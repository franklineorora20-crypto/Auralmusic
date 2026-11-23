import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEmbeddedMediaFromAudioBytes,
  imageBytesToDataUrl,
  isDisplayableImageUrl,
  sniffImageMime,
} from "./mediaMetadata";

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
    0x49, 0x44, 0x33,
    0x03, 0x00,
    0x00,
    ...makeSynchsafe(body.length),
    ...body,
  ]);
}

function makeMp4Box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, body]);
}

// 20-byte synthetic PNG-prefixed payload
const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

// 20-byte synthetic JPEG-prefixed payload
const FAKE_JPG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00,
]);

test("sniffImageMime and isDisplayableImageUrl validate image types and URLs", () => {
  assert.equal(sniffImageMime(FAKE_PNG), "image/png");
  assert.equal(sniffImageMime(FAKE_JPG), "image/jpeg");
  assert.equal(sniffImageMime(new Uint8Array([0, 1, 2, 3]), "PNG"), "image/png");

  assert.equal(isDisplayableImageUrl("https://example.com/a.jpg"), true);
  assert.equal(isDisplayableImageUrl("data:image/png;base64,AAAA"), true);
  assert.equal(isDisplayableImageUrl("blob:https://app.test/123"), true);
  assert.equal(isDisplayableImageUrl("/pwa-512x512.png"), true);
  assert.equal(isDisplayableImageUrl(""), false);
  assert.equal(isDisplayableImageUrl("javascript:alert(1)"), false);
});

test("extractEmbeddedMediaFromAudioBytes extracts ID3v2 APIC front cover artwork", () => {
  const bytes = makeId3v23([
    { id: "TIT2", payload: [0x03, ...Buffer.from("Sunset Road", "utf8")] },
    { id: "TPE1", payload: [0x03, ...Buffer.from("Coastal Tape", "utf8")] },
    {
      id: "APIC",
      payload: [
        0x00, // latin1 description
        ...Buffer.from("image/png", "ascii"), 0x00,
        0x06, // media/other picture type
        0x00, // empty description
        ...FAKE_PNG,
      ],
    },
    {
      id: "APIC",
      payload: [
        0x00,
        ...Buffer.from("image/jpeg", "ascii"), 0x00,
        0x03, // cover (front) should win over type 6
        ...Buffer.from("Front", "ascii"), 0x00,
        ...FAKE_JPG,
      ],
    },
  ]);

  const extracted = extractEmbeddedMediaFromAudioBytes(bytes);
  assert.ok(extracted);
  assert.equal(extracted.title, "Sunset Road");
  assert.equal(extracted.artist, "Coastal Tape");
  assert.ok(extracted.artwork);
  assert.equal(extracted.artwork.mime, "image/jpeg");
  assert.deepEqual(extracted.artwork.data, FAKE_JPG);
  const dataUrl = imageBytesToDataUrl(extracted.artwork.data, extracted.artwork.mime);
  assert.ok(dataUrl.startsWith("data:image/jpeg;base64,"));
});

test("extractEmbeddedMediaFromAudioBytes extracts FLAC PICTURE block", () => {
  const mime = Buffer.from("image/png", "ascii");
  const picBlock = Buffer.concat([
    Buffer.from(makeUint32BE(3)), // Cover (front)
    Buffer.from(makeUint32BE(mime.length)),
    mime,
    Buffer.from(makeUint32BE(0)), // description len
    Buffer.alloc(16), // width, height, depth, colors
    Buffer.from(makeUint32BE(FAKE_PNG.length)),
    Buffer.from(FAKE_PNG),
  ]);
  const header = Buffer.from([
    0x66, 0x4c, 0x61, 0x43, // fLaC
    0x86, // last block + type 6 (PICTURE)
    (picBlock.length >> 16) & 0xff,
    (picBlock.length >> 8) & 0xff,
    picBlock.length & 0xff,
  ]);
  const extracted = extractEmbeddedMediaFromAudioBytes(new Uint8Array(Buffer.concat([header, picBlock])));
  assert.ok(extracted?.artwork);
  assert.equal(extracted.artwork.mime, "image/png");
  assert.deepEqual(extracted.artwork.data, FAKE_PNG);
});

test("extractEmbeddedMediaFromAudioBytes extracts MP4/M4A metadata and covr artwork", () => {
  const makeData = (typeInt: number, payload: Buffer) => {
    const typeBytes = Buffer.from([0, 0, 0, typeInt, 0, 0, 0, 0]);
    return makeMp4Box("data", Buffer.concat([typeBytes, payload]));
  };
  const ilst = makeMp4Box(
    "ilst",
    Buffer.concat([
      makeMp4Box("\u00a9nam", makeData(1, Buffer.from("Night Train", "utf8"))),
      makeMp4Box("\u00a9ART", makeData(1, Buffer.from("M4A Artist", "utf8"))),
      makeMp4Box("\u00a9alb", makeData(1, Buffer.from("Station", "utf8"))),
      makeMp4Box("covr", makeData(13, Buffer.from(FAKE_JPG))),
    ]),
  );
  const meta = makeMp4Box("meta", Buffer.concat([Buffer.alloc(4), ilst]));
  const udta = makeMp4Box("udta", meta);
  const moov = makeMp4Box("moov", udta);
  const ftyp = makeMp4Box("ftyp", Buffer.from("M4A \0\0\0\0", "latin1"));

  const extracted = extractEmbeddedMediaFromAudioBytes(new Uint8Array(Buffer.concat([ftyp, moov])));
  assert.ok(extracted);
  assert.equal(extracted.title, "Night Train");
  assert.equal(extracted.artist, "M4A Artist");
  assert.equal(extracted.album, "Station");
  assert.ok(extracted.artwork);
  assert.equal(extracted.artwork.mime, "image/jpeg");
  assert.deepEqual(extracted.artwork.data, FAKE_JPG);
});
