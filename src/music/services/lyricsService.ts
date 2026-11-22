import type { Track } from "../types/music";
import { parseLrc, type LyricLine, type LyricsMetadata } from "../lib/lyrics";

export type LyricsSource = "lrclib" | "metadata" | "lrc-import" | "none";

export type TrackLyrics = {
  trackId: string;
  source: LyricsSource;
  synced: boolean;
  instrumental: boolean;
  lines: LyricLine[];
  plainText: string;
  metadata?: LyricsMetadata;
  fetchedAt: number;
};

export type LrclibRecord = {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

const LRCLIB_BASE = "https://lrclib.net/api";
const CACHE_STORAGE_KEY = "aural-lyrics-cache";
const CUSTOM_STORAGE_KEY = "aural-custom-lyrics";
const MAX_CACHED_TRACKS = 80;
const REQUEST_TIMEOUT_MS = 10_000;

const memoryCache = new Map<string, TrackLyrics>();
const inFlight = new Map<string, Promise<TrackLyrics>>();

/** Removes noisy release tags like "(feat. X)", "[Official Video]", "- Remastered" for fallback searches. */
export function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*[\[(](?:feat\.?|ft\.?|featuring|official\s*(?:audio|video|music\s*video|lyric\s*video)|remaster(?:ed)?(?:\s*\d{4})?|radio\s*edit|explicit|clean|audio|hd|4k)[^\])]*[\])]/gi, "")
    .replace(/\s+-\s+(?:remaster(?:ed)?(?:\s*\d{4})?|radio\s*edit|single\s*version|live).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Picks the strongest LRCLIB search candidate: prefers synced lyrics, matching
 * artist/title tokens, and duration proximity when track duration is known.
 */
export function selectBestLrclibCandidate(
  candidates: ReadonlyArray<LrclibRecord>,
  track: Pick<Track, "title" | "artist" | "duration"> & { album?: string },
): LrclibRecord | null {
  if (!candidates.length) return null;
  const targetTitle = normalizeMatchText(cleanTrackTitle(track.title) || track.title);
  const targetArtist = normalizeMatchText(track.artist);
  const targetAlbum = normalizeMatchText(track.album ?? "");
  const targetDuration = track.duration > 0 ? track.duration : 0;

  let best: LrclibRecord | null = null;
  let bestScore = -Infinity;

  for (const item of candidates) {
    const hasSynced = Boolean(item.syncedLyrics?.trim());
    const hasPlain = Boolean(item.plainLyrics?.trim());
    const isInstrumental = Boolean(item.instrumental);
    if (!hasSynced && !hasPlain && !isInstrumental) continue;

    let score = 0;
    if (hasSynced) score += 100;
    else if (hasPlain) score += 40;
    else if (isInstrumental) score += 15;

    const itemTitle = normalizeMatchText(item.trackName ?? item.name ?? "");
    const itemArtist = normalizeMatchText(item.artistName ?? "");
    const itemAlbum = normalizeMatchText(item.albumName ?? "");

    if (itemTitle && targetTitle) {
      if (itemTitle === targetTitle) score += 50;
      else if (itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle)) score += 25;
    }

    if (itemArtist && targetArtist) {
      if (itemArtist === targetArtist) score += 45;
      else if (itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist)) score += 25;
    }

    if (itemAlbum && targetAlbum && (itemAlbum === targetAlbum || itemAlbum.includes(targetAlbum))) {
      score += 15;
    }

    if (targetDuration > 0 && typeof item.duration === "number" && item.duration > 0) {
      const diff = Math.abs(item.duration - targetDuration);
      if (diff <= 2) score += 30;
      else if (diff <= 6) score += 15;
      else if (diff > 20) score -= 25;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

function readStorageRecord<T>(key: string): Record<string, T> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, T>)
      : {};
  } catch {
    return {};
  }
}

function writeStorageRecord<T>(key: string, record: Record<string, T>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Blocked or full storage must not break playback or lyrics UI.
  }
}

