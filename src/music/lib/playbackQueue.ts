/**
 * Pure playback queue navigation helpers used by both the UI controls and the
 * OS lock-screen Media Session action handlers.
 */

import type { RepeatMode, Track } from "../../types";

export interface TrackAvailabilityOptions {
  online?: boolean;
  downloadedIds?: ReadonlySet<string>;
}

/**
 * Returns true if the track can currently be played.
 * When offline, only locally imported or downloaded (or blob-backed) tracks
 * are considered available.
 */
export function isTrackPlayable(
  track: Track | undefined,
  options?: TrackAvailabilityOptions,
): boolean {
  if (!track || !track.streamUrl) return false;
  const online = options?.online ?? true;
  if (online) return true;
  return (
    track.streamUrl.startsWith("blob:") ||
    Boolean(track.downloaded) ||
    Boolean(track.imported) ||
    Boolean(options?.downloadedIds?.has(track.id))
  );
}

/**
 * Produces a Fisher-Yates shuffled order of unique IDs, pinning `currentId`
 * at index 0 when present so playback advances through the remaining tracks
 * without repeating until every track has been heard.
 */
export function createShuffledIds(
  ids: readonly string[],
  currentId?: string,
  randomFn: () => number = Math.random,
): string[] {
  const unique = ids.filter((id, index) => Boolean(id) && ids.indexOf(id) === index);
  const copy = [...unique];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (currentId) {
    const pos = copy.indexOf(currentId);
    if (pos > 0) {
      copy.splice(pos, 1);
      copy.unshift(currentId);
    }
  }
  return copy;
}

/**
 * Returns the ordered track IDs to step through when skipping tracks.
 * If the explicit queue is empty or only holds the current track, falls back
 * to the available playable library/catalogue tracks so Next/Previous still
 * change songs from the phone lock screen or autoplay.
 */
export function resolvePlayableQueue(
  queueIds: readonly string[],
  tracks: readonly Track[],
  currentId: string,
  options?: TrackAvailabilityOptions,
): string[] {
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const hasCatalog = tracks.length > 0;
  const uniqueQueue = queueIds.filter((id, index) => {
    if (queueIds.indexOf(id) !== index) return false;
    if (!hasCatalog) return true;
    return isTrackPlayable(trackMap.get(id), options);
  });

  if (uniqueQueue.length > 1 || (uniqueQueue.length === 1 && uniqueQueue[0] !== currentId)) {
    return uniqueQueue;
  }

  const playableIds = tracks
    .filter((track) => isTrackPlayable(track, options))
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
  autoplay?: boolean;
  online?: boolean;
  downloadedIds?: ReadonlySet<string>;
  shuffleOrder?: readonly string[];
  recentIds?: readonly string[];
  randomFn?: () => number;
}): string | null {
  const availability: TrackAvailabilityOptions = {
    online: options.online ?? true,
    downloadedIds: options.downloadedIds,
  };
  const list = resolvePlayableQueue(options.queueIds, options.tracks, options.currentId, availability);
  const availablePoolIds = options.tracks
    .filter((track) => isTrackPlayable(track, availability))
    .map((track) => track.id);

  if (!list.length) {
    if (!options.autoplay) return null;
    const fallback = availablePoolIds.find((id) => id !== options.currentId);
    return fallback ?? null;
  }

  const rand = options.randomFn ?? Math.random;
  const extraPool = availablePoolIds.filter((id) => id !== options.currentId && !list.includes(id));

  if (options.shuffle) {
    if (options.shuffleOrder?.length) {
      const listSet = new Set(list);
      const orderedQueue = options.shuffleOrder.filter((id) => listSet.has(id));
      const orderedSet = new Set(orderedQueue);
      for (const id of list) {
        if (!orderedSet.has(id)) orderedQueue.push(id);
      }

      const pos = orderedQueue.indexOf(options.currentId);
      if (pos >= 0 && pos + 1 < orderedQueue.length) {
        return orderedQueue[pos + 1] ?? null;
      }
      if (pos < 0 && orderedQueue.length > 0) {
        const first = orderedQueue.find((id) => id !== options.currentId) ?? orderedQueue[0];
        if (first && (first !== options.currentId || options.repeat === "all")) {
          return first;
        }
      }

      if (options.autoplay && options.repeat !== "all") {
        const orderedExtra = options.shuffleOrder.filter(
          (id) => id !== options.currentId && !listSet.has(id) && availablePoolIds.includes(id),
        );
        const remainingExtra = orderedExtra.length > 0 ? orderedExtra : extraPool;
        if (remainingExtra.length > 0) {
          return remainingExtra[0] ?? null;
        }
      }

      if (options.repeat === "all") {
        const wrap = orderedQueue.find((id) => id !== options.currentId) ?? orderedQueue[0];
        return wrap ?? null;
      }

      return null;
    }

    if (list.length > 1) {
      const index = list.indexOf(options.currentId);
      let candidate = Math.floor(rand() * list.length);
      if (candidate === index) {
        candidate = (index + 1) % list.length;
      }
      return list[candidate] ?? null;
    }

    if (options.autoplay && extraPool.length > 0) {
      return extraPool[Math.floor(rand() * extraPool.length)] ?? null;
    }

    return options.repeat === "all" ? (list[0] ?? null) : null;
  }

  const index = list.indexOf(options.currentId);
  const nextIndex = index < 0 ? 0 : index + 1;
  if (nextIndex < list.length) {
    return list[nextIndex] ?? null;
  }

  if (options.repeat === "all") {
    return list[0] ?? null;
  }

  if (options.autoplay && extraPool.length > 0) {
    const recentSet = new Set(options.recentIds ?? []);
    const freshTrack = extraPool.find((id) => !recentSet.has(id));
    return freshTrack ?? extraPool[0] ?? null;
  }

  return null;
}

export function computePreviousTrackId(options: {
  queueIds: readonly string[];
  tracks: readonly Track[];
  currentId: string;
  repeat: RepeatMode;
  currentTime: number;
  restartThresholdSeconds?: number;
  shuffle?: boolean;
  historyIds?: readonly string[];
  online?: boolean;
  downloadedIds?: ReadonlySet<string>;
}): { action: "restart" | "switch" | "none"; trackId: string | null } {
  const threshold = options.restartThresholdSeconds ?? 4;
  if (Number.isFinite(options.currentTime) && options.currentTime > threshold) {
    return { action: "restart", trackId: options.currentId };
  }

  const availability: TrackAvailabilityOptions = {
    online: options.online ?? true,
    downloadedIds: options.downloadedIds,
  };

  if (options.shuffle && options.historyIds?.length) {
    const trackMap = new Map(options.tracks.map((track) => [track.id, track]));
    for (let i = options.historyIds.length - 1; i >= 0; i -= 1) {
      const candidate = options.historyIds[i];
      if (candidate && candidate !== options.currentId && isTrackPlayable(trackMap.get(candidate), availability)) {
        return { action: "switch", trackId: candidate };
      }
    }
  }

  const list = resolvePlayableQueue(options.queueIds, options.tracks, options.currentId, availability);
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
