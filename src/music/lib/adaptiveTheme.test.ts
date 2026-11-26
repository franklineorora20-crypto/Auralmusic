import test from "node:test";
import assert from "node:assert/strict";
import { computeAdaptivePaletteFromPixels, derivePaletteFromHex } from "./adaptiveTheme";

test("derivePaletteFromHex yields valid hex colors on dark glass surface", () => {
  const palette = derivePaletteFromHex("#5b7c65");
  assert.equal(palette.source, "accent-fallback");
  assert.match(palette.accent, /^#[0-9a-f]{6}$/i);
  assert.match(palette.glow, /^#[0-9a-f]{6}$/i);
  assert.match(palette.surfaceTint, /^#[0-9a-f]{6}$/i);
});

test("computeAdaptivePaletteFromPixels extracts dominant vibrant hue from pixel buffers", () => {
  // 4 opaque warm crimson/amber pixels + 1 transparent pixel
  const pixels = [
    220, 70, 50, 255,
    210, 60, 45, 255,
    230, 80, 55, 255,
    10, 10, 10, 255, // near-black ignored
    0, 0, 255, 0, // transparent ignored
  ];
  const palette = computeAdaptivePaletteFromPixels(pixels, "#5b7c65");
  assert.equal(palette.source, "artwork");
  assert.match(palette.accent, /^#[0-9a-f]{6}$/i);
  // Dominant red channel should outweigh blue in extracted accent
  const r = Number.parseInt(palette.accent.slice(1, 3), 16);
  const b = Number.parseInt(palette.accent.slice(5, 7), 16);
  assert.ok(r > b);
});
