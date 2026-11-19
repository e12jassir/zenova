import type { EpisodePointer, JellyfinConfig, MediaItem } from "./types";
import type { ResolvedStreamSource } from "./native-stream";

export interface JellyfinTestResult {
  ok: boolean;
  serverName?: string;
  userId?: string;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 5000;
const WEB_NATIVE_CONTAINERS = new Set(["mp4", "m4v", "webm", "mov"]);

interface JellyfinMediaStream {
  Type?: string;
  Index?: number;
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsTextSubtitleStream?: boolean;
  Height?: number;
}

interface JellyfinMediaSource {
  Id?: string;
  Container?: string;
  MediaStreams?: JellyfinMediaStream[];
}

interface JellyfinItem {
  Id?: string;
  Name?: string;
  ProductionYear?: number;
  IndexNumber?: number;
  ProviderIds?: Record<string, string | undefined>;
  MediaSources?: JellyfinMediaSource[];
}

interface JellyfinItemsResponse {
  Items?: JellyfinItem[];
}

interface JellyfinPublicInfo {
  ServerName?: string;
}

interface JellyfinUser {
  Id?: string;
}

export function normalizeJellyfinUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProto.replace(/\/+$/, "");
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /^\d{4}/.exec(raw.trim());
  if (!match) return undefined;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getImdbId(item: JellyfinItem): string | undefined {
  return item.ProviderIds?.Imdb ?? item.ProviderIds?.imdb;
}

function findMatchingCandidate(candidates: JellyfinItem[], item: MediaItem): JellyfinItem | null {
  if (candidates.length === 0) return null;

  const byImdb = candidates.find((c) => getImdbId(c) === item.id);
  if (byImdb) return byImdb;

  const targetTitle = normalizeTitle(item.title);
  if (!targetTitle) return null;
  const itemYear = extractYear(item.year);

  const titleMatches = candidates.filter((c) => {
    if (!c.Name || normalizeTitle(c.Name) !== targetTitle) return false;
    if (itemYear !== undefined && typeof c.ProductionYear === "number") {
      return Math.abs(c.ProductionYear - itemYear) <= 2;
    }
    return true;
  });

  if (titleMatches.length === 0) return null;
  if (itemYear === undefined || titleMatches.length === 1) return titleMatches[0];

  return [...titleMatches].sort((a, b) => {
    const da = typeof a.ProductionYear === "number" ? Math.abs(a.ProductionYear - itemYear) : 99;
    const db = typeof b.ProductionYear === "number" ? Math.abs(b.ProductionYear - itemYear) : 99;
    return da - db;
  })[0];
}

function isWebNativeContainer(container: string | undefined): boolean {
  if (!container) return false;
  const primary = container.toLowerCase().split(",")[0]?.trim() ?? "";
  return WEB_NATIVE_CONTAINERS.has(primary);
}

function detectQuality(streams: JellyfinMediaStream[] | undefined): string | null {
  const height = streams?.find((s) => s.Type === "Video")?.Height;
  if (!height || height <= 0) return null;
  if (height >= 2160) return "4K";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  return `${height}p`;
}

function detectAudioLanguage(streams: JellyfinMediaStream[] | undefined): string | null {
  const audioStreams = streams?.filter((s) => s.Type === "Audio") ?? [];
  const preferred = audioStreams.find((s) => s.IsDefault) ?? audioStreams[0];
  return preferred?.Language ?? null;
}

export async function testJellyfinConnection(
  url: string,
  apiKey: string,
): Promise<JellyfinTestResult> {
  const base = normalizeJellyfinUrl(url);
  const token = apiKey.trim();

  if (!base) {
    return { ok: false, error: "URL del servidor requerida" };
  }
  if (!token) {
    return { ok: false, error: "API Key requerida" };
  }

  try {
    const infoRes = await fetch(`${base}/System/Info/Public`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!infoRes.ok) {
      return { ok: false, error: `No se pudo conectar (HTTP ${infoRes.status})` };
    }

    const info = (await infoRes.json()) as JellyfinPublicInfo;
    const serverName = info.ServerName;

    const usersRes = await fetch(`${base}/Users`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "X-Emby-Token": token,
      },
    });

    if (usersRes.status === 401 || usersRes.status === 403) {
      return { ok: false, error: "API Key inválida o rechazada" };
    }

