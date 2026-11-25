import {
  deleteArtworkLookup,
  getArtworkBlob,
  getArtworkLookup,
  saveArtworkBlob,
  saveArtworkLookup,
  touchArtworkBlob,
  type OfflineArtworkLookupRecord,
} from "../../../offline";
import { isDisplayableImageUrl } from "../../lib/mediaMetadata";
import type { ArtworkMetadata, Track } from "../../types/music";
import { deezerArtworkAdapter } from "./adapters/deezer";
import { itunesArtworkAdapter } from "./adapters/itunes";
import { musicBrainzCaaAdapter } from "./adapters/musicbrainzCaa";
import { parseTrackMetadataForArtwork, shouldUpgradeArtwork } from "./matching";
import { isAbortError } from "../../lib/http";
import type { ArtworkAdapter, ArtworkCandidate, ArtworkResolution, NormalizedArtworkQuery } from "./types";

const RESOLVED_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 2 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_LOOKUPS = 2;

const ADAPTERS: ArtworkAdapter[] = [
  musicBrainzCaaAdapter,
  itunesArtworkAdapter,
  deezerArtworkAdapter,
];

const memoryLookupCache = new Map<string, OfflineArtworkLookupRecord>();
const inFlightLookups = new Map<string, Promise<ArtworkResolution>>();
const inFlightBlobFetches = new Map<string, Promise<string | null>>();
const blobUrlByKey = new Map<string, string>();
const brokenUrls = new Set<string>();

export type ArtworkTrackStatus = "idle" | "loading" | "resolved" | "missing" | "error";

const trackStatuses = new Map<string, ArtworkTrackStatus>();
const statusListeners = new Set<(trackId: string, status: ArtworkTrackStatus, resolution?: ArtworkResolution) => void>();

let activeLookups = 0;
const waitQueue: Array<() => void> = [];

function acquireLookupSlot(signal?: AbortSignal): Promise<void> {
  if (activeLookups < MAX_CONCURRENT_LOOKUPS) {
    activeLookups += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const idx = waitQueue.indexOf(grant);
      if (idx >= 0) waitQueue.splice(idx, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const grant = () => {
      signal?.removeEventListener("abort", onAbort);
      activeLookups += 1;
      resolve();
    };
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    waitQueue.push(grant);
  });
}

function releaseLookupSlot(): void {
  activeLookups = Math.max(0, activeLookups - 1);
  const next = waitQueue.shift();
  if (next) next();
}

function setTrackStatus(trackId: string, status: ArtworkTrackStatus, resolution?: ArtworkResolution): void {
  trackStatuses.set(trackId, status);
  statusListeners.forEach((listener) => listener(trackId, status, resolution));
}

export function getArtworkStatus(trackId: string): ArtworkTrackStatus {
  return trackStatuses.get(trackId) ?? "idle";
}

export function subscribeArtworkStatus(
  listener: (trackId: string, status: ArtworkTrackStatus, resolution?: ArtworkResolution) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function isBrokenArtworkUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return brokenUrls.has(url.trim());
}

