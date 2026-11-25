import { buildProviderUrl, getJamendoClientId, isJamendoConfigured } from "../config";
import {
  fetchJson,
  isRecord,
  ProviderError,
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readString,
  safeUrl,
  TTL,
} from "../lib/http";
import type { Artist, ProviderPlaylist, Track, TrackLicensing } from "../types/music";
import { PROVIDER_NAMES } from "../types/music";
import {
  accentFor,
  clampLimit,
  clampOffset,
  type ListOptions,
  type MusicProvider,
  type TrackQueryOptions,
} from "./base";

const JAMENDO_API = "https://api.jamendo.com/v3.0";

/**
 * Jamendo client ids are free, public identifiers, but they must never be
 * committed: they arrive from `VITE_JAMENDO_CLIENT_ID` or from the value the
 * operator saves in the app at runtime.
 */
function requireClientId(): string {
  const clientId = getJamendoClientId();
  if (!clientId) {
    throw new ProviderError("jamendo", "Jamendo needs a free client ID. Add one in Discover → Providers.");
  }
  return clientId;
}

function jamendoUrl(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams({
    client_id: requireClientId(),
    format: "json",
    include: "musicinfo",
    audioformat: "mp32",
  });
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === 0) return;
    search.set(key, String(value));
  });
  return buildProviderUrl("jamendo", `${JAMENDO_API}${path}?${search.toString()}`);
}

/** Jamendo answers HTTP 200 even for failures; the envelope says what happened. */
function unwrap(body: unknown, provider: "jamendo" = "jamendo"): unknown[] {
  const headers = readRecord(body, "headers");
  const status = readString(headers, "status");
  if (status && status !== "success") {
    const message = readString(headers, "error_message") || "Jamendo rejected the request.";
    throw new ProviderError(provider, message, readNumber(headers, "code") || undefined);
  }
  const results = isRecord(body) ? body.results : undefined;
  return Array.isArray(results) ? results : [];
}

function licenceFromUrl(licenseUrl: string): TrackLicensing["name"] {
  if (!licenseUrl) return "Jamendo licence";
  const match = licenseUrl.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  if (!match) return "Creative Commons";
  return `Creative Commons ${match[1].toUpperCase()} ${match[2]}`;
}

function jamendoArtwork(source: unknown): string {
  return (
    safeUrl(readString(source, "image")) ||
    safeUrl(readString(source, "album_image")) ||
    safeUrl(readString(source, "artist_image"))
  );
}

export function mapJamendoTrack(source: unknown): Track | null {
  const providerTrackId = readString(source, "id");
  const title = readString(source, "name");
  const audio = safeUrl(readString(source, "audio"));
  if (!providerTrackId || !title || !audio) return null;

  const downloadAllowed = readBoolean(source, "audiodownload_allowed");
  const downloadUrl = downloadAllowed ? safeUrl(readString(source, "audiodownload")) : "";
  const licenseUrl = safeUrl(readString(source, "license_ccurl")) || "https://creativecommons.org/licenses/";
  const musicInfo = readRecord(source, "musicinfo");
  const tags = readRecord(musicInfo, "tags");
  const genres = readArray(tags, "genres").filter((genre): genre is string => typeof genre === "string");
  const extraTags = [
    ...readArray(tags, "vartags"),
    ...readArray(tags, "instruments"),
  ].filter((tag): tag is string => typeof tag === "string");
  const artistId = readString(source, "artist_id");
  const artwork = jamendoArtwork(source);

  return {
    id: `jamendo-${providerTrackId}`,
    providerId: "jamendo",
    providerName: PROVIDER_NAMES.jamendo,
    providerTrackId,
    title,
    artist: readString(source, "artist_name") || "Unknown artist",
    ...(artistId ? { artistId: `jamendo-${artistId}` } : {}),
    album: readString(source, "album_name") || "Single",
    ...(readString(source, "album_id") ? { albumId: `jamendo-${readString(source, "album_id")}` } : {}),
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
    duration: Math.max(0, readNumber(source, "duration")),
    streamUrl: audio,
    ...(downloadUrl ? { downloadUrl } : {}),
    genre: genres[0] ?? "Various",
    tags: [...genres, ...extraTags].slice(0, 8),
    licensing: {
      name: licenceFromUrl(licenseUrl),
      url: licenseUrl,
      attribution: `${readString(source, "artist_name") || "Unknown artist"} — licensed via Jamendo`,
      streamingAllowed: true,
      downloadAllowed: Boolean(downloadUrl),
      note: downloadAllowed
        ? "The artist allows downloads through Jamendo."
        : "Jamendo permits streaming only for this track.",
    },
    ...(readString(source, "releasedate") ? { releaseDate: readString(source, "releasedate") } : {}),
    ...(safeUrl(readString(source, "shareurl")) ? { permalink: safeUrl(readString(source, "shareurl")) } : {}),
    accent: accentFor(providerTrackId, 20),
  };
}

