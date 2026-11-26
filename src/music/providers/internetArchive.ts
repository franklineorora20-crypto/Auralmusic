import { buildProviderUrl } from "../config";
import { fetchJson, isRecord, ProviderError, TTL } from "../lib/http";
import type { Artist, ProviderPlaylist, Track } from "../types/music";
import { PROVIDER_NAMES } from "../types/music";
import {
  clampLimit,
  clampOffset,
  type ListOptions,
  type MusicProvider,
  type TrackQueryOptions,
} from "./base";
import {
  ARCHIVE_METADATA_URL,
  buildArchiveAdvancedSearchUrl,
  buildArchiveItemDetail,
  mapArchiveDetailToTrack,
  mapArchiveDetailToTracks,
  mapArchiveDocToArtist,
  mapArchiveDocToPlaylist,
  parseArchiveTrackId,
  readArchiveText,
  type ArchiveItemDetail,
  type ArchiveItemMetadata,
  type ArchiveMetadataResponse,
} from "./internetArchiveMeta";

export type ArchiveSearchPage = {
  tracks: Track[];
  numFound: number;
  hasMore: boolean;
};

type AdvancedSearchEnvelope = {
  response?: {
    numFound?: unknown;
    start?: unknown;
    docs?: unknown;
  };
};

const METADATA_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function extractSearchDocs(body: unknown): { docs: ArchiveItemMetadata[]; numFound: number; start: number } {
  if (!isRecord(body) || !isRecord(body.response)) {
    throw new ProviderError("internetarchive", "Internet Archive returned an unexpected search response.");
  }
  const docsRaw = body.response.docs;
  const docs = Array.isArray(docsRaw)
    ? docsRaw.filter((entry): entry is ArchiveItemMetadata => isRecord(entry))
    : [];
  const numFound = typeof body.response.numFound === "number" && Number.isFinite(body.response.numFound)
    ? body.response.numFound
    : docs.length;
  const start = typeof body.response.start === "number" && Number.isFinite(body.response.start)
    ? body.response.start
    : 0;
  return { docs, numFound, start };
}

