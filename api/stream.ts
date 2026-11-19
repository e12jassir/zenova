import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/db.js";
import { proxiedStreamPath } from "./_lib/stream-sign.js";
import { ArchiveStreamResolver } from "../src/core/streams/resolvers/archive.resolver.js";
import { DemoStreamResolver } from "../src/core/streams/resolvers/demo.resolver.js";
import { StreamManager } from "../src/core/streams/stream.manager.js";
import type { IStreamResolver, StreamRequest } from "../src/core/streams/types.js";

/**
 * Resolución de fuentes directas.
 *
 * Este endpoint es el único lugar donde vive la lógica de scraping. El cliente
 * pide un título y recibe rutas ya firmadas hacia `/api/hls`; nunca ve la URL
 * upstream ni las cabeceras que el proveedor exige.
 *
 * Excepción: una fuente puede declarar `requiresProxy: false` (contenido público
 * y estable, como Internet Archive). Ahí la URL sí llega al cliente, porque no
 * hay token que proteger y el proxy solo agregaría bandwidth.
 */

const ID_PATTERN = /^[a-zA-Z0-9:_-]{2,40}$/;
const MAX_SOURCES = 6;

const buildManager = (): StreamManager => {
  // Archive sirve películas de dominio público: es el resolver real, siempre activo.
  const resolvers: IStreamResolver[] = [new ArchiveStreamResolver()];
  // El resolver de verificación solo existe si se pide explícitamente y queda
  // de último: nunca le gana a una película real.
  if (process.env.STREAM_DEMO_RESOLVER === "1") {
    resolvers.push(new DemoStreamResolver());
  }
  return new StreamManager(resolvers);
};

const manager = buildManager();

const parseRequest = (query: VercelRequest["query"]): StreamRequest | null => {
  const imdbId = typeof query.imdb === "string" ? query.imdb.trim() : "";
  if (!ID_PATTERN.test(imdbId)) return null;

  const type = query.type === "series" ? "series" : "movie";
  const season = Number.parseInt(String(query.season ?? ""), 10);
  const episode = Number.parseInt(String(query.episode ?? ""), 10);
  const year = Number.parseInt(String(query.year ?? ""), 10);
  const runtime = Number.parseInt(String(query.runtime ?? ""), 10);

  return {
    imdbId,
    type,
    season: Number.isFinite(season) && season > 0 ? season : undefined,
    episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
    year: Number.isFinite(year) && year > 1900 ? year : undefined,
    runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? runtime : undefined,
    title: typeof query.title === "string" ? query.title.trim() : undefined,
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const request = parseRequest(req.query);
  if (!request) {
    return res.status(400).json({ error: "Parámetros inválidos: se requiere `imdb`." });
  }

  try {
    const resolution = await manager.resolve(request);

    const sources = resolution.sources.slice(0, MAX_SOURCES).map((source) => ({
      providerId: source.providerId,
      providerName: source.providerName,
      kind: source.kind,
      quality: source.quality ?? null,
      language: source.language ?? null,
      /**
       * Un resolver puede declarar que su fuente es pública y estable
       * (`requiresProxy: false`). Ahí la URL sale tal cual: el navegador la pide
       * con `Range` sin gastar bandwidth del proxy. El resto se firma.
       */
      url: source.requiresProxy === false ? source.url : proxiedStreamPath(source.url),
      direct: source.requiresProxy === false,
      subtitles: source.subtitles ?? [],
    }));

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

    return res.status(200).json({
      sources,
      attempts: resolution.attempts,
      /**
       * `true` cuando hay al menos un resolver real registrado (no el demo).
       */
      configured: manager.getAll().some((resolver) => resolver.id !== "demo"),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "STREAM_SIGNING_SECRET_MISSING") {
      return res.status(503).json({ error: "Secreto de firma de stream no configurado en el servidor." });
    }
    console.error("[stream]", err);
    return res.status(500).json({ error: "Error interno al resolver stream." });
  }
}
