import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowUpDown,
  ChevronRight,
  CornerLeftUp,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  ListMusic,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { isDisplayableImageUrl } from "../music/lib/mediaMetadata";
import { formatBytes } from "../offline";
import { useStore, type LibraryFolder } from "../store";
import type { Track, View } from "../types";
import { TrackArtwork } from "./TrackArtwork";

type SystemNodeId =
  | "root"
  | "sys:downloads"
  | "sys:imports"
  | "sys:saved"
  | "sys:playlists"
  | "sys:albums"
  | "sys:artists"
  | "sys:recent";

type FsSortKey = "name" | "artist" | "duration" | "size";
type FsViewMode = "list" | "grid";

type VirtualAlbumNode = {
  kind: "album";
  name: string;
  tracks: Track[];
};

type VirtualArtistNode = {
  kind: "artist";
  name: string;
  tracks: Track[];
};

type DirectorySelection =
  | { kind: "system"; id: SystemNodeId }
  | { kind: "custom"; id: string }
  | { kind: "album"; name: string }
  | { kind: "artist"; name: string }
  | { kind: "playlist"; id: string };

interface LibraryFileSystemProps {
  currentId: string;
  isPlaying: boolean;
  onPlayTrack: (track: Track, collection?: Track[]) => void;
  onNavigate: (view: View, id?: string) => void;
  onAddTrackToPlaylist: (trackId: string) => void;
  onOpenNewPlaylist: () => void;
  onImportFiles: (files: File[], targetFolderId?: string | null) => void;
  onTriggerImportPicker: (targetFolderId?: string | null) => void;
  onEditCover?: (track: Track) => void;
  onFolderExitToss?: (label: string) => void;
}

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  return `${mins}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
};

const formatFileDate = (timestamp?: number) => {
  if (!timestamp) return "Catalogue";
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Saved";
  }
};

function sanitizeSegment(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
}

function getFileExtension(track: Track): string {
  const url = track.streamUrl.toLowerCase();
  if (url.includes(".flac")) return "flac";
  if (url.includes(".wav")) return "wav";
  if (url.includes(".ogg") || url.includes(".opus")) return "ogg";
  if (url.includes(".m4a") || url.includes(".aac")) return "m4a";
  if (track.imported) return "wav";
  if (track.downloaded || track.providerId === "sample") return "mp3";
  return "stream";
}

function getTrackFileName(track: Track): string {
  const artist = sanitizeSegment(track.artist || "Unknown");
  const title = sanitizeSegment(track.title || "Track");
  const ext = getFileExtension(track);
  return `${artist} - ${title}.${ext}`;
}

export default function LibraryFileSystem({
  currentId,
  isPlaying,
  onPlayTrack,
  onNavigate,
  onAddTrackToPlaylist,
  onOpenNewPlaylist,
  onImportFiles,
  onTriggerImportPicker,
  onEditCover,
  onFolderExitToss,
}: LibraryFileSystemProps) {
  const store = useStore();
  const [location, setLocation] = useState<DirectorySelection>({ kind: "system", id: "root" });
  const [viewMode, setViewMode] = useState<FsViewMode>("list");
  const [sortKey, setSortKey] = useState<FsSortKey>("name");
  const [filterTerm, setFilterTerm] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTrackTarget, setMoveTrackTarget] = useState<{ trackId: string; fromFolderId: string | null } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [folderEnterKey, setFolderEnterKey] = useState(0);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const importedTracks = useMemo(
    () => store.downloads.filter((track) => track.imported),
    [store.downloads],
  );
  const savedTracks = useMemo(
    () => store.tracks.filter((track) => store.favouriteIds.includes(track.id)),
    [store.tracks, store.favouriteIds],
  );
  const recentTracks = useMemo(
    () =>
      store.recentIds
        .map((id) => store.tracks.find((t) => t.id === id))
        .filter((t): t is Track => Boolean(t)),
    [store.recentIds, store.tracks],
  );

  const albumGroups = useMemo<VirtualAlbumNode[]>(() => {
    const grouped = new Map<string, Track[]>();
    const preferred = new Set(store.savedAlbumIds);
    for (const track of store.tracks) {
      if (!track.album || track.album === "Single") continue;
      if (preferred.has(track.album) || track.downloaded || track.imported || store.favouriteIds.includes(track.id)) {
        const list = grouped.get(track.album) ?? [];
        list.push(track);
        grouped.set(track.album, list);
      }
    }
    return [...grouped.entries()]
      .map(([name, tracks]) => ({ kind: "album" as const, name, tracks }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [store.savedAlbumIds, store.tracks, store.favouriteIds]);

  const artistGroups = useMemo<VirtualArtistNode[]>(() => {
    const grouped = new Map<string, Track[]>();
    const preferred = new Set(store.followedArtistIds);
    for (const track of store.tracks) {
      if (!track.artist) continue;
      if (preferred.has(track.artist) || track.downloaded || track.imported || store.favouriteIds.includes(track.id)) {
        const list = grouped.get(track.artist) ?? [];
        list.push(track);
        grouped.set(track.artist, list);
      }
    }
    return [...grouped.entries()]
      .map(([name, tracks]) => ({ kind: "artist" as const, name, tracks }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [store.followedArtistIds, store.tracks, store.favouriteIds]);

  const folderMap = useMemo(
    () => new Map(store.folders.map((folder) => [folder.id, folder])),
    [store.folders],
  );

  const activeCustomFolder: LibraryFolder | null =
    location.kind === "custom" ? folderMap.get(location.id) ?? null : null;

  const openLocation = (next: DirectorySelection, isBack = false) => {
    if (isBack) {
      onFolderExitToss?.(activeCustomFolder?.name ?? "Folder");
    }
    setLocation(next);
    setFilterTerm("");
    setFolderEnterKey((n) => n + 1);
  };

  const breadcrumbs = useMemo(() => {
    const trail: Array<{ label: string; target: DirectorySelection }> = [
      { label: "~/Music", target: { kind: "system", id: "root" } },
    ];
    if (location.kind === "system") {
      if (location.id === "sys:downloads") trail.push({ label: "Downloads", target: location });
      else if (location.id === "sys:imports") trail.push({ label: "Local Imports", target: location });
      else if (location.id === "sys:saved") trail.push({ label: "Saved Tracks", target: location });
      else if (location.id === "sys:playlists") trail.push({ label: "Playlists", target: location });
      else if (location.id === "sys:albums") trail.push({ label: "Albums", target: location });
      else if (location.id === "sys:artists") trail.push({ label: "Artists", target: location });
      else if (location.id === "sys:recent") trail.push({ label: "Recently Played", target: location });
    } else if (location.kind === "custom") {
      const chain: LibraryFolder[] = [];
      let cursor: LibraryFolder | undefined = folderMap.get(location.id);
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor.id)) {
        guard.add(cursor.id);
        chain.unshift(cursor);
        cursor = cursor.parentId ? folderMap.get(cursor.parentId) : undefined;
      }
      for (const node of chain) {
        trail.push({ label: node.name, target: { kind: "custom", id: node.id } });
      }
    } else if (location.kind === "album") {
      trail.push({ label: "Albums", target: { kind: "system", id: "sys:albums" } });
      trail.push({ label: location.name, target: location });
    } else if (location.kind === "artist") {
      trail.push({ label: "Artists", target: { kind: "system", id: "sys:artists" } });
      trail.push({ label: location.name, target: location });
    } else if (location.kind === "playlist") {
      const playlist = store.playlists.find((p) => p.id === location.id);
      trail.push({ label: "Playlists", target: { kind: "system", id: "sys:playlists" } });
      trail.push({ label: playlist?.name ?? "Playlist", target: location });
    }
    return trail;
  }, [location, folderMap, store.playlists]);

  const goUp = () => {
    if (breadcrumbs.length <= 1) return;
    const parent = breadcrumbs[breadcrumbs.length - 2];
    openLocation(parent.target, true);
  };

  const directoryFolders = useMemo(() => {
    type FolderEntry = {
      key: string;
      name: string;
      meta: string;
      kindLabel: string;
      customFolder?: LibraryFolder;
      onOpen: () => void;
    };
    const items: FolderEntry[] = [];

    if (location.kind === "system" && location.id === "root") {
      items.push(
        {
          key: "sys:downloads",
          name: "Downloads",
          meta: `${store.downloads.length} file${store.downloads.length === 1 ? "" : "s"} · ${store.storageUsageLabel}`,
          kindLabel: "Offline store",
          onOpen: () => openLocation({ kind: "system", id: "sys:downloads" }),
        },
        {
          key: "sys:imports",
          name: "Local Imports",
          meta: `${importedTracks.length} audio file${importedTracks.length === 1 ? "" : "s"}`,
          kindLabel: "Device files",
          onOpen: () => openLocation({ kind: "system", id: "sys:imports" }),
        },
        {
          key: "sys:saved",
          name: "Saved Tracks",
          meta: `${savedTracks.length} track${savedTracks.length === 1 ? "" : "s"}`,
          kindLabel: "Favourites",
          onOpen: () => openLocation({ kind: "system", id: "sys:saved" }),
        },
        {
          key: "sys:playlists",
          name: "Playlists",
          meta: `${store.playlists.length} list${store.playlists.length === 1 ? "" : "s"}`,
          kindLabel: ".m3u collections",
          onOpen: () => openLocation({ kind: "system", id: "sys:playlists" }),
        },
        {
          key: "sys:albums",
          name: "Albums",
          meta: `${albumGroups.length} album${albumGroups.length === 1 ? "" : "s"}`,
          kindLabel: "Releases",
          onOpen: () => openLocation({ kind: "system", id: "sys:albums" }),
        },
        {
          key: "sys:artists",
          name: "Artists",
          meta: `${artistGroups.length} artist${artistGroups.length === 1 ? "" : "s"}`,
          kindLabel: "Creators",
          onOpen: () => openLocation({ kind: "system", id: "sys:artists" }),
        },
        {
          key: "sys:recent",
          name: "Recently Played",
          meta: `${recentTracks.length} track${recentTracks.length === 1 ? "" : "s"}`,
          kindLabel: "History",
          onOpen: () => openLocation({ kind: "system", id: "sys:recent" }),
        },
      );

      for (const folder of store.folders.filter((f) => f.parentId === null)) {
        const childCount = store.folders.filter((c) => c.parentId === folder.id).length;
        items.push({
          key: folder.id,
          name: folder.name,
          meta: `${folder.trackIds.length} file${folder.trackIds.length === 1 ? "" : "s"}${childCount ? ` · ${childCount} subfolder${childCount === 1 ? "" : "s"}` : ""}`,
          kindLabel: "Folder",
          customFolder: folder,
          onOpen: () => openLocation({ kind: "custom", id: folder.id }),
        });
      }
    } else if (location.kind === "custom") {
      for (const folder of store.folders.filter((f) => f.parentId === location.id)) {
        items.push({
          key: folder.id,
          name: folder.name,
          meta: `${folder.trackIds.length} file${folder.trackIds.length === 1 ? "" : "s"}`,
          kindLabel: "Folder",
          customFolder: folder,
          onOpen: () => openLocation({ kind: "custom", id: folder.id }),
        });
      }
    } else if (location.kind === "system" && location.id === "sys:playlists") {
      for (const playlist of store.playlists) {
        items.push({
          key: playlist.id,
          name: `${playlist.name}.m3u`,
          meta: `${playlist.trackIds.length} track${playlist.trackIds.length === 1 ? "" : "s"}`,
          kindLabel: "Playlist",
          onOpen: () => openLocation({ kind: "playlist", id: playlist.id }),
        });
      }
    } else if (location.kind === "system" && location.id === "sys:albums") {
      for (const album of albumGroups) {
        items.push({
          key: `album:${album.name}`,
          name: album.name,
          meta: `${album.tracks.length} track${album.tracks.length === 1 ? "" : "s"} · ${album.tracks[0]?.artist ?? ""}`,
          kindLabel: "Album",
          onOpen: () => openLocation({ kind: "album", name: album.name }),
        });
      }
    } else if (location.kind === "system" && location.id === "sys:artists") {
      for (const artist of artistGroups) {
        items.push({
          key: `artist:${artist.name}`,
          name: artist.name,
          meta: `${artist.tracks.length} track${artist.tracks.length === 1 ? "" : "s"}`,
          kindLabel: "Artist",
          onOpen: () => openLocation({ kind: "artist", name: artist.name }),
        });
      }
    }

    const q = filterTerm.trim().toLowerCase();
    return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
  }, [
    location,
    store.downloads.length,
    store.storageUsageLabel,
    importedTracks.length,
    savedTracks.length,
    store.playlists,
    albumGroups,
    artistGroups,
    recentTracks.length,
    store.folders,
    filterTerm,
  ]);

  const directoryTracks = useMemo(() => {
    let list: Track[] = [];
    if (location.kind === "system") {
      if (location.id === "sys:downloads") list = store.downloads;
      else if (location.id === "sys:imports") list = importedTracks;
      else if (location.id === "sys:saved") list = savedTracks;
      else if (location.id === "sys:recent") list = recentTracks;
    } else if (location.kind === "custom" && activeCustomFolder) {
      list = activeCustomFolder.trackIds
        .map((id) => store.getTrack(id))
        .filter((t): t is Track => Boolean(t));
    } else if (location.kind === "album") {
      list = store.tracks.filter((t) => t.album === location.name);
    } else if (location.kind === "artist") {
      list = store.tracks.filter((t) => t.artist === location.name);
    } else if (location.kind === "playlist") {
      const playlist = store.playlists.find((p) => p.id === location.id);
      list = (playlist?.trackIds ?? [])
        .map((id) => store.getTrack(id))
        .filter((t): t is Track => Boolean(t));
    }

    const q = filterTerm.trim().toLowerCase();
    const filtered = q
      ? list.filter((t) => `${t.title} ${t.artist} ${t.album} ${getTrackFileName(t)}`.toLowerCase().includes(q))
      : [...list];

    filtered.sort((a, b) => {
      if (sortKey === "artist") return a.artist.localeCompare(b.artist);
      if (sortKey === "duration") return (b.duration || 0) - (a.duration || 0);
      if (sortKey === "size") {
        const sizeA = store.offlineMeta[a.id]?.bytes ?? 0;
        const sizeB = store.offlineMeta[b.id]?.bytes ?? 0;
        return sizeB - sizeA;
      }
      return getTrackFileName(a).localeCompare(getTrackFileName(b));
    });

    return filtered;
  }, [
    location,
    store.downloads,
    importedTracks,
    savedTracks,
    recentTracks,
    activeCustomFolder,
    store,
    filterTerm,
    sortKey,
  ]);

  const isRoot = location.kind === "system" && location.id === "root";
  const canCreateSubfolderHere = isRoot || location.kind === "custom";
  const currentCustomParentId = location.kind === "custom" ? location.id : null;

  const handleCreateFolder = () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    store.createFolder(clean, currentCustomParentId);
    setNewFolderName("");
    setNewFolderOpen(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      onImportFiles(files, currentCustomParentId);
    }
  };

  const cycleSort = () => {
    const order: FsSortKey[] = ["name", "artist", "duration", "size"];
    const next = order[(order.indexOf(sortKey) + 1) % order.length];
    setSortKey(next);
  };

  const totalDirectoryBytes = useMemo(
    () =>
      directoryTracks.reduce(
        (sum, track) => sum + (store.offlineMeta[track.id]?.bytes ?? 0),
        0,
      ),
    [directoryTracks, store.offlineMeta],
  );

  return (
    <section
      className={`fs-browser ${dragOver ? "is-drag-over" : ""}`}
      aria-label="Music file system"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div className="fs-toolbar">
        <div className="fs-breadcrumbs" role="navigation" aria-label="Directory path">
          <button
            type="button"
            className="fs-up-btn"
            onClick={goUp}
            disabled={isRoot}
            aria-label="Go up one folder"
            title="Parent directory"
          >
            <CornerLeftUp size={15} />
          </button>
          <div className="fs-crumb-trail">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="fs-crumb-item">
                  {index > 0 && <ChevronRight size={13} className="fs-crumb-sep" aria-hidden="true" />}
                  <button
                    type="button"
                    className={isLast ? "active" : ""}
                    onClick={() => openLocation(crumb.target, index < breadcrumbs.length - 1)}
                    aria-current={isLast ? "location" : undefined}
                  >
                    {crumb.label}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="fs-controls">
          <label className="fs-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={filterInputRef}
              value={filterTerm}
              onChange={(event) => setFilterTerm(event.target.value)}
              placeholder="Filter folder…"
              aria-label="Filter files and folders"
            />
            {filterTerm && (
              <button type="button" onClick={() => setFilterTerm("")} aria-label="Clear folder filter">
                <X size={13} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="fs-tool-btn"
            onClick={cycleSort}
            title={`Sort by ${sortKey}`}
            aria-label={`Sort by ${sortKey}`}
          >
            <ArrowUpDown size={14} />
            <span>{sortKey[0].toUpperCase() + sortKey.slice(1)}</span>
          </button>
          <div className="fs-view-toggle" role="group" aria-label="File view mode">
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              aria-label="List view"
              title="List view"
            >
              <List size={15} />
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid size={15} />
            </button>
          </div>
          {canCreateSubfolderHere && (
            <button
              type="button"
              className="fs-tool-btn fs-new-folder-btn"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus size={15} />
              <span>New folder</span>
            </button>
          )}
        </div>
      </div>

      <div className="fs-statusbar">
        <span className="fs-status-path">
          <HardDrive size={13} aria-hidden="true" />
          <span>
            {directoryFolders.length} folder{directoryFolders.length === 1 ? "" : "s"} ·{" "}
            {directoryTracks.length} file{directoryTracks.length === 1 ? "" : "s"}
            {totalDirectoryBytes > 0 ? ` · ${formatBytes(totalDirectoryBytes)}` : ""}
          </span>
        </span>
        <span className="fs-status-hint">Drop audio files anywhere here to import</span>
      </div>

      <div className="fs-stage paper-unfold" key={`${location.kind}-${"id" in location ? location.id : location.name}-${folderEnterKey}`}>
        {directoryFolders.length > 0 && (
          <div className={viewMode === "grid" ? "fs-folder-grid" : "fs-folder-list"}>
            {directoryFolders.map((item) => {
              const isRenaming = item.customFolder && renamingFolderId === item.customFolder.id;
              return (
                <div key={item.key} className={`fs-folder-row ${viewMode === "grid" ? "is-grid" : ""}`}>
                  {isRenaming ? (
                    <div className="fs-rename-inline">
                      <FolderOpen size={17} />
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && item.customFolder) {
                            store.renameFolder(item.customFolder.id, renameValue);
                            setRenamingFolderId(null);
                          } else if (event.key === "Escape") {
                            setRenamingFolderId(null);
                          }
                        }}
                        aria-label="Rename folder"
                      />
                      <button
                        type="button"
                        className="primary-button fs-mini-save"
                        onClick={() => {
                          if (item.customFolder) store.renameFolder(item.customFolder.id, renameValue);
                          setRenamingFolderId(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="fs-folder-trigger" onClick={item.onOpen}>
                        <span className="fs-folder-icon" aria-hidden="true">
                          <Folder size={viewMode === "grid" ? 24 : 18} />
                        </span>
                        <span className="fs-folder-copy">
                          <strong>{item.name}</strong>
                          <small>{item.meta}</small>
                        </span>
                        <span className="fs-kind-label">{item.kindLabel}</span>
                      </button>
                      {item.customFolder && (
                        <div className="fs-folder-actions">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => {
                              setRenamingFolderId(item.customFolder!.id);
                              setRenameValue(item.customFolder!.name);
                            }}
                            aria-label={`Rename ${item.name}`}
                            title="Rename folder"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => store.deleteFolder(item.customFolder!.id)}
                            aria-label={`Delete ${item.name}`}
                            title="Delete folder"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isRoot && (
          <div className="fs-files-section">
            {location.kind === "custom" && (
              <div className="fs-dir-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onTriggerImportPicker(location.id)}
                >
                  <Upload size={15} /> Import into folder
                </button>
                {directoryTracks[0] && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onPlayTrack(directoryTracks[0], directoryTracks)}
                  >
                    <Play size={15} fill="currentColor" /> Play folder
                  </button>
                )}
              </div>
            )}

            {location.kind === "album" && (
              <div className="fs-dir-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onNavigate("album", location.name)}
                >
                  Open album view
                </button>
                {directoryTracks[0] && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onPlayTrack(directoryTracks[0], directoryTracks)}
                  >
                    <Play size={15} fill="currentColor" /> Play album
                  </button>
                )}
              </div>
            )}

            {location.kind === "artist" && (
              <div className="fs-dir-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onNavigate("artist", location.name)}
                >
                  Open artist view
                </button>
                {directoryTracks[0] && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onPlayTrack(directoryTracks[0], directoryTracks)}
                  >
                    <Play size={15} fill="currentColor" /> Play artist
                  </button>
                )}
              </div>
            )}

            {location.kind === "playlist" && (
              <div className="fs-dir-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onNavigate("playlist", location.id)}
                >
                  <ListMusic size={15} /> Open playlist editor
                </button>
                {directoryTracks[0] && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onPlayTrack(directoryTracks[0], directoryTracks)}
                  >
                    <Play size={15} fill="currentColor" /> Play playlist
                  </button>
                )}
              </div>
            )}

            {directoryTracks.length > 0 ? (
              <>
                {viewMode === "list" && (
                  <div className="fs-table-head" aria-hidden="true">
                    <span>Name</span>
                    <span className="fs-col-ext">Format</span>
                    <span className="fs-col-size">Size</span>
                    <span className="fs-col-date">Saved</span>
                    <span className="fs-col-dur">Time</span>
                    <span />
                  </div>
                )}
                <div className={viewMode === "grid" ? "fs-file-grid" : "fs-file-list"}>
                  {directoryTracks.map((track) => {
                    const active = track.id === currentId;
                    const playing = active && isPlaying;
                    const fileMeta = store.offlineMeta[track.id];
                    const ext = getFileExtension(track).toUpperCase();
                    const fileName = getTrackFileName(track);
                    const isStarred = store.favouriteIds.includes(track.id);

                    return (
                      <div
                        key={track.id}
                        className={`fs-file-row ${viewMode === "grid" ? "is-grid" : ""} ${active ? "is-current" : ""}`}
                      >
                        <button
                          type="button"
                          className="fs-file-main"
                          onClick={() => onPlayTrack(track, directoryTracks)}
                        >
                          <span className="fs-file-icon" aria-hidden="true">
                            <TrackArtwork track={track} size="small" className="fs-file-thumb-art" />
                            {playing && (
                              <span className="fs-file-playing-badge">
                                <Pause size={12} fill="currentColor" />
                              </span>
                            )}
                          </span>
                          <span className="fs-file-copy">
                            <strong title={fileName}>{fileName}</strong>
                            <small>
                              {track.title} · {track.artist}
                              {track.lyrics ? " · .lrc" : ""}
                            </small>
                          </span>
                        </button>
                        <span className="fs-file-ext">{ext}</span>
                        <span className="fs-file-size">
                          {fileMeta ? formatBytes(fileMeta.bytes) : "Stream"}
                        </span>
                        <span className="fs-file-date">
                          {formatFileDate(fileMeta?.savedAt)}
                        </span>
                        <span className="fs-file-dur">{formatDuration(track.duration)}</span>
                        <div className="fs-file-actions">
                          <button
                            type="button"
                            className={`icon-button ${isStarred ? "active" : ""}`}
                            onClick={() => store.toggleFavourite(track.id)}
                            aria-label={isStarred ? `Remove ${track.title} from saved tracks` : `Save ${track.title}`}
                            title="Star file"
                          >
                            <Heart size={14} fill={isStarred ? "currentColor" : "none"} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() =>
                              setMoveTrackTarget({
                                trackId: track.id,
                                fromFolderId: location.kind === "custom" ? location.id : null,
                              })
                            }
                            aria-label={`File ${track.title} into folder`}
                            title="Move / file into folder"
                          >
                            <FolderInput size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onAddTrackToPlaylist(track.id)}
                            aria-label={`Add ${track.title} to a playlist`}
                            title="Add to playlist"
                          >
                            <Plus size={14} />
                          </button>
                          {onEditCover && (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => onEditCover(track)}
                              aria-label={isDisplayableImageUrl(track.artwork) ? `Change cover for ${track.title}` : `Add cover for ${track.title}`}
                              title={isDisplayableImageUrl(track.artwork) ? "Change cover picture" : "Add cover picture"}
                            >
                              <ImagePlus size={14} />
                            </button>
                          )}
                          {location.kind === "custom" && (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => store.removeTrackFromFolder(location.id, track.id)}
                              aria-label={`Remove ${track.title} from folder`}
                              title="Remove from folder"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {location.kind === "system" && (location.id === "sys:downloads" || location.id === "sys:imports") && (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => {
                                void store.removeLocalTrack(track.id).catch(() => undefined);
                              }}
                              aria-label={`Delete ${track.title} from device`}
                              title="Delete offline file"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              directoryFolders.length === 0 && (
                <div className="empty-state">
                  <FolderOpen size={24} />
                  <h3>This folder is empty</h3>
                  <p>
                    {location.kind === "custom"
                      ? "Import audio files, drag and drop files here, or file tracks into this folder from any directory."
                      : "Items matching this folder will appear here automatically."}
                  </p>
                  <div className="fs-empty-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onTriggerImportPicker(currentCustomParentId)}
                    >
                      <Upload size={15} /> Import audio
                    </button>
                    {location.kind === "system" && location.id === "sys:playlists" && (
                      <button type="button" className="primary-button" onClick={onOpenNewPlaylist}>
                        <Plus size={15} /> New playlist
                      </button>
                    )}
                    {location.kind === "system" && location.id === "sys:downloads" && (
                      <button type="button" className="secondary-button" onClick={() => onNavigate("downloads")}>
                        <Download size={15} /> Offline storage
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {newFolderOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNewFolderOpen(false);
          }}
        >
          <div className="modal paper-unfold" role="dialog" aria-modal="true" aria-labelledby="new-folder-title">
            <button type="button" className="modal-close" onClick={() => setNewFolderOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h2 id="new-folder-title">New folder</h2>
            <p>
              Create a directory inside{" "}
              <code>{breadcrumbs[breadcrumbs.length - 1]?.label ?? "~/Music"}</code>.
            </p>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreateFolder();
              }}
              placeholder="Folder name (e.g. Late Night Mixes)"
            />
            <button
              type="button"
              className="primary-button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
            >
              <FolderPlus size={16} /> Create folder
            </button>
          </div>
        </div>
      )}

      {moveTrackTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoveTrackTarget(null);
          }}
        >
          <div className="modal paper-unfold" role="dialog" aria-modal="true" aria-labelledby="move-folder-title">
            <button type="button" className="modal-close" onClick={() => setMoveTrackTarget(null)} aria-label="Close">
              <X size={18} />
            </button>
            <h2 id="move-folder-title">File into folder</h2>
            <p>Choose a folder in your library file system.</p>
            {store.folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (moveTrackTarget.fromFolderId) {
                    store.moveTrackToFolder(moveTrackTarget.fromFolderId, folder.id, moveTrackTarget.trackId);
                  } else {
                    store.addTrackToFolder(folder.id, moveTrackTarget.trackId);
                  }
                  setMoveTrackTarget(null);
                }}
              >
                <Folder size={15} /> {folder.name}
              </button>
            ))}
            {store.folders.length === 0 && (
              <p>No custom folders yet. Create one first to organize tracks into directories.</p>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const created = store.createFolder("My Mixes", null);
                store.addTrackToFolder(created.id, moveTrackTarget.trackId);
                setMoveTrackTarget(null);
              }}
            >
              <FolderPlus size={15} /> Quick-create &ldquo;My Mixes&rdquo; &amp; file here
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
