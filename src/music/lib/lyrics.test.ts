import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEmbeddedLyricsFromAudioBytes,
  findActiveLyricIndex,
  formatLyricCueTime,
  parseLrc,
} from "./lyrics";
import { cleanTrackTitle, selectBestLrclibCandidate } from "../services/lyricsService";

function makeSynchsafe(value: number): [number, number, number, number] {
  return [
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ];
}

function makeUint32BE(value: number): [number, number, number, number] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function makeId3v23(frames: Array<{ id: string; payload: number[] }>): Uint8Array {
  const body: number[] = [];
  for (const frame of frames) {
    const idBytes = [...Buffer.from(frame.id, "ascii")];
    body.push(...idBytes, ...makeUint32BE(frame.payload.length), 0, 0, ...frame.payload);
  }
  return new Uint8Array([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00,       // v2.3
    0x00,             // flags
    ...makeSynchsafe(body.length),
    ...body,
  ]);
}

test("parseLrc parses metadata tags, multi-timestamp lines, offsets, and sorting", () => {
  const sample = [
    "[ti:Aurora Drift]",
    "[ar:Nova Pines]",
    "[al:Light / Time]",
    "[offset:500]",
    "[00:25.00]Second chorus",
    "[00:05.50][00:15.250]Chorus line",
    "[00:01.00]Opening verse",
  ].join("\n");

  const parsed = parseLrc(sample);
  assert.equal(parsed.synced, true);
  assert.equal(parsed.metadata.title, "Aurora Drift");
  assert.equal(parsed.metadata.artist, "Nova Pines");
  assert.equal(parsed.metadata.album, "Light / Time");
  assert.equal(parsed.metadata.offsetMs, 500);
  assert.equal(parsed.lines.length, 4);
  assert.deepEqual(
    parsed.lines.map((line) => ({ time: line.time, text: line.text })),
    [
      { time: 0.5, text: "Opening verse" },
      { time: 5, text: "Chorus line" },
      { time: 14.75, text: "Chorus line" },
      { time: 24.5, text: "Second chorus" },
    ],
  );
});

test("parseLrc strips enhanced LRC inline word timings and falls back to plain lyrics", () => {
  const enhanced = "[00:10.00]Hello <00:10.50>world <00:11.00>today";
  const synced = parseLrc(enhanced);
  assert.equal(synced.synced, true);
  assert.deepEqual(synced.lines, [{ time: 10, text: "Hello world today" }]);

  const plain = parseLrc("Line one\nLine two\n\nLine four");
  assert.equal(plain.synced, false);
  assert.deepEqual(plain.lines, []);
  assert.equal(plain.plainText, "Line one\nLine two\n\nLine four");
});

test("findActiveLyricIndex binary-searches active line with offset and tolerance", () => {
  const lines = [
    { time: 5, text: "First" },
    { time: 12.5, text: "Second" },
    { time: 20, text: "Third" },
  ];

  assert.equal(findActiveLyricIndex(lines, 0), -1);
  assert.equal(findActiveLyricIndex(lines, 4.9), -1);
  assert.equal(findActiveLyricIndex(lines, 5), 0);
  assert.equal(findActiveLyricIndex(lines, 12.46), 1);
  assert.equal(findActiveLyricIndex(lines, 15), 1);
  assert.equal(findActiveLyricIndex(lines, 25), 2);
  assert.equal(findActiveLyricIndex(lines, 19.2, 1.0), 2);
  assert.equal(formatLyricCueTime(125), "2:05");
});

test("extractEmbeddedLyricsFromAudioBytes extracts ID3v2 USLT, SYLT, and text frames", () => {
  const usltText = "[00:02.00]Line from USLT\n[00:06.00]Second line";
  const bytes = makeId3v23([
    { id: "TIT2", payload: [0x03, ...Buffer.from("Track Title", "utf8")] },
    { id: "TPE1", payload: [0x03, ...Buffer.from("Track Artist", "utf8")] },
    { id: "USLT", payload: [0x03, 0x65, 0x6e, 0x67, 0x00, ...Buffer.from(usltText, "utf8")] },
  ]);

  const extracted = extractEmbeddedLyricsFromAudioBytes(bytes);
  assert.ok(extracted);
  assert.equal(extracted.title, "Track Title");
  assert.equal(extracted.artist, "Track Artist");
  assert.equal(extracted.syncedLyrics, usltText);

  const syltBytes = makeId3v23([
    {
      id: "SYLT",
      payload: [
        0x03, 0x65, 0x6e, 0x67, 0x02, 0x01, 0x00,
        ...Buffer.from("Start", "utf8"), 0x00, ...makeUint32BE(1500),
        ...Buffer.from("Next", "utf8"), 0x00, ...makeUint32BE(4250),
      ],
    },
  ]);

  const syltExtracted = extractEmbeddedLyricsFromAudioBytes(syltBytes);
  assert.ok(syltExtracted?.syncedLyrics);
  const parsedSylt = parseLrc(syltExtracted.syncedLyrics);
  assert.equal(parsedSylt.synced, true);
  assert.deepEqual(parsedSylt.lines, [
    { time: 1.5, text: "Start" },
    { time: 4.25, text: "Next" },
  ]);
});

