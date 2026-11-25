/**
 * Shared rate-limiting, timeout, and abort-safe JSON fetching for artwork adapters.
 */

export class ArtworkAdapterError extends Error {
  readonly source: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(source: string, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ArtworkAdapterError";
    this.source = source;
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable ?? true;
  }
}

export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextAllowedAt = 0;
  private cooldownUntil = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(minIntervalMs: number) {
    this.minIntervalMs = Math.max(50, minIntervalMs);
  }

  isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  cooldown(ms: number): void {
    const until = Date.now() + ms;
    this.cooldownUntil = Math.max(this.cooldownUntil, until);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, until);
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (this.isCoolingDown()) {
      return Promise.reject(new ArtworkAdapterError("rate-limit", "Provider is temporarily cooling down.", { status: 429, retryable: true }));
    }
    const wait = this.chain.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.nextAllowedAt - now);
      this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minIntervalMs;
      if (delay > 0) await abortableSleep(delay, signal);
    });
    this.chain = wait.catch(() => undefined);
    return wait;
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchArtworkJson<T>(options: {
  source: string;
  url: string;
  limiter: RateLimiter;
  signal?: AbortSignal;
  timeoutMs?: number;
  treat404AsNull?: boolean;
}): Promise<T | null> {
  const { source, url, limiter, signal, timeoutMs = 10_000, treat404AsNull = false } = options;
  await limiter.acquire(signal);

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    if (treat404AsNull && response.status === 404) {
      return null;
    }

    if (response.status === 429 || response.status === 503) {
      limiter.cooldown(30_000);
      throw new ArtworkAdapterError(source, `${source} rate limit reached (${response.status}).`, {
        status: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      throw new ArtworkAdapterError(source, `${source} returned HTTP ${response.status}.`, {
        status: response.status,
        retryable: response.status >= 500,
      });
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ArtworkAdapterError(source, `${source} request timed out.`, { retryable: true });
    }
    if (error instanceof ArtworkAdapterError) throw error;
    throw new ArtworkAdapterError(source, `${source} request failed.`, { retryable: true });
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

export function forceHttps(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice(7)}`;
  if (trimmed.startsWith("https://")) return trimmed;
  return "";
}
