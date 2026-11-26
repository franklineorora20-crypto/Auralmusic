/**
 * Clean-room 10-band graphic/parametric equalizer state, presets, and
 * CORS compatibility rules for Web Audio processing.
 */

export const EQ_BAND_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_BAND_LABELS = ["32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"] as const;

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export type EqualizerPreset = {
  id: string;
  name: string;
  description: string;
  preampDb: number;
  bandsDb: number[]; // length 10 matching EQ_BAND_FREQUENCIES
};

export type EqualizerState = {
  enabled: boolean;
  bitPerfectBypass: boolean;
  presetId: string;
  preampDb: number;
  bandsDb: number[];
};

export const EQUALIZER_PRESETS: EqualizerPreset[] = [
  {
    id: "flat",
    name: "Flat",
    description: "Neutral studio reference with zero boost or cut",
    preampDb: 0,
    bandsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "acoustic",
    name: "Acoustic",
    description: "Natural string and body warmth with crisp air",
    preampDb: 0,
    bandsDb: [1.5, 1.5, 1, 0.5, 1.5, 2, 2.5, 3, 2.5, 1.5],
  },
  {
    id: "bass-boost",
    name: "Sub Bass",
    description: "Deep low-end weight without clouding midrange vocals",
    preampDb: -1.5,
    bandsDb: [5.5, 4.5, 3, 1.5, 0, -0.5, 0, 0.5, 1, 1],
  },
  {
    id: "vocal",
    name: "Vocal Clarity",
    description: "Forward midrange presence and gentle low-end trim",
    preampDb: -0.5,
    bandsDb: [-2, -1.5, -1, 0.5, 2.5, 4, 4, 2.5, 1, 0],
  },
  {
    id: "electronic",
    name: "Electronic",
    description: "Tight punchy lows and crystalline synth sparkle",
    preampDb: -1,
    bandsDb: [4, 3.5, 1.5, -0.5, -1.5, 0.5, 2, 3.5, 4.5, 3.5],
  },
  {
    id: "late-night",
    name: "Late Night",
    description: "Balanced low-volume listening curve",
    preampDb: 0,
    bandsDb: [2.5, 2, 1, 0, 0.5, 1.5, 2, 1.5, 0.5, -1],
  },
  {
    id: "jazz",
    name: "Jazz Club",
    description: "Warm upright bass with smooth brass presence",
    preampDb: -0.5,
    bandsDb: [2.5, 2, 1.5, 1, -0.5, 0.5, 2, 2.5, 2, 1.5],
  },
  {
    id: "studio-warmth",
    name: "Analog Warmth",
    description: "Gentle upper-treble roll-off with lush low-mid bloom",
    preampDb: 0,
    bandsDb: [2, 2.5, 2, 1.5, 0.5, 0, -0.5, -1, -2, -2.5],
  },
];

export const DEFAULT_EQUALIZER_STATE: EqualizerState = {
  enabled: true,
  bitPerfectBypass: false,
  presetId: "flat",
  preampDb: 0,
  bandsDb: [...EQUALIZER_PRESETS[0].bandsDb],
};

export function clampGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(value * 10) / 10));
}

export function getPresetById(id: string): EqualizerPreset | undefined {
  return EQUALIZER_PRESETS.find((preset) => preset.id === id);
}

export function normalizeEqualizerState(input: Partial<EqualizerState> | null | undefined): EqualizerState {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_EQUALIZER_STATE, bandsDb: [...DEFAULT_EQUALIZER_STATE.bandsDb] };
  }
  const bands = EQ_BAND_FREQUENCIES.map((_, idx) => clampGainDb(input.bandsDb?.[idx] ?? 0));
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    bitPerfectBypass: Boolean(input.bitPerfectBypass),
    presetId: typeof input.presetId === "string" && input.presetId.trim() ? input.presetId : "custom",
    preampDb: clampGainDb(input.preampDb ?? 0),
    bandsDb: bands,
  };
}

export function applyPresetToState(state: EqualizerState, presetId: string): EqualizerState {
  const preset = getPresetById(presetId);
  if (!preset) return state;
  return {
    ...state,
    enabled: true,
    bitPerfectBypass: false,
    presetId: preset.id,
    preampDb: preset.preampDb,
    bandsDb: [...preset.bandsDb],
  };
}

export function updateBandGain(state: EqualizerState, bandIndex: number, gainDb: number): EqualizerState {
  if (bandIndex < 0 || bandIndex >= EQ_BAND_FREQUENCIES.length) return state;
  const bandsDb = [...state.bandsDb];
  bandsDb[bandIndex] = clampGainDb(gainDb);
  return {
    ...state,
    enabled: true,
    bitPerfectBypass: false,
    presetId: "custom",
    bandsDb,
  };
}

export type WebAudioEligibility = {
  eligible: boolean;
  reason: "offline-blob" | "data-url" | "same-origin" | "cross-origin-bypass" | "empty";
};

/**
 * Determines whether a stream URL can be safely attached to a Web Audio API
 * `MediaElementAudioSourceNode` without risking silent audio output from strict
 * cross-origin CDN headers.
 */
export function isStreamCorsWebAudioSafe(streamUrl: string, appOrigin?: string): WebAudioEligibility {
  const trimmed = streamUrl.trim();
  if (!trimmed) return { eligible: false, reason: "empty" };
  if (trimmed.startsWith("blob:")) return { eligible: true, reason: "offline-blob" };
  if (trimmed.startsWith("data:")) return { eligible: true, reason: "data-url" };
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return { eligible: true, reason: "same-origin" };
  }
  try {
    const parsed = new URL(trimmed, appOrigin || "http://localhost:3000");
    if (appOrigin && parsed.origin === appOrigin) {
      return { eligible: true, reason: "same-origin" };
    }
  } catch {
    return { eligible: false, reason: "cross-origin-bypass" };
  }
  return { eligible: false, reason: "cross-origin-bypass" };
}
