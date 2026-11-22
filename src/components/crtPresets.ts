export type CrtPresetMode = "hero" | "stage";

export type CrtPresetConfig = {
  color: string;
  backgroundColor: string;
  speed: number;
  energy: number;
  contour: number;
  waveAmplitude: number;
  waveFrequency: number;
  levels: number;
  columns: number;
  persistence: number;
  curvature: number;
  corners: number;
  scanlineStrength: number;
  scanlineFrequency: number;
  mask: "none" | "aperture" | "shadow" | "slot";
  maskStrength: number;
  bloom: number;
  bloomRadius: number;
  noise: number;
  flicker: number;
  interference: number;
  vignette: number;
  rgbShift: number;
  brightness: number;
  dpr: number;
  fps: number;
};

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepSmoothValue(current: number, target: number, dt: number, tau = 0.28): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const factor = 1 - Math.exp(-dt / Math.max(0.01, tau));
  return current + (target - current) * factor;
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3 && /^[0-9a-f]{3}$/i.test(clean)) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return [r, g, b];
  }
  if (clean.length === 6 && /^[0-9a-f]{6}$/i.test(clean)) {
    const num = parseInt(clean, 16);
    return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
  }
  return null;
}

/**
 * Blend a subtle warm champagne brass baseline with a track's heritage accent so
 * the phosphor never shifts into garish neon while subtly echoing the track mood.
 */
export function resolvePhosphorColor(accent?: string, baseHex = "#d4af72"): string {
  const base = parseHexColor(baseHex);
  const track = accent ? parseHexColor(accent) : null;
  if (!base || !track) return baseHex;
  const mix = (a: number, b: number, weight: number) => Math.round(clampNumber(a * (1 - weight) + b * weight, 0, 1) * 255);
  const r = mix(base[0], track[0], 0.18).toString(16).padStart(2, "0");
  const g = mix(base[1], track[1], 0.18).toString(16).padStart(2, "0");
  const b = mix(base[2], track[2], 0.18).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

export function getCrtPreset(
  mode: CrtPresetMode,
  options: { isPlaying: boolean; trackAccent?: string }
): CrtPresetConfig {
  const { isPlaying, trackAccent } = options;

  if (mode === "stage") {
    return {
      color: resolvePhosphorColor(trackAccent, "#d9b77c"),
      backgroundColor: "transparent",
      speed: isPlaying ? 0.36 : 0.14,
      energy: isPlaying ? 0.92 : 0.35,
      contour: 0.88,
      waveAmplitude: 0.25,
      waveFrequency: 1.85,
      levels: 6,
      columns: 224,
      persistence: 0.45,
      curvature: 0.16,
      corners: 0.08,
      scanlineStrength: 0.22,
      scanlineFrequency: 240,
      mask: "aperture",
      maskStrength: 0.08,
      bloom: isPlaying ? 1.45 : 1.05,
      bloomRadius: 1.45,
      noise: 0.025,
      flicker: 0.03,
      interference: 0.04,
      vignette: 0.55,
      rgbShift: 0.0005,
      brightness: isPlaying ? 1.02 : 0.76,
      dpr: 1.5,
      fps: 45,
    };
  }

  return {
    color: resolvePhosphorColor(trackAccent, "#d4af72"),
    backgroundColor: "#141210",
    speed: isPlaying ? 0.42 : 0.18,
    energy: isPlaying ? 0.88 : 0.4,
    contour: 0.84,
    waveAmplitude: 0.22,
    waveFrequency: 1.65,
    levels: 6,
    columns: 210,
    persistence: 0.42,
    curvature: 0.12,
    corners: 0.04,
    scanlineStrength: 0.2,
    scanlineFrequency: 210,
    mask: "aperture",
    maskStrength: 0.08,
    bloom: isPlaying ? 1.35 : 1.0,
    bloomRadius: 1.35,
    noise: 0.02,
    flicker: 0.025,
    interference: 0.035,
    vignette: 0.4,
    rgbShift: 0.0004,
    brightness: isPlaying ? 1.0 : 0.82,
    dpr: 1.5,
    fps: 45,
  };
}
