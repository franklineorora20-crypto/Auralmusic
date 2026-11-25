import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNextTrackId,
  computePreviousTrackId,
  createShuffledIds,
  isTrackPlayable,
  resolvePlayableQueue,
} from "./playbackQueue";
import type { Track } from "../../types";

function track(
  id: string,
  streamUrl = `https://example.test/${id}.mp3`,
  extra: Partial<Track> = {},
): Track {
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
    ...extra,
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

test("computeNextTrackId autoplays available next song when queue ends and skips offline-unavailable tracks", () => {
  assert.equal(
    computeNextTrackId({
      queueIds: ["t1", "t2"],
      tracks,
      currentId: "t2",
      shuffle: false,
      repeat: "off",
      autoplay: true,
    }),
    "t3",
  );

  const mixedTracks = [
    track("online1", "https://example.test/online1.mp3", { providerId: "audius" }),
    track("dl1", "blob:offline-1", { downloaded: true }),
    track("online2", "https://example.test/online2.mp3", { providerId: "audius" }),
    track("dl2", "blob:offline-2", { imported: true }),
  ];

  assert.equal(isTrackPlayable(mixedTracks[0], { online: false }), false);
  assert.equal(isTrackPlayable(mixedTracks[1], { online: false }), true);
  assert.equal(
    computeNextTrackId({
      queueIds: ["dl1", "online2", "dl2"],
      tracks: mixedTracks,
      currentId: "dl1",
      shuffle: false,
      repeat: "off",
      autoplay: true,
      online: false,
    }),
    "dl2",
  );
});

test("createShuffledIds and shuffleOrder advance without immediate repeats", () => {
  const ordered = createShuffledIds(["t1", "t2", "t3"], "t2", () => 0.4);
  assert.equal(ordered[0], "t2");
  assert.equal(ordered.length, 3);
  assert.deepEqual([...ordered].sort(), ["t1", "t2", "t3"]);

  const first = computeNextTrackId({
    queueIds: ["t1", "t2", "t3"],
    tracks,
    currentId: ordered[0],
    shuffle: true,
    repeat: "off",
    shuffleOrder: ordered,
  });
  assert.equal(first, ordered[1]);

  const second = computeNextTrackId({
    queueIds: ["t1", "t2", "t3"],
    tracks,
    currentId: ordered[1],
    shuffle: true,
    repeat: "off",
    shuffleOrder: ordered,
  });
  assert.equal(second, ordered[2]);
});

test("computePreviousTrackId restarts after 4s or switches to previous track (including shuffle history)", () => {
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
  assert.deepEqual(
    computePreviousTrackId({
      queueIds: ["t1", "t2", "t3"],
      tracks,
      currentId: "t3",
      repeat: "off",
      currentTime: 0,
      shuffle: true,
      historyIds: ["t1"],
    }),
    { action: "switch", trackId: "t1" },
  );
});
