/**
 * Pure embedded audio metadata & cover artwork extraction (ID3v2 APIC/PIC,
 * FLAC METADATA_BLOCK_PICTURE + VORBIS_COMMENT, and MP4/M4A moov/ilst atoms),
 * plus browser-safe image data URL conversion utilities.
 */

import { formatLrcTimestamp, parseLrc } from "./lyrics";

export type EmbeddedArtwork = {
  mime: string;
  data: Uint8Array;
};

export type EmbeddedMediaMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  artwork?: EmbeddedArtwork;
};

export function isDisplayableImageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/")
  );
}

export function sniffImageMime(bytes: Uint8Array, declaredMime?: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const normalized = (declaredMime ?? "").trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "gif") return "image/gif";
  if (normalized === "webp") return "image/webp";
  if (normalized.startsWith("image/") && normalized !== "image/") return normalized;
  return "image/jpeg";
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += hasB2 ? BASE64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

export function imageBytesToDataUrl(bytes: Uint8Array, declaredMime?: string): string {
  if (!bytes.length) return "";
  const mime = sniffImageMime(bytes, declaredMime);
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
}

/* -------------------------------------------------------------------------- */
/* Binary readers                                                             */
/* -------------------------------------------------------------------------- */

function readSynchsafe32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readUint24BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function decodeTextBytes(bytes: Uint8Array, encoding: number): string {
  if (!bytes.length) return "";
  try {
    if (encoding === 0) {
      return new TextDecoder("latin1").decode(bytes).replace(/\0+$/g, "");
    }
    if (encoding === 1) {
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(bytes.subarray(2)).replace(/\0+$/g, "");
      }
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(bytes.subarray(2)).replace(/\0+$/g, "");
      }
      return new TextDecoder("utf-16le").decode(bytes).replace(/\0+$/g, "");
    }
    if (encoding === 2) {
      return new TextDecoder("utf-16be").decode(bytes).replace(/\0+$/g, "");
    }
    return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "");
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\0+$/g, "");
  }
}

function findNullTerminator(bytes: Uint8Array, start: number, encoding: number): number {
  const isUtf16 = encoding === 1 || encoding === 2;
  if (isUtf16) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return i;
  }
  return bytes.length;
}

function nullTerminatorWidth(encoding: number): number {
  return encoding === 1 || encoding === 2 ? 2 : 1;
}

function ununsyncBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    out[j] = bytes[i];
    j += 1;
    if (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0x00) {
      i += 1;
    }
  }
  return out.subarray(0, j);
}

/* -------------------------------------------------------------------------- */
/* ID3v2 parser (text, lyrics, APIC / PIC artwork)                            */
/* -------------------------------------------------------------------------- */

function parseUsltPayload(payload: Uint8Array): string {
  if (payload.length < 4) return "";
  const encoding = payload[0];
  const descEnd = findNullTerminator(payload, 4, encoding);
  const textStart = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  return decodeTextBytes(payload.subarray(textStart), encoding).trim();
}

function parseSyltPayload(payload: Uint8Array): string {
  if (payload.length < 6) return "";
  const encoding = payload[0];
  const timestampFormat = payload[4];
  const descEnd = findNullTerminator(payload, 6, encoding);
  let cursor = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  const lines: string[] = [];

  while (cursor < payload.length) {
    const textEnd = findNullTerminator(payload, cursor, encoding);
    const segment = decodeTextBytes(payload.subarray(cursor, textEnd), encoding);
    cursor = textEnd + nullTerminatorWidth(encoding);
    if (cursor + 4 > payload.length) break;
    const rawStamp = readUint32BE(payload, cursor);
    cursor += 4;
    const seconds = timestampFormat === 1 ? rawStamp * 0.026 : rawStamp / 1000;
    const cleanText = segment.replace(/\r?\n/g, " ").trim();
    lines.push(`${formatLrcTimestamp(seconds)}${cleanText}`);
  }

  return lines.join("\n");
}