export function mapJamendoArtist(source: unknown): Artist | null {
  const providerArtistId = readString(source, "id");
  const name = readString(source, "name");
  if (!providerArtistId || !name) return null;
  return {
    id: `jamendo-${providerArtistId}`,
    providerId: "jamendo",
    providerName: PROVIDER_NAMES.jamendo,
    providerArtistId,
    name,
    avatar: jamendoArtwork(source),
    accent: accentFor(providerArtistId, 60),
    ...(safeUrl(readString(source, "shareurl")) ? { permalink: safeUrl(readString(source, "shareurl")) } : {}),
  } as Artist & { permalink?: string };
}

export function mapJamendoPlaylist(source: unknown): ProviderPlaylist | null {
  const providerPlaylistId = readString(source, "id");
  const name = readString(source, "name") || readString(source, "title");
  if (!providerPlaylistId || !name) return null;
  return {
    id: `jamendo-${providerPlaylistId}`,
    providerId: "jamendo",
    providerName: PROVIDER_NAMES.jamendo,
    providerPlaylistId,
    name,
    description: readString(source, "description"),
    artwork: jamendoArtwork(source),
    trackCount: readNumber(source, "trackcount") || readNumber(source, "nb_tracks"),
    accent: accentFor(providerPlaylistId, 100),
    ...(safeUrl(readString(source, "shareurl")) ? { permalink: safeUrl(readString(source, "shareurl")) } : {}),
  };
}

function mapTracks(body: unknown): Track[] {
  return unwrap(body)
    .map(mapJamendoTrack)
    .filter((track): track is Track => track !== null);
}

