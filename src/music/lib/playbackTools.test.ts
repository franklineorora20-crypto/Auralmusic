import test from "node:test";
import assert from "node:assert/strict";
import type { Track } from "../../types";
import {
  clampCrossfadeDuration,
  clampPlaybackSpeed,
  computeCrossfadeGains,
  createCountdownSleepTimer,
  createEndOfTrackSleepTimer,
  createOffSleepTimer,
  formatSleepTimerRemaining,
  getSleepTimerRemainingMs,
  pickAutomixNextTrack,
} from "./playbackTools";

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    providerId: "audius",
    providerName: "Audius",
    providerTrackId: overrides.id,
    title: overrides.title ?? overrides.id,
    artist: overrides.artist ?? "Artist",
    album: overrides.album ?? "Album",
    artwork: "",
    artworkSmall: "",
    duration: overrides.duration ?? 210,
    streamUrl: overrides.streamUrl ?? `https://example.com/${overrides.id}.mp3`,
    genre: overrides.genre ?? "Electronic",
    tags: overrides.tags ?? [],
    licensing: {
      name: "Test",
      streamingAllowed: true,
      downloadAllowed: false,
    },
    accent: "#c49e64",
    ...overrides,
  };
}

test("computeCrossfadeGains computes equal-power, smooth, and linear curves", () => {
  assert.equal(clampCrossfadeDuration(1), 2);
  assert.equal(clampCrossfadeDuration(18), 12);

  const eqMid = computeCrossfadeGains(0.5, "equal-power");
  assert.ok(Math.abs(eqMid.outgoing - Math.SQRT1_2) < 0.001);
  assert.ok(Math.abs(eqMid.incoming - Math.SQRT1_2) < 0.001);

  const linearMid = computeCrossfadeGains(0.25, "linear");
  assert.equal(linearMid.outgoing, 0.75);
  assert.equal(linearMid.incoming, 0.25);

  const smoothEnd = computeCrossfadeGains(1, "smooth");
  assert.ok(smoothEnd.outgoing < 0.001);
  assert.ok(smoothEnd.incoming > 0.999);
});

test("pickAutomixNextTrack favors genre/tag continuity and skips offline-unavailable tracks", () => {
  const current = makeTrack({
    id: "now",
    title: "Pulse Horizon",
    artist: "Kaito",
    genre: "Ambient Electronic",
    tags: ["chill", "synth"],
    duration: 240,
  });
  const candidates = [
    makeTrack({
      id: "rock-track",
      title: "Loud Guitars",
      artist: "Bolder",
      genre: "Rock",
      tags: ["punk"],
      duration: 180,
      downloaded: true,
      streamUrl: "blob:local/rock",
    }),
    makeTrack({
      id: "ambient-match",
      title: "Cloud Drift",
      artist: "Lina",
      genre: "Ambient",
      tags: ["chill", "electronic"],
      duration: 245,
      downloaded: true,
      streamUrl: "blob:local/ambient",
    }),
    makeTrack({
      id: "online-only-match",
      title: "Cloud Stream",
      artist: "Lina",
      genre: "Ambient",
      tags: ["chill", "synth", "electronic"],
      duration: 240,
    }),
  ];

  // Offline: must only consider downloaded/local tracks and still pick ambient-match over rock
  const offlinePick = pickAutomixNextTrack({
    currentTrack: current,
    candidates,
    availability: { online: false, downloadedIds: new Set(["rock-track", "ambient-match"]) },
  });
  assert.equal(offlinePick?.track.id, "ambient-match");
  assert.equal(offlinePick?.recommendedFadeSeconds, 8);
  assert.match(offlinePick?.reason ?? "", /ambient|chill|electronic/i);
});

test("sleep timer and playback speed helpers behave deterministically", () => {
  const start = 1_000_000;
  const countdown = createCountdownSleepTimer(30, start);
  assert.equal(countdown.mode, "countdown");
  assert.equal(getSleepTimerRemainingMs(countdown, start + 65_000), 28 * 60_000 + 55_000);
  assert.equal(formatSleepTimerRemaining(125_000), "2:05");
  assert.equal(formatSleepTimerRemaining(3_665_000), "1:01:05");

  const eot = createEndOfTrackSleepTimer();
  assert.equal(eot.mode, "end-of-track");
  assert.equal(getSleepTimerRemainingMs(createOffSleepTimer()), 0);

  assert.equal(clampPlaybackSpeed(0.2), 0.5);
  assert.equal(clampPlaybackSpeed(2.6), 2.0);
  assert.equal(clampPlaybackSpeed(1.254), 1.25);
});
