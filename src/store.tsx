import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  formatBytes,
  getOfflineUsage,
  listOfflineMetadata,
  listOfflineTracks,
  removeOfflineTrack,
  saveOfflineTrack,
} from "./offline";
import { fetchTrackAudio } from "./music/services/downloadService";
import { sampleTracks } from "./music/providers/sample";
import { setLocalTracks } from "./music/providers";
import { extractEmbeddedLyricsFromAudioBytes } from "./music/lib/lyrics";
import { GENRE_CATEGORIES } from "./music/types/music";
import type { Playlist, ProviderId, RepeatMode, Track } from "./types";
import { PROVIDER_ACCENTS, PROVIDER_NAMES } from "./music/types/music";

export type LibraryFolder = {
  id: string;
  name: string;
  parentId: string | null;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type OfflineFileMeta = {
  bytes: number;
  savedAt: number;
};

const STORAGE_KEYS = {
  catalogue: "aural-catalogue",
  playlists: "aural-playlists",
  folders: "aural-fs-folders",
  favourites: "aural-favourites",
  recent: "aural-recent",
  likedPlaylists: "aural-liked-playlists",
  savedAlbums: "aural-saved-albums",
  followedArtists: "aural-followed-artists",
} as const;

/** How many catalogue tracks stay cached locally (metadata only). */
const CATALOGUE_LIMIT = 600;
const RECENT_LIMIT = 30;

function getSaved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage API must not break the app.
  }
}

type StoredTrack = Partial<Track> & { src?: string; provider?: string; id: string };

/**
 * Tracks cached by an earlier version of the app used `src` and a provider
 * label instead of the normalised model. Upgrading them in place keeps a
 * listener's favourites, playlists and recent plays working.
 */
function migrateTrack(stored: StoredTrack): Track | null {
  if (!stored || typeof stored.id !== "string" || typeof stored.title !== "string") return null;
  const legacyProvider = stored.provider === "Audius" ? "audius" : stored.provider === "Jamendo" ? "jamendo" : stored.provider === "Local" ? "local" : "sample";
  const providerId: ProviderId = stored.providerId ?? legacyProvider;
  const providerTrackId = stored.providerTrackId ?? stored.id.replace(/^(audius|jamendo|sample|local)-/, "");
  const streamUrl = stored.streamUrl ?? stored.src ?? "";
  const id = stored.id.startsWith(`${providerId}-`) || providerId === "local" ? stored.id : `${providerId}-${stored.id}`;
  return {
    id,
    providerId,
    providerName: stored.providerName ?? PROVIDER_NAMES[providerId],
    providerTrackId,
    title: stored.title,
    artist: stored.artist ?? "Unknown artist",
    ...(stored.artistId ? { artistId: stored.artistId } : {}),
    album: stored.album ?? "Single",
    ...(stored.albumId ? { albumId: stored.albumId } : {}),
    artwork: stored.artwork ?? "",
    artworkSmall: stored.artworkSmall ?? stored.artwork ?? "",
    duration: typeof stored.duration === "number" ? stored.duration : 0,
    streamUrl,
    ...(stored.downloadUrl ? { downloadUrl: stored.downloadUrl } : {}),
    genre: stored.genre ?? "Other",
    tags: Array.isArray(stored.tags) ? stored.tags : [],
    licensing: stored.licensing ?? {
      name: providerId === "audius" ? "Audius track licence" : providerId === "jamendo" ? "Creative Commons" : "Local file",
      streamingAllowed: true,
      downloadAllowed: Boolean(stored.downloadUrl),
    },
    ...(stored.releaseDate ? { releaseDate: stored.releaseDate } : {}),
    ...(stored.permalink ? { permalink: stored.permalink } : {}),
    accent: stored.accent ?? PROVIDER_ACCENTS[providerId],
    ...(stored.imported ? { imported: true } : {}),
    ...(stored.lyrics ? { lyrics: stored.lyrics } : {}),
  };
}