    if (!usersRes.ok) {
      return { ok: false, error: `Error al validar usuario (HTTP ${usersRes.status})` };
    }

    const users = (await usersRes.json()) as JellyfinUser[];
    const userId = Array.isArray(users) ? users[0]?.Id : undefined;

    return { ok: true, serverName, userId };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Error de red al conectar con Jellyfin";
    return { ok: false, error: message };
  }
}

export async function resolveJellyfinStream(
  config: JellyfinConfig,
  item: MediaItem,
  episode?: EpisodePointer,
): Promise<ResolvedStreamSource | null> {
  if (!config.url || !config.apiKey) return null;

  const base = normalizeJellyfinUrl(config.url);
  const token = config.apiKey.trim();
  if (!base || !token) return null;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Emby-Token": token,
    };
    const itemType = item.type === "series" ? "Series" : "Movie";

    const searchUrl =
      `${base}/Items?Recursive=true&Fields=ProviderIds,MediaSources,ProductionYear` +
      `&IncludeItemTypes=${itemType}&SearchTerm=${encodeURIComponent(item.title)}`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers,
    });

    if (!searchRes.ok) return null;

    const searchPayload = (await searchRes.json()) as JellyfinItemsResponse;
    let candidate = findMatchingCandidate(searchPayload.Items ?? [], item);

    if (!candidate && /^tt\d+$/i.test(item.id)) {
      const imdbUrl =
        `${base}/Items?Recursive=true&Fields=ProviderIds,MediaSources,ProductionYear` +
        `&IncludeItemTypes=${itemType}&AnyProviderIdEquals=imdb.${encodeURIComponent(item.id)}&Limit=10`;
      const imdbRes = await fetch(imdbUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers,
      });
      if (imdbRes.ok) {
        const imdbPayload = (await imdbRes.json()) as JellyfinItemsResponse;
        candidate = (imdbPayload.Items ?? []).find((c) => getImdbId(c) === item.id) ?? null;
      }
    }

    if (!candidate?.Id) return null;

    let targetMedia: JellyfinItem | null = candidate;

    if (item.type === "series") {
      const season = episode?.season ?? 1;
      const episodeNumber = episode?.episode ?? 1;
      const epUrl = `${base}/Shows/${encodeURIComponent(candidate.Id)}/Episodes?Season=${season}&Fields=MediaSources`;
      const epRes = await fetch(epUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers,
      });
      if (!epRes.ok) return null;

      const epPayload = (await epRes.json()) as JellyfinItemsResponse;
      targetMedia =
        (epPayload.Items ?? []).find((ep) => ep.IndexNumber === episodeNumber) ?? null;
    }

    const mediaId = targetMedia?.Id;
    const source = targetMedia?.MediaSources?.[0];
    if (!mediaId || !source) return null;

    const sourceId = source.Id ?? mediaId;
    const encodedKey = encodeURIComponent(token);
    const webNative = isWebNativeContainer(source.Container);
    const kind: ResolvedStreamSource["kind"] = webNative ? "mp4" : "hls";

    const streamUrl = webNative
      ? `${base}/Videos/${mediaId}/stream?Static=true&MediaSourceId=${sourceId}&api_key=${encodedKey}`
      : `${base}/Videos/${mediaId}/master.m3u8?MediaSourceId=${sourceId}&VideoCodec=h264&AudioCodec=aac&TranscodingMaxAudioChannels=2&api_key=${encodedKey}`;

    const subtitles = (source.MediaStreams ?? [])
      .filter(
        (s): s is JellyfinMediaStream & { Index: number } =>
          s.Type === "Subtitle" &&
          typeof s.Index === "number" &&
          s.IsTextSubtitleStream !== false,
      )
      .map((s) => ({
        url: `${base}/Videos/${mediaId}/${sourceId}/Subtitles/${s.Index}/Stream.vtt?api_key=${encodedKey}`,
        label: s.DisplayTitle || s.Language || "Subtítulo",
        lang: s.Language || "es",
        default: Boolean(s.IsDefault),
      }));

    return {
      providerId: "jellyfin",
      providerName: "Jellyfin Personal",
      kind,
      quality: detectQuality(source.MediaStreams),
      language: detectAudioLanguage(source.MediaStreams),
      url: streamUrl,
      subtitles,
    };
  } catch {
    return null;
  }
}