export const jamendoProvider: MusicProvider = {
  id: "jamendo",
  name: PROVIDER_NAMES.jamendo,

  isEnabled: () => isJamendoConfigured(),
  disabledReason: () =>
    isJamendoConfigured()
      ? undefined
      : "Jamendo needs a free client ID (developer.jamendo.com). Add it in Discover → Providers.",

  async searchTracks(query, options: TrackQueryOptions) {
    const trimmed = query.trim();
    if (!trimmed || !isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", {
        search: trimmed,
        limit: clampLimit(options.limit, 20),
        offset: clampOffset(options.offset),
        tags: options.genre,
        order: "relevance",
      }),
      cacheKey: `jamendo:search:${trimmed.toLowerCase()}:${options.genre ?? ""}:${clampLimit(options.limit, 20)}:${clampOffset(options.offset)}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async searchArtists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed || !isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/artists/", { search: trimmed, limit: clampLimit(options.limit, 12), offset: clampOffset(options.offset) }),
      cacheKey: `jamendo:artist-search:${trimmed.toLowerCase()}:${clampLimit(options.limit, 12)}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return unwrap(body)
      .map(mapJamendoArtist)
      .filter((artist): artist is Artist => artist !== null);
  },

  async searchPlaylists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed || !isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/playlists/", { search: trimmed, limit: clampLimit(options.limit, 12), offset: clampOffset(options.offset) }),
      cacheKey: `jamendo:playlist-search:${trimmed.toLowerCase()}:${clampLimit(options.limit, 12)}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return unwrap(body)
      .map(mapJamendoPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getTrending(options: TrackQueryOptions) {
    if (!isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", {
        limit: clampLimit(options.limit, 20),
        offset: clampOffset(options.offset),
        order: "popularity_week",
        tags: options.genre,
      }),
      cacheKey: `jamendo:trending:${options.genre ?? "all"}:${clampLimit(options.limit, 20)}:${clampOffset(options.offset)}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getGenreTracks(genre, options: ListOptions) {
    if (!isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", {
        limit: clampLimit(options.limit, 20),
        offset: clampOffset(options.offset),
        tags: genre,
        order: "popularity_month",
      }),
      cacheKey: `jamendo:genre:${genre.toLowerCase()}:${clampLimit(options.limit, 20)}:${clampOffset(options.offset)}`,
      ttl: TTL.genre,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getPopularArtists(options: ListOptions) {
    if (!isJamendoConfigured()) return [];
    const limit = clampLimit(options.limit, 12);
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", { limit: 60, order: "popularity_week", groupby: "artist_id" }),
      cacheKey: "jamendo:popular-artists",
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const seen = new Set<string>();
    const artists: Artist[] = [];
    for (const entry of unwrap(body)) {
      const artistId = readString(entry, "artist_id");
      if (!artistId || seen.has(artistId)) continue;
      const artist = mapJamendoArtist({
        id: artistId,
        name: readString(entry, "artist_name"),
        image: readString(entry, "artist_image") || readString(entry, "image"),
        shareurl: readString(entry, "shareurl"),
      });
      if (!artist) continue;
      seen.add(artistId);
      artists.push(artist);
      if (artists.length >= limit) break;
    }
    return artists;
  },

  async getFeaturedPlaylists(options: ListOptions) {
    if (!isJamendoConfigured()) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/playlists/", { limit: clampLimit(options.limit, 12), offset: clampOffset(options.offset) }),
      cacheKey: `jamendo:featured-playlists:${clampLimit(options.limit, 12)}:${clampOffset(options.offset)}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return unwrap(body)
      .map(mapJamendoPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getArtist(artistId, options: ListOptions) {
    if (!isJamendoConfigured()) return null;
    const id = artistId.replace(/^jamendo-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/artists/", { id, limit: 1 }),
      cacheKey: `jamendo:artist:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapJamendoArtist(unwrap(body)[0]);
  },

  async getArtistTracks(artistId, options: ListOptions) {
    if (!isJamendoConfigured()) return [];
    const id = artistId.replace(/^jamendo-/, "");
    if (!id) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", { artist_id: id, limit: clampLimit(options.limit, 25), offset: clampOffset(options.offset) }),
      cacheKey: `jamendo:artist-tracks:${id}:${clampLimit(options.limit, 25)}:${clampOffset(options.offset)}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getPlaylist(playlistId, options: ListOptions) {
    if (!isJamendoConfigured()) return null;
    const id = playlistId.replace(/^jamendo-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/playlists/", { id, limit: 1 }),
      cacheKey: `jamendo:playlist:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapJamendoPlaylist(unwrap(body)[0]);
  },

  async getPlaylistTracks(playlistId, options: ListOptions) {
    if (!isJamendoConfigured()) return [];
    const id = playlistId.replace(/^jamendo-/, "");
    if (!id) return [];
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/playlists/tracks/", { id, limit: clampLimit(options.limit, 50), offset: clampOffset(options.offset) }),
      cacheKey: `jamendo:playlist-tracks:${id}:${clampLimit(options.limit, 50)}:${clampOffset(options.offset)}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getTrack(trackId, options: ListOptions) {
    if (!isJamendoConfigured()) return null;
    const id = trackId.replace(/^jamendo-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "jamendo",
      url: jamendoUrl("/tracks/", { id, limit: 1 }),
      cacheKey: `jamendo:track:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapJamendoTrack(unwrap(body)[0]);
  },
};
