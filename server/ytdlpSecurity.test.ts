import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildDiscoverArgs,
  buildImportArgs,
  isPathInsideDir,
  METADATA_DISCLAIMER,
  normalizeDiscoveryPayload,
  parseProgressLine,
  validateAudioFormat,
  validateMediaUrl,
} from "./ytdlpSecurity";

test("validateMediaUrl accepts valid http and https URLs", () => {
  const httpsRes = validateMediaUrl("https://example.com/watch?v=123");
  assert.equal(httpsRes.ok, true);
  if (httpsRes.ok) assert.equal(httpsRes.url, "https://example.com/watch?v=123");

  const httpRes = validateMediaUrl("http://media.example.org/audio/track.mp3");
  assert.equal(httpRes.ok, true);
});

test("validateMediaUrl blocks unsafe schemes, credentials, loopback and private IPs", () => {
  for (const blocked of [
    "",
    "   ",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com/file.mp3",
    "https://user:pass@example.com/track",
    "http://localhost:3000/secret",
    "http://127.0.0.1:8080/internal",
    "http://[::1]/loopback",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/private",
    "http://172.16.4.10/private",
    "http://192.168.1.1/router",
    "https://example.com/bad url with spaces",
    "https://example.com/bad\nline",
  ]) {
    const res = validateMediaUrl(blocked);
    assert.equal(res.ok, false, `Expected URL to be blocked: ${blocked}`);
  }
});

test("validateAudioFormat enforces allowlist", () => {
  assert.equal(validateAudioFormat(undefined), "mp3");
  assert.equal(validateAudioFormat("M4A"), "m4a");
  assert.equal(validateAudioFormat("opus"), "opus");
  assert.equal(validateAudioFormat("wav"), "wav");
  assert.throws(() => validateAudioFormat("exe"));
  assert.throws(() => validateAudioFormat("mp3; rm -rf /"));
});

test("isPathInsideDir confines resolved file paths inside temp directory", () => {
  const baseDir = path.resolve("/tmp/aural-ytdlp/job-1");
  assert.equal(isPathInsideDir(path.join(baseDir, "track.mp3"), baseDir), true);
  assert.equal(isPathInsideDir(path.join(baseDir, "../job-2/track.mp3"), baseDir), false);
  assert.equal(isPathInsideDir(baseDir, baseDir), false);
  assert.equal(isPathInsideDir("/tmp/aural-ytdlp/job-10/track.mp3", baseDir), false);
});

test("buildDiscoverArgs and buildImportArgs lock down yt-dlp flags and isolate URL after --", () => {
  const discover = buildDiscoverArgs("https://example.com/audio");
  assert.ok(discover.includes("--ignore-config"));
  assert.ok(discover.includes("--no-exec"));
  assert.ok(discover.includes("--dump-single-json"));
  assert.equal(discover.at(-2), "--");
  assert.equal(discover.at(-1), "https://example.com/audio");

  const importArgs = buildImportArgs("https://example.com/audio", "/tmp/job/%(id)s.%(ext)s", {
    format: "mp3",
    maxFilesizeMb: 75,
    ffmpegLocation: "/usr/bin/ffmpeg",
    embedThumbnail: true,
  });
  assert.ok(importArgs.includes("--no-playlist"));
  assert.ok(importArgs.includes("--extract-audio"));
  assert.ok(importArgs.includes("--embed-thumbnail"));
  assert.equal(importArgs.at(-2), "--");
  assert.equal(importArgs.at(-1), "https://example.com/audio");
});

test("parseProgressLine extracts download and post-processing progress", () => {
  const dl = parseProgressLine("[download]  42.5% of 4.10MiB at 1.20MiB/s ETA 00:02");
  assert.ok(dl);
  assert.equal(dl.percent, 38);

  const extract = parseProgressLine("[ExtractAudio] Destination: /tmp/job/track.mp3");
  assert.equal(extract?.percent, 96);

  const meta = parseProgressLine("[Metadata] Adding metadata to /tmp/job/track.mp3");
  assert.equal(meta?.percent, 98);

  assert.equal(parseProgressLine("unrelated noise"), null);
});

test("normalizeDiscoveryPayload normalizes single track and playlist responses with disclaimer", () => {
  const single = normalizeDiscoveryPayload(
    {
      id: "abc",
      title: "Morning Field Recording",
      uploader: "Nature Archive",
      duration: 184.4,
      thumbnail: "https://cdn.example.com/thumb.jpg",
      webpage_url: "https://example.com/watch?v=abc",
      extractor_key: "Generic",
    },
    "https://example.com/watch?v=abc",
  );
  assert.equal(single.kind, "single");
  assert.equal(single.itemCount, 1);
  assert.equal(single.items[0].title, "Morning Field Recording");
  assert.equal(single.items[0].artist, "Nature Archive");
  assert.equal(single.items[0].duration, 184);
  assert.equal(single.notice, METADATA_DISCLAIMER);

  const playlist = normalizeDiscoveryPayload(
    {
      _type: "playlist",
      title: "Open Audio Commons",
      uploader: "Commons Curator",
      entries: [
        { id: "1", title: "Track One", artist: "Artist A", duration: 90, url: "https://example.com/1" },
        { id: "2", title: "Track Two", uploader: "Artist B", duration: 120, url: "https://example.com/2" },
      ],
    },
    "https://example.com/playlist/open",
  );
  assert.equal(playlist.kind, "playlist");
  assert.equal(playlist.items.length, 2);
  assert.equal(playlist.items[0].album, "Open Audio Commons");
  assert.equal(playlist.notice, METADATA_DISCLAIMER);
});
