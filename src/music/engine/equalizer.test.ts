import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EQUALIZER_STATE,
  EQ_BAND_FREQUENCIES,
  applyPresetToState,
  clampGainDb,
  isStreamCorsWebAudioSafe,
  normalizeEqualizerState,
  updateBandGain,
} from "./equalizer";

test("clampGainDb and normalizeEqualizerState bound 10 bands cleanly", () => {
  assert.equal(clampGainDb(24), 12);
  assert.equal(clampGainDb(-18), -12);
  assert.equal(clampGainDb(Number.NaN), 0);

  const normalized = normalizeEqualizerState({
    presetId: "custom",
    preampDb: 20,
    bandsDb: [15, -20, 3.25],
    bitPerfectBypass: true,
  });

  assert.equal(normalized.bandsDb.length, EQ_BAND_FREQUENCIES.length);
  assert.equal(normalized.preampDb, 12);
  assert.equal(normalized.bandsDb[0], 12);
  assert.equal(normalized.bandsDb[1], -12);
  assert.equal(normalized.bandsDb[2], 3.3);
  assert.equal(normalized.bandsDb[9], 0);
  assert.equal(normalized.bitPerfectBypass, true);
});

test("applyPresetToState and updateBandGain update EQ cleanly", () => {
  const bass = applyPresetToState(DEFAULT_EQUALIZER_STATE, "bass-boost");
  assert.equal(bass.presetId, "bass-boost");
  assert.equal(bass.bitPerfectBypass, false);
  assert.ok(bass.bandsDb[0] > 4);

  const custom = updateBandGain(bass, 5, 6.4);
  assert.equal(custom.presetId, "custom");
  assert.equal(custom.bandsDb[5], 6.4);
});

test("isStreamCorsWebAudioSafe protects cross-origin streams while enabling local/same-origin EQ", () => {
  assert.deepEqual(isStreamCorsWebAudioSafe("blob:http://localhost:3000/123", "http://localhost:3000"), {
    eligible: true,
    reason: "offline-blob",
  });
  assert.deepEqual(isStreamCorsWebAudioSafe("data:audio/mpeg;base64,AAA", "http://localhost:3000"), {
    eligible: true,
    reason: "data-url",
  });
  assert.deepEqual(isStreamCorsWebAudioSafe("/api/ytdlp/audio/123", "http://localhost:3000"), {
    eligible: true,
    reason: "same-origin",
  });
  assert.deepEqual(isStreamCorsWebAudioSafe("https://archive.org/download/item/song.mp3", "http://localhost:3000"), {
    eligible: false,
    reason: "cross-origin-bypass",
  });
});
