import type { Artist, ProviderId, ProviderPlaylist, Track } from "../types/music";

export type ListOptions = {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export type TrackQueryOptions = ListOptions & {
  genre?: string;
};

/**
 * The contract every music source implements. Services and UI only ever talk to
 * this interface, so adding or removing a provider never touches React code.
 */
export type MusicProvider = {
  readonly id: ProviderId;
  readonly name: string;
  /** False when the provider needs configuration we do not have yet. */
  isEnabled(): boolean;
  disabledReason(): string | undefined;

  searchTracks(query: string, options: TrackQueryOptions): Promise<Track[]>;
  searchArtists(query: string, options: ListOptions): Promise<Artist[]>;
  searchPlaylists(query: string, options: ListOptions): Promise<ProviderPlaylist[]>;

  getTrending(options: TrackQueryOptions): Promise<Track[]>;
  getGenreTracks(genre: string, options: ListOptions): Promise<Track[]>;
  getPopularArtists(options: ListOptions): Promise<Artist[]>;
  /** Charts or editorial playlist collections offered by the provider. */
  getFeaturedPlaylists(options: ListOptions): Promise<ProviderPlaylist[]>;

  getArtist(artistId: string, options: ListOptions): Promise<Artist | null>;
  getArtistTracks(artistId: string, options: ListOptions): Promise<Track[]>;

  getPlaylist(playlistId: string, options: ListOptions): Promise<ProviderPlaylist | null>;
  getPlaylistTracks(playlistId: string, options: ListOptions): Promise<Track[]>;

  getTrack(trackId: string, options: ListOptions): Promise<Track | null>;
};

/** Slicing helper so provider pagination stays consistent. */
export function clampLimit(value: number | undefined, fallback: number, max = 50): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function clampOffset(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Deterministic accent colour derived from an id, for artwork fallbacks. */
export function accentFor(seed: string, offset = 0): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return `hsl(${(hash + offset) % 360} 58% 58%)`;
}

/** How many tracks a provider should return when a caller does not say. */
export const DEFAULT_PAGE = 24;

export function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
