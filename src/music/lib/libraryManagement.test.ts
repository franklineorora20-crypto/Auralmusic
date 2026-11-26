import test from "node:test";
import assert from "node:assert/strict";
import type { Playlist, Track } from "../../types";
import {
  dedupeTrackIds,
  exportPlaylistAsJson,
  exportPlaylistAsM3u,
  findDuplicateTracks,
  sortPlaylistTrackIds,
} from "./libraryManagement";

function makeTrack(id: string, title: string, artist: string, duration = 180): Track {
  return {
    id,
    providerId: "local",
    providerName: "Local",
    providerTrackId: id,
    title,
    artist,
    album: "Album",
    artwork: "",
    artworkSmall: "",
    duration,
    streamUrl: `blob:local/${id}`,
    genre: "Electronic",
    tags: [],
    licensing: { name: "Local", streamingAllowed: true, downloadAllowed: true },
    accent: "#c49e64",
    imported: true,
  };
}

test("dedupeTrackIds and sortPlaylistTrackIds order and clean playlists", () => {
  const t1 = makeTrack("1", "Zephyr", "Beta", 120);
  const t2 = makeTrack("2", "Aurora", "Alpha", 260);
  const map = new Map([
    ["1", t1],
    ["2", t2],
  ]);

  assert.deepEqual(dedupeTrackIds(["1", "2", "1", "2"]), ["1", "2"]);
  assert.deepEqual(sortPlaylistTrackIds(["1", "2"], (id) => map.get(id), "title"), ["2", "1"]);
  assert.deepEqual(sortPlaylistTrackIds(["2", "1"], (id) => map.get(id), "duration"), ["2", "1"]);
});

test("findDuplicateTracks groups matching title+artist regardless of punctuation", () => {
  const a = makeTrack("local-1", "Midnight City!", "M83");
  const b = makeTrack("local-2", "midnight city", "M83");
  const c = makeTrack("local-3", "Other Song", "M83");
  const groups = findDuplicateTracks([a, b, c]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tracks.map((t) => t.id), ["local-1", "local-2"]);
});

test("exportPlaylistAsM3u and exportPlaylistAsJson generate valid outputs", () => {
  const playlist: Playlist = {
    id: "pl-1",
    name: "Night Mix",
    description: "Late night tracks",
    trackIds: ["1"],
    createdAt: 1,
    updatedAt: 2,
  };
  const tracks = [makeTrack("1", "Aurora", "Nova", 205)];
  const m3u = exportPlaylistAsM3u(playlist, tracks);
  assert.match(m3u, /#EXTM3U/);
  assert.match(m3u, /#EXTINF:205,Nova - Aurora/);

  const json = JSON.parse(exportPlaylistAsJson(playlist, tracks)) as { name: string; tracks: Array<{ title: string }> };
  assert.equal(json.name, "Night Mix");
  assert.equal(json.tracks[0].title, "Aurora");
});
