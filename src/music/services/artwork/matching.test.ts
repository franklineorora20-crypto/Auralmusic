import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanAlbumTitleForArtwork,
  cleanTrackTitleForArtwork,
  parseTrackMetadataForArtwork,
  scoreArtworkCandidate,
  shouldUpgradeArtwork,
} from "./matching";

test("cleanTrackTitleForArtwork and cleanAlbumTitleForArtwork strip release noise", () => {
  assert.equal(cleanTrackTitleForArtwork("01 - Midnight City (feat. M83) [Official Video]"), "Midnight City");
  assert.equal(cleanTrackTitleForArtwork("Dreams - 2004 Remaster"), "Dreams");
  assert.equal(cleanAlbumTitleForArtwork("Discovery (Deluxe Edition)"), "Discovery");
  assert.equal(cleanAlbumTitleForArtwork("Random Access Memories [Remastered]"), "Random Access Memories");
});

test("parseTrackMetadataForArtwork extracts artist from filename-style title when artist is placeholder", () => {
  const parsed = parseTrackMetadataForArtwork({
    title: "Daft Punk - One More Time",
    artist: "Local library",
    album: "Imported",
  });
  assert.equal(parsed.artist, "Daft Punk");
  assert.equal(parsed.title, "One More Time");
  assert.equal(parsed.hasUsableArtist, true);
  assert.equal(parsed.hasUsableAlbum, false);
  assert.equal(parsed.albumLookupKey, null);
});

test("parseTrackMetadataForArtwork shares albumLookupKey across tracks of the same album", () => {
  const track1 = parseTrackMetadataForArtwork({
    title: "One More Time",
    artist: "Daft Punk",
    album: "Discovery",
  });
  const track2 = parseTrackMetadataForArtwork({
    title: "Aerodynamic",
    artist: "Daft Punk",
    album: "Discovery (Remastered)",
  });
  assert.ok(track1.albumLookupKey);
  assert.equal(track1.albumLookupKey, track2.albumLookupKey);
});

test("scoreArtworkCandidate prioritizes exact artist + album and rejects similarly named artists", () => {
  const query = parseTrackMetadataForArtwork({
    title: "Harder, Better, Faster, Stronger",
    artist: "Daft Punk",
    album: "Discovery",
  });

  const exact = scoreArtworkCandidate(query, {
    releaseTitle: "Discovery",
    releaseArtist: "Daft Punk",
    releaseType: "album",
    isOfficial: true,
    hasFrontCover: true,
  });
  assert.equal(exact.accepted, true);
  assert.equal(exact.matchType, "album");

  const wrongArtist = scoreArtworkCandidate(query, {
    releaseTitle: "Discovery",
    releaseArtist: "Mike Oldfield",
    releaseType: "album",
    isOfficial: true,
    hasFrontCover: true,
  });
  assert.equal(wrongArtist.accepted, false);

  const tribute = scoreArtworkCandidate(query, {
    releaseTitle: "8-Bit Tribute to Daft Punk - Discovery",
    releaseArtist: "Daft Punk",
    releaseType: "album",
    isOfficial: true,
  });
  assert.equal(tribute.accepted, false);
});

test("scoreArtworkCandidate supports singles when album is Single/Imported", () => {
  const query = parseTrackMetadataForArtwork({
    title: "Breathe Deeper",
    artist: "Tame Impala",
    album: "Single",
  });

  const singleMatch = scoreArtworkCandidate(query, {
    releaseTitle: "Breathe Deeper",
    releaseArtist: "Tame Impala",
    trackTitle: "Breathe Deeper",
    releaseType: "single",
    isOfficial: true,
  });
  assert.equal(singleMatch.accepted, true);
  assert.equal(singleMatch.matchType, "single");

  const wrongTrack = scoreArtworkCandidate(query, {
    releaseTitle: "Currents",
    releaseArtist: "Tame Impala",
    trackTitle: "The Less I Know The Better",
    releaseType: "album",
    isOfficial: true,
  });
  assert.equal(wrongTrack.accepted, false);
});

test("scoreArtworkCandidate supports compilations for Various Artists", () => {
  const query = parseTrackMetadataForArtwork({
    title: "Nightcall",
    artist: "Kavinsky",
    album: "Drive (Original Motion Picture Soundtrack)",
  });

  const compilation = scoreArtworkCandidate(query, {
    releaseTitle: "Drive (Original Motion Picture Soundtrack)",
    releaseArtist: "Various Artists",
    trackTitle: "Nightcall",
    releaseType: "compilation",
    isOfficial: true,
  });
  assert.equal(compilation.accepted, true);
  assert.equal(compilation.matchType, "compilation");
});

test("shouldUpgradeArtwork preserves user/embedded covers and upgrades broken or weaker covers", () => {
  const embedded = { source: "embedded" as const, attribution: "Embedded", confidence: 100 };
  const user = { source: "user" as const, attribution: "User", confidence: 100 };
  const caa = { source: "coverartarchive" as const, attribution: "CAA", confidence: 95 };
  const itunes = { source: "itunes" as const, attribution: "iTunes", confidence: 85 };

  assert.equal(shouldUpgradeArtwork(embedded, caa), false);
  assert.equal(shouldUpgradeArtwork(user, caa), false);
  assert.equal(shouldUpgradeArtwork(undefined, itunes), true);
  assert.equal(shouldUpgradeArtwork({ source: "none", attribution: "", confidence: 0 }, itunes), true);
  assert.equal(shouldUpgradeArtwork(itunes, caa), true);
  assert.equal(shouldUpgradeArtwork({ source: "audius", attribution: "Audius", confidence: 70 }, caa, true), true);
});
