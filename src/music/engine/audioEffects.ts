/**
 * Clean-room Web Audio API 10-band BiquadFilterNode + Preamp graph controller.
 * Bound strictly to CORS-safe audio elements (offline blob, data URL, same-origin)
 * so external streams are never muted or broken.
 */

import { EQ_BAND_FREQUENCIES, type EqualizerState } from "./equalizer";

export type AudioEffectsRoutingStatus = {
  attached: boolean;
  processingActive: boolean;
  mode: "processed" | "bit-perfect" | "bypass-cors" | "unavailable";
  note: string;
};

type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function createAudioContextInstance(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export class AudioEffectsController {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private boundElement: HTMLAudioElement | null = null;
  private preampNode: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private lastState: EqualizerState | null = null;

  /**
   * Lazily initializes the AudioContext & filter chain for a CORS-safe
   * `<audio>` element. Calling this multiple times on the same element is a no-op.
   */
  ensureAttached(audioEl: HTMLAudioElement | null): boolean {
    if (!audioEl) return false;
    if (this.boundElement === audioEl && this.ctx && this.sourceNode) {
      return true;
    }
    if (this.boundElement && this.boundElement !== audioEl) {
      // An AudioElement can only be bound once; refuse rebinding a second element cleanly.
      return false;
    }

    const ctx = this.ctx ?? createAudioContextInstance();
    if (!ctx) return false;

    try {
      const source = ctx.createMediaElementSource(audioEl);
      const preamp = ctx.createGain();
      const filters = EQ_BAND_FREQUENCIES.map((freq, index) => {
        const filter = ctx.createBiquadFilter();
        filter.frequency.value = freq;
        if (index === 0) {
          filter.type = "lowshelf";
        } else if (index === EQ_BAND_FREQUENCIES.length - 1) {
          filter.type = "highshelf";
        } else {
          filter.type = "peaking";
          filter.Q.value = 1.4;
        }
        filter.gain.value = 0;
        return filter;
      });

      let node: AudioNode = source;
      node.connect(preamp);
      node = preamp;
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(ctx.destination);

      this.ctx = ctx;
      this.sourceNode = source;
      this.boundElement = audioEl;
      this.preampNode = preamp;
      this.filters = filters;

      if (this.lastState) {
        this.applyEqualizer(this.lastState);
      }
      return true;
    } catch {
      return false;
    }
  }

  async resumeIfNeeded(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // Autoplay restriction — resumed on next user gesture.
      }
    }
  }

  applyEqualizer(state: EqualizerState): void {
    this.lastState = state;
    if (!this.ctx || !this.preampNode || this.filters.length !== EQ_BAND_FREQUENCIES.length) {
      return;
    }
    const now = this.ctx.currentTime;
    const bypassed = state.bitPerfectBypass || !state.enabled;

    const linearPreamp = bypassed ? 1 : Math.pow(10, state.preampDb / 20);
    this.preampNode.gain.setTargetAtTime(linearPreamp, now, 0.02);

    this.filters.forEach((filter, idx) => {
      const targetDb = bypassed ? 0 : (state.bandsDb[idx] ?? 0);
      filter.gain.setTargetAtTime(targetDb, now, 0.02);
    });
  }

  dispose(): void {
    try {
      this.sourceNode?.disconnect();
      this.preampNode?.disconnect();
      this.filters.forEach((filter) => filter.disconnect());
      if (this.ctx && this.ctx.state !== "closed") {
        void this.ctx.close();
      }
    } catch {
      // Ignore cleanup errors on unmount.
    }
    this.ctx = null;
    this.sourceNode = null;
    this.preampNode = null;
    this.filters = [];
    this.boundElement = null;
  }
}
