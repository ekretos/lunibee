import { Collection } from "./index.js";

/** Cache policy for bounded resource storage. */
export interface CacheOptions {
  /** Maximum number of entries retained. */
  maxSize?: number;
  /** Time-to-live in milliseconds. Omit to disable expiration. */
  ttl?: number;
  /** Sweep interval in milliseconds. */
  sweepInterval?: number;
}

type Entry<V> = { value: V; expiresAt: number };

/** Bounded cache with TTL expiration and explicit invalidation support. */
export class Cache<K, V> {
  readonly #entries = new Collection<K, Entry<V>>();
  readonly #maxSize: number;
  readonly #ttl: number;
  #timer?: ReturnType<typeof setInterval>;

  /** Creates a cache using the supplied retention policy. */
  public constructor(options: CacheOptions = {}) {
    this.#maxSize = options.maxSize ?? Infinity;
    this.#ttl = options.ttl ?? 0;
    if (
      (!Number.isInteger(this.#maxSize) && this.#maxSize !== Infinity) ||
      this.#maxSize < 1
    )
      throw new RangeError("Cache maxSize must be a positive integer.");
    if (!Number.isFinite(this.#ttl) || this.#ttl < 0)
      throw new RangeError("Cache ttl must be a non-negative finite number.");
    if (this.#ttl > 0) {
      const interval = options.sweepInterval ?? Math.min(this.#ttl, 60_000);
      if (!Number.isFinite(interval) || interval < 1)
        throw new RangeError("Cache sweepInterval must be positive.");
      this.#timer = setInterval(() => this.sweep(), interval);
    }
  }

  /** Number of currently live entries. */
  public get size(): number {
    this.#sweepExpired();
    return this.#entries.size;
  }
  /** Reads a live entry. */
  public get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }
  /** Returns whether a live entry exists. */
  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }
  /** Stores an entry and evicts the oldest entries when the bound is exceeded. */
  public set(key: K, value: V): this {
    const expiresAt = this.#ttl > 0 ? Date.now() + this.#ttl : 0;
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt });
    while (this.#entries.size > this.#maxSize) {
      const oldest = this.#entries.firstKey();
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    return this;
  }
  /** Invalidates one key. */
  public delete(key: K): boolean {
    return this.#entries.delete(key);
  }
  /** Invalidates every cached resource. */
  public clear(): void {
    this.#entries.clear();
  }
  /** Invalidates every entry matching a predicate. */
  public invalidate(predicate: (value: V, key: K) => boolean): number {
    return this.#entries.sweep((entry, key) => predicate(entry.value, key));
  }
  /** Removes expired entries and returns the number removed. */
  public sweep(): number {
    return this.#entries.sweep((entry) => this.#expired(entry));
  }
  /** Stops the background sweeper and releases its timer. */
  public dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
  /** Returns live cached values. */
  public values(): V[] {
    this.#sweepExpired();
    return this.#entries.map((entry) => entry.value);
  }
  /** Returns live cached entries. */
  public entries(): [K, V][] {
    this.#sweepExpired();
    return this.#entries.map((entry, key) => [key, entry.value]);
  }
  #expired(entry: Entry<V>): boolean {
    return entry.expiresAt > 0 && entry.expiresAt <= Date.now();
  }
  #sweepExpired(): void {
    if (this.#ttl > 0) this.sweep();
  }
}
