/**
 * Clean-room adaptive artwork palette & contrast calculation.
 * Derives rich ambient glow colors from a track's artwork pixels (when CORS allows)
 * or deterministically from the track's accent hex fallback.
 */

export type AdaptivePalette = {
  accent: string;
  glow: string;
  secondary: string;
  surfaceTint: string;
  source: "artwork" | "accent-fallback";
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16);
    const g = Number.parseInt(clean[1] + clean[1], 16);
    const b = Number.parseInt(clean[2] + clean[2], 16);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b];
    return null;
  }
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b];
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, h) * 255),
    clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Ensures extracted accent colors sit within a dark-surface readable lightness
 * range so glass glow layers and badges retain visual contrast on Aural's `#100f0d` canvas.
 */
function tuneRgbForDarkGlass(r: number, g: number, b: number, targetLightness: number, minSaturation = 0.28): string {
  const [h, s] = rgbToHsl(r, g, b);
  const tunedS = Math.max(minSaturation, Math.min(0.84, s));
  const [nr, ng, nb] = hslToRgb(h, tunedS, targetLightness);
  return rgbToHex(nr, ng, nb);
}

export function derivePaletteFromHex(fallbackHex: string): AdaptivePalette {
  const parsed = parseHexColor(fallbackHex) ?? [196, 158, 100];
  const [h, s] = rgbToHsl(parsed[0], parsed[1], parsed[2]);
  const accent = tuneRgbForDarkGlass(parsed[0], parsed[1], parsed[2], 0.58, 0.3);
  const glow = tuneRgbForDarkGlass(parsed[0], parsed[1], parsed[2], 0.44, 0.35);
  const [sr, sg, sb] = hslToRgb((h + 0.08) % 1, Math.max(0.25, s * 0.9), 0.5);
  const secondary = rgbToHex(sr, sg, sb);
  const [tr, tg, tb] = hslToRgb(h, Math.max(0.2, s * 0.6), 0.16);
  const surfaceTint = rgbToHex(tr, tg, tb);
  return {
    accent,
    glow,
    secondary,
    surfaceTint,
    source: "accent-fallback",
  };
}

/**
 * Quantizes an RGBA pixel buffer (e.g., 24x24 downscaled canvas) into dominant
 * vibrant accent, secondary harmonic tint, and dark glass surface tint.
 */
export function computeAdaptivePaletteFromPixels(
  pixels: Uint8ClampedArray | number[],
  fallbackHex = "#c49e64",
): AdaptivePalette {
  if (!pixels || pixels.length < 4) {
    return derivePaletteFromHex(fallbackHex);
  }

  // 12 hue buckets weighted by saturation & mid-tone luminance to ignore pure black/white borders
  const buckets = Array.from({ length: 12 }, () => ({
    weight: 0,
    rSum: 0,
    gSum: 0,
    bSum: 0,
  }));

  let totalVisible = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    totalVisible += 1;
    // Down-weight near-black or near-white neutral pixels
    if (l < 0.08 || l > 0.94) continue;
    const chromaWeight = 0.25 + s * 2.2;
    const midWeight = 1 - Math.abs(l - 0.52);
    const weight = chromaWeight * Math.max(0.2, midWeight);
    const bucketIdx = Math.min(11, Math.floor(h * 12));
    buckets[bucketIdx].weight += weight;
    buckets[bucketIdx].rSum += r * weight;
    buckets[bucketIdx].gSum += g * weight;
    buckets[bucketIdx].bSum += b * weight;
  }

  const ranked = buckets
    .map((bucket, idx) => ({ ...bucket, idx }))
    .filter((bucket) => bucket.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (!totalVisible || ranked.length === 0) {
    return derivePaletteFromHex(fallbackHex);
  }

  const primary = ranked[0];
  const pr = primary.rSum / primary.weight;
  const pg = primary.gSum / primary.weight;
  const pb = primary.bSum / primary.weight;

  const secondaryBucket = ranked.find((b) => Math.abs(b.idx - primary.idx) >= 2) ?? primary;
  const sr = secondaryBucket.rSum / secondaryBucket.weight;
  const sg = secondaryBucket.gSum / secondaryBucket.weight;
  const sb = secondaryBucket.bSum / secondaryBucket.weight;

  const [ph, ps] = rgbToHsl(pr, pg, pb);
  const [tr, tg, tb] = hslToRgb(ph, Math.max(0.18, ps * 0.58), 0.14);

  return {
    accent: tuneRgbForDarkGlass(pr, pg, pb, 0.58, 0.28),
    glow: tuneRgbForDarkGlass(pr, pg, pb, 0.44, 0.34),
    secondary: tuneRgbForDarkGlass(sr, sg, sb, 0.52, 0.24),
    surfaceTint: rgbToHex(tr, tg, tb),
    source: "artwork",
  };
}

const paletteCache = new Map<string, AdaptivePalette>();

/**
 * Loads an artwork URL on an offscreen `<img crossOrigin="anonymous">` to sample
 * pixels cleanly without interfering with visible artwork or failing on non-CORS CDNs.
 */
export async function extractPaletteFromArtworkUrl(
  artworkUrl: string,
  fallbackHex: string,
): Promise<AdaptivePalette> {
  const trimmed = artworkUrl.trim();
  const fallback = derivePaletteFromHex(fallbackHex);
  if (!trimmed || trimmed.startsWith("linear-gradient") || typeof document === "undefined") {
    return fallback;
  }
  const cacheKey = `${trimmed}::${fallbackHex}`;
  const cached = paletteCache.get(cacheKey);
  if (cached) return cached;

  const resolved = await new Promise<AdaptivePalette>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = window.setTimeout(() => resolve(fallback), 3500);
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        resolve(computeAdaptivePaletteFromPixels(data, fallbackHex));
      } catch {
        // SecurityError when remote CDN omits Access-Control-Allow-Origin: *
        resolve(fallback);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(fallback);
    };
    img.src = trimmed;
  });

  paletteCache.set(cacheKey, resolved);
  return resolved;
}
