import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
  buildArchiveAdvancedSearchUrl,
  buildArchiveDownloadUrl,
  buildArchiveItemDetail,
  buildArchiveItemPermalink,
  mapArchiveDetailToTrack,
  mapArchiveDetailToTracks,
  parseArchiveDuration,
  parseArchiveTrackId,
  resolveArchiveArtworkUrl,
  resolveArchiveRights,
  sanitizeArchiveSearchTerm,
  selectArchiveAudioFiles,
  validateArchiveMediaUrl,
} from "./internetArchiveMeta";
import { internetArchiveProvider, searchArchiveAudioPage } from "./internetArchive";
import { ProviderError } from "../lib/http";
import { canDownload } from "../services/downloadService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("internetArchiveMeta URL, query, and duration helpers", () => {
  it("sanitizes Lucene operators and builds paginated Advanced Search URLs", () => {
    assert.equal(sanitizeArchiveSearchTerm('  "78 rpm" +jazz -rock (live)! '), "78 rpm jazz rock live");

    const page1 = new URL(buildArchiveAdvancedSearchUrl("78 rpm jazz", { limit: 12, offset: 0 }));
    assert.equal(page1.origin, "https://archive.org");
    assert.equal(page1.pathname, "/advancedsearch.php");
    assert.equal(page1.searchParams.get("rows"), "12");
    assert.equal(page1.searchParams.get("page"), "1");
    assert.equal(page1.searchParams.get("output"), "json");
    assert.equal(page1.searchParams.get("q"), "mediatype:audio AND (78 AND rpm AND jazz)");
    assert.ok(page1.searchParams.getAll("fl[]").includes("licenseurl"));
    assert.ok(page1.searchParams.getAll("fl[]").includes("access-restricted-item"));

    const page2 = new URL(buildArchiveAdvancedSearchUrl("ambient", { limit: 12, offset: 12, genre: "electronic" }));
    assert.equal(page2.searchParams.get("page"), "2");
    assert.equal(
      page2.searchParams.get("q"),
      "mediatype:audio AND (ambient) AND (subject:(electronic) OR title:(electronic))",
    );
  });

  it("validates Archive.org media URLs strictly and encodes download paths", () => {
    assert.equal(
      validateArchiveMediaUrl("http://archive.org/download/test-item/track 01.mp3"),
      "https://archive.org/download/test-item/track%2001.mp3",
    );
    assert.equal(
      validateArchiveMediaUrl("https://ia800100.us.archive.org/12/items/test/song.ogg"),
      "https://ia800100.us.archive.org/12/items/test/song.ogg",
    );
    assert.equal(validateArchiveMediaUrl("https://evil.example.com/song.mp3"), "");
    assert.equal(validateArchiveMediaUrl("https://user:pass@archive.org/download/a/b.mp3"), "");
    assert.equal(validateArchiveMediaUrl("javascript:alert(1)"), "");

    assert.equal(
      buildArchiveDownloadUrl("my_item", "/sub folder/../track #1.mp3"),
      "https://archive.org/download/my_item/sub%20folder/track%20%231.mp3",
    );
    assert.equal(buildArchiveItemPermalink("my item"), "https://archive.org/details/my%20item");
  });

  it("parses numeric, MM:SS, and HH:MM:SS Archive.org durations", () => {
    assert.equal(parseArchiveDuration("150.6"), 151);
    assert.equal(parseArchiveDuration(92.4), 92);
    assert.equal(parseArchiveDuration("03:45"), 225);
    assert.equal(parseArchiveDuration("1:02:30"), 3750);
    assert.equal(parseArchiveDuration("invalid"), 0);
    assert.equal(parseArchiveDuration(""), 0);
  });
});

