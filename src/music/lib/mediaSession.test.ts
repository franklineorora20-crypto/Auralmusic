import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaMetadataInit, clampPositionState } from "./mediaSession";
import type { Track } from "../../types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "local-1",
    providerId: "local",
    providerName: "Local library",
    providerTrackId: "1",
    title: "Evening Bells",
    artist: "Harbour Trio",
    album: "Imported",
    artwork: "",
    artworkSmall: "",
    duration: 200,
    streamUrl: "blob:https://aural.test/track",
    genre: "Imported",
    tags: [],
    licensing: {
      name: "Local",
      streamingAllowed: true,
      downloadAllowed: true,
    },
    accent: "#c49e64",
    ...overrides,
  };
}

test("buildMediaMetadataInit uses track artwork when present and falls back to PWA icons", () => {
  const custom = buildMediaMetadataInit(
    makeTrack({ artwork: "data:image/jpeg;base64,AAAA", artworkSmall: "data:image/jpeg;base64,AAAA" }),
    "https://aural.app",
  );
  assert.equal(custom.title, "Evening Bells");
  assert.equal(custom.artist, "Harbour Trio");
  assert.equal(custom.album, "Imported");
  assert.deepEqual(custom.artwork, [{ src: "data:image/jpeg;base64,AAAA", sizes: "512x512" }]);

  const fallback = buildMediaMetadataInit(makeTrack({ album: "Single", artwork: "" }), "https://aural.app");
  assert.equal(fallback.album, "Aural");
  assert.deepEqual(fallback.artwork, [
    { src: "https://aural.app/pwa-512x512.png", sizes: "512x512", type: "image/png" },
    { src: "https://aural.app/pwa-192x192.png", sizes: "192x192", type: "image/png" },
  ]);
});

test("clampPositionState validates and bounds lock-screen scrubber state", () => {
  assert.equal(clampPositionState(0, 10), null);
  assert.equal(clampPositionState(Number.NaN, 5), null);
  assert.deepEqual(clampPositionState(180, -4), { duration: 180, playbackRate: 1, position: 0 });
  assert.deepEqual(clampPositionState(180, 240), { duration: 180, playbackRate: 1, position: 180 });
  assert.deepEqual(clampPositionState(180, 42.5), { duration: 180, playbackRate: 1, position: 42.5 });
});
