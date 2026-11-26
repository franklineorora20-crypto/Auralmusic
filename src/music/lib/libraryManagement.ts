/**
 * Pure playlist & local library management helpers:
 * - Sorting & deduplicating playlist track IDs
 * - M3U & JSON playlist serialization
 * - Duplicate track detection by normalized title + artist
 */

import type { Playlist, Track } from "../../types";

export type PlaylistSortKey = "title" | "artist" | "album" | "duration";

export function dedupeTrackIds(trackIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of trackIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function sortPlaylistTrackIds(
  trackIds: readonly string[],
  getTrack: (id: string) => Track | undefined,
  sortBy: PlaylistSortKey,
): string[] {
  return [...trackIds].sort((aId, bId) => {
    const a = getTrack(aId);
    const b = getTrack(bId);
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (sortBy === "artist") {
      return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
    }
    if (sortBy === "album") {
      return a.album.localeCompare(b.album) || a.title.localeCompare(b.title);
    }
    if (sortBy === "duration") {
      return (b.duration || 0) - (a.duration || 0) || a.title.localeCompare(b.title);
    }
    return a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist);
  });
}

function normalizeTrackSignature(track: Pick<Track, "title" | "artist">): string {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${norm(track.title)}::${norm(track.artist)}`;
}

export function findDuplicateTracks(tracks: readonly Track[]): Array<{ key: string; tracks: Track[] }> {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = normalizeTrackSignature(track);
    if (!key || key === "::") continue;
    const list = groups.get(key) ?? [];
    list.push(track);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, tracks: group }));
}

export function exportPlaylistAsM3u(playlist: Playlist, tracks: readonly Track[]): string {
  const lines = [
    "#EXTM3U",
    `#PLAYLIST:${playlist.name}`,
  ];
  for (const track of tracks) {
    const duration = Math.max(-1, Math.round(track.duration || 0));
    lines.push(`#EXTINF:${duration},${track.artist} - ${track.title}`);
    const ref = track.permalink || (!track.streamUrl.startsWith("blob:") ? track.streamUrl : `${track.artist} - ${track.title}`);
    lines.push(ref);
  }
  return lines.join("\n");
}

export function exportPlaylistAsJson(playlist: Playlist, tracks: readonly Track[]): string {
  return JSON.stringify(
    {
      name: playlist.name,
      description: playlist.description,
      exportedAt: new Date().toISOString(),
      tracks: tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        genre: t.genre,
        provider: t.providerName,
        ...(t.permalink ? { permalink: t.permalink } : {}),
      })),
    },
    null,
    2,
  );
}
