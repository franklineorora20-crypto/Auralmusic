import path from "node:path";

export const ALLOWED_AUDIO_FORMATS = ["mp3", "m4a", "opus", "wav"] as const;
export type YtdlpAudioFormat = (typeof ALLOWED_AUDIO_FORMATS)[number];

export interface YtdlpDiscoveredItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail: string;
  sourceUrl: string;
  webpageUrl: string;
  extractor: string;
}

export interface YtdlpDiscoveryResult {
  kind: "single" | "playlist";
  title: string;
  uploader: string;
  sourceUrl: string;
  thumbnail: string;
  itemCount: number;
  items: YtdlpDiscoveredItem[];
  notice: string;
}

const MAX_URL_LENGTH = 2048;

export const METADATA_DISCLAIMER =
  "Metadata retrieval inspects public reference details only and does not grant permission to stream or download copyrighted content.";

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrReservedIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase().split("%")[0];
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    if (isPrivateOrReservedIpv4(mapped)) return true;
  }
  return false;
}

export function isDisallowedIpAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return true;
  if (isPrivateOrReservedIpv4(trimmed)) return true;
  if (isPrivateOrReservedIpv6(trimmed)) return true;
  return false;
}

export function isDisallowedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!normalized) return true;
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal" ||
    normalized === "metadata"
  ) {
    return true;
  }
  if (/^\d+$/.test(normalized)) return true; // decimal IPv4 obfuscation
  if (/^0x[0-9a-f]+$/i.test(normalized)) return true; // hex IPv4 obfuscation
  return isDisallowedIpAddress(normalized);
}

export function validateMediaUrl(
  rawUrl: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof rawUrl !== "string") {
    return { ok: false, error: "Enter a media or playlist URL." };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a media or playlist URL." };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: "The URL is too long." };
  }
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) {
    return { ok: false, error: "The URL contains invalid whitespace or control characters." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid http:// or https:// URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// media URLs are supported." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed." };
  }
  if (isDisallowedHostname(parsed.hostname)) {
    return { ok: false, error: "Local network and loopback addresses are blocked." };
  }

  return { ok: true, url: parsed.toString() };
}

export function validateAudioFormat(rawFormat: unknown): YtdlpAudioFormat {
  if (rawFormat === undefined || rawFormat === null || rawFormat === "") {
    return "mp3";
  }
  if (typeof rawFormat === "string") {
    const normalized = rawFormat.trim().toLowerCase();
    if ((ALLOWED_AUDIO_FORMATS as readonly string[]).includes(normalized)) {
      return normalized as YtdlpAudioFormat;
    }
  }
  throw new Error(`Unsupported audio format. Choose one of: ${ALLOWED_AUDIO_FORMATS.join(", ")}.`);
}

export function isPathInsideDir(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`;
  return resolvedTarget.startsWith(baseWithSep);
}

export function buildDiscoverArgs(validatedUrl: string, maxItems = 25): string[] {
  const clampedMax = Math.max(1, Math.min(50, Math.floor(maxItems)));
  return [
    "--ignore-config",
    "--no-exec",
    "--no-warnings",
    "--proto",
    "https,http",
    "--dump-single-json",
    "--flat-playlist",
    "--playlist-end",
    String(clampedMax),
    "--socket-timeout",
    "15",
    "--",
    validatedUrl,
  ];
}

export function buildImportArgs(
  validatedUrl: string,
  outputTemplate: string,
  options: {
    format: YtdlpAudioFormat;
    maxFilesizeMb?: number;
    ffmpegLocation?: string;
    embedThumbnail?: boolean;
  },
): string[] {
  const maxFilesizeMb = Math.max(1, Math.min(80, Math.floor(options.maxFilesizeMb ?? 75)));
  const args = [
    "--ignore-config",
    "--no-exec",
    "--no-warnings",
    "--proto",
    "https,http",
    "--no-playlist",
    "--newline",
    "--progress",
    "--extract-audio",
    "--audio-format",
    options.format,
    "--audio-quality",
    "0",
    "--max-filesize",
    `${maxFilesizeMb}M`,
    "--socket-timeout",
    "20",
    "--write-info-json",
    "--add-metadata",
  ];

  if (options.ffmpegLocation) {
    args.push("--ffmpeg-location", options.ffmpegLocation);
  }
  if (options.embedThumbnail && (options.format === "mp3" || options.format === "m4a")) {
    args.push("--embed-thumbnail");
  }

  args.push("-o", outputTemplate, "--", validatedUrl);
  return args;
}

export function parseProgressLine(line: string): { percent?: number; statusText?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const downloadMatch = trimmed.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (downloadMatch) {
    const rawPercent = Number(downloadMatch[1]);
    if (Number.isFinite(rawPercent)) {
      const percent = Math.max(0, Math.min(95, Math.round(rawPercent * 0.9)));
      return { percent, statusText: `Downloading authorized media (${Math.round(rawPercent)}%)…` };
    }
  }

  if (trimmed.startsWith("[ExtractAudio]")) {
    return { percent: 96, statusText: "Extracting audio stream…" };
  }
  if (trimmed.startsWith("[Metadata]") || trimmed.startsWith("[EmbedThumbnail]")) {
    return { percent: 98, statusText: "Embedding metadata and artwork…" };
  }
  return null;
}

function safeHttpImageUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const checked = validateMediaUrl(raw);
  return checked.ok ? checked.url : "";
}

function readStringField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readNumberField(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
  }
  return 0;
}

function pickThumbnail(obj: Record<string, unknown>): string {
  const direct = safeHttpImageUrl(obj.thumbnail);
  if (direct) return direct;
  const thumbs = obj.thumbnails;
  if (Array.isArray(thumbs)) {
    for (let i = thumbs.length - 1; i >= 0; i -= 1) {
      const entry = thumbs[i];
      if (entry && typeof entry === "object") {
        const candidate = safeHttpImageUrl((entry as Record<string, unknown>).url);
        if (candidate) return candidate;
      }
    }
  }
  return "";
}

function resolveEntrySourceUrl(
  entry: Record<string, unknown>,
  fallbackUrl: string,
  playlistExtractor?: string,
): string {
  const candidates = [
    readStringField(entry, "webpage_url", "original_url", "url"),
    fallbackUrl,
  ];
  for (const candidate of candidates) {
    const validated = validateMediaUrl(candidate);
    if (validated.ok) return validated.url;
  }

  const rawId = readStringField(entry, "id");
  const ieKey = readStringField(entry, "ie_key", "extractor_key", "extractor") || playlistExtractor || "";
  if (rawId && /youtube/i.test(ieKey)) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(rawId)}`;
  }
  if (rawId && /soundcloud/i.test(ieKey) && fallbackUrl.startsWith("http")) {
    return fallbackUrl;
  }
  return fallbackUrl;
}

