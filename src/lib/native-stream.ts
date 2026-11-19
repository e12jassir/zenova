import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api';
import { resolveJellyfinStream } from './jellyfin';
import { getProfileData } from './store';
import type { EpisodePointer, MediaItem } from './types';

/**
 * Cliente del pipeline de stream directo.
 *
 * Consulta primero Jellyfin personal (si está configurado) y luego `/api/stream`.
 * Mientras no haya un resolver disponible, la respuesta viene vacía y esta capa
 * se queda callada: el reproductor sigue con el iframe como respaldo.
 */

export interface ResolvedStreamSource {
  readonly providerId: string;
  readonly providerName: string;
  readonly kind: 'hls' | 'mp4';
  readonly quality: string | null;
  readonly language: string | null;
  readonly url: string;
  readonly subtitles: ReadonlyArray<{
    url: string;
    label: string;
    lang: string;
    default?: boolean;
  }>;
}

export interface NativeStreamState {
  readonly source: ResolvedStreamSource | null;
  readonly loading: boolean;
  readonly configured: boolean;
  readonly error: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface CacheEntry {
  readonly at: number;
  readonly state: NativeStreamState;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<NativeStreamState>>();

export function clearNativeStreamCache(): void {
  cache.clear();
}

const EMPTY: NativeStreamState = {
  source: null,
  loading: false,
  configured: false,
  error: null,
};

const cacheKeyOf = (item: MediaItem, episode?: EpisodePointer): string => {
  const jellyfin = getProfileData().settings.jellyfin;
  return [
    item.id,
    item.type,
    episode?.season ?? '',
    episode?.episode ?? '',
    jellyfin?.url ?? '',
  ].join('|');
};

const fetchSources = async (
  item: MediaItem,
  episode: EpisodePointer | undefined,
): Promise<NativeStreamState> => {
  const jf = getProfileData().settings.jellyfin;
  if (jf?.url && jf?.apiKey) {
    const source = await resolveJellyfinStream(jf, item, episode);
    if (source) {
      return {
        source,
        loading: false,
        configured: true,
        error: null,
      };
    }
  }

  const params = new URLSearchParams({ imdb: item.id, type: item.type });
  if (item.type === 'series') {
    params.set('season', String(episode?.season ?? 1));
    params.set('episode', String(episode?.episode ?? 1));
  }
  const year = Number.parseInt(String(item.year), 10);
  if (Number.isFinite(year) && year > 1900) params.set('year', String(year));
  if (item.runtimeMinutes) params.set('runtime', String(item.runtimeMinutes));
  if (item.title) params.set('title', item.title);

  const response = await fetch(apiUrl(`/api/stream?${params.toString()}`), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return { ...EMPTY, error: `HTTP ${response.status}` };
  }

  const payload = (await response.json()) as {
    sources?: ResolvedStreamSource[];
    configured?: boolean;
  };

  const first = Array.isArray(payload.sources) ? payload.sources[0] : undefined;
  return {
    source: first ?? null,
    loading: false,
    configured: Boolean(payload.configured),
    error: null,
  };
};

export function useNativeStream(
  item: MediaItem,
  episode?: EpisodePointer,
  enabled = true,
): NativeStreamState {
  const key = cacheKeyOf(item, episode);
  const [state, setState] = useState<NativeStreamState>(() => {
    const hit = cache.get(key);
    return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.state : { ...EMPTY, loading: enabled };
  });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setState(hit.state);
      return;
    }

    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchSources(item, episode).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    pending
      .then((next) => {
        cache.set(key, { at: Date.now(), state: next });
        if (alive.current) setState(next);
      })
      .catch((error: unknown) => {
        if (!alive.current) return;
        const message = error instanceof Error ? error.message : 'request_failed';
        // Un fallo de red no debe romper el reproductor: cae al iframe.
        setState({ ...EMPTY, error: message });
      });
    // `key` resume item + episodio; los objetos cambian de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
