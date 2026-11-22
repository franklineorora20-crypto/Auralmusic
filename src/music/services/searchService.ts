import { enabledProviders, getProvider } from "../providers";
import type { MusicProvider } from "../providers/base";
import { isAbortError } from "../lib/http";
import type { Artist, ProviderId, ProviderPlaylist, SearchQuery, SearchResults, Track } from "../types/music";

export type ProviderFailure = {
  providerId: ProviderId;
  providerName: string;
  message: string;
};

export type SearchOutcome = SearchResults & {
  failures: ProviderFailure[];
  /** True when at least one provider answered. */
  anySuccess: boolean;
};

/** Strip control characters and clamp length before anything reaches a URL. */
export function sanitizeTerm(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  // Round-robin so the first screen is not dominated by a single provider.
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

function describe(error: unknown, provider: MusicProvider): ProviderFailure {
  return {
    providerId: provider.id,
    providerName: provider.name,
    message: error instanceof Error ? error.message : `${provider.name} could not be reached.`,
  };
}

type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

function collect<T>(
  provider: MusicProvider,
  result: Settled<T[]>,
  failures: ProviderFailure[],
): T[] {
  if (result.status === "fulfilled") return result.value;
  if (isAbortError(result.reason)) return [];
  failures.push(describe(result.reason, provider));
  return [];
}

/**
 * Search every enabled provider in parallel and normalise the outcome.
 * A single provider failing never fails the search: it is reported in
 * `failures` and the remaining results still render.
 */
export async function searchMusic(query: SearchQuery): Promise<SearchOutcome> {
  const term = sanitizeTerm(query.term);
  if (!term) {
    return { tracks: [], artists: [], playlists: [], failures: [], anySuccess: true };
  }

  const providers = query.providerId
    ? [getProvider(query.providerId)].filter((provider): provider is MusicProvider => Boolean(provider?.isEnabled()))
    : enabledProviders();

  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;
  const kind = query.kind ?? "all";

  const options = {
    limit,
    offset,
    ...(query.genre ? { genre: query.genre } : {}),
    ...(query.signal ? { signal: query.signal } : {}),
  };

  const failures: ProviderFailure[] = [];
  const wantsTracks = kind === "all" || kind === "tracks";
  const wantsArtists = kind === "all" || kind === "artists";
  const wantsPlaylists = kind === "all" || kind === "playlists";

  const trackResults = await Promise.all(
    providers.map(async (provider) => {
      if (!wantsTracks) return [] as Track[];
      const settled = await provider.searchTracks(term, options).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      return collect(provider, settled, failures);
    }),
  );

  const artistResults = await Promise.all(
    providers.map(async (provider) => {
      if (!wantsArtists) return [] as Artist[];
      const settled = await provider.searchArtists(term, options).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      return collect(provider, settled, failures);
    }),
  );

  const playlistResults = await Promise.all(
    providers.map(async (provider) => {
      if (!wantsPlaylists) return [] as ProviderPlaylist[];
      const settled = await provider.searchPlaylists(term, options).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      return collect(provider, settled, failures);
    }),
  );

  const tracks = mergeById(trackResults);
  const artists = mergeById(artistResults);
  const playlists = mergeById(playlistResults);

  return {
    tracks,
    artists,
    playlists,
    failures,
    anySuccess: tracks.length + artists.length + playlists.length > 0 || failures.length < providers.length,
  };
}
