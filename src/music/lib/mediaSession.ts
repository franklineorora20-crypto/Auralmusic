/**
 * Media Session API integration for lock-screen and notification controls on
 * mobile phones (iOS / Android) and desktop OS media overlays.
 */

import type { Track } from "../../types";
import { isDisplayableImageUrl } from "./mediaMetadata";

export type MediaArtworkEntry = {
  src: string;
  sizes?: string;
  type?: string;
};

export type MediaMetadataDescriptor = {
  title: string;
  artist: string;
  album: string;
  artwork: MediaArtworkEntry[];
};

export type MediaSessionHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeekTo?: (seconds: number) => void;
  onSeekBackward?: (offsetSeconds: number) => void;
  onSeekForward?: (offsetSeconds: number) => void;
  onStop?: () => void;
};

function resolveAppAsset(path: string, origin?: string): string {
  if (!origin) return path;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export function buildMediaMetadataInit(track: Track, origin?: string): MediaMetadataDescriptor {
  const artwork: MediaArtworkEntry[] = [];
  if (isDisplayableImageUrl(track.artwork)) {
    artwork.push({ src: track.artwork, sizes: "512x512" });
  }
  if (isDisplayableImageUrl(track.artworkSmall) && track.artworkSmall !== track.artwork) {
    artwork.push({ src: track.artworkSmall, sizes: "192x192" });
  }
  if (!artwork.length) {
    artwork.push(
      { src: resolveAppAsset("/pwa-512x512.png", origin), sizes: "512x512", type: "image/png" },
      { src: resolveAppAsset("/pwa-192x192.png", origin), sizes: "192x192", type: "image/png" },
    );
  }

  return {
    title: track.title || "Aural",
    artist: track.artist || "Unknown artist",
    album: track.album && track.album !== "Single" ? track.album : "Aural",
    artwork,
  };
}

export function clampPositionState(
  duration: number,
  position: number,
): { duration: number; playbackRate: number; position: number } | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const safePosition = Number.isFinite(position) ? Math.max(0, Math.min(duration, position)) : 0;
  return {
    duration,
    playbackRate: 1,
    position: safePosition,
  };
}

export function syncMediaSessionMetadata(track: Track | undefined): void {
  if (!track || typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") {
    return;
  }
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    navigator.mediaSession.metadata = new MediaMetadata(buildMediaMetadataInit(track, origin));
  } catch {
    // Some browsers reject uncommon artwork schemes; ignore safely.
  }
}

export function syncMediaSessionPlaybackState(isPlaying: boolean): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  } catch {
    // Ignore unsupported playbackState environments.
  }
}

export function syncMediaSessionPosition(duration: number, position: number): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  const state = clampPositionState(duration, position);
  if (!state) return;
  try {
    navigator.mediaSession.setPositionState(state);
  } catch {
    // Ignore transient duration mismatches during track switching.
  }
}

export function registerMediaSessionHandlers(handlers: MediaSessionHandlers): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => undefined;
  }
  const session = navigator.mediaSession;
  const registered: MediaSessionAction[] = [];

  const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      session.setActionHandler(action, handler);
      registered.push(action);
    } catch {
      // Action not supported in this browser.
    }
  };

  bind("play", () => handlers.onPlay());
  bind("pause", () => handlers.onPause());
  bind("nexttrack", () => handlers.onNextTrack());
  bind("previoustrack", () => handlers.onPreviousTrack());

  if (handlers.onSeekTo) {
    bind("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        handlers.onSeekTo?.(details.seekTime);
      }
    });
  }
  if (handlers.onSeekBackward) {
    bind("seekbackward", (details) => {
      handlers.onSeekBackward?.(details.seekOffset ?? 10);
    });
  }
  if (handlers.onSeekForward) {
    bind("seekforward", (details) => {
      handlers.onSeekForward?.(details.seekOffset ?? 10);
    });
  }
  if (handlers.onStop) {
    bind("stop", () => handlers.onStop?.());
  }

  return () => {
    for (const action of registered) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Ignore cleanup errors.
      }
    }
  };
}
