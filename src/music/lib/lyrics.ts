/**
 * Pure lyrics parsing, time synchronization, and embedded audio metadata
 * extraction utilities (LRC, ID3v2 USLT/SYLT/TXXX, FLAC Vorbis comments, MP4 ©lyr).
 */

export type LyricLine = {
  /** Timestamp in seconds (>= 0). */
  time: number;
  text: string;
};

export type LyricsMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  length?: string;
  offsetMs?: number;
};

export type ParsedLyrics = {
  synced: boolean;
  lines: LyricLine[];
  plainText: string;
  metadata: LyricsMetadata;
};

export type EmbeddedAudioMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
};

const LRC_TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_TAG_RE = /^\[(ti|ar|al|by|length|offset):([^\]]*)\]$/i;

function parseFractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0;
  if (fraction.length === 1) return Number(fraction) / 10;
  if (fraction.length === 2) return Number(fraction) / 100;
  return Number(fraction.slice(0, 3)) / 1000;
}

/**
 * Parses standard LRC text (including multi-timestamp lines and `[offset:]` tags)
 * or falls back to unsynced plain lyrics when no timestamps are present.
 */
export function parseLrc(raw: string): ParsedLyrics {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return { synced: false, lines: [], plainText: "", metadata: {} };
  }

  const metadata: LyricsMetadata = {};
  const timedEntries: Array<{ rawTime: number; text: string }> = [];
  const untimedLines: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      untimedLines.push("");
      continue;
    }

    const tagMatch = trimmed.match(LRC_TAG_RE);
    if (tagMatch) {
      const key = tagMatch[1].toLowerCase();
      const value = tagMatch[2].trim();
      if (key === "ti" && value) metadata.title = value;
      else if (key === "ar" && value) metadata.artist = value;
      else if (key === "al" && value) metadata.album = value;
      else if (key === "by" && value) metadata.by = value;
      else if (key === "length" && value) metadata.length = value;
      else if (key === "offset") {
        const parsedOffset = Number.parseInt(value, 10);
        if (Number.isFinite(parsedOffset)) metadata.offsetMs = parsedOffset;
      }
      continue;
    }

    // Ignore other header metadata tags like [re:...] or [ve:...]
    if (/^\[[a-z]{2,8}:[^\]]*\]$/i.test(trimmed)) {
      continue;
    }

    const timestamps: number[] = [];
    LRC_TIMESTAMP_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LRC_TIMESTAMP_RE.exec(trimmed)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = parseFractionToSeconds(match[3]);
      if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
        timestamps.push(minutes * 60 + seconds + fraction);
      }
    }

    if (timestamps.length > 0) {
      // Strip inline enhanced-LRC word tags like <00:12.34> while keeping text intact.
      const text = trimmed
        .replace(LRC_TIMESTAMP_RE, "")
        .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
        .trim();
      for (const rawTime of timestamps) {
        timedEntries.push({ rawTime, text });
      }
    } else {
      untimedLines.push(trimmed);
    }
  }

  if (timedEntries.length > 0) {
    const offsetSeconds = (metadata.offsetMs ?? 0) / 1000;
    const lines = timedEntries
      .map((entry) => ({
        time: Math.max(0, Math.round((entry.rawTime - offsetSeconds) * 1000) / 1000),
        text: entry.text,
      }))
      .sort((a, b) => a.time - b.time);

    const plainText = lines
      .map((line) => line.text)
      .filter((line) => line.length > 0)
      .join("\n");

    return { synced: true, lines, plainText, metadata };
  }

  // Collapse leading/trailing empty lines while keeping stanza breaks.
  const plainText = untimedLines.join("\n").replace(/^\n+|\n+$/g, "");
  return {
    synced: false,
    lines: [],
    plainText,
    metadata,
  };
}

