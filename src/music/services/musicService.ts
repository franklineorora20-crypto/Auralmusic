import { getProvider } from "../providers";
import type { MusicProvider } from "../providers/base";
import { isAbortError } from "../lib/http";
import type { Artist, ProviderId, ProviderPlaylist, Track } from "../types/music";
import type { ProviderFailure } from "./searchService";

export type FeedResult<T> = {
  items: T[];
  failures: ProviderFailure[];
};

function failureFor(provider: MusicProvider, error: unknown): ProviderFailure {
  return {
    providerId: provider.id,
    providerName: provider.name,
    message: error instanceof Error ? error.message : `${provider.name} is unavailable.`,
  };
}

function failureKey(failure: ProviderFailure): string {
  return `${failure.providerId}:${failure.message}`;
}

function dedupeFailures(failures: ProviderFailure[]): ProviderFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = failureKey(failure);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function attempt<T>(work: () => Promise<T[]>): Promise<{ items: T[]; error?: unknown }> {
  try {
    return { items: await work() };
  } catch (error) {
    return { items: [], error };
  }
}

export function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

/** Merge several provider lists round-robin so one source cannot dominate. */
export function interleave<T>(lists: T[][]): T[] {
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);
  const merged: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) merged.push(item);
    }
  }
  return merged;
}

export type HomeFeed = {
  trending: Track[];
  newReleases: Track[];
  popularArtists: Artist[];
  featuredPlaylists: ProviderPlaylist[];
  failures: ProviderFailure[];
};

/**
 * Loads the discovery feed from every configured catalogue provider in
 * parallel. Individual providers can fail without emptying the page.
 */
export async function loadHomeFeed(options: { signal?: AbortSignal; trendingLimit?: number } = {}): Promise<HomeFeed> {
  const { signal, trendingLimit = 30 } = options;
  const failures: ProviderFailure[] = [];
  const providers = [getProvider("audius"), getProvider("jamendo")].filter(
    (provider): provider is MusicProvider => Boolean(provider?.isEnabled()),
  );

  const [trendingLists, artistLists, playlistLists] = await Promise.all([
    Promise.all(
      providers.map(async (provider) => {
        const result = await attempt(() => provider.getTrending({ limit: trendingLimit, ...(signal ? { signal } : {}) }));
        if (result.error && !isAbortError(result.error)) failures.push(failureFor(provider, result.error));
        return result.items;
      }),
    ),
    Promise.all(
      providers.map(async (provider) => {
        const result = await attempt(() => provider.getPopularArtists({ limit: 10, ...(signal ? { signal } : {}) }));
        if (result.error && !isAbortError(result.error)) failures.push(failureFor(provider, result.error));
        return result.items;
      }),
    ),
    Promise.all(
      providers.map(async (provider) => {
        const result = await attempt(() => provider.getFeaturedPlaylists({ limit: 10, ...(signal ? { signal } : {}) }));
        if (result.error && !isAbortError(result.error)) failures.push(failureFor(provider, result.error));
        return result.items;
      }),
    ),
  ]);

  const trending = dedupeTracks(interleave(trendingLists));
  const popularArtists = interleave(artistLists as Artist[][]);
  const featuredPlaylists = interleave(playlistLists as ProviderPlaylist[][]);

  return {
    trending,
    newReleases: pickNewReleases(trending, 12),
    popularArtists: dedupeArtists(popularArtists),
    featuredPlaylists: dedupePlaylists(featuredPlaylists),
    failures: dedupeFailures(failures),
  };
}

export function dedupeArtists(artists: Artist[]): Artist[] {
  const seen = new Set<string>();
  return artists.filter((artist) => {
    if (seen.has(artist.id)) return false;
    seen.add(artist.id);
    return true;
  });
}

