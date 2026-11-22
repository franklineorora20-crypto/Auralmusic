/**
 * The single audio engine for the whole application.
 *
 * Exactly one <audio> element is created for the lifetime of the page and it is
 * appended (hidden) to the document, so playback survives navigation between
 * pages and React never re-creates it on render. Components subscribe to this
 * store instead of owning media elements of their own.
 */

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type EngineSnapshot = {
  /** The track id the element is currently bound to. */
  trackId: string | null;
  status: PlaybackStatus;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  /** True while the browser is buffering after a stall. */
  buffering: boolean;
};

const INITIAL: EngineSnapshot = {
  trackId: null,
  status: "idle",
  position: 0,
  duration: 0,
  volume: 0.75,
  muted: false,
  error: null,
  buffering: false,
};

type Listener = () => void;

function errorMessageFor(media: HTMLMediaElement): string {
  const code = media.error?.code;
  switch (code) {
    case 1:
      return "Playback was aborted.";
    case 2:
      return "A network error interrupted playback.";
    case 3:
      return "This audio file could not be decoded.";
    case 4:
      return navigator.onLine
        ? "This track's audio is unavailable from the provider."
        : "This track is not stored for offline playback.";
    default:
      return navigator.onLine
        ? "This audio could not be loaded."
        : "This track is not stored for offline playback.";
  }
}

class AudioEngine {
  private element: HTMLAudioElement | null = null;
  private snapshot: EngineSnapshot = INITIAL;
  private readonly listeners = new Set<Listener>();
  private endedListeners = new Set<() => void>();
  private errorListeners = new Set<(message: string) => void>();

  getSnapshot = (): EngineSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onEnded = (listener: () => void): (() => void) => {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  };

  onError = (listener: (message: string) => void): (() => void) => {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  };

  /** Lazily create the one media element, attached to the document body. */
  private ensureElement(): HTMLAudioElement {
    if (this.element) return this.element;
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.setAttribute("data-audio-engine", "music");
    audio.style.display = "none";
    audio.volume = this.snapshot.volume;
    this.attachEvents(audio);
    document.body.appendChild(audio);
    this.element = audio;
    return audio;
  }

  private attachEvents(audio: HTMLAudioElement): void {
    audio.addEventListener("loadedmetadata", () => {
      this.patch({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        buffering: false,
      });
    });
    audio.addEventListener("timeupdate", () => {
      this.patch({ position: audio.currentTime });
    });
    audio.addEventListener("play", () => {
      this.patch({ status: "playing", error: null, buffering: false });
    });
    audio.addEventListener("playing", () => {
      this.patch({ status: "playing", error: null, buffering: false });
    });
    audio.addEventListener("pause", () => {
      // Ignore the pause fired while swapping sources.
      if (audio.ended) return;
      this.patch({ status: audio.currentTime > 0 ? "paused" : "idle" });
    });
    audio.addEventListener("waiting", () => this.patch({ buffering: true }));
    audio.addEventListener("canplay", () => this.patch({ buffering: false }));
    audio.addEventListener("volumechange", () => {
      this.patch({ volume: audio.volume, muted: audio.muted });
    });
    audio.addEventListener("ended", () => {
      this.patch({ status: "paused", position: audio.duration || 0 });
      this.endedListeners.forEach((listener) => listener());
    });
    audio.addEventListener("error", () => {
      const message = errorMessageFor(audio);
      this.patch({ status: "error", error: message, buffering: false });
      this.errorListeners.forEach((listener) => listener(message));
    });
  }

  private patch(changes: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  /** Bind a new source without starting playback. */
  load(source: string, trackId: string): void {
    const audio = this.ensureElement();
    if (this.snapshot.trackId === trackId && audio.currentSrc === source) return;
    audio.pause();
    this.patch({ trackId, position: 0, duration: 0, error: null, status: "loading", buffering: false });
    audio.src = source;
    audio.load();
  }

  /**
   * Play the bound source. The intent is reflected immediately so the UI can
   * show the playing state while the media element buffers; any real failure
   * arrives through the error listeners.
   */
  async play(): Promise<void> {
    const audio = this.ensureElement();
    if (!audio.currentSrc) {
      this.patch({ status: "error", error: "No audio source is loaded." });
      return;
    }
    try {
      await audio.play();
      this.patch({ status: "playing", error: null });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Press play to allow audio in this browser."
        : navigator.onLine
          ? "This track could not start playing."
          : "This track is not stored for offline playback.";
      this.patch({ status: "error", error: message });
      this.errorListeners.forEach((listener) => listener(message));
    }
  }

  pause(): void {
    this.element?.pause();
    if (this.snapshot.status === "playing" || this.snapshot.status === "loading") {
      this.patch({ status: "paused" });
    }
  }

  async toggle(): Promise<void> {
    const audio = this.ensureElement();
    if (audio.paused) await this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    const audio = this.ensureElement();
    const bounded = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, audio.duration || seconds)) : 0;
    try {
      audio.currentTime = bounded;
      this.patch({ position: bounded });
    } catch {
      // Seeking before metadata is available is safe to ignore.
    }
  }

  setVolume(value: number): void {
    const volume = Math.max(0, Math.min(1, value));
    const audio = this.ensureElement();
    audio.volume = volume;
    audio.muted = volume === 0;
    this.patch({ volume, muted: audio.muted });
  }

  setMuted(muted: boolean): void {
    const audio = this.ensureElement();
    audio.muted = muted;
    this.patch({ muted });
  }

  get currentSource(): string {
    return this.element?.currentSrc ?? "";
  }

  /** Release the current source (used when its offline copy is deleted). */
  unload(): void {
    if (!this.element) return;
    this.element.pause();
    this.element.removeAttribute("src");
    this.element.load();
    this.patch({ trackId: null, status: "idle", position: 0, duration: 0, error: null });
  }
}

export const audioEngine = new AudioEngine();
export type { AudioEngine };
