import type { Artist, ProviderPlaylist, Track } from "../types/music";
import { PROVIDER_NAMES } from "../types/music";
import { accentFor, type ListOptions, type MusicProvider, type TrackQueryOptions } from "./base";

/**
 * The local library provider.
 *
 * Imported audio lives in IndexedDB; the library store mirrors the imported
 * tracks into this registry so search, genre browsing and the queue can treat
 * local files exactly like catalogue tracks — with no network access at all.
 */
let registry: Track[] = [];
const listeners = new Set<() => void>();

export function setLocalTracks(tracks: Track[]): void {
  registry = tracks;
  listeners.forEach((listener) => listener());
}

export function getLocalTracks(): Track[] {
  return registry;
}

export function subscribeToLocalTracks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function matches(track: Track, term: string): boolean {
  const haystack = `${track.title} ${track.artist} ${track.album} ${track.genre} ${track.tags.join(" ")}`.toLowerCase();
  return haystack.includes(term);
}

function matchTracks(query: string, limit?: number): Track[] {
  const term = query.trim().toLowerCase();
  const found = term ? registry.filter((track) => matches(track, term)) : registry;
  return limit ? found.slice(0, limit) : found;
}

function artistsFromTracks(tracks: Track[], limit: number): Artist[] {
  const seen = new Map<string, Artist>();
  for (const track of tracks) {
    if (seen.has(track.artist)) continue;
    seen.set(track.artist, {
      id: `local-artist-${track.artist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      providerId: "local",
      providerName: PROVIDER_NAMES.local,
      providerArtistId: track.artist,
      name: track.artist,
      avatar: track.artwork,
      trackCount: tracks.filter((entry) => entry.artist === track.artist).length,
      accent: accentFor(track.artist, 30),
    });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export const localProvider: MusicProvider = {
  id: "local",
  name: PROVIDER_NAMES.local,

  isEnabled: () => true,
  disabledReason: () => undefined,

  async searchTracks(query, options: TrackQueryOptions) {
    const term = query.trim().toLowerCase();
    const genre = options.genre?.toLowerCase();
    const found = registry.filter((track) => {
      if (genre && !`${track.genre} ${track.tags.join(" ")}`.toLowerCase().includes(genre)) return false;
      return term ? matches(track, term) : true;
    });
    const offset = options.offset ?? 0;
    return found.slice(offset, offset + (options.limit ?? 20));
  },

  async searchArtists(query, options: ListOptions) {
    const found = artistsFromTracks(matchTracks(query), options.limit ?? 12);
    return found;
  },

  async searchPlaylists(query, options: ListOptions) {
    void query;
    void options;
    // Imported files carry no provider playlists; user playlists live in the
    // library store and are searched there.
    return [] as ProviderPlaylist[];
  },

  async getTrending(options: TrackQueryOptions) {
    return registry.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 20));
  },

  async getGenreTracks(genre, options: ListOptions) {
    const term = genre.toLowerCase();
    const found = registry.filter((track) => `${track.genre} ${track.tags.join(" ")}`.toLowerCase().includes(term));
    return found.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 20));
  },

  async getPopularArtists(options: ListOptions) {
    return artistsFromTracks(registry, options.limit ?? 12);
  },

  async getFeaturedPlaylists() {
    return [] as ProviderPlaylist[];
  },

  async getArtist(artistId, options: ListOptions) {
    void options;
    return artistsFromTracks(registry.filter((track) => track.artistId === artistId || track.artist === artistId), 1)[0] ?? null;
  },

  async getArtistTracks(artistId, options: ListOptions) {
    const found = registry.filter((track) => track.artistId === artistId || `local-artist-${track.artist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` === artistId);
    return found.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 25));
  },

  async getPlaylist() {
    return null;
  },

  async getPlaylistTracks() {
    return [] as Track[];
  },

  async getTrack(trackId, options: ListOptions) {
    void options;
    return registry.find((track) => track.id === trackId || track.providerTrackId === trackId) ?? null;
  },
};