export function dedupePlaylists(playlists: ProviderPlaylist[]): ProviderPlaylist[] {
  const seen = new Set<string>();
  return playlists.filter((playlist) => {
    if (seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  });
}

/** Newest tracks from a trending pool — no extra provider request needed. */
export function pickNewReleases(pool: Track[], limit: number): Track[] {
  return [...pool]
    .filter((track) => Boolean(track.releaseDate))
    .sort((left, right) => (right.releaseDate ?? "").localeCompare(left.releaseDate ?? ""))
    .slice(0, limit);
}

export type GenreFeed = FeedResult<Track> & { genre: string };

export async function loadGenreFeed(genre: string, options: { signal?: AbortSignal; limit?: number } = {}): Promise<GenreFeed> {
  const { signal, limit = 30 } = options;
  const failures: ProviderFailure[] = [];
  const providers = [getProvider("audius"), getProvider("jamendo")].filter(
    (provider): provider is MusicProvider => Boolean(provider?.isEnabled()),
  );

  const lists = await Promise.all(
    providers.map(async (provider) => {
      const result = await attempt(() => provider.getGenreTracks(genre, { limit, ...(signal ? { signal } : {}) }));
      if (result.error && !isAbortError(result.error)) failures.push(failureFor(provider, result.error));
      return result.items;
    }),
  );

  return { genre, items: dedupeTracks(interleave(lists)), failures: dedupeFailures(failures) };
}

export type ArtistDetail = FeedResult<Track> & { artist: Artist | null };

export async function loadArtistDetail(artistId: string, options: { signal?: AbortSignal } = {}): Promise<ArtistDetail> {
  const providerId = artistId.split("-")[0] as ProviderId;
  const provider = getProvider(providerId);
  if (!provider?.isEnabled()) {
    return { artist: null, items: [], failures: [] };
  }
  const failures: ProviderFailure[] = [];
  const [artist, tracks] = await Promise.all([
    attempt(async () => {
      const found = await provider.getArtist(artistId, options);
      return found ? [found] : [];
    }),
    attempt(() => provider.getArtistTracks(artistId, { limit: 30, ...options })),
  ]);
  if (artist.error && !isAbortError(artist.error)) failures.push(failureFor(provider, artist.error));
  if (tracks.error && !isAbortError(tracks.error)) failures.push(failureFor(provider, tracks.error));
  return { artist: (artist.items as Artist[])[0] ?? null, items: tracks.items, failures };
}

export type ProviderPlaylistDetail = FeedResult<Track> & { playlist: ProviderPlaylist | null };

export async function loadProviderPlaylist(
  playlistId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProviderPlaylistDetail> {
  const providerId = playlistId.split("-")[0] as ProviderId;
  const provider = getProvider(providerId);
  if (!provider?.isEnabled()) {
    return { playlist: null, items: [], failures: [] };
  }
  const failures: ProviderFailure[] = [];
  const [playlist, tracks] = await Promise.all([
    attempt(async () => {
      const found = await provider.getPlaylist(playlistId, options);
      return found ? [found] : [];
    }),
    attempt(() => provider.getPlaylistTracks(playlistId, { limit: 50, ...options })),
  ]);
  if (playlist.error && !isAbortError(playlist.error)) failures.push(failureFor(provider, playlist.error));
  if (tracks.error && !isAbortError(tracks.error)) failures.push(failureFor(provider, tracks.error));
  return { playlist: (playlist.items as ProviderPlaylist[])[0] ?? null, items: tracks.items, failures };
}

export type AlbumDetail = FeedResult<Track> & { title: string; artist: string };

/**
 * Albums are provider playlists on Audius and album endpoints on Jamendo. The
 * cached catalogue is used as a fallback whenever the provider cannot answer.
 */
export async function loadAlbumDetail(
  albumId: string,
  fallbackTracks: Track[],
  options: { signal?: AbortSignal } = {},
): Promise<AlbumDetail> {
  const providerId = albumId.split("-")[0] as ProviderId;
  const provider = getProvider(providerId);
  const title = fallbackTracks[0]?.album ?? "Album";
  const artist = fallbackTracks[0]?.artist ?? "";
  if (!provider?.isEnabled()) {
    return { title, artist, items: fallbackTracks, failures: [] };
  }
  const result = await attempt(() => provider.getPlaylistTracks(albumId, { limit: 50, ...options }));
  if (result.error && !isAbortError(result.error)) {
    return {
      title,
      artist,
      items: fallbackTracks,
      failures: [failureFor(provider, result.error)],
    };
  }
  const items = result.items.length ? result.items : fallbackTracks;
  return { title, artist, items, failures: [] };
}
