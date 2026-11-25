/**
 * Provider-independent music model.
 *
 * Every provider (Audius, Jamendo, local files, sample previews) is normalised
 * into these shapes so the rest of the application never talks to a
 * provider-specific response again.
 */

export type ProviderId = "audius" | "jamendo" | "local" | "sample";

export type TrackLicensing = {
  /** Human readable licence name, e.g. "Creative Commons BY-NC-SA 3.0". */
  name: string;
  /** Link to the licence text, when the provider exposes one. */
  url?: string;
  /** Attribution string the licence requires, when known. */
  attribution?: string;
  /** The provider serves this track as a stream. */
  streamingAllowed: boolean;
  /** The provider explicitly marks the track as downloadable. */
  downloadAllowed: boolean;
  /** A short note rendered beside the track in download contexts. */
  note?: string;
};

export type ArtworkSource =
  | "user"
  | "embedded"
  | "audius"
  | "jamendo"
  | "coverartarchive"
  | "itunes"
  | "deezer"
  | "none";

export type ArtworkMatchType =
  | "user"
  | "embedded"
  | "provider"
  | "album"
  | "single"
  | "compilation"
  | "track";

export type ArtworkMetadata = {
  source: ArtworkSource;
  attribution: string;
  confidence: number;
  matchType?: ArtworkMatchType;
  releaseTitle?: string;
  releaseArtist?: string;
  mbid?: string;
  sourceUrl?: string;
  verifiedAt?: number;
};

export type TrackEmbeddedLyrics = {
  syncedLyrics?: string;
  plainLyrics?: string;
};

export type Track = {
  /** Globally unique id: `${providerId}-${providerTrackId}`. */
  id: string;
  providerId: ProviderId;
  /** Display name of the provider. */
  providerName: string;
  /** The id the provider uses for this track. */
  providerTrackId: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  /** Artwork URL (or cached blob:/data: URL). Empty string when none exists. */
  artwork: string;
  artworkSmall: string;
  /** Provenance and verification confidence for the current artwork. */
  artworkMeta?: ArtworkMetadata;
  duration: number;
  /** Playback identifier handed to the audio engine. */
  streamUrl: string;
  /** Only present when the provider permits downloading. */
  downloadUrl?: string;
  genre: string;
  tags: string[];
  licensing: TrackLicensing;
  releaseDate?: string;
  permalink?: string;
  /** CSS colour used for artwork fallbacks and accents. */
  accent: string;
  /** Track was imported from the user's device. */
  imported?: boolean;
  /** Track has an offline copy in IndexedDB. */
  downloaded?: boolean;
  /** Lyrics parsed from embedded audio file tags (ID3v2 / FLAC). */
  lyrics?: TrackEmbeddedLyrics;
};

export type Artist = {
  id: string;
  providerId: ProviderId;
  providerName: string;
  providerArtistId: string;
  name: string;
  handle?: string;
  avatar: string;
  followerCount?: number;
  trackCount?: number;
  bio?: string;
  accent: string;
};

export type ProviderPlaylist = {
  id: string;
  providerId: ProviderId;
  providerName: string;
  providerPlaylistId: string;
  name: string;
  description: string;
  artwork: string;
  trackCount: number;
  ownerName?: string;
  accent: string;
  permalink?: string;
};

/** A playlist owned by the user, persisted with the rest of the library. */
export type Playlist = {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type SearchResults = {
  tracks: Track[];
  artists: Artist[];
  playlists: ProviderPlaylist[];
};

export type SearchKind = "all" | "tracks" | "artists" | "playlists";

export type ProviderStatus = {
  id: ProviderId;
  name: string;
  /** Whether the provider can be queried right now. */
  ready: boolean;
  /** Why the provider is unavailable, surfaced in the UI. */
  reason?: string;
  /** Requires a client id the operator must supply. */
  requiresKey: boolean;
  docsUrl: string;
};

export type SearchQuery = {
  term: string;
  kind?: SearchKind;
  genre?: string;
  /** Restrict the search to one provider. */
  providerId?: ProviderId;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export type GenreCategory = {
  id: string;
  label: string;
  color: string;
};

export const GENRE_CATEGORIES: GenreCategory[] = [
  { id: "Electronic", label: "Electronic", color: "#7a5cc4" },
  { id: "Hip-Hop/Rap", label: "Hip-Hop", color: "#b26a45" },
  { id: "Lo-Fi", label: "Lo-Fi", color: "#4f8578" },
  { id: "Ambient", label: "Ambient", color: "#3f7d9c" },
  { id: "Alternative", label: "Alternative", color: "#a44e72" },
  { id: "Pop", label: "Pop", color: "#bf6a8a" },
  { id: "R&B/Soul", label: "R&B / Soul", color: "#8a5340" },
  { id: "Rock", label: "Rock", color: "#8c6239" },
  { id: "Jazz", label: "Jazz", color: "#6d6350" },
  { id: "Classical", label: "Classical", color: "#5f6f8a" },
  { id: "House", label: "House", color: "#4a7a63" },
  { id: "Techno", label: "Techno", color: "#54606b" },
];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  audius: "Audius",
  jamendo: "Jamendo",
  local: "Local library",
  sample: "Sample preview",
};

export const PROVIDER_ACCENTS: Record<ProviderId, string> = {
  audius: "#5b7c65",
  jamendo: "#4d6480",
  local: "#c49e64",
  sample: "#8b6f4e",
};

export const PROVIDER_DOCS: Record<ProviderId, string> = {
  audius: "https://docs.audius.co/",
  jamendo: "https://developer.jamendo.com/",
  local: "",
  sample: "",
};
