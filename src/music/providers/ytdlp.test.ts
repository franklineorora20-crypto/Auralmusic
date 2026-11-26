import assert from "node:assert/strict";
import test from "node:test";
import { isValidHttpMediaUrl, mapYtdlpPreviewTrack, ytdlpProvider } from "./ytdlp";

test("isValidHttpMediaUrl accepts http/https and rejects non-web schemes", () => {
  assert.equal(isValidHttpMediaUrl("https://example.com/track"), true);
  assert.equal(isValidHttpMediaUrl("http://example.com/playlist"), true);
  assert.equal(isValidHttpMediaUrl("ftp://example.com/file"), false);
  assert.equal(isValidHttpMediaUrl("javascript:alert(1)"), false);
  assert.equal(isValidHttpMediaUrl("not a url"), false);
});

test("mapYtdlpPreviewTrack never presents metadata as streaming or download permission", () => {
  const track = mapYtdlpPreviewTrack({
    id: "item-1",
    title: "Public Domain Piano",
    artist: "Open Pianist",
    album: "Commons",
    duration: 215,
    thumbnail: "https://cdn.example.com/cover.jpg",
    sourceUrl: "https://example.com/watch?v=item-1",
    webpageUrl: "https://example.com/watch?v=item-1",
    extractor: "Generic",
  });

  assert.equal(track.providerId, "ytdlp");
  assert.equal(track.streamUrl, "");
  assert.equal(track.downloadUrl, undefined);
  assert.equal(track.licensing.streamingAllowed, false);
  assert.equal(track.licensing.downloadAllowed, false);
});

test("ytdlpProvider keeps passive catalogue search disabled", () => {
  assert.equal(ytdlpProvider.id, "ytdlp");
  assert.equal(ytdlpProvider.isEnabled(), false);
  assert.ok(ytdlpProvider.disabledReason());
});
