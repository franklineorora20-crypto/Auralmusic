import { scoreArtworkCandidate } from "../matching";
import { fetchArtworkJson, forceHttps, RateLimiter } from "../rateLimiter";
import type { ArtworkAdapter, ArtworkCandidate, NormalizedArtworkQuery } from "../types";

const MB_API = "https://musicbrainz.org/ws/2";
const CAA_API = "https://coverartarchive.org";

/** MusicBrainz asks for max 1 request per second per client. */
const mbLimiter = new RateLimiter(1100);
const caaLimiter = new RateLimiter(450);

type MbArtistCredit = {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
};

type MbReleaseGroup = {
  id?: string;
  title?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
};

type MbRelease = {
  id?: string;
  title?: string;
  status?: string;
  "artist-credit"?: MbArtistCredit[];
  "release-group"?: MbReleaseGroup;
  "cover-art-archive"?: {
    artwork?: boolean;
    front?: boolean;
    count?: number;
  };
};

type MbReleaseSearchResponse = {
  releases?: MbRelease[];
};

type MbRecording = {
  id?: string;
  title?: string;
  "artist-credit"?: MbArtistCredit[];
  releases?: MbRelease[];
};

type MbRecordingSearchResponse = {
  recordings?: MbRecording[];
};

type CaaImage = {
  approved?: boolean;
  front?: boolean;
  back?: boolean;
  types?: string[];
  image?: string;
  thumbnails?: {
    "250"?: string;
    "500"?: string;
    "1200"?: string;
    small?: string;
    large?: string;
  };
};

type CaaResponse = {
  images?: CaaImage[];
};

function escapeLucenePhrase(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim();
}

function formatArtistCredit(credits?: MbArtistCredit[]): string {
  if (!Array.isArray(credits) || !credits.length) return "";
  return credits
    .map((c) => `${c.name || c.artist?.name || ""}${c.joinphrase || ""}`)
    .join("")
    .trim();
}

function resolveReleaseType(rg?: MbReleaseGroup): "album" | "single" | "ep" | "compilation" | "other" {
  const secondary = (rg?.["secondary-types"] ?? []).map((s) => s.toLowerCase());
  if (secondary.includes("compilation") || secondary.includes("soundtrack")) return "compilation";
  const primary = (rg?.["primary-type"] ?? "").toLowerCase();
  if (primary === "album") return "album";
  if (primary === "single") return "single";
  if (primary === "ep") return "ep";
  return "other";
}

function pickBestCaaImage(images: CaaImage[]): { url: string; smallUrl: string } | null {
  if (!images.length) return null;
  const frontApproved = images.find((img) => img.front === true && img.approved !== false);
  const frontType = images.find((img) => Array.isArray(img.types) && img.types.includes("Front") && img.approved !== false);
  const anyFront = images.find((img) => img.front === true || (Array.isArray(img.types) && img.types.includes("Front")));
  const chosen = frontApproved ?? frontType ?? anyFront ?? images[0];
  if (!chosen) return null;

  const url = forceHttps(
    chosen.thumbnails?.["500"] ||
      chosen.thumbnails?.large ||
      chosen.thumbnails?.["1200"] ||
      chosen.image,
  );
  const smallUrl = forceHttps(
    chosen.thumbnails?.["250"] ||
      chosen.thumbnails?.small ||
      chosen.thumbnails?.["500"] ||
      chosen.thumbnails?.large ||
      chosen.image,
  );
  if (!url) return null;
  return { url, smallUrl: smallUrl || url };
}

async function fetchCaaForRelease(
  releaseMbid: string,
  releaseGroupMbid: string | undefined,
  signal?: AbortSignal,
): Promise<{ url: string; smallUrl: string; usedMbid: string } | null> {
  const releaseJson = await fetchArtworkJson<CaaResponse>({
    source: "coverartarchive",
    url: `${CAA_API}/release/${encodeURIComponent(releaseMbid)}`,
    limiter: caaLimiter,
    signal,
    treat404AsNull: true,
  });
  if (releaseJson?.images?.length) {
    const picked = pickBestCaaImage(releaseJson.images);
    if (picked) return { ...picked, usedMbid: releaseMbid };
  }

  if (releaseGroupMbid) {
    const rgJson = await fetchArtworkJson<CaaResponse>({
      source: "coverartarchive",
      url: `${CAA_API}/release-group/${encodeURIComponent(releaseGroupMbid)}`,
      limiter: caaLimiter,
      signal,
      treat404AsNull: true,
    });
    if (rgJson?.images?.length) {
      const picked = pickBestCaaImage(rgJson.images);
      if (picked) return { ...picked, usedMbid: releaseGroupMbid };
    }
  }

  return null;
}

type RankedRelease = {
  mbid: string;
  releaseGroupMbid?: string;
  releaseTitle: string;
  releaseArtist: string;
  trackTitle?: string;
  releaseType: "album" | "single" | "ep" | "compilation" | "other";
  isOfficial: boolean;
  hasFrontHint: boolean;
  score: number;
  matchType: ArtworkCandidate["matchType"];
};

