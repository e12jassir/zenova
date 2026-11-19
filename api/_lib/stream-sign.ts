import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Firma de URLs del proxy HLS.
 *
 * Sin esto, `/api/hls?u=...` es un proxy abierto: cualquiera puede usarlo para
 * escanear tu red interna o pegarle a `169.254.169.254` (metadata del cloud).
 * La URL se firma en `/api/stream` y solo esa forma entra al proxy.
 */

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

const signingSecret = (): string => {
  const secret = process.env.STREAM_SIGNING_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
    throw new Error("STREAM_SIGNING_SECRET_MISSING");
  }
  // Fallback de desarrollo. En producción define STREAM_SIGNING_SECRET.
  return "zenova-dev-stream-secret-do-not-ship";
};

const mac = (url: string, exp: number): string =>
  createHmac("sha256", signingSecret()).update(`${url}\n${exp}`).digest("base64url");

export interface SignedStreamUrl {
  readonly url: string;
  readonly exp: number;
  readonly sig: string;
}

export const signStreamUrl = (
  url: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SignedStreamUrl => {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { url, exp, sig: mac(url, exp) };
};

/** Ruta relativa lista para el `<video>` del cliente. */
export const proxiedStreamPath = (url: string, ttlSeconds?: number): string => {
  const signed = signStreamUrl(url, ttlSeconds);
  const params = new URLSearchParams({
    u: signed.url,
    e: String(signed.exp),
    s: signed.sig,
  });
  return `/api/hls?${params.toString()}`;
};

export const verifyStreamSignature = (
  url: string,
  expRaw: string | undefined,
  sig: string | undefined,
): { ok: true } | { ok: false; reason: string } => {
  if (!url || !sig || !expRaw) return { ok: false, reason: "missing_signature" };

  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp)) return { ok: false, reason: "bad_expiry" };
  if (exp * 1000 < Date.now()) return { ok: false, reason: "expired" };

  const expected = Buffer.from(mac(url, exp), "utf8");
  const received = Buffer.from(sig, "utf8");
  if (expected.length !== received.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: "bad_signature" };

  return { ok: true };
};

const ipv4ToInt = (ip: string): number =>
  ip.split(".").reduce((acc, part) => (acc << 8) + Number.parseInt(part, 10), 0) >>> 0;

const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const isBlockedV4 = (ip: string): boolean => {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
};

const isBlockedV6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;

  // IPv4 mapeada en forma decimal (::ffff:127.0.0.1)
  const dotted = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isBlockedV4(dotted[1]);

  // Node normaliza `[::ffff:127.0.0.1]` a `[::ffff:7f00:1]`: dos grupos hex.
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedV4(v4);
  }

  // NAT64 (64:ff9b::/96) también puede envolver un destino IPv4 interno.
  const nat64 = normalized.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) {
    const hi = Number.parseInt(nat64[1], 16);
    const lo = Number.parseInt(nat64[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedV4(v4);
  }

  return false;
};

/**
 * Valida esquema y destino real. Resuelve el DNS para que un dominio que
 * apunta a 127.0.0.1 no se cuele por el nombre.
 */
export const assertPublicHttpUrl = async (
  raw: string,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "bad_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "bad_protocol" };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    const blocked = isIP(host) === 4 ? isBlockedV4(host) : isBlockedV6(host);
    return blocked ? { ok: false, reason: "private_host" } : { ok: true, url: parsed };
  }

  // `localhost` y TLDs internos no pasan por DNS público.
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "private_host" };
  }

  try {
    const records = await lookup(host, { all: true });
    if (records.length === 0) return { ok: false, reason: "dns_failed" };
    const blocked = records.some((record) =>
      record.family === 4 ? isBlockedV4(record.address) : isBlockedV6(record.address),
    );
    return blocked ? { ok: false, reason: "private_host" } : { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
};
