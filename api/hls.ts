import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { assertPublicHttpUrl, proxiedStreamPath, verifyStreamSignature } from "./_lib/stream-sign.js";

/**
 * Proxy HLS.
 *
 * Hace tres cosas y solo tres:
 *  1. Verifica que la URL pedida la firmó nuestro propio `/api/stream`.
 *  2. Bloquea destinos internos (SSRF).
 *  3. Si la respuesta es un manifest, reescribe cada URI para que pase otra vez
 *     por aquí. Sin eso el player pide los segmentos directo al CDN y el
 *     navegador/TV los corta por CORS.
 *
 * No reescribe manifiestos sin `#EXT-X-MAP` y `#EXT-X-KEY`: son el init segment
 * de fMP4 y la llave AES-128. Si se olvidan, el video no arranca o no descifra.
 */

const MANIFEST_TTL = 5;
const SEGMENT_TTL = 3600;

const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

const MAX_REDIRECTS = 5;

/**
 * `redirect: "follow"` deja escapar el filtro: una URL pública puede redirigir
 * a `127.0.0.1` y el SSRF vuelve por la puerta de atrás. Aquí cada salto se
 * valida otra vez contra la lista de rangos bloqueados.
 */
export const followSafely = async (
  start: URL,
  method: "GET" | "HEAD",
  range?: string,
  clientSignal?: AbortSignal,
): Promise<{ response: Response; finalUrl: URL } | { error: string }> => {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hopController = new AbortController();
    const onClientAbort = () => hopController.abort();
    if (clientSignal?.aborted) return { error: "client_aborted" };
    clientSignal?.addEventListener("abort", onClientAbort, { once: true });
    // Timeout solo para conectar y recibir cabeceras; el streaming de cuerpo continúa sin corte fijo a 15s.
    const headerTimer = setTimeout(() => hopController.abort(), 15_000);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        ...BROWSER_HEADERS,
        // Muchos CDN validan Referer contra su propio dominio de origen.
        Referer: `${current.protocol}//${current.host}/`,
        Origin: `${current.protocol}//${current.host}`,
      };
      if (range) {
        headers.Range = range;
      }
      response = await fetch(current, {
        method,
        headers,
        redirect: "manual",
        signal: hopController.signal,
      });
    } catch {
      clientSignal?.removeEventListener("abort", onClientAbort);
      return { error: "upstream_unreachable" };
    } finally {
      clearTimeout(headerTimer);
    }

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current };
    }

    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current };

    clientSignal?.removeEventListener("abort", onClientAbort);
    void response.body?.cancel().catch(() => {});

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { error: "bad_redirect" };
    }

    const checked = await assertPublicHttpUrl(next.toString());
    if (checked.ok === false) return { error: `blocked_redirect:${checked.reason}` };
    current = checked.url;
  }

  return { error: "too_many_redirects" };
};

const URI_ATTRIBUTE = /URI="([^"]+)"/g;

export const isManifest = (contentType: string, url: string, body: string): boolean => {
  if (/mpegurl|vnd\.apple/i.test(contentType)) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  return body.trimStart().startsWith("#EXTM3U");
};

const absolutize = (uri: string, base: string): string => {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
};

/** Reescribe una URI dejándola servible a través de este proxy. */
const rewriteUri = (uri: string, base: string): string => {
  const absolute = absolutize(uri, base);
  // Las llaves de datos (`skd://`, `data:`) y los DRM no se proxean.
  if (!/^https?:\/\//i.test(absolute)) return uri;
  return proxiedStreamPath(absolute);
};

export const rewriteManifest = (body: string, baseUrl: string): string =>
  body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(URI_ATTRIBUTE, (_, uri: string) => `URI="${rewriteUri(uri, baseUrl)}"`);
      }

      return rewriteUri(trimmed, baseUrl);
    })
    .join("\n");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    return res.status(204).end();
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const target = typeof req.query.u === "string" ? req.query.u : "";
  const exp = typeof req.query.e === "string" ? req.query.e : undefined;
  const sig = typeof req.query.s === "string" ? req.query.s : undefined;
  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;

  try {
    const verified = verifyStreamSignature(target, exp, sig);
    if (verified.ok === false) {
      return res.status(403).json({ error: "Firma inválida", reason: verified.reason });
    }

    const safe = await assertPublicHttpUrl(target);
    if (safe.ok === false) {
      return res.status(400).json({ error: "Destino no permitido", reason: safe.reason });
    }

    const upstreamController = new AbortController();
    const fetched = await followSafely(
      safe.url,
      req.method === "HEAD" ? "HEAD" : "GET",
      range,
      upstreamController.signal,
    );
    if ("error" in fetched) {
      return res.status(502).json({ error: "Upstream no respondió", reason: fetched.error });
    }

    const { response: upstream, finalUrl: upstreamUrl } = fetched;

    if (!upstream.ok) {
      return res
        .status(upstream.status === 404 ? 404 : 502)
        .json({ error: "Upstream rechazó la petición", status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const looksLikePlaylist =
      /mpegurl|vnd\.apple/i.test(contentType) || /\.m3u8(\?|$)/i.test(upstreamUrl.toString());

    // Manifiesto: leer texto, reescribir, firmar cada URI.
    if (looksLikePlaylist) {
      const text = await upstream.text();
      if (!isManifest(contentType, upstreamUrl.toString(), text)) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", `public, max-age=${SEGMENT_TTL}, immutable`);
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "HEAD") {
          return res.status(upstream.status).end();
        }
        return res.status(200).send(Buffer.from(text, "utf8"));
      }

      const rewritten = rewriteManifest(text, upstreamUrl.toString());
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", `public, max-age=${MANIFEST_TTL}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "HEAD") {
        return res.status(upstream.status).end();
      }
      return res.status(200).send(rewritten);
    }

    // Segmento o init: passthrough binario.
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType || "application/octet-stream");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", `public, max-age=${SEGMENT_TTL}, immutable`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "HEAD" || !upstream.body) {
      return res.status(upstream.status).end();
    }

    res.status(upstream.status);
    const stream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
    await new Promise<void>((resolve) => {
      const done = () => {
        res.off("finish", done);
        res.off("close", onClose);
        stream.off("error", onStreamError);
        resolve();
      };
      const onClose = () => {
        if (!res.writableFinished) {
          upstreamController.abort();
        }
        stream.destroy();
        done();
      };
      const onStreamError = () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else if (!res.writableEnded) {
          res.end();
        }
        done();
      };
      res.once("finish", done);
      res.once("close", onClose);
      stream.once("error", onStreamError);
      stream.pipe(res);
    });
    return;
  } catch (err) {
    if (err instanceof Error && err.message === "STREAM_SIGNING_SECRET_MISSING") {
      return res.status(503).json({ error: "Secreto de firma de stream no configurado en el servidor." });
    }
    console.error("[hls]", err);
    return res.status(500).json({ error: "Error interno en proxy HLS." });
  }
}
