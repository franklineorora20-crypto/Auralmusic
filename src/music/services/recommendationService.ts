import type { Track } from "../types/music";

export type RecommendationReason =
  | { kind: "genre"; label: string }
  | { kind: "artist"; label: string }
  | { kind: "trending"; label: string }
  | { kind: "fresh"; label: string };

export type Recommendation = {
  track: Track;
  reason: RecommendationReason;
  score: number;
};

export type RecommendationInput = {
  /** Candidate pool, usually the trending feed. */
  pool: Track[];
  /** Tracks that shape taste: favourites, playlist contents, recent plays. */
  seeds?: Track[];
  /** Tracks to keep out of the result (already in the queue, for example). */
  exclude?: Track[];
  limit?: number;
};

function terms(track: Track): string[] {
  return [
    track.genre.toLowerCase(),
    ...track.tags.map((tag) => tag.toLowerCase()),
  ].filter(Boolean);
}

function scoreCandidate(candidate: Track, seedTerms: Map<string, number>, seedArtists: Set<string>): Recommendation {
  const candidateTerms = terms(candidate);
  let score = 0;
  let matchedTerm = "";

  for (const term of candidateTerms) {
    const weight = seedTerms.get(term);
    if (!weight) continue;
    score += weight * 3;
    if (!matchedTerm) matchedTerm = term;
  }

  if (seedArtists.has(candidate.artist.toLowerCase())) {
    score += 5;
    return {
      track: candidate,
      score,
      reason: { kind: "artist", label: `More from ${candidate.artist}` },
    };
  }

  if (matchedTerm) {
    return {
      track: candidate,
      score,
      reason: { kind: "genre", label: `Because you listen to ${matchedTerm}` },
    };
  }

  if (candidate.releaseDate) {
    const released = Date.parse(candidate.releaseDate);
    if (Number.isFinite(released)) {
      const ageDays = (Date.now() - released) / 86_400_000;
      if (ageDays >= 0 && ageDays < 45) {
        score += 2;
        return { track: candidate, score, reason: { kind: "fresh", label: "New this month" } };
      }
    }
  }

  score += 1;
  return { track: candidate, score, reason: { kind: "trending", label: "Trending now" } };
}

/**
 * Builds a recommendation list from the trending pool, ranked by how closely a
 * candidate matches the listener's own genres and artists. No paid API and no
 * cross-user data: the ranking runs entirely on already-fetched tracks.
 */
export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { pool, seeds = [], exclude = [], limit = 12 } = input;

  if (!pool.length) return [];

  const excludedIds = new Set<string>([
    ...exclude.map((track) => track.id),
  ]);

  const seedTerms = new Map<string, number>();
  const seedArtists = new Set<string>();
  seeds.forEach((seed) => {
    terms(seed).forEach((term) => seedTerms.set(term, (seedTerms.get(term) ?? 0) + 1));
    seedArtists.add(seed.artist.toLowerCase());
  });

  const scored = pool
    .filter((track) => !excludedIds.has(track.id))
    .map((track) => scoreCandidate(track, seedTerms, seedArtists))
    .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title));

  const seen = new Set<string>();
  const picked: Recommendation[] = [];
  for (const entry of scored) {
    if (seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    picked.push(entry);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** Top genres in a set of tracks, used for the library "your genres" row. */
export function topGenres(tracks: Track[], limit = 6): string[] {
  const counts = new Map<string, number>();
  tracks.forEach((track) => {
    const genre = track.genre.trim();
    if (!genre) return;
    counts.set(genre, (counts.get(genre) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([genre]) => genre);
}
