/**
 * Device permissions, OS audio-session priority, Screen Wake Lock, persistent
 * storage, and silent Web Audio transition keep-alive so mobile OSes (iOS /
 * Android) do not suspend playback or dismiss the home-screen / lock-screen
 * media player when switching tracks with Next / Previous.
 */

export type PermissionStatusValue = "granted" | "prompt" | "denied" | "unsupported";

export interface DevicePermissionsSnapshot {
  audioSession: "playback" | "unsupported";
  mediaSession: "active" | "unsupported";
  persistentStorage: PermissionStatusValue;
  notifications: PermissionStatusValue;
  wakeLockSupported: boolean;
  wakeLockEnabled: boolean;
  wakeLockActive: boolean;
  keepAliveActive: boolean;
}

type AudioSessionLike = {
  type?: string;
};

type NavigatorWithAudioSession = Navigator & {
  audioSession?: AudioSessionLike;
};

export function isAudioAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function shouldHoldWakeLock(isPlaying: boolean, wakeLockEnabled: boolean): boolean {
  return Boolean(isPlaying && wakeLockEnabled);
}

export function getAudioSessionSupport(): "playback" | "unsupported" {
  if (typeof navigator === "undefined") return "unsupported";
  const nav = navigator as NavigatorWithAudioSession;
  return nav.audioSession ? "playback" : "unsupported";
}

/**
 * Marks the browser audio session as dedicated media playback (iOS 16.4+ /
 * Safari 17+ / supporting WebKit PWAs) so lock-screen controls stay visible
 * and background playback is prioritised.
 */
export function ensurePlaybackAudioSession(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithAudioSession;
  if (!nav.audioSession) return false;
  try {
    if (nav.audioSession.type !== "playback") {
      nav.audioSession.type = "playback";
    }
    return true;
  } catch {
    return false;
  }
}

export function getNotificationPermissionStatus(): PermissionStatusValue {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  const perm = Notification.permission;
  if (perm === "granted") return "granted";
  if (perm === "denied") return "denied";
  return "prompt";
}

export async function getPersistentStorageStatus(): Promise<PermissionStatusValue> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
    return "unsupported";
  }
  try {
    const persisted = await navigator.storage.persisted();
    return persisted ? "granted" : "prompt";
  } catch {
    return "unsupported";
  }
}

export async function requestPersistentStoragePermission(): Promise<PermissionStatusValue> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return "unsupported";
  }
  try {
    const granted = await navigator.storage.persist();
    return granted ? "granted" : "prompt";
  } catch {
    return "unsupported";
  }
}

export async function requestNotificationPermission(): Promise<PermissionStatusValue> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") return "granted";
    if (result === "denied") return "denied";
    return "prompt";
  } catch {
    return getNotificationPermissionStatus();
  }
}

/**
 * Silent Web Audio keep-alive bridge.
 *
 * When the <audio> element swaps `src` on Next/Previous in the background,
 * there is a network buffering gap with zero media frames. Running an
 * inaudible, ultra-low-level AudioContext keeps the OS audio pipeline alive
 * across track transitions so iOS/Android do not tear down the home-screen
 * player before the next stream starts playing.
 */
class BackgroundAudioBridge {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private active = false;

  get isActive(): boolean {
    return this.active && this.context?.state === "running";
  }

  async start(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioCtx();
      }
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      if (!this.source && this.context.state === "running") {
        const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const gain = this.context.createGain();
        gain.gain.value = 0.00001;

        source.connect(gain);
        gain.connect(this.context.destination);
        source.start(0);

        this.source = source;
        this.gain = gain;
      }
      this.active = this.context.state === "running";
      return this.active;
    } catch {
      this.active = false;
      return false;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    try {
      this.source?.stop();
    } catch {
      // Ignore already-stopped source.
    }
    try {
      this.source?.disconnect();
      this.gain?.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
    this.source = null;
    this.gain = null;
    if (this.context && this.context.state === "running") {
      try {
        await this.context.suspend();
      } catch {
        // Ignore suspend errors.
      }
    }
  }
}

export const backgroundAudioBridge = new BackgroundAudioBridge();

class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;

  get isSupported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  get isActive(): boolean {
    return Boolean(this.sentinel && !this.sentinel.released);
  }

  async acquire(): Promise<boolean> {
    if (!this.isSupported) return false;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return false;
    }
    if (this.sentinel && !this.sentinel.released) return true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    const current = this.sentinel;
    this.sentinel = null;
    if (!current) return;
    try {
      await current.release();
    } catch {
      // Ignore already-released sentinel.
    }
  }
}

export const wakeLockController = new WakeLockController();

export async function readDevicePermissionsSnapshot(
  wakeLockEnabled: boolean,
): Promise<DevicePermissionsSnapshot> {
  const persistentStorage = await getPersistentStorageStatus();
  return {
    audioSession: getAudioSessionSupport(),
    mediaSession:
      typeof navigator !== "undefined" && "mediaSession" in navigator ? "active" : "unsupported",
    persistentStorage,
    notifications: getNotificationPermissionStatus(),
    wakeLockSupported: wakeLockController.isSupported,
    wakeLockEnabled,
    wakeLockActive: wakeLockController.isActive,
    keepAliveActive: backgroundAudioBridge.isActive,
  };
}

export function countGrantedDevicePermissions(snapshot: DevicePermissionsSnapshot): {
  granted: number;
  total: number;
} {
  let granted = 0;
  let total = 0;

  if (snapshot.mediaSession !== "unsupported") {
    total += 1;
    if (snapshot.mediaSession === "active") granted += 1;
  }
  if (snapshot.audioSession !== "unsupported") {
    total += 1;
    if (snapshot.audioSession === "playback") granted += 1;
  }
  if (snapshot.persistentStorage !== "unsupported") {
    total += 1;
    if (snapshot.persistentStorage === "granted") granted += 1;
  }
  if (snapshot.notifications !== "unsupported") {
    total += 1;
    if (snapshot.notifications === "granted") granted += 1;
  }
  if (snapshot.wakeLockSupported) {
    total += 1;
    if (snapshot.wakeLockEnabled) granted += 1;
  }

  return { granted, total };
}