describe("internetArchiveMeta file selection and rights resolution", () => {
  it("prioritizes browser-playable audio per original stem and skips private/unsupported files", () => {
    const selection = selectArchiveAudioFiles(
      "jazz-sample-item",
      [
        { name: "01_intro.shn", format: "Shorten" },
        { name: "01_intro.flac", format: "Flac", original: "01_intro.shn", length: "124.2", size: "15000000" },
        { name: "01_intro.mp3", format: "VBR MP3", original: "01_intro.shn", length: "02:04", size: "2400000", title: "Opening Brass", track: "1" },
        { name: "02_secret.mp3", format: "VBR MP3", private: "true", length: "180" },
        { name: "03_finale.ogg", format: "Ogg Vorbis", length: "210", title: "Closing Theme", track: "2" },
      ],
      { title: "Jazz Archive Session", creator: "The Quartet" },
    );

    assert.equal(selection.audioFiles.length, 2);
    assert.equal(selection.skippedPrivateCount, 1);
    assert.equal(selection.skippedUnsupportedCount, 1);
    assert.equal(selection.hasOnlyPrivateAudio, false);
    assert.equal(selection.hasUnsupportedAudioOnly, false);

    assert.equal(selection.audioFiles[0].fileName, "01_intro.mp3");
    assert.equal(selection.audioFiles[0].title, "Opening Brass");
    assert.equal(selection.audioFiles[0].duration, 124);
    assert.equal(selection.audioFiles[0].sizeBytes, 2400000);
    assert.equal(
      selection.audioFiles[0].streamUrl,
      "https://archive.org/download/jazz-sample-item/01_intro.mp3",
    );
    assert.equal(selection.audioFiles[1].fileName, "03_finale.ogg");
  });

  it("flags unsupported-only and private-only audio items accurately", () => {
    const unsupportedOnly = selectArchiveAudioFiles(
      "shn-only",
      [{ name: "track1.shn", format: "Shorten" }],
      { title: "Shorten Only" },
    );
    assert.equal(unsupportedOnly.audioFiles.length, 0);
    assert.equal(unsupportedOnly.hasUnsupportedAudioOnly, true);
    assert.equal(unsupportedOnly.hasOnlyPrivateAudio, false);

    const privateOnly = selectArchiveAudioFiles(
      "private-only",
      [{ name: "track1.mp3", format: "VBR MP3", private: "true" }],
      { title: "Private Only" },
    );
    assert.equal(privateOnly.audioFiles.length, 0);
    assert.equal(privateOnly.hasOnlyPrivateAudio, true);
  });

  it("blocks access-restricted and stream_only items completely", () => {
    const rights = resolveArchiveRights(
      {
        "access-restricted-item": "true",
        collection: ["audio_music", "stream_only"],
        creator: "KCBX Broadcast",
        licenseurl: "https://creativecommons.org/licenses/by/4.0/",
      },
      { hasPlayableAudio: false, hasOnlyPrivateAudio: true, hasUnsupportedAudioOnly: false },
    );

    assert.equal(rights.restricted, true);
    assert.equal(rights.licensing.streamingAllowed, false);
    assert.equal(rights.licensing.downloadAllowed, false);
    assert.equal(rights.importAllowed, false);
    assert.match(rights.restrictionReason, /stream-only/i);
  });

  it("permits download on explicit open licenses but disables auto-download when license is missing or copyrighted", () => {
    const openRights = resolveArchiveRights(
      {
        creator: "Free Sound Lab",
        licenseurl: "http://creativecommons.org/publicdomain/mark/1.0/",
      },
      { hasPlayableAudio: true, hasOnlyPrivateAudio: false, hasUnsupportedAudioOnly: false },
    );
    assert.equal(openRights.isOpenLicense, true);
    assert.equal(openRights.licensing.streamingAllowed, true);
    assert.equal(openRights.licensing.downloadAllowed, true);
    assert.equal(openRights.importAllowed, true);
    assert.equal(openRights.importRequiresConfirmation, false);

    const unspecifiedRights = resolveArchiveRights(
      { creator: "Unknown Transfer" },
      { hasPlayableAudio: true, hasOnlyPrivateAudio: false, hasUnsupportedAudioOnly: false },
    );
    assert.equal(unspecifiedRights.isOpenLicense, false);
    assert.equal(unspecifiedRights.licensing.streamingAllowed, true);
    assert.equal(unspecifiedRights.licensing.downloadAllowed, false);
    assert.equal(unspecifiedRights.importAllowed, true);
    assert.equal(unspecifiedRights.importRequiresConfirmation, true);
    assert.match(unspecifiedRights.licensing.note ?? "", /do not assume public domain/i);

    const copyrightedRights = resolveArchiveRights(
      {
        creator: "Commercial Label",
        rights: "All rights reserved. Do not redistribute.",
      },
      { hasPlayableAudio: true, hasOnlyPrivateAudio: false, hasUnsupportedAudioOnly: false },
    );
    assert.equal(copyrightedRights.isExplicitCopyright, true);
    assert.equal(copyrightedRights.licensing.downloadAllowed, false);
    assert.equal(copyrightedRights.importAllowed, false);
  });

  it("ignores spectrogram/waveform thumbnails when resolving real cover artwork", () => {
    const artwork = resolveArchiveArtworkUrl(
      "cover-test",
      [
        { name: "track_spectrogram.png", format: "PNG" },
        { name: "front_cover.jpg", format: "JPEG" },
        { name: "__ia_thumb.jpg", format: "JPEG Thumb" },
      ],
      ["PNG", "JPEG"],
    );
    assert.equal(artwork, "https://archive.org/download/cover-test/front_cover.jpg");

    const noRealArt = resolveArchiveArtworkUrl(
      "no-cover",
      [{ name: "track_spectrogram.png", format: "PNG" }],
      ["VBR MP3"],
    );
    assert.equal(noRealArt, "");
  });

  it("maps item details to Tracks and cooperates with downloadService.canDownload", () => {
    const openDetail = buildArchiveItemDetail("open_78_jazz", {
      metadata: {
        identifier: "open_78_jazz",
        title: "St. Louis Blues (1929)",
        creator: "Blue Note Brass",
        date: "1929-05-14",
        licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/",
        subject: ["Jazz", "78rpm"],
      },
      files: [
        { name: "side_a.mp3", format: "VBR MP3", length: "184", title: "Side A" },
        { name: "side_b.mp3", format: "VBR MP3", length: "190", title: "Side B" },
        { name: "cover.jpg", format: "JPEG" },
      ],
    });

    const tracks = mapArchiveDetailToTracks(openDetail);
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].providerId, "internetarchive");
    assert.equal(tracks[0].permalink, "https://archive.org/details/open_78_jazz");
    assert.equal(canDownload(tracks[0]), true);
    assert.deepEqual(parseArchiveTrackId(tracks[1].id), {
      identifier: "open_78_jazz",
      fileName: "side_b.mp3",
    });

    const unverifiedDetail = buildArchiveItemDetail("unverified_tape", {
      metadata: { identifier: "unverified_tape", title: "Tape Reel" },
      files: [{ name: "reel.mp3", format: "VBR MP3", length: "95" }],
    });
    const unverifiedTrack = mapArchiveDetailToTrack(unverifiedDetail);
    assert.equal(unverifiedTrack.licensing.streamingAllowed, true);
    assert.equal(unverifiedTrack.licensing.downloadAllowed, false);
    assert.equal(canDownload(unverifiedTrack), false);
  });
});

