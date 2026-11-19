export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly recoveryCooldownMs: number;
}

interface PersistedCircuitRecord {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
}

const STORAGE_KEY = 'pelisstream:provider-health:v1';

function readHealthStore(): Record<string, PersistedCircuitRecord> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, PersistedCircuitRecord>)
      : {};
  } catch {
    return {};
  }
}

function writeHealthStore(providerId: string, record: PersistedCircuitRecord | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const store = readHealthStore();
    if (record) {
      store[providerId] = record;
    } else {
      delete store[providerId];
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* Ignore storage quota or private-mode restrictions */
  }
}

export class ProviderCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    readonly providerId: string,
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 2,
      recoveryCooldownMs: 120_000,
    },
  ) {
    const saved = readHealthStore()[providerId];
    if (saved && typeof saved.failureCount === 'number' && typeof saved.lastFailureTime === 'number') {
      this.failureCount = saved.failureCount;
      this.lastFailureTime = saved.lastFailureTime;
      this.state = saved.state === 'OPEN' || saved.state === 'HALF_OPEN' ? saved.state : 'CLOSED';
    }
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.config.recoveryCooldownMs) {
        this.state = 'HALF_OPEN';
        writeHealthStore(this.providerId, {
          state: this.state,
          failureCount: this.failureCount,
          lastFailureTime: this.lastFailureTime,
        });
      }
    }
    return this.state;
  }

  isAvailable(): boolean {
    const s = this.getState();
    return s === 'CLOSED' || s === 'HALF_OPEN';
  }

  recordSuccess(): void {
    if (this.failureCount === 0 && this.state === 'CLOSED') return;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'CLOSED';
    writeHealthStore(this.providerId, null);
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
    writeHealthStore(this.providerId, {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    });
  }

  reset(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
    writeHealthStore(this.providerId, null);
  }
}