type Store = {
  /** Every track the app can currently resolve by id. */
  tracks: Track[];
  catalogueTracks: Track[];
  downloads: Track[];
  downloadProgress: Record<string, number>;
  downloadingIds: string[];
  storageUsage: number;
  storageUsageLabel: string;
  storageError: string;
  offlineMeta: Record<string, OfflineFileMeta>;
  clearStorageError: () => void;
  playlists: Playlist[];
  folders: LibraryFolder[];
  favouriteIds: string[];
  recentIds: string[];
  likedPlaylistIds: string[];
  savedAlbumIds: string[];
  followedArtistIds: string[];
  getTrack: (id: string) => Track | undefined;
  rememberTracks: (tracks: Track[]) => void;
  isFavourite: (id: string) => boolean;
  toggleFavourite: (id: string) => void;
  createPlaylist: (name: string, trackIds?: string[]) => Playlist;
  renamePlaylist: (id: string, name: string) => void;
  describePlaylist: (id: string, description: string) => void;
  deletePlaylist: (id: string) => void;
  createFolder: (name: string, parentId?: string | null) => LibraryFolder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  addTrackToFolder: (folderId: string, trackId: string) => void;
  removeTrackFromFolder: (folderId: string, trackId: string) => void;
  moveTrackToFolder: (fromFolderId: string | null, toFolderId: string, trackId: string) => void;
  togglePlaylistLike: (id: string) => void;
  toggleSavedAlbum: (id: string) => void;
  toggleFollowedArtist: (id: string) => void;
  addToPlaylist: (playlistId: string, trackId: string) => void;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  shiftPlaylistTrack: (playlistId: string, trackId: string, direction: -1 | 1) => void;
  reorderPlaylistTrack: (playlistId: string, trackId: string, direction: -1 | 1) => void;
  movePlaylistTrack: (playlistId: string, fromIndex: number, toIndex: number) => void;
  addRecent: (id: string) => void;
  downloadTrack: (id: string) => Promise<boolean>;
  cancelDownload: (id: string) => void;
  removeDownload: (id: string) => Promise<void>;
  importAudio: (files: File[], targetFolderId?: string | null) => Promise<{ imported: number; skipped: number }>;
  removeLocalTrack: (id: string) => Promise<void>;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  queueIds: string[];
  setVolume: (value: number) => void;
  setShuffle: (value: boolean) => void;
  setRepeat: (value: RepeatMode) => void;
  setQueue: (ids: string[]) => void;
  addCatalogueTracks: (tracks: Track[]) => void;
};

