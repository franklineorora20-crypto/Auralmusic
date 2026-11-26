/**
 * Clean-room playback controls & transition intelligence:
 * - Crossfade duration & curve math (`equal-power`, `smooth`, `linear`)
 * - Intelligent Automix candidate scoring (genre/tag/artist/duration continuity)
 * - Sleep timer presets & end-of-track pause policy
 * - Playback speed clamping & pitch-preservation settings
 */

import type { Track } from "../../types";
import { isTrackPlayable, type TrackAvailabilityOptions } from "./playbackQueue";

/* -------------------------------------------------------------------------- */
/* Crossfade & Smooth Transitions                                             */
/* -------------------------------------------------------------------------- */

export type CrossfadeCurve = "equal-power" | "smooth" | "linear";

export type CrossfadeSettings = {
  enabled: boolean;
  durationSeconds: number; // 2..12 seconds
  curve: CrossfadeCurve;
};

export const DEFAULT_CROSSFADE_SETTINGS: CrossfadeSettings = {
  enabled: false,
  durationSeconds: 6,
  curve: "equal-power",
};

export function clampCrossfadeDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 6;
  return Math.max(2, Math.min(12, Math.round(seconds)));
}

/**
 * Computes normalized `(outgoing, incoming)` gains in `[0, 1]` for crossfade
 * progress `t` in `[0, 1]`.
 */
export function computeCrossfadeGains(
  progress: number,
  curve: CrossfadeCurve = "equal-power",
): { outgoing: number; incoming: number } {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (curve === "linear") {
    return { outgoing: 1 - t, incoming: t };
  }
  if (curve === "smooth") {
    // Cosine S-curve
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
    return { outgoing: 1 - eased, incoming: eased };
  }
  // Equal-power sinusoidal curve keeps perceived loudness steady at mid-point
  return {
    outgoing: Math.cos((t * Math.PI) / 2),
    incoming: Math.sin((t * Math.PI) / 2),
  };
}

/* -------------------------------------------------------------------------- */
/* Intelligent Automix                                                        */
/* -------------------------------------------------------------------------- */

export type AutomixSuggestion = {
  track: Track;
  score: number;
  reason: string;
  recommendedFadeSeconds: number;
};

function normalizedTokens(track: Track): Set<string> {
  const tokens = new Set<string>();
  const parts = [track.genre, ...(track.tags ?? [])]
    .join(",")
    .toLowerCase()
    .split(/[\s,/&]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s !== "other" && s !== "imported");
  for (const part of parts) tokens.add(part);
  return tokens;
}

/**
 * Selects the best next track for Intelligent Automix based on musical
 * continuity (genre/tag overlap, artist affinity without monotonous repeats,
 * compatible duration pacing, and offline/streaming availability).
 */
export function pickAutomixNextTrack(options: {
  currentTrack: Track;
  candidates: readonly Track[];
  recentIds?: readonly string[];
  excludeIds?: ReadonlySet<string>;
  availability?: TrackAvailabilityOptions;
}): AutomixSuggestion | null {
  const { currentTrack, candidates, recentIds = [], excludeIds, availability } = options;
  const currentTokens = normalizedTokens(currentTrack);
  const recentWindow = new Set(recentIds.slice(0, 6));
  const currentArtist = currentTrack.artist.trim().toLowerCase();

  const pool = candidates.filter((candidate) => {
    if (!candidate || candidate.id === currentTrack.id) return false;
    if (excludeIds?.has(candidate.id)) return false;
    return isTrackPlayable(candidate, availability);
  });

  if (!pool.length) return null;

  let best: AutomixSuggestion | null = null;

  for (const candidate of pool) {
    let score = 0;
    const candidateTokens = normalizedTokens(candidate);
    const sharedTags: string[] = [];
    for (const token of candidateTokens) {
      if (currentTokens.has(token)) sharedTags.push(token);
    }

    score += sharedTags.length * 14;

    let reason = "Smooth catalog bridge";
    if (sharedTags.length > 0) {
      reason = `Matches ${sharedTags.slice(0, 2).join(" · ")} texture`;
    }

    const sameArtist = candidate.artist.trim().toLowerCase() === currentArtist && currentArtist !== "local library";
    if (sameArtist) {
      // Slight bonus when same artist, but lower than a rich multi-tag bridge so mixes vary naturally
      score += 6;
      if (sharedTags.length === 0) reason = `Continuity with ${candidate.artist}`;
    }

    if (
      currentTrack.album &&
      candidate.album &&
      currentTrack.album !== "Single" &&
      currentTrack.album !== "Imported" &&
      candidate.album === currentTrack.album
    ) {
      score += 10;
      if (sharedTags.length === 0) {
        reason = `From ${candidate.album}`;
      }
    }

    if (currentTrack.duration > 0 && candidate.duration > 0) {
      const diff = Math.abs(currentTrack.duration - candidate.duration);
      if (diff <= 35) score += 6;
      else if (diff <= 90) score += 3;
    }

    if (recentWindow.has(candidate.id)) {
      score -= 22;
    }

    if (candidate.downloaded || candidate.imported) {
      score += 2;
    }

    // Suggest tighter fades for upbeat genres, longer overlap for ambient/electronic
    const isLongAtmospheric =
      candidateTokens.has("ambient") ||
      candidateTokens.has("electronic") ||
      candidateTokens.has("chill") ||
      candidateTokens.has("drone");
    const recommendedFadeSeconds = isLongAtmospheric ? 8 : 5;

    if (!best || score > best.score || (score === best.score && candidate.title.localeCompare(best.track.title) < 0)) {
      best = { track: candidate, score, reason, recommendedFadeSeconds };
    }
  }

  return best;
}

/* -------------------------------------------------------------------------- */
/* Sleep Timer                                                                */
/* -------------------------------------------------------------------------- */

export type SleepTimerMode = "off" | "countdown" | "end-of-track";

export type SleepTimerState = {
  mode: SleepTimerMode;
  endsAt: number | null; // epoch ms when mode === "countdown"
  durationMinutes: number | null;
};

export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;

export function createOffSleepTimer(): SleepTimerState {
  return { mode: "off", endsAt: null, durationMinutes: null };
}

export function createCountdownSleepTimer(minutes: number, nowMs = Date.now()): SleepTimerState {
  const safeMinutes = Math.max(1, Math.min(240, Math.round(minutes)));
  return {
    mode: "countdown",
    endsAt: nowMs + safeMinutes * 60_000,
    durationMinutes: safeMinutes,
  };
}

export function createEndOfTrackSleepTimer(): SleepTimerState {
  return { mode: "end-of-track", endsAt: null, durationMinutes: null };
}

export function getSleepTimerRemainingMs(timer: SleepTimerState, nowMs = Date.now()): number {
  if (timer.mode !== "countdown" || timer.endsAt === null) return 0;
  return Math.max(0, timer.endsAt - nowMs);
}

export function formatSleepTimerRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Playback Speed                                                             */
/* -------------------------------------------------------------------------- */

export const PLAYBACK_SPEED_PRESETS = [0.75, 1, 1.15, 1.25, 1.5, 2] as const;

export function clampPlaybackSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.5, Math.min(2.0, Math.round(speed * 100) / 100));
}
