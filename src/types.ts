export type {
  Artist,
  ArtworkMatchType,
  ArtworkMetadata,
  ArtworkSource,
  GenreCategory,
  Playlist,
  ProviderId,
  ProviderPlaylist,
  ProviderStatus,
  SearchKind,
  SearchQuery,
  SearchResults,
  Track,
  TrackLicensing,
} from "./music/types/music";

export { GENRE_CATEGORIES } from "./music/types/music";

export type View =
  | "home"
  | "search"
  | "discover"
  | "library"
  | "playlists"
  | "favourites"
  | "recent"
  | "downloads"
  | "artist"
  | "album"
  | "playlist"
  | "genre";

export type RepeatMode = "off" | "one" | "all";