function parseTxxxPayload(payload: Uint8Array): { key: string; value: string } | null {
  if (payload.length < 2) return null;
  const encoding = payload[0];
  const descEnd = findNullTerminator(payload, 1, encoding);
  const key = decodeTextBytes(payload.subarray(1, descEnd), encoding).trim().toUpperCase();
  const valueStart = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  const value = decodeTextBytes(payload.subarray(valueStart), encoding).trim();
  if (!key || !value) return null;
  return { key, value };
}

function parseApicPayload(payload: Uint8Array): { pictureType: number; artwork: EmbeddedArtwork } | null {
  if (payload.length < 6) return null;
  const encoding = payload[0];
  const mimeEnd = findNullTerminator(payload, 1, 0);
  if (mimeEnd >= payload.length) return null;
  const declaredMime = decodeTextBytes(payload.subarray(1, mimeEnd), 0).trim();
  const picTypeOffset = mimeEnd + 1;
  if (picTypeOffset >= payload.length) return null;
  const pictureType = payload[picTypeOffset];
  const descStart = picTypeOffset + 1;
  const descEnd = findNullTerminator(payload, descStart, encoding);
  const imageStart = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  const data = payload.subarray(imageStart);
  if (data.length < 16 || declaredMime === "-->") return null;
  return {
    pictureType,
    artwork: {
      mime: sniffImageMime(data, declaredMime),
      data: data.slice(),
    },
  };
}

function parsePicPayload(payload: Uint8Array): { pictureType: number; artwork: EmbeddedArtwork } | null {
  if (payload.length < 7) return null;
  const encoding = payload[0];
  const declaredFormat = decodeTextBytes(payload.subarray(1, 4), 0).trim();
  const pictureType = payload[4];
  const descEnd = findNullTerminator(payload, 5, encoding);
  const imageStart = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  const data = payload.subarray(imageStart);
  if (data.length < 16 || declaredFormat === "-->") return null;
  return {
    pictureType,
    artwork: {
      mime: sniffImageMime(data, declaredFormat),
      data: data.slice(),
    },
  };
}

function isValidFrameId(bytes: Uint8Array, offset: number): boolean {
  if (offset + 4 > bytes.length) return false;
  for (let i = 0; i < 4; i += 1) {
    const ch = bytes[offset + i];
    const isUpper = ch >= 0x41 && ch <= 0x5a;
    const isDigit = ch >= 0x30 && ch <= 0x39;
    if (!isUpper && !isDigit) return false;
  }
  return true;
}

function resolveId3v24FrameSize(bytes: Uint8Array, offset: number, limit: number): number {
  const synchsafe = readSynchsafe32(bytes, offset + 4);
  const rawBe = readUint32BE(bytes, offset + 4);
  if (synchsafe === rawBe) return synchsafe;
  const afterSynch = offset + 10 + synchsafe;
  const afterRaw = offset + 10 + rawBe;
  if (afterSynch <= limit && (afterSynch === limit || bytes[afterSynch] === 0 || isValidFrameId(bytes, afterSynch))) {
    return synchsafe;
  }
  if (afterRaw <= limit && (afterRaw === limit || bytes[afterRaw] === 0 || isValidFrameId(bytes, afterRaw))) {
    return rawBe;
  }
  return synchsafe;
}

