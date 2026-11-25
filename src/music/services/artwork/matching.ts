import type { ArtworkMatchType, ArtworkMetadata, ArtworkSource } from "../../types/music";
import type { NormalizedArtworkQuery, RawCandidateInfo } from "./types";

const UNUSABLE_ARTISTS = new Set([
  "",
  "unknown",
  "unknown artist",
  "local library",
  "local",
  "artist",
]);

const UNUSABLE_ALBUMS = new Set([
  "",
  "single",
  "imported",
  "unknown",
  "unknown album",
  "album",
  "track",
]);

const TRIBUTE_OR_FAKE_KEYWORDS = [
  "tribute to",
  "made famous by",
  "in the style of",
  "karaoke",
  "8 bit",
  "8-bit",
  "lullaby",
  "lullabies",
  "cover version",
  "piano tribute",
  "string quartet tribute",
  "instrumental cover",
  "ringtone",
];

const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "in", "on", "at", "to", "for"]);

export function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeArtworkText(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips noisy release tags like (feat. X), [Official Video], - Remastered 2021, leading track numbers. */
export function cleanTrackTitleForArtwork(title: string): string {
  return title
    .replace(/^\s*\d{1,2}\s*[.\-)\]]+\s+(?=[A-Za-z])/, "")
    .replace(
      /\s*[\[(](?:feat\.?|ft\.?|featuring|with\s+[^)\]]+|official\s*(?:audio|video|music\s*video|lyric\s*video)|(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|radio\s*edit|single\s*version|album\s*version|explicit|clean|audio|hd|4k|mono|stereo)[^\])]*[\])]/gi,
      "",
    )
    .replace(/\s+-\s+(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|radio\s*edit|single\s*version|album\s*version|live(?:\s+at\s+.*)?).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strips edition/remaster tags from album names for comparison while keeping core title intact. */
export function cleanAlbumTitleForArtwork(album: string): string {
  return album
    .replace(
      /\s*[\[(](?:deluxe(?:\s+edition)?|expanded(?:\s+edition)?|special(?:\s+edition)?|collector'?s?(?:\s+edition)?|anniversary(?:\s+edition)?|(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|bonus\s+track(?:s)?(?:\s+version)?|explicit|clean)[^\])]*[\])]/gi,
      "",
    )
    .replace(/\s+-\s+(?:ep|single|deluxe(?:\s+edition)?|(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function extractPrimaryArtist(artist: string): string {
  return artist
    .split(/\s+(?:feat\.?|ft\.?|featuring|x|vs\.?|with)\s+|[,;&/]/i)[0]
    .trim();
}

export function isUsableArtistName(artist: string): boolean {
  const norm = normalizeArtworkText(artist);
  return Boolean(norm && !UNUSABLE_ARTISTS.has(norm));
}

export function isUsableAlbumName(album: string): boolean {
  const norm = normalizeArtworkText(album);
  return Boolean(norm && !UNUSABLE_ALBUMS.has(norm));
}

function tokenize(norm: string, dropStopWords = false): string[] {
  if (!norm) return [];
  const tokens = norm.split(" ").filter(Boolean);
  if (!dropStopWords) return tokens;
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : tokens;
}

export function tokenOverlapRatio(a: string, b: string, dropStopWords = true): number {
  const tokensA = tokenize(a, dropStopWords);
  const tokensB = tokenize(b, dropStopWords);
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? shared / union : 0;
}

function stripLeadingThe(norm: string): string {
  return norm.replace(/^the\s+/, "").trim();
}

export function parseTrackMetadataForArtwork(input: {
  title: string;
  artist: string;
  album: string;
}): NormalizedArtworkQuery {
  let rawTitle = (input.title ?? "").trim();
  let rawArtist = (input.artist ?? "").trim();
  const rawAlbum = (input.album ?? "").trim();

  // If local filename left "Artist - Title" in title while artist is placeholder
  if (!isUsableArtistName(rawArtist)) {
    const dash = rawTitle.indexOf(" - ");
    if (dash > 1 && dash < rawTitle.length - 3) {
      rawArtist = rawTitle.slice(0, dash).trim();
      rawTitle = rawTitle.slice(dash + 3).trim();
    }
  }

  const cleanedTitle = cleanTrackTitleForArtwork(rawTitle) || rawTitle;
  const cleanedAlbum = cleanAlbumTitleForArtwork(rawAlbum) || rawAlbum;
  const primaryArtist = extractPrimaryArtist(rawArtist) || rawArtist;

  const normalizedTitle = normalizeArtworkText(cleanedTitle);
  const normalizedArtist = normalizeArtworkText(primaryArtist);
  const normalizedAlbum = normalizeArtworkText(cleanedAlbum);

  const hasUsableArtist = isUsableArtistName(primaryArtist);
  const hasUsableAlbum = isUsableAlbumName(cleanedAlbum);
  const hasUsableTitle = Boolean(normalizedTitle && normalizedTitle !== "imported track");

  const isCompilationHint =
    normalizeArtworkText(rawArtist) === "various artists" ||
    /\b(?:soundtrack|ost|compilation|greatest hits|anthology)\b/i.test(rawAlbum);

  const albumLookupKey =
    hasUsableArtist && hasUsableAlbum
      ? `album:${normalizedArtist}::${normalizedAlbum}`
      : null;

  const lookupKey = albumLookupKey
    ? `${albumLookupKey}${normalizedTitle ? `::${normalizedTitle}` : ""}`
    : `track:${hasUsableArtist ? normalizedArtist : "_"}::${normalizedTitle || "_"}`;

  return {
    rawTitle,
    rawArtist,
    rawAlbum,
    title: cleanedTitle,
    artist: primaryArtist,
    album: cleanedAlbum,
    normalizedTitle,
    normalizedArtist,
    normalizedAlbum,
    hasUsableArtist,
    hasUsableAlbum,
    hasUsableTitle,
    isCompilationHint,
    lookupKey,
    albumLookupKey,
  };
}

function containsTributeMarker(value: string): boolean {
  const norm = normalizeArtworkText(value);
  return TRIBUTE_OR_FAKE_KEYWORDS.some((kw) => norm.includes(kw));
}

export type ScoreResult = {
  score: number;
  accepted: boolean;
  matchType: ArtworkMatchType;
  reason: string;
};

/**
 * Strictly scores a MusicBrainz / iTunes / Deezer candidate against the track's
 * metadata. Rejects covers from similarly named artists or unrelated albums.
 */
export function scoreArtworkCandidate(
  query: NormalizedArtworkQuery,
  candidate: RawCandidateInfo,
): ScoreResult {
  const candArtistRaw = candidate.releaseArtist ?? "";
  const candArtistNorm = normalizeArtworkText(extractPrimaryArtist(candArtistRaw) || candArtistRaw);
  const candArtistFullNorm = normalizeArtworkText(candArtistRaw);
  const candAlbumNorm = normalizeArtworkText(cleanAlbumTitleForArtwork(candidate.releaseTitle ?? ""));
  const candAlbumRawNorm = normalizeArtworkText(candidate.releaseTitle ?? "");
  const candTrackNorm = normalizeArtworkText(cleanTrackTitleForArtwork(candidate.trackTitle ?? ""));

  // Reject tribute/karaoke/cover versions unless the query explicitly asked for one
  const queryAskedForTribute =
    containsTributeMarker(query.rawTitle) ||
    containsTributeMarker(query.rawAlbum) ||
    containsTributeMarker(query.rawArtist);
  const candIsTribute =
    containsTributeMarker(candidate.releaseTitle) ||
    containsTributeMarker(candidate.releaseArtist) ||
    containsTributeMarker(candidate.trackTitle ?? "");
  if (candIsTribute && !queryAskedForTribute) {
    return { score: -100, accepted: false, matchType: "track", reason: "Rejected tribute/karaoke release" };
  }

  let score = 0;
  let artistMatched = false;
  let isVariousArtistsCompilation = false;

  if (query.hasUsableArtist) {
    const qArtist = query.normalizedArtist;
    const qArtistNoThe = stripLeadingThe(qArtist);
    const cArtistNoThe = stripLeadingThe(candArtistNorm);

    if (candArtistNorm === qArtist || candArtistFullNorm === normalizeArtworkText(query.rawArtist)) {
      score += 55;
      artistMatched = true;
    } else if (cArtistNoThe && qArtistNoThe && cArtistNoThe === qArtistNoThe) {
      score += 50;
      artistMatched = true;
    } else {
      const overlap = Math.max(
        tokenOverlapRatio(qArtist, candArtistNorm, false),
        tokenOverlapRatio(qArtist, candArtistFullNorm, false),
      );
      if (overlap >= 0.75) {
        score += 34;
        artistMatched = true;
      } else if (
        (candArtistNorm === "various artists" || candidate.releaseType === "compilation") &&
        (query.isCompilationHint || query.hasUsableAlbum)
      ) {
        // Compilation albums can carry "Various Artists" on the release while matching album + track.
        isVariousArtistsCompilation = true;
        score += 12;
      } else {
        return {
          score: -100,
          accepted: false,
          matchType: "track",
          reason: `Artist mismatch (${candidate.releaseArtist} != ${query.artist})`,
        };
      }
    }
  } else {
    // Without an artist, require strong album or exact title match (avoid false positives)
    score += 5;
  }

  let albumMatched = false;
  let matchType: ArtworkMatchType = "track";

  if (query.hasUsableAlbum) {
    const qAlb = query.normalizedAlbum;
    if (candAlbumRawNorm && candAlbumRawNorm === normalizeArtworkText(query.rawAlbum)) {
      score += 45;
      albumMatched = true;
      matchType = isVariousArtistsCompilation || candidate.releaseType === "compilation" ? "compilation" : "album";
    } else if (candAlbumNorm && candAlbumNorm === qAlb) {
      score += 40;
      albumMatched = true;
      matchType = isVariousArtistsCompilation || candidate.releaseType === "compilation" ? "compilation" : "album";
    } else {
      const albumOverlap = tokenOverlapRatio(qAlb, candAlbumNorm, true);
      if (albumOverlap >= 0.72) {
        score += 26;
        albumMatched = true;
        matchType = isVariousArtistsCompilation || candidate.releaseType === "compilation" ? "compilation" : "album";
      } else if (candAlbumNorm && qAlb && (candAlbumNorm.includes(qAlb) || qAlb.includes(candAlbumNorm)) && Math.min(qAlb.length, candAlbumNorm.length) >= 5) {
        score += 18;
        albumMatched = true;
        matchType = "album";
      } else if (isVariousArtistsCompilation) {
        return {
          score: -80,
          accepted: false,
          matchType: "compilation",
          reason: "Various Artists compilation without album match",
        };
      } else {
        // Album didn't match; penalize unless single/track title is a direct match
        score -= 22;
      }
    }
  }

  let trackMatched = false;
  if (query.hasUsableTitle && candTrackNorm) {
    const qTitle = query.normalizedTitle;
    if (candTrackNorm === qTitle) {
      score += 38;
      trackMatched = true;
      if (!albumMatched) matchType = candidate.releaseType === "single" ? "single" : "track";
    } else {
      const titleOverlap = tokenOverlapRatio(qTitle, candTrackNorm, false);
      if (titleOverlap >= 0.78) {
        score += 26;
        trackMatched = true;
        if (!albumMatched) matchType = candidate.releaseType === "single" ? "single" : "track";
      } else if (candTrackNorm.includes(qTitle) && qTitle.length >= 5) {
        score += 14;
        trackMatched = true;
      } else {
        score -= 18;
      }
    }
  } else if (!query.hasUsableAlbum && query.hasUsableTitle && candAlbumNorm) {
    // Singles often share the track title as their release title
    const singleOverlap = tokenOverlapRatio(query.normalizedTitle, candAlbumNorm, false);
    if (candAlbumNorm === query.normalizedTitle) {
      score += 36;
      trackMatched = true;
      matchType = "single";
    } else if (singleOverlap >= 0.78) {
      score += 24;
      trackMatched = true;
      matchType = "single";
    }
  }

  // Require either album match or track match in addition to artist check
  if (query.hasUsableAlbum && !albumMatched && !trackMatched) {
    return { score, accepted: false, matchType, reason: "Neither album nor track matched" };
  }
  if (!query.hasUsableAlbum && !trackMatched) {
    return { score, accepted: false, matchType, reason: "Track title did not match single/recording" };
  }
  if (!query.hasUsableArtist && !(albumMatched && trackMatched)) {
    return { score, accepted: false, matchType, reason: "Missing artist requires both album and track match" };
  }

  if (candidate.isOfficial) score += 8;
  if (candidate.hasFrontCover) score += 5;
  if (candidate.releaseType === "album" && query.hasUsableAlbum) score += 5;
  if (candidate.releaseType === "single" && !query.hasUsableAlbum) score += 6;
  if (candidate.releaseType === "compilation" && !query.isCompilationHint && !isVariousArtistsCompilation) {
    // Slightly prefer studio album/single over compilation when both exist
    score -= 4;
  }

  const minThreshold = query.hasUsableAlbum ? 62 : 60;
  const accepted = (artistMatched || isVariousArtistsCompilation || !query.hasUsableArtist) && score >= minThreshold;

  return {
    score,
    accepted,
    matchType,
    reason: accepted ? "Verified match" : `Score ${score} below threshold ${minThreshold}`,
  };
}

const SOURCE_PRIORITY: Record<ArtworkSource, number> = {
  user: 1000,
  embedded: 900,
  coverartarchive: 700,
  itunes: 650,
  deezer: 620,
  audius: 500,
  jamendo: 500,
  none: 0,
};

/**
 * Determines whether incoming verified artwork should replace the track's current
 * artwork. User-chosen and embedded file covers are never automatically overwritten.
 */
export function shouldUpgradeArtwork(
  current: ArtworkMetadata | undefined,
  incoming: ArtworkMetadata,
  currentUrlBroken = false,
): boolean {
  if (incoming.source === "none") return false;
  if (!current || current.source === "none") return true;
  if (current.source === "user") return incoming.source === "user";
  if (current.source === "embedded") return incoming.source === "user" || incoming.source === "embedded";
  if (currentUrlBroken) return true;

  const currentRank = SOURCE_PRIORITY[current.source] + (current.confidence || 0);
  const incomingRank = SOURCE_PRIORITY[incoming.source] + (incoming.confidence || 0);
  return incomingRank > currentRank + 5;
}
