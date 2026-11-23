/**
 * Pure playback queue navigation helpers used by both the UI controls and the
 * OS lock-screen Media Session action handlers.
 */

import type { RepeatMode, Track } from "../../types";

/**
 * Returns the ordered track IDs to step through when skipping tracks.
 * If the explicit queue is empty or only holds the current track, falls back
 * to the available playable library/catalogue tracks so Next/Previous still
 * change songs from the phone lock screen.
 */
export function resolvePlayableQueue(
  queueIds: readonly string[],
  tracks: readonly Track[],
  currentId: string,
): string[] {
  const uniqueQueue = queueIds.filter((id, index) => queueIds.indexOf(id) === index);
  if (uniqueQueue.length > 1 || (uniqueQueue.length === 1 && uniqueQueue[0] !== currentId)) {
    return uniqueQueue;
  }

  const playableIds = tracks
    .filter((track) => Boolean(track.streamUrl))
    .map((track) => track.id);

  if (playableIds.length > 0) {
    return playableIds;
  }
  return uniqueQueue;
}

export function computeNextTrackId(options: {
  queueIds: readonly string[];
  tracks: readonly Track[];
  currentId: string;
  shuffle: boolean;
  repeat: RepeatMode;
  randomFn?: () => number;
}): string | null {
  const list = resolvePlayableQueue(options.queueIds, options.tracks, options.currentId);
  if (!list.length) return null;

  const index = list.indexOf(options.currentId);
  if (options.shuffle && list.length > 1) {
    const rand = options.randomFn ?? Math.random;
    let candidate = Math.floor(rand() * list.length);
    if (candidate === index) {
      candidate = (index + 1) % list.length;
    }
    return list[candidate] ?? null;
  }

  let nextIndex = index < 0 ? 0 : index + 1;
  if (nextIndex >= list.length) {
    if (options.repeat !== "all") return null;
    nextIndex = 0;
  }
  return list[nextIndex] ?? null;
}

export function computePreviousTrackId(options: {
  queueIds: readonly string[];
  tracks: readonly Track[];
  currentId: string;
  repeat: RepeatMode;
  currentTime: number;
  restartThresholdSeconds?: number;
}): { action: "restart" | "switch" | "none"; trackId: string | null } {
  const threshold = options.restartThresholdSeconds ?? 4;
  if (Number.isFinite(options.currentTime) && options.currentTime > threshold) {
    return { action: "restart", trackId: options.currentId };
  }

  const list = resolvePlayableQueue(options.queueIds, options.tracks, options.currentId);
  if (!list.length) return { action: "none", trackId: null };

  const index = list.indexOf(options.currentId);
  if (index <= 0) {
    if (options.repeat !== "all" && index === 0) {
      return { action: "none", trackId: null };
    }
    return { action: "switch", trackId: list[list.length - 1] ?? null };
  }

  return { action: "switch", trackId: list[index - 1] ?? null };
}
