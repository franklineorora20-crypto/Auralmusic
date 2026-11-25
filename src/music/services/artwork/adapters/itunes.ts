import { scoreArtworkCandidate } from "../matching";
import { fetchArtworkJson, forceHttps, RateLimiter } from "../rateLimiter";
import type { ArtworkAdapter, ArtworkCandidate, NormalizedArtworkQuery } from "../types";

const ITUNES_SEARCH_API = "https://itunes.apple.com/search";

/** Apple iTunes Search API allows ~20 calls/minute. */
const itunesLimiter = new RateLimiter(1200);

type ItunesResult = {
  wrapperType?: string;
  collectionType?: string;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
};

type ItunesSearchResponse = {
  resultCount?: number;
  results?: ItunesResult[];
};

function upgradeItunesArtwork(url: string, size: number): string {
  const safe = forceHttps(url);
  if (!safe) return "";
  return safe.replace(/\/\d+x\d+bb(\.[a-z]+)$/i, `/${size}x${size}bb$1`);
}

function detectReleaseType(item: ItunesResult): "album" | "single" | "ep" | "compilation" | "other" {
  const name = (item.collectionName ?? "").toLowerCase();
  const type = (item.collectionType ?? "").toLowerCase();
  if (type === "compilation" || name.includes("soundtrack")) return "compilation";
  if (name.endsWith("- single") || name.includes(" - single")) return "single";
  if (name.endsWith("- ep") || name.includes(" - ep")) return "ep";
  if (type === "album" || item.wrapperType === "collection") return "album";
  return "other";
}

function mapItunesResults(
  results: ItunesResult[],
  query: NormalizedArtworkQuery,
): ArtworkCandidate[] {
  const candidates: ArtworkCandidate[] = [];
  for (const item of results) {
    if (!item.artworkUrl100 || !item.artistName) continue;
    const releaseTitle = item.collectionName || item.trackName || "";
    if (!releaseTitle) continue;

    const releaseType = detectReleaseType(item);
    const scored = scoreArtworkCandidate(query, {
      releaseTitle,
      releaseArtist: item.artistName,
      ...(item.trackName ? { trackTitle: item.trackName } : {}),
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
    });
    if (!scored.accepted) continue;

    const url = upgradeItunesArtwork(item.artworkUrl100, 600);
    const smallUrl = upgradeItunesArtwork(item.artworkUrl100, 250) || forceHttps(item.artworkUrl100);
    if (!url) continue;

    candidates.push({
      source: "itunes",
      attribution: "Apple iTunes Search",
      url,
      smallUrl: smallUrl || url,
      releaseTitle,
      releaseArtist: item.artistName,
      ...(item.trackName ? { trackTitle: item.trackName } : {}),
      releaseType,
      isOfficial: true,
      hasFrontCover: true,
      score: scored.score,
      matchType: scored.matchType,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export const itunesArtworkAdapter: ArtworkAdapter = {
  id: "itunes",
  name: "iTunes Search API",
  attribution: "Apple iTunes Search",

  isAvailable() {
    return !itunesLimiter.isCoolingDown();
  },

  async findArtwork(query: NormalizedArtworkQuery, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    const candidates: ArtworkCandidate[] = [];

    if (query.hasUsableArtist && query.hasUsableAlbum) {
      const term = `${query.artist} ${query.album}`.trim();
      const url = `${ITUNES_SEARCH_API}?term=${encodeURIComponent(term)}&media=music&entity=album&limit=8`;
      const data = await fetchArtworkJson<ItunesSearchResponse>({
        source: "itunes",
        url,
        limiter: itunesLimiter,
        signal,
      });
      candidates.push(...mapItunesResults(data?.results ?? [], query));
    }

    if (candidates.length === 0 && query.hasUsableTitle) {
      const term = query.hasUsableArtist ? `${query.artist} ${query.title}`.trim() : query.title;
      const url = `${ITUNES_SEARCH_API}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8`;
      const data = await fetchArtworkJson<ItunesSearchResponse>({
        source: "itunes",
        url,
        limiter: itunesLimiter,
        signal,
      });
      candidates.push(...mapItunesResults(data?.results ?? [], query));
    }

    return candidates.sort((a, b) => b.score - a.score);
  },
};