function parseId3v2Media(bytes: Uint8Array): EmbeddedMediaMetadata | null {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const majorVersion = bytes[3];
  const flags = bytes[5];
  const tagSize = readSynchsafe32(bytes, 6);
  const rawBody = bytes.subarray(10, Math.min(bytes.length, 10 + tagSize));
  const body = majorVersion <= 3 && (flags & 0x80) !== 0 ? ununsyncBytes(rawBody) : rawBody;
  const limit = body.length;

  let offset = 0;
  if (majorVersion >= 3 && (flags & 0x40) !== 0 && offset + 4 <= limit) {
    const extSize = majorVersion === 4 ? readSynchsafe32(body, offset) : readUint32BE(body, offset);
    offset += majorVersion === 4 ? extSize : extSize + 4;
  }

  const result: EmbeddedMediaMetadata = {};
  let bestPicPriority = -1;

  while (offset < limit) {
    if (body[offset] === 0) break;

    let frameId = "";
    let frameSize = 0;
    let headerSize = 0;
    let frameFlags = 0;

    if (majorVersion === 2) {
      if (offset + 6 > limit) break;
      frameId = String.fromCharCode(body[offset], body[offset + 1], body[offset + 2]);
      frameSize = readUint24BE(body, offset + 3);
      headerSize = 6;
    } else {
      if (offset + 10 > limit) break;
      frameId = String.fromCharCode(body[offset], body[offset + 1], body[offset + 2], body[offset + 3]);
      frameSize = majorVersion === 4 ? resolveId3v24FrameSize(body, offset, limit) : readUint32BE(body, offset + 4);
      frameFlags = (body[offset + 8] << 8) | body[offset + 9];
      headerSize = 10;
    }

    if (!/^[A-Z0-9]{3,4}$/.test(frameId) || frameSize <= 0) break;
    const payloadStart = offset + headerSize;
    const payloadEnd = Math.min(limit, payloadStart + frameSize);
    let payload = body.subarray(payloadStart, payloadEnd);

    if (majorVersion === 4 && (frameFlags & 0x0002) !== 0) {
      payload = ununsyncBytes(payload);
    }

    if (frameId === "TIT2" || frameId === "TT2") {
      if (payload.length > 1) result.title = decodeTextBytes(payload.subarray(1), payload[0]).trim() || result.title;
    } else if (frameId === "TPE1" || frameId === "TP1") {
      if (payload.length > 1) result.artist = decodeTextBytes(payload.subarray(1), payload[0]).trim() || result.artist;
    } else if (frameId === "TALB" || frameId === "TAL") {
      if (payload.length > 1) result.album = decodeTextBytes(payload.subarray(1), payload[0]).trim() || result.album;
    } else if (frameId === "SYLT" || frameId === "SLT") {
      const sylt = parseSyltPayload(payload);
      if (sylt) result.syncedLyrics = sylt;
    } else if (frameId === "USLT" || frameId === "ULT") {
      const uslt = parseUsltPayload(payload);
      if (uslt) {
        const parsed = parseLrc(uslt);
        if (parsed.synced) result.syncedLyrics = result.syncedLyrics || uslt;
        else result.plainLyrics = result.plainLyrics || uslt;
      }
    } else if (frameId === "TXXX" || frameId === "TXX") {
      const txxx = parseTxxxPayload(payload);
      if (txxx && (txxx.key === "LYRICS" || txxx.key === "SYNCEDLYRICS" || txxx.key === "UNSYNCEDLYRICS" || txxx.key === "LRC")) {
        const parsed = parseLrc(txxx.value);
        if (parsed.synced) result.syncedLyrics = result.syncedLyrics || txxx.value;
        else result.plainLyrics = result.plainLyrics || txxx.value;
      }
    } else if (frameId === "APIC" || frameId === "PIC") {
      const parsedPic = frameId === "APIC" ? parseApicPayload(payload) : parsePicPayload(payload);
      if (parsedPic) {
        const priority = parsedPic.pictureType === 3 ? 2 : parsedPic.pictureType === 0 ? 1 : 0;
        if (priority > bestPicPriority) {
          bestPicPriority = priority;
          result.artwork = parsedPic.artwork;
        }
      }
    }

    offset = payloadEnd;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/* -------------------------------------------------------------------------- */
/* FLAC parser (VORBIS_COMMENT + PICTURE)                                     */
/* -------------------------------------------------------------------------- */

function parseFlacPictureBlock(block: Uint8Array): { pictureType: number; artwork: EmbeddedArtwork } | null {
  if (block.length < 32) return null;
  let cursor = 0;
  const pictureType = readUint32BE(block, cursor);
  cursor += 4;
  const mimeLen = readUint32BE(block, cursor);
  cursor += 4;
  if (cursor + mimeLen + 4 > block.length) return null;
  const declaredMime = new TextDecoder("latin1").decode(block.subarray(cursor, cursor + mimeLen)).trim();
  cursor += mimeLen;
  const descLen = readUint32BE(block, cursor);
  cursor += 4 + descLen;
  // Skip width, height, depth, indexed colors (4 * 4 bytes)
  cursor += 16;
  if (cursor + 4 > block.length) return null;
  const dataLen = readUint32BE(block, cursor);
  cursor += 4;
  if (dataLen < 16 || cursor + dataLen > block.length || declaredMime === "-->") return null;
  const data = block.subarray(cursor, cursor + dataLen);
  return {
    pictureType,
    artwork: {
      mime: sniffImageMime(data, declaredMime),
      data: data.slice(),
    },
  };
}

function parseFlacMedia(bytes: Uint8Array): EmbeddedMediaMetadata | null {
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return null;
  }
  let offset = 4;
  const result: EmbeddedMediaMetadata = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bestPicPriority = -1;

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockSize = readUint24BE(bytes, offset + 1);
    offset += 4;
    if (offset + blockSize > bytes.length) break;

    if (blockType === 4 && blockSize >= 8) {
      let cursor = offset;
      const vendorLen = readUint32LE(bytes, cursor);
      cursor += 4 + vendorLen;
      if (cursor + 4 <= offset + blockSize) {
        const count = readUint32LE(bytes, cursor);
        cursor += 4;
        for (let i = 0; i < count && cursor + 4 <= offset + blockSize; i += 1) {
          const entryLen = readUint32LE(bytes, cursor);
          cursor += 4;
          if (cursor + entryLen > offset + blockSize) break;
          const comment = decoder.decode(bytes.subarray(cursor, cursor + entryLen));
          cursor += entryLen;
          const eq = comment.indexOf("=");
          if (eq <= 0) continue;
          const key = comment.slice(0, eq).trim().toUpperCase();
          const value = comment.slice(eq + 1).trim();
          if (!value) continue;
          if (key === "TITLE") result.title = result.title || value;
          else if (key === "ARTIST") result.artist = result.artist || value;
          else if (key === "ALBUM") result.album = result.album || value;
          else if (key === "LYRICS" || key === "SYNCEDLYRICS" || key === "UNSYNCEDLYRICS") {
            const parsed = parseLrc(value);
            if (parsed.synced) result.syncedLyrics = result.syncedLyrics || value;
            else result.plainLyrics = result.plainLyrics || value;
          }
        }
      }
    } else if (blockType === 6) {
      const pic = parseFlacPictureBlock(bytes.subarray(offset, offset + blockSize));
      if (pic) {
        const priority = pic.pictureType === 3 ? 2 : pic.pictureType === 0 ? 1 : 0;
        if (priority > bestPicPriority) {
          bestPicPriority = priority;
          result.artwork = pic.artwork;
        }
      }
    }

    offset += blockSize;
    if (isLast) break;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/* -------------------------------------------------------------------------- */
/* MP4 / M4A parser (moov -> udta -> meta -> ilst -> covr / ©nam / ©ART ...)  */
/* -------------------------------------------------------------------------- */

function readBoxHeader(bytes: Uint8Array, offset: number, end: number): { type: string; headerSize: number; boxEnd: number } | null {
  if (offset + 8 > end) return null;
  const size32 = readUint32BE(bytes, offset);
  const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
  let headerSize = 8;
  let totalSize = size32;
  if (size32 === 1) {
    if (offset + 16 > end) return null;
    const hi = readUint32BE(bytes, offset + 8);
    const lo = readUint32BE(bytes, offset + 12);
    totalSize = hi * 0x100000000 + lo;
    headerSize = 16;
  } else if (size32 === 0) {
    totalSize = end - offset;
  }
  if (totalSize < headerSize) return null;
  const boxEnd = Math.min(end, offset + totalSize);
  return { type, headerSize, boxEnd };
}

function findMp4Box(bytes: Uint8Array, start: number, end: number, targetType: string): { contentStart: number; boxEnd: number } | null {
  let cursor = start;
  while (cursor + 8 <= end) {
    const box = readBoxHeader(bytes, cursor, end);
    if (!box) break;
    if (box.type === targetType) {
      return { contentStart: cursor + box.headerSize, boxEnd: box.boxEnd };
    }
    if (box.boxEnd <= cursor) break;
    cursor = box.boxEnd;
  }
  return null;
}

function readMp4DataAtom(bytes: Uint8Array, start: number, end: number): { dataType: number; payload: Uint8Array } | null {
  const dataBox = findMp4Box(bytes, start, end, "data");
  if (!dataBox || dataBox.contentStart + 8 > dataBox.boxEnd) return null;
  const dataType = readUint32BE(bytes, dataBox.contentStart) & 0x00ffffff;
  return {
    dataType,
    payload: bytes.subarray(dataBox.contentStart + 8, dataBox.boxEnd),
  };
}

function parseMp4Media(bytes: Uint8Array): EmbeddedMediaMetadata | null {
  if (bytes.length < 12) return null;
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (ftyp !== "ftyp") return null;

  const moov = findMp4Box(bytes, 0, bytes.length, "moov");
  if (!moov) return null;
  const udta = findMp4Box(bytes, moov.contentStart, moov.boxEnd, "udta");
  if (!udta) return null;
  const meta = findMp4Box(bytes, udta.contentStart, udta.boxEnd, "meta");
  if (!meta || meta.contentStart + 4 > meta.boxEnd) return null;
  // MP4 `meta` is a FullBox with 4-byte version + flags before child atoms.
  const ilst = findMp4Box(bytes, meta.contentStart + 4, meta.boxEnd, "ilst");
  if (!ilst) return null;

  const result: EmbeddedMediaMetadata = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let cursor = ilst.contentStart;

  while (cursor + 8 <= ilst.boxEnd) {
    const atom = readBoxHeader(bytes, cursor, ilst.boxEnd);
    if (!atom) break;
    const dataAtom = readMp4DataAtom(bytes, cursor + atom.headerSize, atom.boxEnd);
    if (dataAtom && dataAtom.payload.length > 0) {
      if (atom.type === "\u00a9nam") {
        result.title = decoder.decode(dataAtom.payload).trim() || result.title;
      } else if (atom.type === "\u00a9ART") {
        result.artist = decoder.decode(dataAtom.payload).trim() || result.artist;
      } else if (atom.type === "\u00a9alb") {
        result.album = decoder.decode(dataAtom.payload).trim() || result.album;
      } else if (atom.type === "\u00a9lyr") {
        const text = decoder.decode(dataAtom.payload).trim();
        if (text) {
          const parsed = parseLrc(text);
          if (parsed.synced) result.syncedLyrics = result.syncedLyrics || text;
          else result.plainLyrics = result.plainLyrics || text;
        }
      } else if (atom.type === "covr" && dataAtom.payload.length >= 16 && !result.artwork) {
        const declaredMime =
          dataAtom.dataType === 14 ? "image/png" : dataAtom.dataType === 13 ? "image/jpeg" : undefined;
        result.artwork = {
          mime: sniffImageMime(dataAtom.payload, declaredMime),
          data: dataAtom.payload.slice(),
        };
      }
    }
    if (atom.boxEnd <= cursor) break;
    cursor = atom.boxEnd;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extracts embedded title, artist, album, lyrics, and cover artwork from MP3
 * (ID3v2), FLAC, or MP4/M4A bytes. Returns null if no supported tags exist.
 */
export function extractEmbeddedMediaFromAudioBytes(bytes: Uint8Array): EmbeddedMediaMetadata | null {
  if (!bytes.length) return null;
  return parseId3v2Media(bytes) ?? parseFlacMedia(bytes) ?? parseMp4Media(bytes);
}

/**
 * Converts a user-selected image file into a compact persisted data URL
 * suitable for IndexedDB storage, UI rendering, and MediaSession lock screens.
 */
export async function fileToCoverDataUrl(file: File, maxDimension = 640): Promise<string> {
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
  if (!isImage) {
    throw new Error("Please select an image file (PNG, JPG, WebP, or GIF).");
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read this image file."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read this image file."));
    reader.readAsDataURL(file);
  });

  if (typeof document === "undefined") return rawDataUrl;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = rawDataUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return rawDataUrl;

    if (width <= maxDimension && height <= maxDimension && file.size <= 350_000) {
      return rawDataUrl;
    }

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return rawDataUrl;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outputMime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const resized = canvas.toDataURL(outputMime, 0.86);
    if (resized.startsWith("data:image/")) {
      return resized.length < rawDataUrl.length || width > maxDimension || height > maxDimension
        ? resized
        : rawDataUrl;
    }
    return rawDataUrl;
  } catch {
    return rawDataUrl;
  }
}
