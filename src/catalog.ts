import { AUDIUS_APP_NAME, getJamendoClientId } from "./music/config";
import { searchArchiveAudioPage } from "./music/providers/internetArchive";
import type { Track } from "./types";

const AUDIUS_API = "https://api.audius.co/v1";
const JAMENDO_API = "https://api.jamendo.com/v3.0";

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; tracks: Track[] }>();
const inFlight = new Map<string, Promise<Track[]>>();

type AudiusTrack = {
  id: string;
  title?: string;
  duration?: number;
  genre?: string;
  artwork?: { "150x150"?: string; "480x480"?: string; "1000x1000"?: string };
  user?: { name?: string; handle?: string };
  album?: string;
  is_downloadable?: boolean;
};

type JamendoTrack = {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio: string;
  audiodownload?: string;
  audiodownload_allowed: boolean;
  license_ccurl?: string;
};

function mapAudiusTrack(track: AudiusTrack): Track | null {
  if (!track.id || !track.title) return null;
  const downloadable = track.is_downloadable === true;
  const artwork = track.artwork?.["480x480"] || track.artwork?.["1000x1000"] || track.artwork?.["150x150"] || "";
  const artworkSmall = track.artwork?.["150x150"] || artwork;
  return {
    id: `audius-${track.id}`,
    providerId: "audius",
    providerName: "Audius",
    providerTrackId: track.id,
    title: track.title,
    artist: track.user?.name || track.user?.handle || "Unknown artist",
    album: track.album || "Single",
    duration: Number.isFinite(track.duration) ? Math.max(0, track.duration ?? 0) : 0,
    streamUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(track.id)}/stream?app_name=${AUDIUS_APP_NAME}`,
    artwork,
    artworkSmall,
    ...(artwork ? {
      artworkMeta: {
        source: "audius" as const,
        attribution: "Audius",
        confidence: 80,
        matchType: "provider" as const,
        sourceUrl: artwork,
      },
    } : {}),
    genre: track.genre || "Other",
    tags: [],
    licensing: {
      name: "Audius track licence",
      streamingAllowed: true,
      downloadAllowed: downloadable,
    },
    accent: "#5b7c65",
    ...(downloadable ? {
      downloadUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(track.id)}/download?app_name=${AUDIUS_APP_NAME}`,
    } : {}),
  };
}

function mapJamendoTrack(track: JamendoTrack): Track | null {
  if (!track.id || !track.name) return null;
  const artwork = track.image || track.album_image || "";
  const downloadable = track.audiodownload_allowed === true && Boolean(track.audiodownload);
  return {
    id: `jamendo-${track.id}`,
    providerId: "jamendo",
    providerName: "Jamendo",
    providerTrackId: track.id,
    title: track.name,
    artist: track.artist_name,
    album: track.album_name || "Single",
    duration: Number.isFinite(track.duration) ? track.duration : 0,
    streamUrl: track.audio,
    artwork,
    artworkSmall: artwork,
    ...(artwork ? {
      artworkMeta: {
        source: "jamendo" as const,
        attribution: "Jamendo",
        confidence: 80,
        matchType: "provider" as const,
        sourceUrl: artwork,
      },
    } : {}),
    genre: "Various",
    tags: [],
    licensing: {
      name: "Creative Commons (Jamendo)",
      ...(track.license_ccurl ? { url: track.license_ccurl } : {}),
      attribution: `Artist: ${track.artist_name} — source: Jamendo (CC licence)`,
      streamingAllowed: true,
      downloadAllowed: downloadable,
    },
    accent: "#4d6480",
    ...(downloadable ? { downloadUrl: track.audiodownload } : {}),
  };
}

function jamendoUrl(params: Record<string, string>): string | null {
  const clientId = getJamendoClientId();
  if (!clientId) return null;
  const query = new URLSearchParams({ client_id: clientId, format: "json", ...params });
  return `${JAMENDO_API}/tracks/?${query.toString()}`;
}

async function requestTracks(
  key: string,
  url: string,
  mapper: (item: any) => Track | null,
  signal?: AbortSignal,
): Promise<Track[]> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;

  const pending = signal ? undefined : inFlight.get(key);
  if (pending) return pending;

  const request = fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
    const body = await response.json();

    // Audius structure is { data: [] }, Jamendo is { results: [] }
    const data = body.data || body.results;

    if (!Array.isArray(data)) throw new Error("Provider returned an unexpected catalogue response.");
    const tracks = data.map(mapper).filter((track): track is Track => track !== null);
    cache.set(key, { tracks, expiresAt: Date.now() + CACHE_TTL });
    return tracks;
  }).finally(() => inFlight.delete(key));

  if (!signal) inFlight.set(key, request);
  return request;
}

export type CatalogueSearchProvider = "all" | "audius" | "jamendo" | "internetarchive";

export type CatalogueSearchPage = {
  tracks: Track[];
  hasMore: boolean;
  nextOffset: number;
  total?: number;
  warnings: string[];
};