function mapDiscoveredItem(
  raw: unknown,
  fallbackUrl: string,
  index: number,
  playlistTitle = "",
  playlistExtractor = "",
): YtdlpDiscoveredItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const title = readStringField(obj, "title", "track", "fulltitle") || `Media item ${index + 1}`;
  const artist =
    readStringField(obj, "artist", "creator", "uploader", "channel", "uploader_id") || "Unknown uploader";
  const album = readStringField(obj, "album") || playlistTitle || "Single";
  const duration = readNumberField(obj, "duration");
  const thumbnail = pickThumbnail(obj);
  const sourceUrl = resolveEntrySourceUrl(obj, fallbackUrl, playlistExtractor);
  const webpageUrl = safeHttpImageUrl(readStringField(obj, "webpage_url")) || sourceUrl;
  const extractor = readStringField(obj, "extractor_key", "extractor", "ie_key") || playlistExtractor || "yt-dlp";
  const id = readStringField(obj, "id") || `item-${index + 1}`;

  return {
    id,
    title,
    artist,
    album,
    duration,
    thumbnail,
    sourceUrl,
    webpageUrl,
    extractor,
  };
}

export function normalizeDiscoveryPayload(raw: unknown, requestedUrl: string): YtdlpDiscoveryResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("yt-dlp returned an unexpected metadata payload.");
  }
  const obj = raw as Record<string, unknown>;
  const type = readStringField(obj, "_type");
  const entries = Array.isArray(obj.entries) ? obj.entries : null;
  const playlistExtractor = readStringField(obj, "extractor_key", "extractor");

  if (type === "playlist" || entries) {
    const playlistTitle = readStringField(obj, "title") || "Playlist";
    const uploader = readStringField(obj, "uploader", "channel", "uploader_id") || "Unknown creator";
    const items = (entries ?? [])
      .map((entry, idx) => mapDiscoveredItem(entry, requestedUrl, idx, playlistTitle, playlistExtractor))
      .filter((item): item is YtdlpDiscoveredItem => item !== null);

    if (items.length === 0) {
      throw new Error("No playable media entries were found at this playlist URL.");
    }

    const thumbnail = pickThumbnail(obj) || items.find((item) => item.thumbnail)?.thumbnail || "";
    const itemCount = readNumberField(obj, "playlist_count") || items.length;
    const sourceUrl = safeHttpImageUrl(readStringField(obj, "webpage_url", "original_url")) || requestedUrl;

    return {
      kind: "playlist",
      title: playlistTitle,
      uploader,
      sourceUrl,
      thumbnail,
      itemCount,
      items,
      notice: METADATA_DISCLAIMER,
    };
  }

  const single = mapDiscoveredItem(obj, requestedUrl, 0);
  if (!single) {
    throw new Error("No media metadata could be extracted from this URL.");
  }

  return {
    kind: "single",
    title: single.title,
    uploader: single.artist,
    sourceUrl: single.webpageUrl || requestedUrl,
    thumbnail: single.thumbnail,
    itemCount: 1,
    items: [single],
    notice: METADATA_DISCLAIMER,
  };
}
