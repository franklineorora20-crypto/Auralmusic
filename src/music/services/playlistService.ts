import type { Playlist, Track } from "../types/music";

const MAX_NAME_LENGTH = 80;

export function sanitizePlaylistName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

export function createPlaylist(name: string, trackIds: string[] = []): Playlist {
  const now = Date.now();
  return {
    id: `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: sanitizePlaylistName(name) || "Untitled playlist",
    description: "Your playlist",
    trackIds: [...new Set(trackIds)],
    createdAt: now,
    updatedAt: now,
  };
}

function touch(playlist: Playlist, changes: Partial<Playlist>): Playlist {
  return { ...playlist, ...changes, updatedAt: Date.now() };
}

export function renamePlaylist(playlists: Playlist[], id: string, name: string): Playlist[] {
  const nextName = sanitizePlaylistName(name);
  if (!nextName) return playlists;
  return playlists.map((playlist) => (playlist.id === id ? touch(playlist, { name: nextName }) : playlist));
}

export function describePlaylist(playlists: Playlist[], id: string, description: string): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id ? touch(playlist, { description: description.slice(0, 240) }) : playlist,
  );
}

export function removePlaylist(playlists: Playlist[], id: string): Playlist[] {
  return playlists.filter((playlist) => playlist.id !== id);
}

/** Adding an existing track is a no-op, so ids stay unique per playlist. */
export function addTrackToPlaylist(playlists: Playlist[], id: string, trackId: string): Playlist[] {
  return playlists.map((playlist) => {
    if (playlist.id !== id || playlist.trackIds.includes(trackId)) return playlist;
    return touch(playlist, { trackIds: [...playlist.trackIds, trackId] });
  });
}

export function addTracksToPlaylist(playlists: Playlist[], id: string, trackIds: string[]): Playlist[] {
  return playlists.map((playlist) => {
    if (playlist.id !== id) return playlist;
    const merged = [...playlist.trackIds];
    trackIds.forEach((trackId) => {
      if (!merged.includes(trackId)) merged.push(trackId);
    });
    if (merged.length === playlist.trackIds.length) return playlist;
    return touch(playlist, { trackIds: merged });
  });
}

export function removeTrackFromPlaylist(playlists: Playlist[], id: string, trackId: string): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id ? touch(playlist, { trackIds: playlist.trackIds.filter((item) => item !== trackId) }) : playlist,
  );
}

/** Move a track by index — used by drag/reorder controls. */
export function moveTrack(playlists: Playlist[], id: string, fromIndex: number, toIndex: number): Playlist[] {
  return playlists.map((playlist) => {
    if (playlist.id !== id) return playlist;
    const { trackIds } = playlist;
    if (fromIndex < 0 || fromIndex >= trackIds.length) return playlist;
    const clamped = Math.max(0, Math.min(trackIds.length - 1, toIndex));
    if (clamped === fromIndex) return playlist;
    const next = [...trackIds];
    const [moved] = next.splice(fromIndex, 1);
    if (moved === undefined) return playlist;
    next.splice(clamped, 0, moved);
    return touch(playlist, { trackIds: next });
  });
}

export function shiftTrack(playlists: Playlist[], id: string, trackId: string, direction: -1 | 1): Playlist[] {
  const playlist = playlists.find((item) => item.id === id);
  if (!playlist) return playlists;
  const index = playlist.trackIds.indexOf(trackId);
  if (index < 0) return playlists;
  return moveTrack(playlists, id, index, index + direction);
}

export function resolvePlaylistTracks(playlist: Playlist, resolve: (id: string) => Track | undefined): Track[] {
  return playlist.trackIds
    .map((id) => resolve(id))
    .filter((track): track is Track => Boolean(track));
}

export function playlistDuration(tracks: Track[]): number {
  return tracks.reduce((total, track) => total + (Number.isFinite(track.duration) ? track.duration : 0), 0);
}
