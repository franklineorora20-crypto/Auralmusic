import { MUSIC_PROXY_URL } from "../../../config";
import { scoreArtworkCandidate } from "../matching";
import { ArtworkAdapterError, fetchArtworkJson, forceHttps, RateLimiter } from "../rateLimiter";
import type { ArtworkAdapter, ArtworkCandidate, NormalizedArtworkQuery } from "../types";

const DEEZER_API = "https://api.deezer.com";
const deezerLimiter = new RateLimiter(350);

type DeezerAlbum = {
  id?: number;
  title?: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  record_type?: string;
  artist?: { name?: string };
};

type DeezerTrack = {
  id?: number;
  title?: string;
  artist?: { name?: string };
  album?: DeezerAlbum;
};

type DeezerSearchResponse<T> = {
  data?: T[];
  error?: { type?: string; message?: string; code?: number };
};

let jsonpSequence = 0;

/**
 * Deezer's REST API does not expose CORS headers for direct browser fetch(),
 * so in browser environments without a configured MUSIC_PROXY_URL we use its
 * documented JSONP callback mechanism with strict cleanup and timeout.
 */
function fetchDeezerJsonp<T>(url: string, signal?: AbortSignal): Promise<T> {
  if (typeof document === "undefined") {
    return Promise.reject(new ArtworkAdapterError("deezer", "Deezer JSONP requires a browser DOM.", { retryable: false }));
  }

  return new Promise<T>((resolve, reject) => {
    const callbackName = `__auralDeezerCb_${Date.now()}_${++jsonpSequence}`;
    const script = document.createElement("script");
    const win = window as unknown as Record<string, unknown>;
    let settled = false;

    const cleanup = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      delete win[callbackName];
      script.remove();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ArtworkAdapterError("deezer", "Deezer request timed out.", { retryable: true }));
    }, 8000);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    win[callbackName] = (payload: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}output=jsonp&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ArtworkAdapterError("deezer", "Deezer JSONP script could not be loaded.", { retryable: true }));
    };

    document.head.appendChild(script);
  });
}

async function queryDeezer<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  const targetUrl = `${DEEZER_API}${path}?${qs}`;

  if (MUSIC_PROXY_URL) {
    const proxied = `${MUSIC_PROXY_URL}/deezer/${targetUrl.replace(/^https?:\/\//, "")}`;
    return fetchArtworkJson<T>({
      source: "deezer",
      url: proxied,
      limiter: deezerLimiter,
      signal,
    });
  }

  await deezerLimiter.acquire(signal);
  return fetchDeezerJsonp<T>(targetUrl, signal);
}

function mapDeezerRecordType(recordType?: string): "album" | "single" | "ep" | "compilation" | "other" {
  const rt = (recordType ?? "").toLowerCase();
  if (rt === "album") return "album";
  if (rt === "single") return "single";
  if (rt === "ep") return "ep";
  if (rt === "compile" || rt === "compilation") return "compilation";
  return "other";
}

function mapDeezerAlbums(items: DeezerAlbum[], query: NormalizedArtworkQuery): ArtworkCandidate[] {
  const candidates: ArtworkCandidate[] = [];
  for (const album of items) {
    if (!album.title || !album.artist?.name) continue;
    const url = forceHttps(album.cover_big || album.cover_xl || album.cover_medium);
    const smallUrl = forceHttps(album.cover_medium || album.cover_big || album.cover_small);
    if (!url) continue;

    const releaseType = mapDeezerRecordType(album.record_type);
    const scored = scoreArtworkCandidate(query, {
      releaseTitle: album.title,
      releaseArtist: album.artist.name,
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
    });
    if (!scored.accepted) continue;

    candidates.push({
      source: "deezer",
      attribution: "Deezer",
      url,
      smallUrl: smallUrl || url,
      releaseTitle: album.title,
      releaseArtist: album.artist.name,
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
      score: scored.score,
      matchType: scored.matchType,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function mapDeezerTracks(items: DeezerTrack[], query: NormalizedArtworkQuery): ArtworkCandidate[] {
  const candidates: ArtworkCandidate[] = [];
  for (const item of items) {
    const albumTitle = item.album?.title || item.title || "";
    const artistName = item.artist?.name || item.album?.artist?.name || "";
    if (!albumTitle || !artistName) continue;
    const url = forceHttps(item.album?.cover_big || item.album?.cover_xl || item.album?.cover_medium);
    const smallUrl = forceHttps(item.album?.cover_medium || item.album?.cover_big || item.album?.cover_small);
    if (!url) continue;

    const releaseType = mapDeezerRecordType(item.album?.record_type);
    const scored = scoreArtworkCandidate(query, {
      releaseTitle: albumTitle,
      releaseArtist: artistName,
      ...(item.title ? { trackTitle: item.title } : {}),
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
    });
    if (!scored.accepted) continue;

    candidates.push({
      source: "deezer",
      attribution: "Deezer",
      url,
      smallUrl: smallUrl || url,
      releaseTitle: albumTitle,
      releaseArtist: artistName,
      ...(item.title ? { trackTitle: item.title } : {}),
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
      score: scored.score,
      matchType: scored.matchType,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export const deezerArtworkAdapter: ArtworkAdapter = {
  id: "deezer",
  name: "Deezer",
  attribution: "Deezer",

  isAvailable() {
    if (deezerLimiter.isCoolingDown()) return false;
    return Boolean(MUSIC_PROXY_URL || typeof document !== "undefined");
  },

  async findArtwork(query: NormalizedArtworkQuery, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    const candidates: ArtworkCandidate[] = [];

    if (query.hasUsableArtist && query.hasUsableAlbum) {
      const q = `artist:"${query.artist}" album:"${query.album}"`;
      const res = await queryDeezer<DeezerSearchResponse<DeezerAlbum>>(
        "/search/album",
        { q, limit: "8" },
        signal,
      );
      if (res?.error) {
        if (res.error.code === 4) deezerLimiter.cooldown(20_000);
        return [];
      }
      candidates.push(...mapDeezerAlbums(res?.data ?? [], query));
    }

    if (candidates.length === 0 && query.hasUsableTitle) {
      const q = query.hasUsableArtist
        ? `artist:"${query.artist}" track:"${query.title}"`
        : query.title;
      const res = await queryDeezer<DeezerSearchResponse<DeezerTrack>>(
        "/search/track",
        { q, limit: "8" },
        signal,
      );
      if (res?.error) {
        if (res.error.code === 4) deezerLimiter.cooldown(20_000);
        return [];
      }
      candidates.push(...mapDeezerTracks(res?.data ?? [], query));
    }

    return candidates.sort((a, b) => b.score - a.score);
  },
};