/** Formats seconds as `[mm:ss.xx]` for LRC serialization. */
export function formatLrcTimestamp(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}]`;
}

/** Formats `[mm:ss]` display timestamp for UI controls. */
export function formatLyricCueTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Returns the index of the active lyric line for `currentTime` (plus optional
 * user sync `offsetSeconds`), or -1 when playback is before the first line.
 */
export function findActiveLyricIndex(
  lines: ReadonlyArray<LyricLine>,
  currentTime: number,
  offsetSeconds = 0,
): number {
  if (!lines.length || !Number.isFinite(currentTime)) return -1;
  const target = currentTime + offsetSeconds + 0.05;
  if (target < lines[0].time) return -1;

  let low = 0;
  let high = lines.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Binary metadata extraction (ID3v2, FLAC Vorbis comments, MP4 ©lyr)         */
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
      // UTF-16 with BOM
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

function parseUsltPayload(payload: Uint8Array): string {
  if (payload.length < 4) return "";
  const encoding = payload[0];
  // Bytes 1..3 are ISO-639-2 language code
  const descEnd = findNullTerminator(payload, 4, encoding);
  const textStart = Math.min(payload.length, descEnd + nullTerminatorWidth(encoding));
  return decodeTextBytes(payload.subarray(textStart), encoding).trim();
}

function parseSyltPayload(payload: Uint8Array): string {
  if (payload.length < 6) return "";
  const encoding = payload[0];
  // Bytes 1..3: language, Byte 4: timestamp format (2 = ms), Byte 5: content type
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
    // Standard ID3 SYLT uses ms when timestampFormat === 2; fallback treats MPEG frames lightly at ~26ms/frame
    const seconds = timestampFormat === 1 ? (rawStamp * 0.026) : rawStamp / 1000;
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

function parseId3v2(bytes: Uint8Array): EmbeddedAudioMetadata | null {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const majorVersion = bytes[3];
  const flags = bytes[5];
  const tagSize = readSynchsafe32(bytes, 6);
  const limit = Math.min(bytes.length, 10 + tagSize);

  let offset = 10;
  // Skip ID3v2.3/2.4 extended header if present (bit 6)
  if (majorVersion >= 3 && (flags & 0x40) !== 0 && offset + 4 <= limit) {
    const extSize = majorVersion === 4 ? readSynchsafe32(bytes, offset) : readUint32BE(bytes, offset);
    offset += majorVersion === 4 ? extSize : extSize + 4;
  }

  const result: EmbeddedAudioMetadata = {};

  while (offset < limit) {
    if (bytes[offset] === 0) break; // Padding reached

    let frameId = "";
    let frameSize = 0;
    let headerSize = 0;

    if (majorVersion === 2) {
      if (offset + 6 > limit) break;
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      frameSize = readUint24BE(bytes, offset + 3);
      headerSize = 6;
    } else {
      if (offset + 10 > limit) break;
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      frameSize = majorVersion === 4 ? readSynchsafe32(bytes, offset + 4) : readUint32BE(bytes, offset + 4);
      headerSize = 10;
    }

    if (!/^[A-Z0-9]{3,4}$/.test(frameId) || frameSize <= 0) break;
    const payloadStart = offset + headerSize;
    const payloadEnd = Math.min(limit, payloadStart + frameSize);
    const payload = bytes.subarray(payloadStart, payloadEnd);

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
    }

    offset = payloadEnd;
  }

  return Object.keys(result).length > 0 ? result : null;
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

function parseFlacMetadata(bytes: Uint8Array): EmbeddedAudioMetadata | null {
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return null;
  }
  let offset = 4;
  const result: EmbeddedAudioMetadata = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockSize = readUint24BE(bytes, offset + 1);
    offset += 4;
    if (offset + blockSize > bytes.length) break;

    if (blockType === 4 && blockSize >= 8) {
      // VORBIS_COMMENT
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
    }

    offset += blockSize;
    if (isLast) break;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extracts embedded lyrics and basic tags (title, artist, album) from MP3
 * (ID3v2) or FLAC audio file bytes. Returns null if no supported tags exist.
 */
export function extractEmbeddedLyricsFromAudioBytes(bytes: Uint8Array): EmbeddedAudioMetadata | null {
  if (!bytes.length) return null;
  return parseId3v2(bytes) ?? parseFlacMetadata(bytes);
}