describe("internetArchiveProvider network search and pagination", () => {
  it("queries Advanced Search and hydrates metadata with pagination & graceful fallback", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);

      if (url.includes("/advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: {
              numFound: 25,
              start: 0,
              docs: [
                { identifier: "item_open_1", title: "Open Suite", creator: "Ensemble A" },
                { identifier: "item_restricted_2", title: "Restricted Tape", creator: "Station B", collection: ["stream_only"] },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/metadata/item_open_1")) {
        return new Response(
          JSON.stringify({
            metadata: {
              identifier: "item_open_1",
              title: "Open Suite",
              creator: "Ensemble A",
              licenseurl: "https://creativecommons.org/licenses/by/4.0/",
            },
            files: [
              { name: "suite.mp3", format: "VBR MP3", length: "205", title: "Open Suite Pt. 1" },
              { name: "artwork.jpg", format: "JPEG" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/metadata/item_restricted_2")) {
        return new Response("Forbidden", { status: 403 });
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const page = await searchArchiveAudioPage("open suite", { limit: 12, offset: 0 });
    assert.equal(page.numFound, 25);
    assert.equal(page.hasMore, true);
    assert.equal(page.tracks.length, 2);

    assert.equal(page.tracks[0].title, "Open Suite Pt. 1");
    assert.equal(page.tracks[0].streamUrl, "https://archive.org/download/item_open_1/suite.mp3");
    assert.equal(page.tracks[0].artwork, "https://archive.org/download/item_open_1/artwork.jpg");
    assert.equal(canDownload(page.tracks[0]), true);

    // Item 2 failed metadata fetch (403) and fell back cleanly as unavailable
    assert.equal(page.tracks[1].id, "internetarchive-item_restricted_2");
    assert.equal(page.tracks[1].streamUrl, "");
    assert.equal(page.tracks[1].licensing.streamingAllowed, false);
    assert.ok(requestedUrls.some((u) => u.includes("advancedsearch.php")));

    const loadedTrack = await internetArchiveProvider.getTrack("internetarchive-item_open_1", {});
    assert.equal(loadedTrack?.streamUrl, "https://archive.org/download/item_open_1/suite.mp3");
  });

  it("throws a ProviderError when Advanced Search returns an HTTP error", async () => {
    globalThis.fetch = (async () => new Response("Service Unavailable", { status: 503 })) as typeof fetch;

    await assert.rejects(
      () => searchArchiveAudioPage("baroque_error_test", { limit: 12, offset: 0 }),
      (err: unknown) => err instanceof ProviderError && err.status === 503,
    );
  });
});
