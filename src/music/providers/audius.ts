import { AUDIUS_APP_NAME, buildProviderUrl } from "../config";
import {
  fetchJson,
  isRecord,
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

const AUDIUS_API = "https://api.audius.co/v1";

/** Audius returns 150/480/1000 px artwork under an `artwork` record. */
function pickArtwork(source: unknown, key: string): string {
  const record = readRecord(source, key);
  if (!record) return "";
  return safeUrl(readString(record, "1000x1000")) || safeUrl(readString(record, "480x480")) || safeUrl(readString(record, "150x150"));
}

function pickSmallArtwork(source: unknown, key: string): string {
  const record = readRecord(source, key);
  if (!record) return "";
  return safeUrl(readString(record, "150x150")) || safeUrl(readString(record, "480x480"));
}

/**
 * Audius exposes the uploader's download setting (`is_downloadable`) and the
 * per-request access decision (`access.download`). A stream URL alone is never
 * treated as download permission.
 */
function resolveDownloadAllowed(source: unknown): boolean {
  const declaredDownloadable = readBoolean(source, "is_downloadable");
  const access = readRecord(source, "access");
  const accessDownload = access && "download" in access ? readBoolean(access, "download") : undefined;
  return declaredDownloadable && accessDownload !== false;
}

function resolveStreamable(source: unknown): boolean {
  if (readBoolean(source, "is_stream_gated")) return false;
  if (isRecord(source) && "is_streamable" in source) return readBoolean(source, "is_streamable");
  const access = readRecord(source, "access");
  if (access && "stream" in access) return readBoolean(access, "stream");
  return true;
}

function audiusLicensing(source: unknown, downloadAllowed: boolean): TrackLicensing {
  const declared = readString(source, "license").trim();
  return {
    name: declared || "Audius track licence (uploader-defined)",
    url: "https://audius.co/terms",
    attribution: "Streamed from Audius",
    streamingAllowed: true,
    downloadAllowed,
    note: downloadAllowed
      ? "The uploader enabled downloads on Audius."
      : "The uploader has not enabled downloads; streaming only.",
  };
}

export function mapAudiusTrack(source: unknown): Track | null {
  const providerTrackId = readString(source, "id");
  const title = readString(source, "title");
  if (!providerTrackId || !title) return null;
  if (!resolveStreamable(source)) return null;

  const user = readRecord(source, "user");
  const backlink = readRecord(source, "album_backlink");
  const downloadAllowed = resolveDownloadAllowed(source);
  const permalink = readString(source, "permalink");

  const artwork = pickArtwork(source, "artwork");
  const artworkSmall = pickSmallArtwork(source, "artwork");

  return {
    id: `audius-${providerTrackId}`,
    providerId: "audius",
    providerName: PROVIDER_NAMES.audius,
    providerTrackId,
    title,
    artist: readString(user, "name") || readString(user, "handle") || "Unknown artist",
    artistId: readString(user, "id") ? `audius-${readString(user, "id")}` : undefined,
    album: readString(backlink, "playlist_name") || "Single",
    albumId: readString(backlink, "playlist_id") ? `audius-${readString(backlink, "playlist_id")}` : undefined,
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
    duration: Math.max(0, readNumber(source, "duration")),
    streamUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(providerTrackId)}/stream?app_name=${encodeURIComponent(AUDIUS_APP_NAME)}`,
    ...(downloadAllowed
      ? { downloadUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(providerTrackId)}/download?app_name=${encodeURIComponent(AUDIUS_APP_NAME)}` }
      : {}),
    genre: readString(source, "genre") || "Other",
    tags: readArray(source, "tags").filter((tag): tag is string => typeof tag === "string").slice(0, 8),
    licensing: audiusLicensing(source, downloadAllowed),
    ...(readString(source, "release_date") ? { releaseDate: readString(source, "release_date") } : {}),
    ...(permalink ? { permalink: `https://audius.co${permalink}` } : {}),
    accent: accentFor(providerTrackId),
  };
}

export function mapAudiusArtist(source: unknown): Artist | null {
  const providerArtistId = readString(source, "id");
  const name = readString(source, "name") || readString(source, "handle");
  if (!providerArtistId || !name) return null;
  const bio = readString(source, "bio");
  return {
    id: `audius-${providerArtistId}`,
    providerId: "audius",
    providerName: PROVIDER_NAMES.audius,
    providerArtistId,
    name,
    ...(readString(source, "handle") ? { handle: readString(source, "handle") } : {}),
    avatar: pickSmallArtwork(source, "profile_picture") || pickArtwork(source, "profile_picture"),
    followerCount: readNumber(source, "follower_count"),
    trackCount: readNumber(source, "track_count"),
    ...(bio ? { bio } : {}),
    accent: accentFor(providerArtistId, 40),
  };
}

export function mapAudiusPlaylist(source: unknown): ProviderPlaylist | null {
  const providerPlaylistId = readString(source, "id") || readString(source, "playlist_id");
  const name = readString(source, "playlist_name") || readString(source, "name");
  if (!providerPlaylistId || !name) return null;
  const contents = readArray(source, "playlist_contents");
  const trackCount = readNumber(source, "track_count") || contents.length;
  const description = readString(source, "description");
  return {
    id: `audius-${providerPlaylistId}`,
    providerId: "audius",
    providerName: PROVIDER_NAMES.audius,
    providerPlaylistId,
    name,
    description,
    artwork: pickArtwork(source, "artwork"),
    trackCount,
    accent: accentFor(providerPlaylistId, 80),
    ...(readString(source, "permalink") ? { permalink: `https://audius.co${readString(source, "permalink")}` } : {}),
  };
}