export async function fetchArchiveItemDetail(
  identifier: string,
  options: { signal?: AbortSignal } = {},
): Promise<ArchiveItemDetail> {
  const cleanId = parseArchiveTrackId(identifier).identifier.trim();
  if (!cleanId) {
    throw new ProviderError("internetarchive", "Missing Internet Archive item identifier.");
  }

  const url = buildProviderUrl("internetarchive", `${ARCHIVE_METADATA_URL}/${encodeURIComponent(cleanId)}`);
  const body = await fetchJson<ArchiveMetadataResponse>({
    provider: "internetarchive",
    url,
    cacheKey: `internetarchive:meta:${cleanId}`,
    ttl: TTL.detail,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!isRecord(body) || (!isRecord(body.metadata) && !Array.isArray(body.files))) {
    throw new ProviderError("internetarchive", `Internet Archive item "${cleanId}" is unavailable.`);
  }

  return buildArchiveItemDetail(cleanId, body);
}

/**
 * Queries Internet Archive's Advanced Search API (`mediatype:audio`) and enriches
 * each result with item-level file, duration, and rights metadata.
 */
export async function searchArchiveAudioPage(
  query: string,
  options: TrackQueryOptions & { sortDownloads?: boolean } = {},
): Promise<ArchiveSearchPage> {
  const limit = clampLimit(options.limit, 12, 30);
  const offset = clampOffset(options.offset);
  const trimmed = query.trim();

  if (!trimmed && !options.genre && !options.sortDownloads) {
    return { tracks: [], numFound: 0, hasMore: false };
  }

  const searchUrl = buildProviderUrl(
    "internetarchive",
    buildArchiveAdvancedSearchUrl(trimmed, {
      limit,
      offset,
      genre: options.genre,
      sortDownloads: options.sortDownloads,
    }),
  );

  const envelope = await fetchJson<AdvancedSearchEnvelope>({
    provider: "internetarchive",
    url: searchUrl,
    cacheKey: `internetarchive:search:${trimmed.toLowerCase()}:${(options.genre ?? "").toLowerCase()}:${limit}:${offset}:${options.sortDownloads ? "dl" : "rel"}`,
    ttl: TTL.search,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const { docs, numFound } = extractSearchDocs(envelope);
  const tracks = (
    await mapWithConcurrency(docs, METADATA_CONCURRENCY, async (doc): Promise<Track | null> => {
      const identifier = readArchiveText(doc.identifier);
      if (!identifier) return null;
      try {
        const detail = await fetchArchiveItemDetail(identifier, { signal: options.signal });
        return mapArchiveDetailToTrack(detail);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        // Surface fallback metadata as unavailable when individual item lookup fails.
        const fallbackDetail = buildArchiveItemDetail(identifier, doc);
        return mapArchiveDetailToTrack(fallbackDetail);
      }
    })
  ).filter((track): track is Track => track !== null);

  return {
    tracks,
    numFound,
    hasMore: offset + docs.length < numFound && docs.length > 0,
  };
}

export const internetArchiveProvider: MusicProvider = {
  id: "internetarchive",
  name: PROVIDER_NAMES.internetarchive,

  isEnabled: () => true,
  disabledReason: () => undefined,

  async searchTracks(query, options: TrackQueryOptions) {
    const page = await searchArchiveAudioPage(query, options);
    return page.tracks;
  },

  async searchArtists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const searchUrl = buildProviderUrl(
      "internetarchive",
      buildArchiveAdvancedSearchUrl(trimmed, {
        limit: clampLimit(options.limit, 12, 24),
        offset: clampOffset(options.offset),
      }),
    );
    const envelope = await fetchJson<AdvancedSearchEnvelope>({
      provider: "internetarchive",
      url: searchUrl,
      cacheKey: `internetarchive:artist-search:${trimmed.toLowerCase()}:${clampLimit(options.limit, 12, 24)}:${clampOffset(options.offset)}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const { docs } = extractSearchDocs(envelope);
    const seen = new Set<string>();
    const artists: Artist[] = [];
    for (const doc of docs) {
      const artist = mapArchiveDocToArtist(doc);
      if (!artist || seen.has(artist.name.toLowerCase())) continue;
      seen.add(artist.name.toLowerCase());
      artists.push(artist);
    }
    return artists;
  },

  async searchPlaylists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const searchUrl = buildProviderUrl(
      "internetarchive",
      buildArchiveAdvancedSearchUrl(trimmed, {
        limit: clampLimit(options.limit, 12, 24),
        offset: clampOffset(options.offset),
      }),
    );
    const envelope = await fetchJson<AdvancedSearchEnvelope>({
      provider: "internetarchive",
      url: searchUrl,
      cacheKey: `internetarchive:playlist-search:${trimmed.toLowerCase()}:${clampLimit(options.limit, 12, 24)}:${clampOffset(options.offset)}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const { docs } = extractSearchDocs(envelope);
    return docs
      .map(mapArchiveDocToPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getTrending(options: TrackQueryOptions) {
    const page = await searchArchiveAudioPage("", {
      ...options,
      limit: clampLimit(options.limit, 12, 24),
      sortDownloads: true,
    });
    return page.tracks;
  },

  async getGenreTracks(genre, options: ListOptions) {
    const page = await searchArchiveAudioPage("", {
      ...options,
      genre,
      limit: clampLimit(options.limit, 12, 24),
      sortDownloads: true,
    });
    return page.tracks;
  },

  async getPopularArtists(options: ListOptions) {
    const searchUrl = buildProviderUrl(
      "internetarchive",
      buildArchiveAdvancedSearchUrl("", {
        limit: clampLimit(options.limit, 12, 24),
        offset: clampOffset(options.offset),
        sortDownloads: true,
      }),
    );
    const envelope = await fetchJson<AdvancedSearchEnvelope>({
      provider: "internetarchive",
      url: searchUrl,
      cacheKey: `internetarchive:popular-artists:${clampLimit(options.limit, 12, 24)}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const { docs } = extractSearchDocs(envelope);
    const seen = new Set<string>();
    const artists: Artist[] = [];
    for (const doc of docs) {
      const artist = mapArchiveDocToArtist(doc);
      if (!artist || seen.has(artist.name.toLowerCase())) continue;
      seen.add(artist.name.toLowerCase());
      artists.push(artist);
    }
    return artists;
  },

  async getFeaturedPlaylists(options: ListOptions) {
    const searchUrl = buildProviderUrl(
      "internetarchive",
      buildArchiveAdvancedSearchUrl("", {
        limit: clampLimit(options.limit, 12, 24),
        offset: clampOffset(options.offset),
        sortDownloads: true,
      }),
    );
    const envelope = await fetchJson<AdvancedSearchEnvelope>({
      provider: "internetarchive",
      url: searchUrl,
      cacheKey: `internetarchive:featured-playlists:${clampLimit(options.limit, 12, 24)}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const { docs } = extractSearchDocs(envelope);
    return docs
      .map(mapArchiveDocToPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getArtist(artistId, options: ListOptions) {
    const detail = await fetchArchiveItemDetail(artistId, options);
    return {
      id: `internetarchive-${detail.identifier}`,
      providerId: "internetarchive",
      providerName: PROVIDER_NAMES.internetarchive,
      providerArtistId: detail.identifier,
      name: detail.creator,
      avatar: detail.artwork,
      trackCount: detail.audioFiles.length,
      ...(detail.description ? { bio: detail.description } : {}),
      accent: mapArchiveDetailToTrack(detail).accent,
    };
  },

  async getArtistTracks(artistId, options: ListOptions) {
    const detail = await fetchArchiveItemDetail(artistId, options);
    return mapArchiveDetailToTracks(detail);
  },

  async getPlaylist(playlistId, options: ListOptions) {
    const detail = await fetchArchiveItemDetail(playlistId, options);
    return {
      id: `internetarchive-${detail.identifier}`,
      providerId: "internetarchive",
      providerName: PROVIDER_NAMES.internetarchive,
      providerPlaylistId: detail.identifier,
      name: detail.title,
      description: detail.description,
      artwork: detail.artwork,
      trackCount: detail.audioFiles.length,
      ownerName: detail.creator,
      accent: mapArchiveDetailToTrack(detail).accent,
      permalink: detail.permalink,
    };
  },

  async getPlaylistTracks(playlistId, options: ListOptions) {
    const detail = await fetchArchiveItemDetail(playlistId, options);
    return mapArchiveDetailToTracks(detail);
  },

  async getTrack(trackId, options: ListOptions) {
    const parsed = parseArchiveTrackId(trackId);
    if (!parsed.identifier) return null;
    const detail = await fetchArchiveItemDetail(parsed.identifier, options);
    const matchedFile = parsed.fileName
      ? detail.audioFiles.find((file) => file.fileName === parsed.fileName)
      : detail.audioFiles[0];
    return mapArchiveDetailToTrack(detail, matchedFile);
  },
};