function getStoredCustomLrc(trackId: string): string | null {
  const map = readStorageRecord<string>(CUSTOM_STORAGE_KEY);
  const raw = map[trackId];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

export function saveCustomLyrics(trackId: string, rawLrc: string): TrackLyrics {
  const trimmed = rawLrc.trim();
  const customMap = readStorageRecord<string>(CUSTOM_STORAGE_KEY);
  if (trimmed) {
    customMap[trackId] = trimmed;
  } else {
    delete customMap[trackId];
  }
  writeStorageRecord(CUSTOM_STORAGE_KEY, customMap);

  const parsed = parseLrc(trimmed);
  const entry: TrackLyrics = {
    trackId,
    source: trimmed ? "lrc-import" : "none",
    synced: parsed.synced,
    instrumental: false,
    lines: parsed.lines,
    plainText: parsed.plainText,
    metadata: parsed.metadata,
    fetchedAt: Date.now(),
  };
  memoryCache.set(trackId, entry);
  return entry;
}

export function clearCustomLyrics(trackId: string): void {
  const customMap = readStorageRecord<string>(CUSTOM_STORAGE_KEY);
  if (trackId in customMap) {
    delete customMap[trackId];
    writeStorageRecord(CUSTOM_STORAGE_KEY, customMap);
  }
  memoryCache.delete(trackId);
}

function getCachedLyrics(trackId: string): TrackLyrics | null {
  const mem = memoryCache.get(trackId);
  if (mem) return mem;
  const disk = readStorageRecord<TrackLyrics>(CACHE_STORAGE_KEY);
  const entry = disk[trackId];
  if (entry && Array.isArray(entry.lines)) {
    memoryCache.set(trackId, entry);
    return entry;
  }
  return null;
}

function persistCachedLyrics(entry: TrackLyrics): void {
  memoryCache.set(entry.trackId, entry);
  if (entry.source === "none") return;
  const disk = readStorageRecord<TrackLyrics>(CACHE_STORAGE_KEY);
  disk[entry.trackId] = entry;
  const keys = Object.keys(disk);
  if (keys.length > MAX_CACHED_TRACKS) {
    keys
      .sort((a, b) => (disk[a]?.fetchedAt ?? 0) - (disk[b]?.fetchedAt ?? 0))
      .slice(0, keys.length - MAX_CACHED_TRACKS)
      .forEach((key) => { delete disk[key]; });
  }
  writeStorageRecord(CACHE_STORAGE_KEY, disk);
}

function buildTrackLyricsFromRecord(trackId: string, record: LrclibRecord, source: LyricsSource): TrackLyrics {
  if (record.syncedLyrics?.trim()) {
    const parsed = parseLrc(record.syncedLyrics);
    return {
      trackId,
      source,
      synced: parsed.synced,
      instrumental: false,
      lines: parsed.lines,
      plainText: parsed.plainText || record.plainLyrics?.trim() || "",
      metadata: parsed.metadata,
      fetchedAt: Date.now(),
    };
  }
  if (record.plainLyrics?.trim()) {
    const parsed = parseLrc(record.plainLyrics);
    return {
      trackId,
      source,
      synced: parsed.synced,
      instrumental: false,
      lines: parsed.lines,
      plainText: parsed.plainText || record.plainLyrics.trim(),
      metadata: parsed.metadata,
      fetchedAt: Date.now(),
    };
  }
  return {
    trackId,
    source,
    synced: false,
    instrumental: Boolean(record.instrumental),
    lines: [],
    plainText: "",
    fetchedAt: Date.now(),
  };
}

async function fetchJsonWithTimeout<T>(url: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    if (response.status === 404) {
      return { ok: false, status: 404, data: null };
    }
    if (!response.ok) {
      throw new Error(`Lyrics service returned ${response.status}.`);
    }
    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data };
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Lyrics lookup timed out.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
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

function isUsableAlbumName(album: string): boolean {
  const lower = album.trim().toLowerCase();
  return Boolean(lower && lower !== "single" && lower !== "imported" && lower !== "unknown");
}

function isUsableArtistName(artist: string): boolean {
  const lower = artist.trim().toLowerCase();
  return Boolean(lower && lower !== "local library" && lower !== "unknown artist");
}

async function queryLrclib(track: Track, signal?: AbortSignal): Promise<TrackLyrics> {
  const title = track.title.trim();
  const artist = track.artist.trim();
  const cleanedTitle = cleanTrackTitle(title) || title;

  // 1. Structured search by track + artist (returns 200 [] when unmatched, avoiding 404 console noise)
  if (cleanedTitle && isUsableArtistName(artist)) {
    const params = new URLSearchParams({
      track_name: cleanedTitle,
      artist_name: artist,
    });
    if (isUsableAlbumName(track.album)) {
      params.set("album_name", track.album.trim());
    }
    const search = await fetchJsonWithTimeout<LrclibRecord[]>(`${LRCLIB_BASE}/search?${params.toString()}`, signal);
    if (search.ok && Array.isArray(search.data)) {
      const best = selectBestLrclibCandidate(search.data, track);
      if (best) return buildTrackLyricsFromRecord(track.id, best, "lrclib");
    }

    // Retry without album constraint if album name narrowed out valid matches
    if (isUsableAlbumName(track.album)) {
      const withoutAlbum = new URLSearchParams({
        track_name: cleanedTitle,
        artist_name: artist,
      });
      const fallback = await fetchJsonWithTimeout<LrclibRecord[]>(`${LRCLIB_BASE}/search?${withoutAlbum.toString()}`, signal);
      if (fallback.ok && Array.isArray(fallback.data)) {
        const best = selectBestLrclibCandidate(fallback.data, track);
        if (best) return buildTrackLyricsFromRecord(track.id, best, "lrclib");
      }
    }
  }

  // 2. Broad query fallback (useful for local files where artist is "Local library" or embedded in title)
  if (cleanedTitle) {
    const q = isUsableArtistName(artist) ? `${cleanedTitle} ${artist}` : cleanedTitle;
    const params = new URLSearchParams({ q });
    const broad = await fetchJsonWithTimeout<LrclibRecord[]>(`${LRCLIB_BASE}/search?${params.toString()}`, signal);
    if (broad.ok && Array.isArray(broad.data)) {
      const best = selectBestLrclibCandidate(broad.data, track);
      if (best) return buildTrackLyricsFromRecord(track.id, best, "lrclib");
    }
  }

  return {
    trackId: track.id,
    source: "none",
    synced: false,
    instrumental: false,
    lines: [],
    plainText: "",
    fetchedAt: Date.now(),
  };
}

/**
 * Resolves lyrics for a track in priority order:
 * 1. User-imported / custom LRC stored locally
 * 2. Embedded metadata (`track.lyrics` parsed from ID3v2 / FLAC tags)
 * 3. Cached LRCLIB result
 * 4. Live LRCLIB public API lookup (when online)
 */
export async function getLyricsForTrack(
  track: Track,
  options: { signal?: AbortSignal; forceRefresh?: boolean } = {},
): Promise<TrackLyrics> {
  const { signal, forceRefresh = false } = options;

  const customRaw = getStoredCustomLrc(track.id);
  if (customRaw) {
    const parsed = parseLrc(customRaw);
    return {
      trackId: track.id,
      source: "lrc-import",
      synced: parsed.synced,
      instrumental: false,
      lines: parsed.lines,
      plainText: parsed.plainText,
      metadata: parsed.metadata,
      fetchedAt: Date.now(),
    };
  }

  if (track.lyrics?.syncedLyrics?.trim() || track.lyrics?.plainLyrics?.trim()) {
    return buildTrackLyricsFromRecord(
      track.id,
      {
        syncedLyrics: track.lyrics.syncedLyrics,
        plainLyrics: track.lyrics.plainLyrics,
      },
      "metadata",
    );
  }

  if (!forceRefresh) {
    const cached = getCachedLyrics(track.id);
    if (cached) return cached;
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      trackId: track.id,
      source: "none",
      synced: false,
      instrumental: false,
      lines: [],
      plainText: "",
      fetchedAt: Date.now(),
    };
  }

  let pending = forceRefresh ? undefined : inFlight.get(track.id);
  if (!pending) {
    pending = queryLrclib(track)
      .then((result) => {
        persistCachedLyrics(result);
        return result;
      })
      .finally(() => {
        inFlight.delete(track.id);
      });
    inFlight.set(track.id, pending);
  }

  return raceWithAbort(pending, signal);
}
