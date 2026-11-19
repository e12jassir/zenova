import type { IStreamResolver, StreamRequest, StreamSource } from '../types.js';

/**
 * Resolver de dominio público (Internet Archive).
 *
 * Archive publica películas cuya copyright expiró o que sus autores liberaron.
 * No hay página, no hay iframe, no hay anuncio: el item devuelve un `.mp4`
 * servido con `Range`, así que se reproduce directo sin proxy.
 *
 * Dos reglas que evitan el peor error posible de este resolver —reproducir la
 * película equivocada:
 *
 *  1. El título tiene que coincidir (por tokens, no por substring suelto).
 *  2. Si conocemos el año en ambos lados, no puede diferir en más de 2.
 *
 * Si no hay coincidencia segura, devuelve `[]` y el reproductor cae al iframe.
 * Un falso negativo cuesta un click; un falso positivo cuesta confianza.
 */

const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata';
const DOWNLOAD_URL = 'https://archive.org/download';

/** Presupuesto total del resolver. El `StreamManager` corta a los 6 s. */
const TOTAL_BUDGET_MS = 5500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 4;
/** Por debajo de 20 min es un corto, un trailer o una conferencia. */
const MIN_DURATION_SECONDS = 20 * 60;
const MIN_SIDE = 240;
/** Un master de archivo de 20 GB no se puede streamear: mejor caer al iframe. */
const MAX_FILE_BYTES = 6 * 1024 ** 3;
const MAX_YEAR_DRIFT = 2;
/** Tolerancia de duración: cubre cortes distintos sin aceptar otro contenido. */
const RUNTIME_TOLERANCE = 0.12;

interface ArchiveDoc {
  readonly identifier?: string;
  readonly title?: string;
  readonly year?: string | number;
}

interface ArchiveFile {
  readonly name?: string;
  readonly format?: string;
  readonly size?: string;
  readonly length?: string;
  readonly width?: string;
  readonly height?: string;
}

interface ArchiveMetadata {
  readonly metadata?: {
    readonly title?: string;
    readonly year?: string | number;
    readonly date?: string;
    readonly collection?: string | readonly string[];
  };
  readonly files?: readonly ArchiveFile[];
}

interface Candidate {
  readonly identifier: string;
  readonly title: string;
  readonly year?: number;
  readonly collections: readonly string[];
  readonly file: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly length: number;
  };
}

interface CacheEntry {
  readonly at: number;
  readonly sources: readonly StreamSource[];
}

const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Coincidencia por tokens: "nosferatu" sí casa con "fw murnaus nosferatu". */
const titleMatches = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  return ` ${long} `.includes(` ${short} `);
};

const parseYear = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? '').slice(0, 4), 10);
  return Number.isFinite(parsed) && parsed > 1800 && parsed < 2100 ? parsed : undefined;
};

/**
 * Año escondido en el título o al final del identificador.
 *
 * `fw-murnaus-nosferatu-1922` → 1922 · `... ( 1979)` → 1979.
 * `nosferatu_201508` NO produce nada: seis dígitos al final son fecha de
 * subida, no año de la película. Esa distinción evita confundir remakes.
 */
const YEAR_IN_TITLE = /\((1[89]\d{2}|20\d{2})\)/;
const YEAR_AT_END_OF_ID = /(?:^|[-_])(1[89]\d{2}|20\d{2})$/;

const yearHint = (title: string, identifier: string): number | undefined => {
  const inTitle = title.match(YEAR_IN_TITLE);
  if (inTitle) return Number.parseInt(inTitle[1], 10);
  const inId = identifier.match(YEAR_AT_END_OF_ID);
  if (inId) return Number.parseInt(inId[1], 10);
  return undefined;
};

/**
 * Cuando el proveedor no trae año, la duración del archivo delata si es la
 * misma película: un remake de 132 min no pasa por un archivo de 90 min.
 */
const runtimeMatches = (
  lengthSeconds: number,
  runtimeMinutes: number | undefined,
): boolean => {
  if (!runtimeMinutes || runtimeMinutes <= 0) return false;
  if (!lengthSeconds) return false;
  const expected = runtimeMinutes * 60;
  return Math.abs(lengthSeconds - expected) / expected <= RUNTIME_TOLERANCE;
};

const collectionList = (value: string | readonly string[] | undefined): readonly string[] =>
  Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

const isFeatureCollection = (collections: readonly string[]): boolean =>
  collections.some((name) => name.startsWith('feature_films'));

/** Elige el mp4 con más resolución; entre iguales, el derivado listo para streaming. */
const pickBestFile = (files: readonly ArchiveFile[]): Candidate['file'] | null => {
  const usable = files
    .filter((file) => typeof file.name === 'string' && /\.(mp4|m4v)$/i.test(file.name))
    .map((file) => ({
      name: file.name as string,
      width: Number.parseInt(String(file.width ?? ''), 10) || 0,
      height: Number.parseInt(String(file.height ?? ''), 10) || 0,
      size: Number.parseInt(String(file.size ?? ''), 10) || 0,
      length: Number.parseFloat(String(file.length ?? '')) || 0,
      // `.ia.mp4` (h.264 IA) es el derivado que Archive optimiza para reproducir.
      streaming: /h\.?264|ia\b/i.test(String(file.format ?? '')),
    }))
    .filter((file) => file.width >= MIN_SIDE && file.height >= MIN_SIDE)
    .filter((file) => file.length >= MIN_DURATION_SECONDS)
    .filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES);

  usable.sort((a, b) => {
    const areaDiff = b.width * b.height - a.width * a.height;
    if (areaDiff !== 0) return areaDiff;
    if (a.streaming !== b.streaming) return a.streaming ? -1 : 1;
    return b.size - a.size;
  });

  const best = usable[0];
  return best
    ? { name: best.name, width: best.width, height: best.height, length: best.length }
    : null;
};