export function markArtworkUrlBroken(url: string | undefined | null): void {
  if (!url) return;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return;
  brokenUrls.add(trimmed);
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Resolves a cached Blob URL from memory or IndexedDB without hitting the network.
 * Identical remote image URLs share a single Blob and a single object URL.
 */
export async function getCachedBlobUrl(key: string): Promise<string | null> {
  if (!key) return null;
  const mem = blobUrlByKey.get(key);
  if (mem) return mem;

  const stored = await getArtworkBlob(key);
  if (!stored) return null;

  const objectUrl = URL.createObjectURL(stored.blob);
  blobUrlByKey.set(key, objectUrl);
  void touchArtworkBlob(key);
  return objectUrl;
}

/**
 * Fetches an image URL once, validates it is a non-empty image under the size
 * limit, stores its Blob in IndexedDB keyed by canonical URL, and returns its
 * reusable `blob:` URL. Concurrent requests for the same URL share one fetch.
 */
export async function cacheArtworkImageBlob(
  remoteUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!remoteUrl || !remoteUrl.startsWith("http")) return null;
  if (brokenUrls.has(remoteUrl)) return null;

  const existing = await getCachedBlobUrl(remoteUrl);
  if (existing) return existing;
  if (!isOnline()) return null;

  let pending = inFlightBlobFetches.get(remoteUrl);
  if (!pending) {
    pending = (async () => {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(remoteUrl, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) brokenUrls.add(remoteUrl);
          return null;
        }
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
          return null;
        }
        const blob = await res.blob();
        if (!blob.size || blob.size > MAX_IMAGE_BYTES) return null;
        const mime = blob.type && blob.type.startsWith("image/") ? blob.type : contentType || "image/jpeg";
        const normalizedBlob = blob.type === mime ? blob : new Blob([blob], { type: mime });
        const now = Date.now();
        await saveArtworkBlob({
          key: remoteUrl,
          blob: normalizedBlob,
          mime,
          bytes: normalizedBlob.size,
          savedAt: now,
          lastAccessedAt: now,
        });
        const objectUrl = URL.createObjectURL(normalizedBlob);
        blobUrlByKey.set(remoteUrl, objectUrl);
        return objectUrl;
      } catch {
        return null;
      } finally {
        globalThis.clearTimeout(timeout);
        inFlightBlobFetches.delete(remoteUrl);
      }
    })();
    inFlightBlobFetches.set(remoteUrl, pending);
  }

  if (!signal) return pending;
  return new Promise<string | null>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pending!.then(
      (val) => {
        signal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function buildMetaFromRecord(record: OfflineArtworkLookupRecord): ArtworkMetadata {
  return {
    source: record.source,
    attribution: record.attribution,
    confidence: record.confidence,
    ...(record.matchType ? { matchType: record.matchType } : {}),
    ...(record.releaseTitle ? { releaseTitle: record.releaseTitle } : {}),
    ...(record.releaseArtist ? { releaseArtist: record.releaseArtist } : {}),
    ...(record.mbid ? { mbid: record.mbid } : {}),
    ...(record.remoteUrl ? { sourceUrl: record.remoteUrl } : {}),
    verifiedAt: record.checkedAt,
  };
}

async function readCachedLookup(query: NormalizedArtworkQuery): Promise<OfflineArtworkLookupRecord | null> {
  const keys = query.albumLookupKey ? [query.albumLookupKey, query.lookupKey] : [query.lookupKey];
  for (const key of keys) {
    const mem = memoryLookupCache.get(key);
    if (mem) return mem;
    const disk = await getArtworkLookup(key);
    if (disk) {
      memoryLookupCache.set(key, disk);
      return disk;
    }
  }
  return null;
}

async function persistLookup(
  query: NormalizedArtworkQuery,
  record: OfflineArtworkLookupRecord,
): Promise<void> {
  const keys =
    query.albumLookupKey && record.matchType === "album"
      ? [query.albumLookupKey, query.lookupKey]
      : [query.lookupKey];
  for (const key of keys) {
    const entry = { ...record, lookupKey: key };
    memoryLookupCache.set(key, entry);
    await saveArtworkLookup(entry);
  }
}

async function resolveRecordUrls(
  record: OfflineArtworkLookupRecord,
  signal?: AbortSignal,
): Promise<ArtworkResolution | null> {
  if (record.status !== "resolved" || !record.remoteUrl) {
    return {
      status: record.status,
      url: "",
      smallUrl: "",
      meta: buildMetaFromRecord(record),
      fromCache: true,
    };
  }

  if (brokenUrls.has(record.remoteUrl)) return null;

  // Prefer local IndexedDB blob URL (works offline and avoids repeat downloads)
  const cachedPrimary = await getCachedBlobUrl(record.blobKey || record.remoteUrl);
  if (cachedPrimary) {
    return {
      status: "resolved",
      url: cachedPrimary,
      smallUrl: cachedPrimary,
      meta: buildMetaFromRecord(record),
      fromCache: true,
    };
  }

  if (!isOnline()) {
    // Offline without cached blob -> cannot fetch remote image
    return null;
  }

  // Online: attempt to cache the image blob once, falling back to remote URL if CORS blocks blob fetch
  const fetchedBlobUrl = await cacheArtworkImageBlob(record.remoteUrl, signal).catch(() => null);
  const finalUrl = fetchedBlobUrl || record.remoteUrl;
  const finalSmall = fetchedBlobUrl || record.remoteSmallUrl || record.remoteUrl;

  return {
    status: "resolved",
    url: finalUrl,
    smallUrl: finalSmall,
    meta: buildMetaFromRecord(record),
    fromCache: Boolean(fetchedBlobUrl),
  };
}

async function runAdapterHierarchy(
  query: NormalizedArtworkQuery,
  signal?: AbortSignal,
): Promise<{ candidate: ArtworkCandidate | null; hadTransientError: boolean }> {
  let hadTransientError = false;

  for (const adapter of ADAPTERS) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!adapter.isAvailable()) continue;

    try {
      const results = await adapter.findArtwork(query, signal);
      for (const candidate of results) {
        if (!candidate.url || brokenUrls.has(candidate.url)) continue;
        return { candidate, hadTransientError };
      }
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      hadTransientError = true;
    }
  }

  return { candidate: null, hadTransientError };
}