const StoreContext = createContext<Store | null>(null);

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".webm"];

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** "Artist - Title" filenames are split; anything else becomes the title. */
function parseFileName(name: string): { title: string; artist: string } {
  const withoutExtension = name.replace(/\.[^./\\]+$/, "").replace(/[_]+/g, " ").trim();
  const separator = withoutExtension.indexOf(" - ");
  if (separator > 0) {
    return {
      artist: withoutExtension.slice(0, separator).trim() || "Local library",
      title: withoutExtension.slice(separator + 3).trim() || withoutExtension,
    };
  }
  return { title: withoutExtension || "Imported track", artist: "Local library" };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [catalogueTracks, setCatalogueTracks] = useState<Track[]>(() => {
    const stored = getSaved<StoredTrack[]>(STORAGE_KEYS.catalogue, []);
    return stored.map(migrateTrack).filter((track): track is Track => track !== null);
  });
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [offlineMeta, setOfflineMeta] = useState<Record<string, OfflineFileMeta>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [storageUsage, setStorageUsage] = useState(0);
  const [storageError, setStorageError] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    const stored = getSaved<Playlist[]>(STORAGE_KEYS.playlists, []);
    return stored
      .filter((playlist) => playlist && typeof playlist.id === "string" && Array.isArray(playlist.trackIds))
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name || "Untitled playlist",
        description: playlist.description || "Your playlist",
        trackIds: playlist.trackIds.filter((id): id is string => typeof id === "string"),
        createdAt: playlist.createdAt ?? Date.now(),
        updatedAt: playlist.updatedAt ?? Date.now(),
      }));
  });
  const [folders, setFolders] = useState<LibraryFolder[]>(() => {
    const stored = getSaved<LibraryFolder[]>(STORAGE_KEYS.folders, []);
    return stored
      .filter((folder) => folder && typeof folder.id === "string" && Array.isArray(folder.trackIds))
      .map((folder) => ({
        id: folder.id,
        name: folder.name || "Untitled folder",
        parentId: typeof folder.parentId === "string" ? folder.parentId : null,
        trackIds: folder.trackIds.filter((id): id is string => typeof id === "string"),
        createdAt: folder.createdAt ?? Date.now(),
        updatedAt: folder.updatedAt ?? Date.now(),
      }));
  });
  const [favouriteIds, setFavouriteIds] = useState<string[]>(() => getSaved<string[]>(STORAGE_KEYS.favourites, []));
  const [recentIds, setRecentIds] = useState<string[]>(() => getSaved<string[]>(STORAGE_KEYS.recent, []));
  const [likedPlaylistIds, setLikedPlaylistIds] = useState<string[]>(() => getSaved<string[]>(STORAGE_KEYS.likedPlaylists, []));
  const [savedAlbumIds, setSavedAlbumIds] = useState<string[]>(() => getSaved<string[]>(STORAGE_KEYS.savedAlbums, []));
  const [followedArtistIds, setFollowedArtistIds] = useState<string[]>(() => getSaved<string[]>(STORAGE_KEYS.followedArtists, []));
  const controllers = useRef(new Map<string, AbortController>());
  const offlineUrlsRef = useRef(new Map<string, string>());

  const offlineById = useMemo(() => new Map(offlineTracks.map((track) => [track.id, track])), [offlineTracks]);

  const tracks = useMemo(() => {
    const merged = new Map<string, Track>();
    sampleTracks.forEach((track) => merged.set(track.id, track));
    catalogueTracks.forEach((track) => merged.set(track.id, offlineById.get(track.id) ?? track));
    offlineTracks.forEach((track) => merged.set(track.id, track));
    return [...merged.values()];
  }, [catalogueTracks, offlineById, offlineTracks]);

  const trackIndex = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const getTrack = useCallback((id: string) => trackIndex.get(id), [trackIndex]);

  /** Imported (local) tracks are mirrored into the local provider registry. */
  useEffect(() => {
    setLocalTracks(offlineTracks.filter((track) => track.imported));
  }, [offlineTracks]);

  useEffect(() => save(STORAGE_KEYS.catalogue, catalogueTracks.slice(-CATALOGUE_LIMIT)), [catalogueTracks]);
  useEffect(() => save(STORAGE_KEYS.playlists, playlists), [playlists]);
  useEffect(() => save(STORAGE_KEYS.folders, folders), [folders]);
  useEffect(() => save(STORAGE_KEYS.favourites, favouriteIds), [favouriteIds]);
  useEffect(() => save(STORAGE_KEYS.recent, recentIds), [recentIds]);
  useEffect(() => save(STORAGE_KEYS.likedPlaylists, likedPlaylistIds), [likedPlaylistIds]);
  useEffect(() => save(STORAGE_KEYS.savedAlbums, savedAlbumIds), [savedAlbumIds]);
  useEffect(() => save(STORAGE_KEYS.followedArtists, followedArtistIds), [followedArtistIds]);

  useEffect(() => {
    const activeControllers = controllers.current;
    return () => {
      activeControllers.forEach((controller) => controller.abort());
      activeControllers.clear();
    };
  }, []);

  const [volume, setVolumeState] = useState(() => getSaved("aural-volume", 0.72));
  const [shuffle, setShuffleState] = useState(() => getSaved("aural-shuffle", false));
  const [repeat, setRepeatState] = useState<RepeatMode>(() => getSaved("aural-repeat", "off"));
  const [queueIds, setQueueIds] = useState<string[]>(() => getSaved<string[]>("aural-queue", []));

  useEffect(() => save("aural-volume", volume), [volume]);
  useEffect(() => save("aural-shuffle", shuffle), [shuffle]);
  useEffect(() => save("aural-repeat", repeat), [repeat]);
  useEffect(() => save("aural-queue", queueIds), [queueIds]);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.72)));
  }, []);

  const setShuffle = useCallback((value: boolean) => setShuffleState(Boolean(value)), []);
  const setRepeat = useCallback((value: RepeatMode) => setRepeatState(value), []);
  const setQueue = useCallback((ids: string[]) => setQueueIds(Array.isArray(ids) ? ids : []), []);

  const [downloads, setDownloads] = useState<Track[]>([]);
  const refreshDownloads = useCallback(async () => {
    try {
      const [rawTracks, usage, metadata] = await Promise.all([
        listOfflineTracks(),
        getOfflineUsage(),
        listOfflineMetadata(),
      ]);
      const activeIds = new Set(rawTracks.map((track) => track.id));
      for (const [id, url] of offlineUrlsRef.current.entries()) {
        if (!activeIds.has(id)) {
          URL.revokeObjectURL(url);
          offlineUrlsRef.current.delete(id);
        }
      }
      const resolved = rawTracks.map((track) => {
        const existingUrl = offlineUrlsRef.current.get(track.id);
        if (existingUrl && track.streamUrl.startsWith("blob:")) {
          URL.revokeObjectURL(track.streamUrl);
          return { ...track, streamUrl: existingUrl };
        }
        if (track.streamUrl.startsWith("blob:")) {
          offlineUrlsRef.current.set(track.id, track.streamUrl);
        }
        return track;
      });
      const metaMap: Record<string, OfflineFileMeta> = {};
      for (const entry of metadata) {
        metaMap[entry.id] = { bytes: entry.bytes, savedAt: entry.savedAt };
      }
      setOfflineMeta(metaMap);
      setOfflineTracks(resolved);
      setDownloads(resolved);
      setStorageUsage(usage);
    } catch (error: unknown) {
      setStorageError(messageFrom(error, "Offline storage is unavailable."));
    }
  }, []);
  useEffect(() => {
    void refreshDownloads();
  }, [refreshDownloads]);

  const downloadsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    downloadsRef.current = new Set(downloads.map((track) => track.id));
  }, [downloads]);

  const addCatalogueTracks = useCallback((incoming: Track[]) => {
    if (!incoming.length) return;
    setCatalogueTracks((previous) => {
      const seen = new Set(previous.map((track) => track.id));
      const next = [...previous];
      for (const track of incoming) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        next.push(track);
      }
      return next.slice(-CATALOGUE_LIMIT);
    });
  }, []);

  const rememberTracks = useCallback((incoming: Track[]) => addCatalogueTracks(incoming), [addCatalogueTracks]);

  const isFavourite = useCallback((id: string) => favouriteIds.includes(id), [favouriteIds]);

  const toggleFavourite = useCallback((id: string) => {
    setFavouriteIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }, []);

  const togglePlaylistLike = useCallback((id: string) => {
    setLikedPlaylistIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }, []);

  const toggleSavedAlbum = useCallback((id: string) => {
    setSavedAlbumIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }, []);

  const toggleFollowedArtist = useCallback((id: string) => {
    setFollowedArtistIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }, []);

  const createPlaylist = useCallback((name: string, trackIds: string[] = []): Playlist => {
    const playlist: Playlist = {
      id: `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || "Untitled playlist",
      description: "Your playlist",
      trackIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPlaylists((previous) => [...previous, playlist]);
    return playlist;
  }, []);

  const renamePlaylist = useCallback((id: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    setPlaylists((previous) => previous.map((playlist) => playlist.id === id ? { ...playlist, name: next, updatedAt: Date.now() } : playlist));
  }, []);

  const describePlaylist = useCallback((id: string, description: string) => {
    setPlaylists((previous) => previous.map((playlist) => playlist.id === id ? { ...playlist, description, updatedAt: Date.now() } : playlist));
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((previous) => previous.filter((playlist) => playlist.id !== id));
    setLikedPlaylistIds((previous) => previous.filter((item) => item !== id));
  }, []);

  const createFolder = useCallback((name: string, parentId: string | null = null): LibraryFolder => {
    const clean = name.trim().replace(/[\\/]+/g, "-") || "New Folder";
    const now = Date.now();
    const folder: LibraryFolder = {
      id: `dir-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: clean,
      parentId: parentId ?? null,
      trackIds: [],
      createdAt: now,
      updatedAt: now,
    };
    setFolders((previous) => [...previous, folder]);
    return folder;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    const clean = name.trim().replace(/[\\/]+/g, "-");
    if (!clean) return;
    setFolders((previous) =>
      previous.map((folder) => (folder.id === id ? { ...folder, name: clean, updatedAt: Date.now() } : folder)),
    );
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setFolders((previous) => {
      const toDelete = new Set<string>([id]);
      let added = true;
      while (added) {
        added = false;
        for (const folder of previous) {
          if (folder.parentId && toDelete.has(folder.parentId) && !toDelete.has(folder.id)) {
            toDelete.add(folder.id);
            added = true;
          }
        }
      }
      return previous.filter((folder) => !toDelete.has(folder.id));
    });
  }, []);

  const addTrackToFolder = useCallback((folderId: string, trackId: string) => {
    setFolders((previous) =>
      previous.map((folder) => {
        if (folder.id !== folderId || folder.trackIds.includes(trackId)) return folder;
        return { ...folder, trackIds: [...folder.trackIds, trackId], updatedAt: Date.now() };
      }),
    );
  }, []);

  const removeTrackFromFolder = useCallback((folderId: string, trackId: string) => {
    setFolders((previous) =>
      previous.map((folder) =>
        folder.id === folderId
          ? { ...folder, trackIds: folder.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() }
          : folder,
      ),
    );
  }, []);

  const moveTrackToFolder = useCallback((fromFolderId: string | null, toFolderId: string, trackId: string) => {
    setFolders((previous) =>
      previous.map((folder) => {
        if (folder.id === fromFolderId && folder.id !== toFolderId) {
          return { ...folder, trackIds: folder.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() };
        }
        if (folder.id === toFolderId && !folder.trackIds.includes(trackId)) {
          return { ...folder, trackIds: [...folder.trackIds, trackId], updatedAt: Date.now() };
        }
        return folder;
      }),
    );
  }, []);

  const addToPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId || playlist.trackIds.includes(trackId)) return playlist;
      return { ...playlist, trackIds: [...playlist.trackIds, trackId], updatedAt: Date.now() };
    }));
  }, []);

  const addTracksToPlaylist = useCallback((playlistId: string, trackIds: string[]) => {
    setPlaylists((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const merged = [...playlist.trackIds];
      for (const id of trackIds) if (!merged.includes(id)) merged.push(id);
      return { ...playlist, trackIds: merged, updatedAt: Date.now() };
    }));
  }, []);

  const removeFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((previous) => previous.map((playlist) => playlist.id === playlistId
      ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() }
      : playlist));
  }, []);

  const reorderPlaylistTrack = useCallback((playlistId: string, trackId: string, direction: -1 | 1) => {
    setPlaylists((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const index = playlist.trackIds.indexOf(trackId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= playlist.trackIds.length) return playlist;
      const trackIds = [...playlist.trackIds];
      [trackIds[index], trackIds[target]] = [trackIds[target], trackIds[index]];
      return { ...playlist, trackIds, updatedAt: Date.now() };
    }));
  }, []);

  const movePlaylistTrack = useCallback((playlistId: string, fromIndex: number, toIndex: number) => {
    setPlaylists((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      if (fromIndex < 0 || fromIndex >= playlist.trackIds.length) return playlist;
      const target = Math.max(0, Math.min(playlist.trackIds.length - 1, toIndex));
      const trackIds = [...playlist.trackIds];
      const [moved] = trackIds.splice(fromIndex, 1);
      trackIds.splice(target, 0, moved);
      return { ...playlist, trackIds, updatedAt: Date.now() };
    }));
  }, []);

  const addRecent = useCallback((id: string) => {
    setRecentIds((previous) => [id, ...previous.filter((item) => item !== id)].slice(0, RECENT_LIMIT));
  }, []);

  const downloadTrack = useCallback(async (id: string): Promise<boolean> => {
    const track = trackIndex.get(id);
    if (!track) return false;
    if (!track.downloadUrl || track.licensing.downloadAllowed === false) {
      setStorageError("This provider has not released this track for download.");
      return false;
    }
    if (controllers.current.has(id)) return false;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setDownloadProgress((previous) => ({ ...previous, [id]: 0 }));
    setStorageError("");
    try {
      const { blob } = await fetchTrackAudio(track, {
        signal: controller.signal,
        onProgress: (percent) => setDownloadProgress((previous) => ({ ...previous, [id]: percent })),
      });
      await saveOfflineTrack(track, blob);
      await refreshDownloads();
      return true;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStorageError("");
      } else {
        setStorageError(messageFrom(error, "The download could not be completed."));
      }
      return false;
    } finally {
      controllers.current.delete(id);
      setDownloadProgress((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }, [refreshDownloads, trackIndex]);

  const cancelDownload = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setDownloadProgress((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  const removeDownload = useCallback(async (id: string) => {
    await removeOfflineTrack(id);
    await refreshDownloads();
  }, [refreshDownloads]);

  const importAudio = useCallback(async (files: File[], targetFolderId: string | null = null): Promise<{ imported: number; skipped: number }> => {
    let imported = 0;
    let skipped = 0;
    const importedIds: string[] = [];
    for (const file of files) {
      if (!isAudioFile(file)) {
        skipped += 1;
        continue;
      }
      try {
        const parsedName = parseFileName(file.name);
        const headerBytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
        const embedded = extractEmbeddedLyricsFromAudioBytes(headerBytes);
        const title = embedded?.title || parsedName.title;
        const artist = embedded?.artist || parsedName.artist;
        const album = embedded?.album || "Imported";
        const lyrics = embedded?.syncedLyrics || embedded?.plainLyrics
          ? {
              ...(embedded.syncedLyrics ? { syncedLyrics: embedded.syncedLyrics } : {}),
              ...(embedded.plainLyrics ? { plainLyrics: embedded.plainLyrics } : {}),
            }
          : undefined;
        const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const track: Track = {
          id,
          providerId: "local",
          providerName: PROVIDER_NAMES.local,
          providerTrackId: id,
          title,
          artist,
          album,
          artwork: "",
          artworkSmall: "",
          duration: 0,
          streamUrl: URL.createObjectURL(file),
          genre: "Imported",
          tags: [],
          licensing: {
            name: "Your own audio file",
            streamingAllowed: true,
            downloadAllowed: true,
            note: "Imported from your device — stored offline in this browser.",
          },
          accent: PROVIDER_ACCENTS.local,
          imported: true,
          ...(lyrics ? { lyrics } : {}),
        };
        await saveOfflineTrack(track, file);
        importedIds.push(id);
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    if (targetFolderId && importedIds.length > 0) {
      setFolders((previous) =>
        previous.map((folder) => {
          if (folder.id !== targetFolderId) return folder;
          const nextIds = [...folder.trackIds];
          for (const id of importedIds) if (!nextIds.includes(id)) nextIds.push(id);
          return { ...folder, trackIds: nextIds, updatedAt: Date.now() };
        }),
      );
    }
    await refreshDownloads();
    return { imported, skipped };
  }, [refreshDownloads]);

  const removeLocalTrack = useCallback(async (id: string) => {
    await removeOfflineTrack(id);
    setFolders((previous) =>
      previous.map((folder) =>
        folder.trackIds.includes(id)
          ? { ...folder, trackIds: folder.trackIds.filter((item) => item !== id), updatedAt: Date.now() }
          : folder,
      ),
    );
    await refreshDownloads();
  }, [refreshDownloads]);

  const value = useMemo<Store>(() => ({
    tracks,
    catalogueTracks,
    downloads,
    downloadProgress,
    downloadingIds: [...controllers.current.keys()],
    storageUsage,
    storageUsageLabel: formatBytes(storageUsage),
    storageError,
    offlineMeta,
    clearStorageError: () => setStorageError(""),
    playlists,
    folders,
    favouriteIds,
    recentIds,
    likedPlaylistIds,
    savedAlbumIds,
    followedArtistIds,
    getTrack,
    rememberTracks,
    isFavourite,
    toggleFavourite,
    createPlaylist,
    renamePlaylist,
    describePlaylist,
    deletePlaylist,
    createFolder,
    renameFolder,
    deleteFolder,
    addTrackToFolder,
    removeTrackFromFolder,
    moveTrackToFolder,
    togglePlaylistLike,
    toggleSavedAlbum,
    toggleFollowedArtist,
    addToPlaylist,
    addTracksToPlaylist,
    removeFromPlaylist,
    shiftPlaylistTrack: reorderPlaylistTrack,
    reorderPlaylistTrack,
    movePlaylistTrack,
    addRecent,
    downloadTrack,
    cancelDownload,
    removeDownload,
    importAudio,
    removeLocalTrack,
    volume,
    shuffle,
    repeat,
    queueIds,
    setVolume,
    setShuffle,
    setRepeat,
    setQueue,
    addCatalogueTracks,
  }), [
    tracks, catalogueTracks, downloads, downloadProgress, storageUsage, storageError, offlineMeta,
    playlists, folders, favouriteIds, recentIds, likedPlaylistIds, savedAlbumIds, followedArtistIds,
    getTrack, rememberTracks, isFavourite, toggleFavourite, createPlaylist, renamePlaylist,
    describePlaylist, deletePlaylist, createFolder, renameFolder, deleteFolder,
    addTrackToFolder, removeTrackFromFolder, moveTrackToFolder,
    togglePlaylistLike, toggleSavedAlbum, toggleFollowedArtist,
    addToPlaylist, addTracksToPlaylist, removeFromPlaylist, reorderPlaylistTrack, movePlaylistTrack,
    addRecent, downloadTrack, cancelDownload, removeDownload, importAudio, removeLocalTrack,
    volume, shuffle, repeat, queueIds, setVolume, setShuffle, setRepeat, setQueue, addCatalogueTracks,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export { GENRE_CATEGORIES };
export type { RepeatMode };

export function useStore(): Store {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside <StoreProvider>.");
  return context;
}