function interleaveTracks(lists: Track[][]): Track[] {
  const maxLen = lists.reduce((max, list) => Math.max(max, list.length), 0);
  const seen = new Set<string>();
  const out: Track[] = [];
  for (let i = 0; i < maxLen; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Provider-aware catalogue search supporting pagination and partial failures. */
export async function searchCataloguePage(params: {
  query: string;
  provider?: CatalogueSearchProvider;
  signal?: AbortSignal;
  offset?: number;
}): Promise<CatalogueSearchPage> {
  const term = params.query.trim();
  const offset = Math.max(0, params.offset ?? 0);
  const provider = params.provider ?? "all";
  if (!term) {
    return { tracks: [], hasMore: false, nextOffset: offset, warnings: [] };
  }

  if (provider === "internetarchive") {
    const page = await searchArchiveAudioPage(term, {
      limit: 12,
      offset,
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return {
      tracks: page.tracks,
      hasMore: page.hasMore,
      nextOffset: offset + 12,
      total: page.numFound,
      warnings: [],
    };
  }

  if (provider === "audius") {
    const audiusUrl = `${AUDIUS_API}/tracks/search?query=${encodeURIComponent(term)}&limit=20&offset=${offset}&app_name=${AUDIUS_APP_NAME}`;
    const tracks = await requestTracks(`audius:search:${term}:20:${offset}`, audiusUrl, mapAudiusTrack, params.signal);
    return {
      tracks,
      hasMore: tracks.length === 20,
      nextOffset: offset + 20,
      warnings: [],
    };
  }

  if (provider === "jamendo") {
    const jamendo = jamendoUrl({
      limit: "20",
      offset: String(offset),
      search: term,
      include: "musicinfo",
      audiodownload_allowed: "true",
    });
    if (!jamendo) {
      throw new Error("Jamendo needs a free client ID (VITE_JAMENDO_CLIENT_ID) to search.");
    }
    const tracks = await requestTracks(`jamendo:search:${term}:20:${offset}`, jamendo, mapJamendoTrack, params.signal);
    return {
      tracks,
      hasMore: tracks.length === 20,
      nextOffset: offset + 20,
      warnings: [],
    };
  }

  // All network providers in parallel; never fail the whole page if one source errs.
  const audiusUrl = `${AUDIUS_API}/tracks/search?query=${encodeURIComponent(term)}&limit=10&offset=${offset}&app_name=${AUDIUS_APP_NAME}`;
  const jamendo = jamendoUrl({
    limit: "10",
    offset: String(offset),
    search: term,
    include: "musicinfo",
    audiodownload_allowed: "true",
  });
  const iaOffset = Math.floor((offset / 20) * 8);

  const tasks: Array<{ name: string; work: Promise<Track[]>; pageSize: number; hasMoreFlag?: () => boolean }> = [
    {
      name: "Audius",
      work: requestTracks(`audius:search:${term}:${offset}`, audiusUrl, mapAudiusTrack, params.signal),
      pageSize: 10,
    },
  ];

  if (jamendo) {
    tasks.push({
      name: "Jamendo",
      work: requestTracks(`jamendo:search:${term}:${offset}`, jamendo, mapJamendoTrack, params.signal),
      pageSize: 10,
    });
  }

  let iaHasMore = false;
  tasks.push({
    name: "Internet Archive",
    work: searchArchiveAudioPage(term, {
      limit: 8,
      offset: iaOffset,
      ...(params.signal ? { signal: params.signal } : {}),
    }).then((res) => {
      iaHasMore = res.hasMore;
      return res.tracks;
    }),
    pageSize: 8,
    hasMoreFlag: () => iaHasMore,
  });

  const settled = await Promise.allSettled(tasks.map((t) => t.work));
  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const lists: Track[][] = [];
  const warnings: string[] = [];
  let anyMore = false;

  settled.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === "fulfilled") {
      lists.push(result.value);
      if (task.hasMoreFlag ? task.hasMoreFlag() : result.value.length >= task.pageSize) {
        anyMore = true;
      }
    } else {
      if (result.reason instanceof DOMException && result.reason.name === "AbortError") {
        throw result.reason;
      }
      warnings.push(
        result.reason instanceof Error ? `${task.name}: ${result.reason.message}` : `${task.name} unavailable`,
      );
      lists.push([]);
    }
  });

  const tracks = interleaveTracks(lists);
  if (!tracks.length && warnings.length === tasks.length) {
    throw new Error(warnings[0] || "Catalogue search failed.");
  }

  return {
    tracks,
    hasMore: anyMore,
    nextOffset: offset + 20,
    warnings,
  };
}

/** Search providers in parallel; a provider failure never empties the page. */
export async function searchMusic(query: string, signal?: AbortSignal, offset = 0): Promise<Track[]> {
  const page = await searchCataloguePage({ query, provider: "all", signal, offset });
  return page.tracks;
}

export async function getTrending(signal?: AbortSignal): Promise<Track[]> {
  const audiusUrl = `${AUDIUS_API}/tracks/trending?limit=10&app_name=${AUDIUS_APP_NAME}`;
  const jamendo = jamendoUrl({
    limit: "10",
    order: "popularity_week",
    include: "musicinfo",
    audiodownload_allowed: "true",
  });

  const requests = [requestTracks("audius:trending", audiusUrl, mapAudiusTrack, signal).catch(() => [])];
  if (jamendo) requests.push(requestTracks("jamendo:trending", jamendo, mapJamendoTrack, signal).catch(() => []));

  const settled = await Promise.all(requests);
  return settled.flat();
}