async function lookupExternalArtwork(
  query: NormalizedArtworkQuery,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
): Promise<ArtworkResolution> {
  const { forceRefresh = false, signal } = options;
  const cacheKey = query.albumLookupKey || query.lookupKey;

  if (!forceRefresh) {
    const cached = await readCachedLookup(query);
    if (cached) {
      const notExpired = cached.expiresAt > Date.now() || !isOnline();
      if (notExpired) {
        const resolved = await resolveRecordUrls(cached, signal);
        if (resolved) return resolved;
      }
    }
  } else {
    memoryLookupCache.delete(query.lookupKey);
    await deleteArtworkLookup(query.lookupKey);
    if (query.albumLookupKey) {
      memoryLookupCache.delete(query.albumLookupKey);
      await deleteArtworkLookup(query.albumLookupKey);
    }
  }

  if (!isOnline()) {
    return {
      status: "missing",
      url: "",
      smallUrl: "",
      meta: { source: "none", attribution: "Offline — no cached cover available", confidence: 0 },
    };
  }

  if (!query.hasUsableTitle && !(query.hasUsableAlbum && query.hasUsableArtist)) {
    return {
      status: "missing",
      url: "",
      smallUrl: "",
      meta: { source: "none", attribution: "Insufficient metadata for cover lookup", confidence: 0 },
    };
  }

  let pending = forceRefresh ? undefined : inFlightLookups.get(cacheKey);
  if (!pending) {
    pending = (async (): Promise<ArtworkResolution> => {
      await acquireLookupSlot();
      try {
        const { candidate, hadTransientError } = await runAdapterHierarchy(query);
        const now = Date.now();

        if (!candidate) {
          const status = hadTransientError ? "error" : "missing";
          const record: OfflineArtworkLookupRecord = {
            lookupKey: query.lookupKey,
            status,
            source: "none",
            attribution: hadTransientError
              ? "Artwork service temporarily unavailable"
              : "No verified original cover found",
            confidence: 0,
            checkedAt: now,
            expiresAt: now + (hadTransientError ? ERROR_TTL_MS : MISSING_TTL_MS),
          };
          await persistLookup(query, record);
          return {
            status,
            url: "",
            smallUrl: "",
            meta: buildMetaFromRecord(record),
          };
        }

        const cachedBlobUrl = await cacheArtworkImageBlob(candidate.url);
        const record: OfflineArtworkLookupRecord = {
          lookupKey: query.lookupKey,
          status: "resolved",
          source: candidate.source,
          attribution: candidate.attribution,
          confidence: candidate.score,
          matchType: candidate.matchType,
          releaseTitle: candidate.releaseTitle,
          releaseArtist: candidate.releaseArtist,
          ...(candidate.mbid ? { mbid: candidate.mbid } : {}),
          remoteUrl: candidate.url,
          remoteSmallUrl: candidate.smallUrl || candidate.url,
          ...(cachedBlobUrl ? { blobKey: candidate.url } : {}),
          checkedAt: now,
          expiresAt: now + RESOLVED_TTL_MS,
        };
        await persistLookup(query, record);

        const displayUrl = cachedBlobUrl || candidate.url;
        const displaySmall = cachedBlobUrl || candidate.smallUrl || candidate.url;
        return {
          status: "resolved",
          url: displayUrl,
          smallUrl: displaySmall,
          meta: buildMetaFromRecord(record),
          fromCache: false,
        };
      } finally {
        releaseLookupSlot();
        inFlightLookups.delete(cacheKey);
      }
    })();
    inFlightLookups.set(cacheKey, pending);
  }

  if (!signal) return pending;
  return new Promise<ArtworkResolution>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pending!.then(
      (res) => {
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function isActiveSessionBlobUrl(url: string): boolean {
  if (!url.startsWith("blob:")) return false;
  for (const active of blobUrlByKey.values()) {
    if (active === url) return true;
  }
  return false;
}

/**
 * Resolves authentic artwork for any Track following the full fallback hierarchy:
 * 1. User-selected or embedded local cover art
 * 2. Native provider cover art (Audius/Jamendo), cached offline when possible
 * 3. MusicBrainz + Cover Art Archive
 * 4. iTunes Search API
 * 5. Deezer (optional fallback)
 * 6. Clean missing-artwork state (never synthetic/AI covers)
 */
export async function resolveTrackArtwork(
  track: Track,
  options: { forceRefresh?: boolean; skipSampleAuto?: boolean; signal?: AbortSignal } = {},
): Promise<ArtworkResolution> {
  const { forceRefresh = false, skipSampleAuto = true, signal } = options;

  const isLiveBlob = track.artwork.startsWith("blob:") && isActiveSessionBlobUrl(track.artwork);
  const isDeadBlob = track.artwork.startsWith("blob:") && !isLiveBlob;
  const hasCurrentUrl =
    !isDeadBlob &&
    isDisplayableImageUrl(track.artwork) &&
    !isBrokenArtworkUrl(track.artwork);

  // 1. Preserve user-chosen or embedded artwork
  if (!forceRefresh && hasCurrentUrl) {
    if (track.artworkMeta?.source === "user" || track.artworkMeta?.source === "embedded") {
      setTrackStatus(track.id, "resolved");
      return {
        status: "resolved",
        url: track.artwork,
        smallUrl: track.artworkSmall || track.artwork,
        meta: track.artworkMeta,
        fromCache: true,
      };
    }

    if (track.artwork.startsWith("data:") || isLiveBlob) {
      const meta: ArtworkMetadata = track.artworkMeta ?? {
        source: track.imported ? "embedded" : track.providerId === "audius" || track.providerId === "jamendo" ? track.providerId : "user",
        attribution: track.imported ? "Embedded in audio file" : track.providerName,
        confidence: 95,
        matchType: track.imported ? "embedded" : "provider",
      };
      setTrackStatus(track.id, "resolved");
      return {
        status: "resolved",
        url: track.artwork,
        smallUrl: track.artworkSmall || track.artwork,
        meta,
        fromCache: true,
      };
    }

    // Remote URL already present (e.g., Audius / Jamendo / previously resolved URL)
    const canonicalUrl = track.artworkMeta?.sourceUrl || track.artwork;
    const cachedBlob = await getCachedBlobUrl(canonicalUrl);
    if (cachedBlob) {
      const meta: ArtworkMetadata = track.artworkMeta ?? {
        source: track.providerId === "audius" || track.providerId === "jamendo" ? track.providerId : "coverartarchive",
        attribution: track.providerName,
        confidence: 80,
        matchType: "provider",
        sourceUrl: canonicalUrl,
      };
      setTrackStatus(track.id, "resolved");
      return {
        status: "resolved",
        url: cachedBlob,
        smallUrl: cachedBlob,
        meta,
        fromCache: true,
      };
    }

    if (!isOnline()) {
      setTrackStatus(track.id, "missing");
      return {
        status: "missing",
        url: "",
        smallUrl: "",
        meta: { source: "none", attribution: "Offline — cover not cached", confidence: 0 },
      };
    }

    // Proactively cache provider remote URL in IndexedDB in background
    void cacheArtworkImageBlob(canonicalUrl);
    const meta: ArtworkMetadata = track.artworkMeta ?? {
      source: track.providerId === "audius" || track.providerId === "jamendo" ? track.providerId : "coverartarchive",
      attribution: track.providerName,
      confidence: 80,
      matchType: "provider",
      sourceUrl: canonicalUrl,
    };
    setTrackStatus(track.id, "resolved");
    return {
      status: "resolved",
      url: track.artwork,
      smallUrl: track.artworkSmall || track.artwork,
      meta,
      fromCache: false,
    };
  }

  // Skip automatic remote lookups for SoundHelix demo sample tracks unless explicitly requested
  if (skipSampleAuto && !forceRefresh && track.providerId === "sample") {
    setTrackStatus(track.id, "missing");
    return {
      status: "missing",
      url: "",
      smallUrl: "",
      meta: { source: "none", attribution: "Sample preview", confidence: 0 },
    };
  }

  setTrackStatus(track.id, "loading");
  try {
    const query = parseTrackMetadataForArtwork({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    const resolution = await lookupExternalArtwork(query, { forceRefresh, signal });

    if (resolution.status === "resolved") {
      if (!track.artworkMeta || shouldUpgradeArtwork(track.artworkMeta, resolution.meta, !hasCurrentUrl)) {
        setTrackStatus(track.id, "resolved", resolution);
        return resolution;
      }
    }

    setTrackStatus(track.id, resolution.status === "error" ? "error" : "missing", resolution);
    return resolution;
  } catch (error: unknown) {
    if (isAbortError(error)) {
      setTrackStatus(track.id, "idle");
      throw error;
    }
    const errRes: ArtworkResolution = {
      status: "error",
      url: "",
      smallUrl: "",
      meta: { source: "none", attribution: "Artwork lookup failed", confidence: 0 },
      error: error instanceof Error ? error.message : "Artwork lookup failed",
    };
    setTrackStatus(track.id, "error", errRes);
    return errRes;
  }
}

/**
 * Ensures a track's artwork is cached as an IndexedDB Blob before or after
 * downloading for offline playback, preserving canonical `sourceUrl` on `artworkMeta`.
 */
export async function ensureTrackArtworkOffline(track: Track): Promise<Track> {
  if (track.artwork.startsWith("data:")) return track;

  const remoteCandidate =
    track.artworkMeta?.sourceUrl ||
    (track.artwork.startsWith("http") ? track.artwork : "");

  if (remoteCandidate && !isBrokenArtworkUrl(remoteCandidate)) {
    const blobUrl = await cacheArtworkImageBlob(remoteCandidate);
    if (blobUrl) {
      return {
        ...track,
        artwork: blobUrl,
        artworkSmall: blobUrl,
        artworkMeta: track.artworkMeta ?? {
          source: track.providerId === "audius" || track.providerId === "jamendo" ? track.providerId : "coverartarchive",
          attribution: track.providerName,
          confidence: 80,
          matchType: "provider",
          sourceUrl: remoteCandidate,
        },
      };
    }
    return track;
  }

  if (!isDisplayableImageUrl(track.artwork) || isBrokenArtworkUrl(track.artwork) || track.artwork.startsWith("blob:")) {
    const resolved = await resolveTrackArtwork(track, { skipSampleAuto: true });
    if (resolved.status === "resolved" && resolved.url) {
      return {
        ...track,
        artwork: resolved.url,
        artworkSmall: resolved.smallUrl || resolved.url,
        artworkMeta: resolved.meta,
      };
    }
  }

  return track;
}

/** Hydrates offline/catalogue tracks on boot from IndexedDB cached artwork blobs. */
export async function hydrateCachedArtworkForTrack(track: Track): Promise<Track> {
  if (track.artwork.startsWith("data:")) return track;

  const sourceUrl = track.artworkMeta?.sourceUrl || (track.artwork.startsWith("http") ? track.artwork : "");
  if (sourceUrl && !isBrokenArtworkUrl(sourceUrl)) {
    const cachedBlob = await getCachedBlobUrl(sourceUrl);
    if (cachedBlob) {
      return { ...track, artwork: cachedBlob, artworkSmall: cachedBlob };
    }
  }

  const isDeadBlob = track.artwork.startsWith("blob:") && !isActiveSessionBlobUrl(track.artwork);
  if (!isDisplayableImageUrl(track.artwork) || isDeadBlob) {
    const query = parseTrackMetadataForArtwork({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    const lookup = await readCachedLookup(query);
    if (lookup && lookup.status === "resolved") {
      const key = lookup.blobKey || lookup.remoteUrl;
      if (key) {
        const cachedBlob = await getCachedBlobUrl(key);
        if (cachedBlob) {
          return {
            ...track,
            artwork: cachedBlob,
            artworkSmall: cachedBlob,
            artworkMeta: buildMetaFromRecord(lookup),
          };
        }
      }
      if (lookup.remoteUrl && isOnline() && !brokenUrls.has(lookup.remoteUrl)) {
        return {
          ...track,
          artwork: lookup.remoteUrl,
          artworkSmall: lookup.remoteSmallUrl || lookup.remoteUrl,
          artworkMeta: buildMetaFromRecord(lookup),
        };
      }
    }
    if (isDeadBlob) {
      return {
        ...track,
        artwork: sourceUrl && isOnline() && !brokenUrls.has(sourceUrl) ? sourceUrl : "",
        artworkSmall: sourceUrl && isOnline() && !brokenUrls.has(sourceUrl) ? sourceUrl : "",
      };
    }
  }

  return track;
}