/** Codifica cada segmento del nombre: hay archivos dentro de subcarpetas. */
const downloadUrl = (identifier: string, name: string): string =>
  `${DOWNLOAD_URL}/${encodeURIComponent(identifier)}/${name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

export class ArchiveStreamResolver implements IStreamResolver {
  readonly id = 'archive';
  readonly name = 'Internet Archive (dominio público)';
  readonly priority = 10;

  private readonly cache = new Map<string, CacheEntry>();

  canResolve(request: StreamRequest): boolean {
    // Archive cataloga películas, no episodios sueltos de una serie.
    if (request.type !== 'movie') return false;
    return Boolean(request.title && normalize(request.title).length >= 3);
  }

  async resolve(request: StreamRequest): Promise<readonly StreamSource[]> {
    const title = request.title?.trim();
    if (!title) return [];

    const cacheKey = `${normalize(title)}|${request.year ?? ''}|${request.runtimeMinutes ?? ''}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.sources;

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const remaining = () => Math.max(400, deadline - Date.now());

    const requestedTitle = normalize(title);

    let docs = await this.search(`title:("${title.replace(/"/g, '')}") AND mediatype:(movies) AND collection:(feature_films)`, remaining);
    if (docs.length === 0) {
      docs = await this.search(`title:("${title.replace(/"/g, '')}") AND mediatype:(movies)`, remaining);
    }
    if (docs.length === 0) {
      this.remember(cacheKey, []);
      return [];
    }

    const candidates = (
      await Promise.all(
        docs
          .filter((doc): doc is ArchiveDoc & { identifier: string } => Boolean(doc.identifier))
          .slice(0, MAX_CANDIDATES)
          .map((doc) => this.inspect(doc, requestedTitle, request, remaining)),
      )
    ).filter((candidate): candidate is Candidate => candidate !== null);

    if (candidates.length === 0) {
      this.remember(cacheKey, []);
      return [];
    }

    // Preferimos lo que está en `feature_films` y, entre eso, la mejor resolución.
    candidates.sort((a, b) => {
      const featureDiff = Number(isFeatureCollection(b.collections)) - Number(isFeatureCollection(a.collections));
      if (featureDiff !== 0) return featureDiff;
      return b.file.width * b.file.height - a.file.width * a.file.height;
    });

    const best = candidates[0];
    const sources: readonly StreamSource[] = [
      {
        providerId: this.id,
        providerName: this.name,
        url: downloadUrl(best.identifier, best.file.name),
        kind: 'mp4',
        quality: `${best.file.width}x${best.file.height}`,
        language: 'en',
        // Contenido público y estable: no hace falta gastar bandwidth de Vercel.
        requiresProxy: false,
      },
    ];

    this.remember(cacheKey, sources);
    return sources;
  }

  private remember(key: string, sources: readonly StreamSource[]): void {
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(key, { at: Date.now(), sources });
  }

  private async search(query: string, remaining: () => number): Promise<ArchiveDoc[]> {
    const url =
      `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year' +
      '&sort%5B%5D=downloads+desc&rows=12&page=1&output=json';

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'zenova-stream/1.0' },
        signal: AbortSignal.timeout(remaining()),
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as { response?: { docs?: ArchiveDoc[] } };
      return payload.response?.docs ?? [];
    } catch {
      return [];
    }
  }

  private async inspect(
    doc: ArchiveDoc & { identifier: string },
    requestedTitle: string,
    request: StreamRequest,
    remaining: () => number,
  ): Promise<Candidate | null> {
    try {
      const response = await fetch(`${METADATA_URL}/${encodeURIComponent(doc.identifier)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'zenova-stream/1.0' },
        signal: AbortSignal.timeout(remaining()),
      });
      if (!response.ok) return null;

      const data = (await response.json()) as ArchiveMetadata;
      const meta = data.metadata ?? {};
      const title = String(meta.title ?? doc.title ?? '');
      if (!titleMatches(normalize(title), requestedTitle)) return null;

      const collections = collectionList(meta.collection);
      // Primero el año declarado; si no hay, el que esté en el título o el id.
      const year = parseYear(meta.year ?? meta.date ?? doc.year) ?? yearHint(title, doc.identifier);

      const file = pickBestFile(data.files ?? []);
      if (!file) return null;

      if (request.year && year && Math.abs(request.year - year) > MAX_YEAR_DRIFT) {
        return null;
      }

      /*
       * Sin año declarado, la colección curada avala que es una película y la
       * duración confirma que es ESTA película. `26.10.2001 Inception` vive en
       * `community` y su duración coincide por casualidad con la de Nolan.
       *
       * Si no hay duración con la que comparar, no hay certeza: se descarta.
       */
      if (!year) {
        if (!isFeatureCollection(collections)) return null;
        if (!runtimeMatches(file.length, request.runtimeMinutes)) return null;
      }

      /*
       * La duración manda incluso cuando el año cuadra: un archivo de otra
       * duración es otro contenido, y reproducir la película equivocada es
       * peor que caer al iframe.
       */
      if (request.runtimeMinutes && file.length > 0 && !runtimeMatches(file.length, request.runtimeMinutes)) {
        return null;
      }

      return { identifier: doc.identifier, title, year, collections, file };
    } catch {
      return null;
    }
  }
}
