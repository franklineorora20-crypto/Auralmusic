import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Track } from "../../types/music";
import { itunesArtworkAdapter } from "./adapters/itunes";
import { musicBrainzCaaAdapter } from "./adapters/musicbrainzCaa";
import { markArtworkUrlBroken, resolveTrackArtwork } from "./artworkService";
import { parseTrackMetadataForArtwork } from "./matching";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: overrides.id ?? "local-test-1",
    providerId: overrides.providerId ?? "local",
    providerName: overrides.providerName ?? "Local library",
    providerTrackId: overrides.providerTrackId ?? "test-1",
    title: overrides.title ?? "Aerodynamic",
    artist: overrides.artist ?? "Daft Punk",
    album: overrides.album ?? "Discovery",
    artwork: overrides.artwork ?? "",
    artworkSmall: overrides.artworkSmall ?? "",
    duration: 212,
    streamUrl: "blob:http://localhost/test-audio",
    genre: "Electronic",
    tags: [],
    licensing: { name: "Local", streamingAllowed: true, downloadAllowed: true },
    accent: "#3d2f24",
    ...overrides,
  };
}

describe("artwork adapters and fallback hierarchy", () => {
  it("musicBrainzCaaAdapter finds album release cover and falls back from 404 release to release-group", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("musicbrainz.org/ws/2/release/")) {
        return new Response(
          JSON.stringify({
            releases: [
              {
                id: "rel-123",
                title: "Discovery",
                status: "Official",
                "artist-credit": [{ name: "Daft Punk" }],
                "release-group": { id: "rg-456", "primary-type": "Album" },
                "cover-art-archive": { artwork: true, front: true, count: 2 },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("coverartarchive.org/release/rel-123")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.includes("coverartarchive.org/release-group/rg-456")) {
        return new Response(
          JSON.stringify({
            images: [
              {
                front: true,
                approved: true,
                image: "http://coverartarchive.org/rg-456/full.jpg",
                thumbnails: {
                  "500": "http://coverartarchive.org/rg-456/500.jpg",
                  "250": "http://coverartarchive.org/rg-456/250.jpg",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const query = parseTrackMetadataForArtwork({
      title: "Aerodynamic",
      artist: "Daft Punk",
      album: "Discovery",
    });
    const candidates = await musicBrainzCaaAdapter.findArtwork(query);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].source, "coverartarchive");
    assert.equal(candidates[0].url, "https://coverartarchive.org/rg-456/500.jpg");
    assert.equal(candidates[0].smallUrl, "https://coverartarchive.org/rg-456/250.jpg");
    assert.equal(candidates[0].mbid, "rg-456");
    assert.ok(requestedUrls.some((u) => u.includes("/release-group/rg-456")));
  });

  it("itunesArtworkAdapter rejects wrong/tribute artists and upgrades artwork dimensions", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          resultCount: 2,
          results: [
            {
              wrapperType: "collection",
              collectionType: "Album",
              artistName: "Tribute Band",
              collectionName: "Tribute to Daft Punk - Discovery",
              artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/fake/100x100bb.jpg",
            },
            {
              wrapperType: "collection",
              collectionType: "Album",
              artistName: "Daft Punk",
              collectionName: "Discovery",
              artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/real/100x100bb.jpg",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "text/javascript" } },
      )) as typeof fetch;

    const query = parseTrackMetadataForArtwork({
      title: "One More Time",
      artist: "Daft Punk",
      album: "Discovery",
    });
    const candidates = await itunesArtworkAdapter.findArtwork(query);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].url, "https://is1-ssl.mzstatic.com/image/thumb/real/600x600bb.jpg");
    assert.equal(candidates[0].smallUrl, "https://is1-ssl.mzstatic.com/image/thumb/real/250x250bb.jpg");
  });

  it("resolveTrackArtwork preserves embedded/user artwork and skips auto-lookup for sample tracks", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const embeddedTrack = makeTrack({
      id: "local-emb-1",
      artwork: "data:image/png;base64,AAAA",
      artworkSmall: "data:image/png;base64,AAAA",
      artworkMeta: {
        source: "embedded",
        attribution: "Embedded in audio file",
        confidence: 100,
        matchType: "embedded",
      },
    });

    const embRes = await resolveTrackArtwork(embeddedTrack);
    assert.equal(embRes.status, "resolved");
    assert.equal(embRes.meta.source, "embedded");
    assert.equal(embRes.url, "data:image/png;base64,AAAA");
    assert.equal(fetchCount, 0);

    const sampleTrack = makeTrack({
      id: "sample-1",
      providerId: "sample",
      providerName: "Sample library",
      title: "Aurora Drift",
      artist: "Soren Lind",
      album: "Still Waters",
      artwork: "linear-gradient(145deg, #2b2722, #5c4632)",
    });

    const sampleRes = await resolveTrackArtwork(sampleTrack, { skipSampleAuto: true });
    assert.equal(sampleRes.status, "missing");
    assert.equal(fetchCount, 0);
  });

  it("resolveTrackArtwork falls back to iTunes when MusicBrainz has no cover and respects broken URLs", async () => {
    const itunesBrokenUrl = "https://is1-ssl.mzstatic.com/image/thumb/broken/600x600bb.jpg";
    markArtworkUrlBroken(itunesBrokenUrl);

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("musicbrainz.org")) {
        return new Response(JSON.stringify({ releases: [], recordings: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("itunes.apple.com")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                wrapperType: "collection",
                collectionType: "Album",
                artistName: "Phoebe Bridgers",
                collectionName: "Punisher",
                artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/punisher/100x100bb.jpg",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Simulate non-image/unavailable image fetch so resolve falls back gracefully to canonical remote URL
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const track = makeTrack({
      id: "local-indie-1",
      title: "Kyoto",
      artist: "Phoebe Bridgers",
      album: "Punisher",
    });

    const res = await resolveTrackArtwork(track);
    assert.equal(res.status, "resolved");
    assert.equal(res.meta.source, "itunes");
    assert.equal(res.url, "https://is1-ssl.mzstatic.com/image/thumb/punisher/600x600bb.jpg");
  });
});
