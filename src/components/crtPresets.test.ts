import test from "node:test";
import assert from "node:assert/strict";
import { getCrtPreset, parseHexColor, resolvePhosphorColor, stepSmoothValue } from "./crtPresets";

test("parseHexColor parses 3-digit and 6-digit hex colors and rejects invalid values", () => {
  assert.deepEqual(parseHexColor("#fff"), [1, 1, 1]);
  assert.deepEqual(parseHexColor("#000000"), [0, 0, 0]);
  const brass = parseHexColor("#c49e64");
  assert.ok(brass && Math.abs(brass[0] - 196 / 255) < 0.001);
  assert.equal(parseHexColor("transparent"), null);
  assert.equal(parseHexColor("rgb(1,2,3)"), null);
});

test("resolvePhosphorColor keeps champagne brass cohesive while subtly tinting from track accent", () => {
  assert.equal(resolvePhosphorColor(undefined, "#d4af72"), "#d4af72");
  const tinted = resolvePhosphorColor("#2d5241", "#d4af72");
  assert.match(tinted, /^#[0-9a-f]{6}$/i);
  assert.notEqual(tinted, "#2d5241");
  assert.notEqual(tinted, "#d4af72");
});

test("getCrtPreset produces high-resolution hero and stage presets scaled by playback state", () => {
  const heroIdle = getCrtPreset("hero", { isPlaying: false });
  const heroPlaying = getCrtPreset("hero", { isPlaying: true, trackAccent: "#8a633b" });
  assert.ok(heroIdle.columns >= 200);
  assert.ok(heroPlaying.speed > heroIdle.speed);
  assert.ok(heroPlaying.energy > heroIdle.energy);
  assert.ok(heroPlaying.brightness > heroIdle.brightness);

  const stage = getCrtPreset("stage", { isPlaying: true });
  assert.equal(stage.backgroundColor, "transparent");
  assert.ok(stage.bloom > heroIdle.bloom);
  assert.ok(stage.levels >= 6);
});

test("stepSmoothValue smoothly converges without overshooting target", () => {
  let val = 0.2;
  for (let i = 0; i < 20; i++) {
    val = stepSmoothValue(val, 1.0, 0.05, 0.25);
    assert.ok(val >= 0.2 && val <= 1.0);
  }
  assert.ok(val > 0.95);
});