function extractData(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  const data = body.data;
  return Array.isArray(data) ? data : [];
}

function extractFirst(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  const data = body.data;
  if (Array.isArray(data)) return data[0];
  return data;
}

function url(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams({ app_name: AUDIUS_APP_NAME });
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    search.set(key, String(value));
  });
  const full = `${AUDIUS_API}${path}?${search.toString()}`;
  return buildProviderUrl("audius", full);
}

function mapTracks(body: unknown): Track[] {
  return extractData(body)
    .map(mapAudiusTrack)
    .filter((track): track is Track => track !== null);
}

export const audiusProvider: MusicProvider = {
  id: "audius",
  name: PROVIDER_NAMES.audius,

  isEnabled: () => true,
  disabledReason: () => undefined,

  async searchTracks(query, options: TrackQueryOptions) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = clampLimit(options.limit, 20);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/tracks/search", { query: trimmed, limit, offset }),
      cacheKey: `audius:search:${trimmed.toLowerCase()}:${limit}:${offset}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async searchArtists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = clampLimit(options.limit, 12);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/users/search", { query: trimmed, limit, offset }),
      cacheKey: `audius:user-search:${trimmed.toLowerCase()}:${limit}:${offset}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return extractData(body)
      .map(mapAudiusArtist)
      .filter((artist): artist is Artist => artist !== null);
  },

  async searchPlaylists(query, options: ListOptions) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = clampLimit(options.limit, 12);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/playlists/search", { query: trimmed, limit, offset }),
      cacheKey: `audius:playlist-search:${trimmed.toLowerCase()}:${limit}:${offset}`,
      ttl: TTL.search,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return extractData(body)
      .map(mapAudiusPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getTrending(options: TrackQueryOptions) {
    const limit = clampLimit(options.limit, 24);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/tracks/trending", { limit, offset, time: "week", genre: options.genre }),
      cacheKey: `audius:trending:${options.genre ?? "all"}:${limit}:${offset}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getGenreTracks(genre, options: ListOptions) {
    const limit = clampLimit(options.limit, 20);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/tracks/trending", { limit, offset, time: "month", genre }),
      cacheKey: `audius:genre:${genre.toLowerCase()}:${limit}:${offset}`,
      ttl: TTL.genre,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  /**
   * Audius has no working "popular users" endpoint on api.audius.co/v1
   * (`/users/popular` answers 400), so popular artists are derived from the
   * trending chart, which is the same signal surfaced on audius.co.
   */
  async getPopularArtists(options: ListOptions) {
    const limit = clampLimit(options.limit, 12);
    const body = await fetchJson({
      provider: "audius",
      url: url("/tracks/trending", { limit: 60, time: "week" }),
      cacheKey: "audius:trending:popular-artists",
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const seen = new Set<string>();
    const artists: Artist[] = [];
    for (const entry of extractData(body)) {
      const user = readRecord(entry, "user");
      const artist = mapAudiusArtist(user);
      if (!artist || seen.has(artist.id)) continue;
      seen.add(artist.id);
      artists.push(artist);
      if (artists.length >= limit) break;
    }
    return artists;
  },

  async getFeaturedPlaylists(options: ListOptions) {
    const limit = clampLimit(options.limit, 12);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url("/playlists/trending", { limit, offset }),
      cacheKey: `audius:featured-playlists:${limit}:${offset}`,
      ttl: TTL.feed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return extractData(body)
      .map(mapAudiusPlaylist)
      .filter((playlist): playlist is ProviderPlaylist => playlist !== null);
  },

  async getArtist(artistId, options: ListOptions) {
    const id = artistId.replace(/^audius-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "audius",
      url: url(`/users/${encodeURIComponent(id)}`, {}),
      cacheKey: `audius:user:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapAudiusArtist(extractFirst(body));
  },

  async getArtistTracks(artistId, options: ListOptions) {
    const id = artistId.replace(/^audius-/, "");
    if (!id) return [];
    const limit = clampLimit(options.limit, 25);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url(`/users/${encodeURIComponent(id)}/tracks`, { limit, offset, sort: "plays" }),
      cacheKey: `audius:user-tracks:${id}:${limit}:${offset}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getPlaylist(playlistId, options: ListOptions) {
    const id = playlistId.replace(/^audius-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "audius",
      url: url(`/playlists/${encodeURIComponent(id)}`, {}),
      cacheKey: `audius:playlist:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapAudiusPlaylist(extractFirst(body));
  },

  async getPlaylistTracks(playlistId, options: ListOptions) {
    const id = playlistId.replace(/^audius-/, "");
    if (!id) return [];
    const limit = clampLimit(options.limit, 50);
    const offset = clampOffset(options.offset);
    const body = await fetchJson({
      provider: "audius",
      url: url(`/playlists/${encodeURIComponent(id)}/tracks`, { limit, offset }),
      cacheKey: `audius:playlist-tracks:${id}:${limit}:${offset}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapTracks(body);
  },

  async getTrack(trackId, options: ListOptions) {
    const id = trackId.replace(/^audius-/, "");
    if (!id) return null;
    const body = await fetchJson({
      provider: "audius",
      url: url(`/tracks/${encodeURIComponent(id)}`, {}),
      cacheKey: `audius:track:${id}`,
      ttl: TTL.detail,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return mapAudiusTrack(extractFirst(body));
  },
};
