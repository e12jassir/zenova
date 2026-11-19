import { ProviderCircuitBreaker } from '../providers/circuit-breaker.js';
import {
  isUsableSource,
  isUsableStreamRequest,
  type IStreamResolver,
  type StreamRequest,
  type StreamSource,
} from './types.js';

export interface StreamAttempt {
  readonly providerId: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly sourceCount: number;
  readonly error?: string;
}

export interface StreamResolution {
  readonly sources: readonly StreamSource[];
  readonly attempts: readonly StreamAttempt[];
}

export interface StreamManagerOptions {
  /** Corta un resolver colgado. Un upstream lento no puede bloquear la respuesta. */
  readonly timeoutMs?: number;
  /** Cuántos resolvers se consultan antes de devolver lo que haya. */
  readonly maxResolvers?: number;
}

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_RESOLVERS = 4;

const withTimeout = <T>(task: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const sortByPreference = (sources: readonly StreamSource[]): StreamSource[] =>
  [...sources].sort((a, b) => {
    // HLS primero: es lo que el player nativo reproduce con adaptación de bitrate.
    if (a.kind !== b.kind) return a.kind === 'hls' ? -1 : 1;
    const rank = (source: StreamSource) =>
      source.language?.toLowerCase().startsWith('es') ? 0 : 1;
    return rank(a) - rank(b);
  });

/**
 * Registry de resolvers de stream directo.
 *
 * Corre únicamente en el servidor. Su trabajo es devolver URLs reproducibles,
 * no páginas. Reutiliza el mismo circuit breaker que el sistema de iframes para
 * que un proveedor caído no arrastre al resto.
 */
export class StreamManager {
  private readonly resolvers = new Map<string, IStreamResolver>();
  private readonly breakers = new Map<string, ProviderCircuitBreaker>();
  private readonly timeoutMs: number;
  private readonly maxResolvers: number;

  constructor(
    resolvers: readonly IStreamResolver[] = [],
    options: StreamManagerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResolvers = options.maxResolvers ?? DEFAULT_MAX_RESOLVERS;
    for (const resolver of resolvers) this.register(resolver);
  }

  register(resolver: IStreamResolver): void {
    if (this.resolvers.has(resolver.id)) {
      throw new Error(`Resolver de stream duplicado: ${resolver.id}`);
    }
    this.resolvers.set(resolver.id, resolver);
    this.breakers.set(resolver.id, new ProviderCircuitBreaker(resolver.id));
  }

  getAll(): IStreamResolver[] {
    return Array.from(this.resolvers.values()).sort(
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    );
  }

  getAvailable(): IStreamResolver[] {
    const healthy = this.getAll().filter(
      (resolver) => this.breakers.get(resolver.id)?.isAvailable() ?? true,
    );
    return healthy.length > 0 ? healthy : this.getAll();
  }

  get(id: string): IStreamResolver | undefined {
    return this.resolvers.get(id);
  }

  async resolve(
    request: StreamRequest,
    options: StreamManagerOptions = {},
  ): Promise<StreamResolution> {
    if (!isUsableStreamRequest(request)) {
      return { sources: [], attempts: [] };
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxResolvers = options.maxResolvers ?? this.maxResolvers;

    const candidates = this.getAvailable()
      .filter((resolver) => resolver.canResolve(request))
      .slice(0, maxResolvers);

    const attempts: StreamAttempt[] = [];
    const sources: StreamSource[] = [];

    // Secuencial a propósito: si el primero responde con HLS, no gastamos
    // cuota ni latencia consultando los demás.
    for (const resolver of candidates) {
      const startedAt = Date.now();
      try {
        const found = await withTimeout(
          resolver.resolve(request),
          timeoutMs,
          resolver.id,
        );
        const usable = found.filter(isUsableSource);
        const ms = Date.now() - startedAt;

        attempts.push({
          providerId: resolver.id,
          ok: usable.length > 0,
          ms,
          sourceCount: usable.length,
        });

        if (usable.length > 0) {
          this.breakers.get(resolver.id)?.recordSuccess();
          sources.push(...usable);
          if (usable.some((source) => source.kind === 'hls')) break;
        } else {
          this.breakers.get(resolver.id)?.recordFailure();
        }
      } catch (error) {
        this.breakers.get(resolver.id)?.recordFailure();
        attempts.push({
          providerId: resolver.id,
          ok: false,
          ms: Date.now() - startedAt,
          sourceCount: 0,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    return { sources: sortByPreference(sources), attempts };
  }
}