test("extractEmbeddedLyricsFromAudioBytes extracts FLAC Vorbis comment lyrics", () => {
  const comment = "LYRICS=[00:04.00]Flac line";
  const vendor = "AuralTest";
  const blockBody = Buffer.concat([
    Buffer.from([vendor.length, 0, 0, 0]),
    Buffer.from(vendor, "utf8"),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([comment.length, 0, 0, 0]),
    Buffer.from(comment, "utf8"),
  ]);
  const header = Buffer.from([
    0x66, 0x4c, 0x61, 0x43, // "fLaC"
    0x84,                   // last block + type 4 (VORBIS_COMMENT)
    (blockBody.length >> 16) & 0xff,
    (blockBody.length >> 8) & 0xff,
    blockBody.length & 0xff,
  ]);
  const extracted = extractEmbeddedLyricsFromAudioBytes(new Uint8Array(Buffer.concat([header, blockBody])));
  assert.ok(extracted);
  assert.equal(extracted.syncedLyrics, "[00:04.00]Flac line");
});

test("cleanTrackTitle and selectBestLrclibCandidate prioritize synced accurate matches", () => {
  assert.equal(cleanTrackTitle("Midnight City (feat. Guest) [Official Video]"), "Midnight City");

  const chosen = selectBestLrclibCandidate(
    [
      {
        id: 1,
        trackName: "Midnight City",
        artistName: "Other Artist",
        duration: 240,
        plainLyrics: "Plain only",
      },
      {
        id: 2,
        trackName: "Midnight City",
        artistName: "M83",
        duration: 244,
        syncedLyrics: "[00:10.00]Waiting in a car",
      },
    ],
    { title: "Midnight City (Remastered)", artist: "M83", duration: 243 },
  );

  assert.equal(chosen?.id, 2);
});

import { computeWordHighlightStates } from "./lyrics";

test("parseLrc captures Enhanced LRC word timings and computeWordHighlightStates tracks exact and estimated cues", () => {
  const enhanced = "[00:10.00]Hello <00:10.50>world <00:11.00>today <00:11.80>";
  const parsed = parseLrc(enhanced);
  assert.equal(parsed.synced, true);
  assert.deepEqual(parsed.lines, [{ time: 10, text: "Hello world today" }]);
  assert.ok(parsed.wordTimings?.[0]);
  assert.equal(parsed.wordTimings[0].length, 3);
  assert.deepEqual(parsed.wordTimings[0].map((w) => [w.text, w.time]), [
    ["Hello", 10],
    ["world", 10.5],
    ["today", 11],
  ]);

  const atMidWorld = computeWordHighlightStates({
    lineText: parsed.lines[0].text,
    explicitWords: parsed.wordTimings[0],
    lineStartTime: 10,
    nextLineTime: 14,
    currentTime: 10.75,
  });
  assert.equal(atMidWorld[0].state, "past");
  assert.equal(atMidWorld[1].state, "active");
  assert.ok(Math.abs(atMidWorld[1].progress - 0.5) < 0.01);
  assert.equal(atMidWorld[2].state, "upcoming");

  // Standard line-synced lyrics without inline word tags use smooth cadence sweep
  const estimated = computeWordHighlightStates({
    lineText: "Moonlight over quiet waves",
    lineStartTime: 20,
    nextLineTime: 24,
    currentTime: 21.8,
  });
  assert.equal(estimated.length, 4);
  assert.ok(estimated.some((w) => w.state === "past"));
  assert.ok(estimated.some((w) => w.state === "active" || w.state === "past"));
});
