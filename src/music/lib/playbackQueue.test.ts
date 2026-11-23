import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNextTrackId,
  computePreviousTrackId,
  resolvePlayableQueue,
} from "./playbackQueue";
import type { Track } from "../../types";

function track(id: string, streamUrl = `https://example.test/${id}.mp3`): Track {
  return {
    id,
    providerId: "local",
    providerName: "Local library",
    providerTrackId: id,
    title: id,
    artist: "Artist",
    album: "Album",
    artwork: "",
    artworkSmall: "",
    duration: 120,
    streamUrl,
    genre: "Indie",
    tags: [],
    licensing: {
      name: "Local",
      streamingAllowed: true,
      downloadAllowed: true,
    },
    accent: "#c49e64",
  };
}

const tracks = [track("t1"), track("t2"), track("t3")];

test("resolvePlayableQueue falls back to library tracks when queue is empty or single-track", () => {
  assert.deepEqual(resolvePlayableQueue([], tracks, "t1"), ["t1", "t2", "t3"]);
  assert.deepEqual(resolvePlayableQueue(["t1"], tracks, "t1"), ["t1", "t2", "t3"]);
  assert.deepEqual(resolvePlayableQueue(["t2", "t3"], tracks, "t2"), ["t2", "t3"]);
});

test("computeNextTrackId steps through queue, respects repeat and shuffle", () => {
  assert.equal(
    computeNextTrackId({ queueIds: [], tracks, currentId: "t1", shuffle: false, repeat: "off" }),
    "t2",
  );
  assert.equal(
    computeNextTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t2", shuffle: false, repeat: "off" }),
    null,
  );
  assert.equal(
    computeNextTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t2", shuffle: false, repeat: "all" }),
    "t1",
  );
  assert.equal(
    computeNextTrackId({
      queueIds: ["t1", "t2", "t3"],
      tracks,
      currentId: "t1",
      shuffle: true,
      repeat: "off",
      randomFn: () => 0, // would pick index 0 (current), must advance to index 1
    }),
    "t2",
  );
});

test("computePreviousTrackId restarts after 4s or switches to previous track", () => {
  assert.deepEqual(
    computePreviousTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t2", repeat: "off", currentTime: 12 }),
    { action: "restart", trackId: "t2" },
  );
  assert.deepEqual(
    computePreviousTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t2", repeat: "off", currentTime: 1.5 }),
    { action: "switch", trackId: "t1" },
  );
  assert.deepEqual(
    computePreviousTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t1", repeat: "all", currentTime: 0 }),
    { action: "switch", trackId: "t2" },
  );
  assert.deepEqual(
    computePreviousTrackId({ queueIds: ["t1", "t2"], tracks, currentId: "t1", repeat: "off", currentTime: 0 }),
    { action: "none", trackId: null },
  );
});
