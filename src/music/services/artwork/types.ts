import type { ArtworkMatchType, ArtworkMetadata, ArtworkSource, ProviderId } from "../../types/music";

export type ArtworkQuery = {
  trackId?: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  providerId?: ProviderId;
  releaseDate?: string;
  forceRefresh?: boolean;
};

export type NormalizedArtworkQuery = {
  rawTitle: string;
  rawArtist: string;
  rawAlbum: string;
  title: string;
  artist: string;
  album: string;
  normalizedTitle: string;
  normalizedArtist: string;
  normalizedAlbum: string;
  hasUsableArtist: boolean;
  hasUsableAlbum: boolean;
  hasUsableTitle: boolean;
  isCompilationHint: boolean;
  lookupKey: string;
  albumLookupKey: string | null;
};

export type RawCandidateInfo = {
  releaseTitle: string;
  releaseArtist: string;
  trackTitle?: string;
  releaseType?: "album" | "single" | "ep" | "compilation" | "other";
  isOfficial?: boolean;
  hasFrontCover?: boolean;
};

export type ArtworkCandidate = RawCandidateInfo & {
  source: ArtworkSource;
  attribution: string;
  url: string;
  smallUrl?: string;
  mbid?: string;
  releaseGroupMbid?: string;
  score: number;
  matchType: ArtworkMatchType;
};

export type ArtworkResolution = {
  status: "resolved" | "missing" | "error";
  url: string;
  smallUrl: string;
  meta: ArtworkMetadata;
  width?: number;
  height?: number;
  fromCache?: boolean;
  error?: string;
};

export interface ArtworkAdapter {
  readonly id: ArtworkSource;
  readonly name: string;
  readonly attribution: string;
  isAvailable(): boolean;
  findArtwork(query: NormalizedArtworkQuery, signal?: AbortSignal): Promise<ArtworkCandidate[]>;
}
