/**
 * Direct-stream contract.
 *
 * Un `IStreamResolver` corre SOLO en el servidor (`/api/stream`). Devuelve
 * referencias a un stream reproducible, nunca HTML de una página con anuncios.
 * Esto es lo que separa esta capa del sistema de iframes: aquí no hay página,
 * así que no hay dónde poner publicidad.
 */

export type StreamKind = 'hls' | 'mp4';

export interface StreamRequest {
  readonly imdbId: string;
  readonly type: 'movie' | 'series';
  readonly season?: number;
  readonly episode?: number;
  /** Año de estreno, cuando el proveedor lo necesita para desambiguar. */
  readonly year?: number;
  /** Título original, cuando el proveedor busca por texto en vez de por id. */
  readonly title?: string;
  /**
   * Duración en minutos según el catálogo (TMDB). Es la señal que distingue
   * remakes del mismo título cuando el proveedor no trae año.
   */
  readonly runtimeMinutes?: number;
}

export interface StreamSubtitle {
  readonly url: string;
  readonly label: string;
  readonly lang: string;
  readonly default?: boolean;
}

export interface StreamSource {
  readonly providerId: string;
  readonly providerName: string;
  /** URL absoluta upstream. Nunca sale del servidor sin pasar por el proxy. */
  readonly url: string;
  readonly kind: StreamKind;
  readonly quality?: string;
  /** Código ISO-639-1: 'es', 'en', 'es-LA'. */
  readonly language?: string;
  /** Cabeceras que el upstream exige (Referer, Origin, User-Agent). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly subtitles?: readonly StreamSubtitle[];
  /**
   * `false` = el cliente recibe la URL tal cual, sin pasar por `/api/hls`.
   *
   * Solo para contenido público que no necesita Referer ni oculta tokens
   * (Archive.org, por ejemplo). Ahorra el bandwidth del proxy, que es el costo
   * real de esta arquitectura. Por defecto `true`: se proxiá y se firma.
   */
  readonly requiresProxy?: boolean;
}

export interface IStreamResolver {
  readonly id: string;
  readonly name: string;
  /** Menor es mejor. */
  readonly priority: number;
  canResolve(request: StreamRequest): boolean;
  resolve(request: StreamRequest): Promise<readonly StreamSource[]>;
}

export const isUsableStreamRequest = (request: StreamRequest): boolean =>
  request.imdbId.trim().length > 0;

/** Rechaza fuentes sin URL absoluta http(s); un resolver roto no debe tumbar el registry. */
export const isUsableSource = (source: StreamSource): boolean => {
  if (!source.url || typeof source.url !== 'string') return false;
  try {
    const parsed = new URL(source.url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const streamKindOf = (url: string): StreamKind =>
  /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4';