export const musicBrainzCaaAdapter: ArtworkAdapter = {
  id: "coverartarchive",
  name: "MusicBrainz & Cover Art Archive",
  attribution: "Cover Art Archive / MusicBrainz",

  isAvailable() {
    return !mbLimiter.isCoolingDown() && !caaLimiter.isCoolingDown();
  },

  async findArtwork(query: NormalizedArtworkQuery, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    if (!query.hasUsableTitle && !(query.hasUsableAlbum && query.hasUsableArtist)) {
      return [];
    }

    const ranked: RankedRelease[] = [];
    const seenReleaseIds = new Set<string>();

    const pushScoredRelease = (release: MbRelease, fallbackArtist: string, trackTitle?: string) => {
      if (!release.id || !release.title || seenReleaseIds.has(release.id)) return;
      const releaseArtist = formatArtistCredit(release["artist-credit"]) || fallbackArtist;
      const releaseType = resolveReleaseType(release["release-group"]);
      const isOfficial = (release.status ?? "").toLowerCase() === "official";
      const hasFrontHint = release["cover-art-archive"]?.front === true || release["cover-art-archive"]?.artwork === true;

      const scored = scoreArtworkCandidate(query, {
        releaseTitle: release.title,
        releaseArtist,
        ...(trackTitle ? { trackTitle } : {}),
        releaseType,
        isOfficial,
        hasFrontCover: hasFrontHint,
      });

      if (!scored.accepted) return;
      seenReleaseIds.add(release.id);
      ranked.push({
        mbid: release.id,
        releaseGroupMbid: release["release-group"]?.id,
        releaseTitle: release.title,
        releaseArtist,
        ...(trackTitle ? { trackTitle } : {}),
        releaseType,
        isOfficial,
        hasFrontHint,
        score: scored.score + (hasFrontHint ? 8 : 0),
        matchType: scored.matchType,
      });
    };

    // 1. Release search when both artist and album are usable
    if (query.hasUsableArtist && query.hasUsableAlbum) {
      const artistPhrase = escapeLucenePhrase(query.artist);
      const albumPhrase = escapeLucenePhrase(query.album);
      if (artistPhrase && albumPhrase) {
        const lucene = `artist:"${artistPhrase}" AND release:"${albumPhrase}"`;
        const data = await fetchArtworkJson<MbReleaseSearchResponse>({
          source: "musicbrainz",
          url: `${MB_API}/release/?query=${encodeURIComponent(lucene)}&limit=8&fmt=json`,
          limiter: mbLimiter,
          signal,
        });
        for (const release of data?.releases ?? []) {
          pushScoredRelease(release, query.artist);
        }
      }
    }

    // 2. Recording search for singles, tracks without album, or fallback if release search missed
    if (ranked.length === 0 && query.hasUsableTitle) {
      const titlePhrase = escapeLucenePhrase(query.title);
      const artistPhrase = query.hasUsableArtist ? escapeLucenePhrase(query.artist) : "";
      if (titlePhrase && (artistPhrase || query.hasUsableAlbum)) {
        const lucene = artistPhrase
          ? `artist:"${artistPhrase}" AND recording:"${titlePhrase}"`
          : `recording:"${titlePhrase}" AND release:"${escapeLucenePhrase(query.album)}"`;
        const data = await fetchArtworkJson<MbRecordingSearchResponse>({
          source: "musicbrainz",
          url: `${MB_API}/recording/?query=${encodeURIComponent(lucene)}&limit=8&fmt=json`,
          limiter: mbLimiter,
          signal,
        });
        for (const rec of data?.recordings ?? []) {
          const recArtist = formatArtistCredit(rec["artist-credit"]);
          const recTitle = rec.title || query.title;
          for (const release of rec.releases ?? []) {
            pushScoredRelease(release, recArtist, recTitle);
          }
        }
      }
    }

    if (!ranked.length) return [];

    // Sort highest score & front-art hint first, then probe up to 3 Cover Art Archive releases
    ranked.sort((a, b) => b.score - a.score);
    const checkedRgIds = new Set<string>();
    const candidates: ArtworkCandidate[] = [];

    for (const item of ranked.slice(0, 4)) {
      if (signal?.aborted) break;
      const rgToCheck =
        item.releaseGroupMbid && !checkedRgIds.has(item.releaseGroupMbid)
          ? item.releaseGroupMbid
          : undefined;
      if (rgToCheck) checkedRgIds.add(rgToCheck);

      const art = await fetchCaaForRelease(item.mbid, rgToCheck, signal);
      if (!art) continue;

      candidates.push({
        source: "coverartarchive",
        attribution: "Cover Art Archive / MusicBrainz",
        url: art.url,
        smallUrl: art.smallUrl,
        releaseTitle: item.releaseTitle,
        releaseArtist: item.releaseArtist,
        ...(item.trackTitle ? { trackTitle: item.trackTitle } : {}),
        releaseType: item.releaseType,
        isOfficial: item.isOfficial,
        hasFrontCover: true,
        mbid: art.usedMbid,
        ...(item.releaseGroupMbid ? { releaseGroupMbid: item.releaseGroupMbid } : {}),
        score: item.score,
        matchType: item.matchType,
      });

      // Stop early once we have a high-confidence verified release cover
      if (item.score >= 85) break;
    }

    return candidates;
  },
};
