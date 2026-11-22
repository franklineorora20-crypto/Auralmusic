/**
 * Cached, rate-limited JSON fetching shared by every provider.
 *
 * - Successful responses are memoised per cache key with a TTL so repeated
 *   navigation and re-renders never re-hit a provider.
 * - Concurrent identical requests share a single in-flight promise.
 * - A per-provider token bucket keeps us inside published rate limits, and a
 *   429/503 response parks that provider for a cooldown window.
 * - Responses are size-checked and JSON-parsed defensively; nothing is trusted.
 */

import type { ProviderId } from "../types/music";

export type CacheTtl = number;

export const TTL = {
  /** Volatile lists such as trending. */
  feed: 5 * 60 * 1000,
  /** Search results. */
  search: 3 * 60 * 1000,
  /** Track / artist / album detail. */
  detail: 30 * 60 * 1000,
  /** Genre sweeps change slowly. */
  genre: 15 * 60 * 1000,
} as const;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

const MAX_CACHE_ENTRIES = 240;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

class ProviderRateLimiter {
  private readonly minIntervalMs: number;
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = Math.ceil(1000 / requestsPerSecond);
  }

  /** Resolves when the caller is allowed to issue a request. */
  acquire(signal?: AbortSignal): Promise<void> {
    const wait = this.chain.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.nextAllowedAt - now);
      this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minIntervalMs;
      if (delay > 0) await sleep(delay, signal);
    });
    this.chain = wait.catch(() => undefined);
    return wait;
  }

  /** Back off this provider for a while after a rate-limit response. */
  cooldown(ms: number): void {
    this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + ms);
  }
}

const limiters: Record<ProviderId, ProviderRateLimiter> = {
  audius: new ProviderRateLimiter(3),
  jamendo: new ProviderRateLimiter(3),
  local: new ProviderRateLimiter(50),
  sample: new ProviderRateLimiter(50),
};

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;

  constructor(provider: ProviderId, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    if (status !== undefined) this.status = status;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isAbortError(error: unknown): boolean {
  return isAbort(error);
}

function pruneCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export type JsonRequest = {
  provider: ProviderId;
  url: string;
  cacheKey: string;
  ttl?: CacheTtl;
  signal?: AbortSignal;
};

async function performRequest<T>({ provider, url }: JsonRequest): Promise<T> {
  const limiter = limiters[provider];
  await limiter.acquire();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    if (response.status === 429 || response.status === 503) {
      limiter.cooldown(20_000);
      throw new ProviderError(provider, `${provider} is rate limiting requests. Try again in a moment.`, response.status);
    }
    if (!response.ok) {
      throw new ProviderError(provider, `${provider} request failed (${response.status}).`, response.status);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new ProviderError(provider, `${provider} returned an oversized response.`);
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ProviderError(provider, `${provider} returned an oversized response.`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(provider, `${provider} returned a malformed JSON response.`);
    }
  } catch (error) {
    if (isAbort(error) && !controller.signal.aborted) throw error;
    if (isAbort(error)) throw new ProviderError(provider, `${provider} timed out. Check your connection.`);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider, `${provider} could not be reached. Check your connection.`);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Fetch JSON with caching, retry-on-transient-failure and abort support.
 * The shared promise is never bound to a single caller's AbortSignal so one
 * cancelled screen cannot cancel the result another screen is waiting for.
 */
export async function fetchJson<T>(request: JsonRequest): Promise<T> {
  const { cacheKey, ttl = TTL.search, signal } = request;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  let pending = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (!pending) {
    pending = performRequest<T>(request)
      .then((value) => {
        cache.set(cacheKey, { expiresAt: Date.now() + ttl, value });
        pruneCache();
        return value;
      })
      .finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }

  if (!signal) return pending;
  return raceWithAbort(pending, signal);
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Drop every cached provider response (used by the "refresh" controls). */
export function clearMusicCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Validation helpers — provider payloads are untrusted input.         */
/* ------------------------------------------------------------------ */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(source: unknown, key: string): string {
  if (!isRecord(source)) return "";
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function readNumber(source: unknown, key: string): number {
  if (!isRecord(source)) return 0;
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function readBoolean(source: unknown, key: string): boolean {
  if (!isRecord(source)) return false;
  const value = source[key];
  return value === true || value === "true" || value === 1;
}

export function readArray(source: unknown, key: string): unknown[] {
  if (!isRecord(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

export function readRecord(source: unknown, key: string): JsonRecord | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

/** Only http(s) URLs are ever handed to <img> or the audio engine. */
export function safeUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    if (url.protocol === "blob:") return url.toString();
    return "";
  } catch {
    return "";
  }
}
