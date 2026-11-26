import type { Artist, ProviderPlaylist, Track, TrackLicensing } from "../types/music";
import { PROVIDER_NAMES } from "../types/music";
import { accentFor, clampLimit, clampOffset } from "./base";

export const ARCHIVE_BASE_URL = "https://archive.org";
export const ARCHIVE_ADVANCED_SEARCH_URL = `${ARCHIVE_BASE_URL}/advancedsearch.php`;
export const ARCHIVE_METADATA_URL = `${ARCHIVE_BASE_URL}/metadata`;

export const ARCHIVE_RESTRICTED_COLLECTIONS = new Set([
  "stream_only",
  "lendinglibrary",
  "inlibrary",
  "printdisabled",
  "restricted",
  "protected",
  "dark",
]);

export type ArchiveFileEntry = {
  name?: unknown;
  source?: unknown;
  format?: unknown;
  original?: unknown;
  length?: unknown;
  size?: unknown;
  title?: unknown;
  creator?: unknown;
  artist?: unknown;
  album?: unknown;
  track?: unknown;
  private?: unknown;
};

export type ArchiveItemMetadata = {
  identifier?: unknown;
  mediatype?: unknown;
  title?: unknown;
  creator?: unknown;
  artist?: unknown;
  album?: unknown;
  collection?: unknown;
  date?: unknown;
  year?: unknown;
  licenseurl?: unknown;
  rights?: unknown;
  subject?: unknown;
  genre?: unknown;
  format?: unknown;
  description?: unknown;
  "access-restricted-item"?: unknown;
};

export type ArchiveMetadataResponse = {
  metadata?: ArchiveItemMetadata;
  files?: ArchiveFileEntry[];
  is_dark?: unknown;
  noindex?: unknown;
};

export type ArchiveAudioTrackFile = {
  fileName: string;
  format: string;
  extension: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  duration: number;
  sizeBytes: number;
  streamUrl: string;
  downloadUrl?: string;
};

export type ArchiveRightsResolution = {
  restricted: boolean;
  restrictionReason: string;
  isOpenLicense: boolean;
  isExplicitCopyright: boolean;
  importAllowed: boolean;
  importRequiresConfirmation: boolean;
  licensing: TrackLicensing;
};

export type ArchiveItemDetail = {
  identifier: string;
  title: string;
  creator: string;
  album: string;
  collections: string[];
  releaseDate?: string;
  genre: string;
  tags: string[];
  description: string;
  permalink: string;
  artwork: string;
  rights: ArchiveRightsResolution;
  audioFiles: ArchiveAudioTrackFile[];
  skippedUnsupportedCount: number;
  skippedPrivateCount: number;
  unavailableReason: string;
};

/** Flattens Archive.org `string | string[]` metadata fields cleanly. */
export function readArchiveFieldList(value: unknown): string[] {
  const clean = (entry: string) => entry.replace(/\\(['"])/g, "$1").trim();
  if (typeof value === "string") {
    return value
      .split(/[;\n]/)
      .map(clean)
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === "string" || typeof entry === "number" ? [clean(String(entry))] : []))
      .filter(Boolean);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [clean(String(value))];
  }
  return [];
}

export function readArchiveText(value: unknown): string {
  const list = readArchiveFieldList(value);
  return list[0] ?? "";
}

export function readArchiveJoined(value: unknown, separator = ", "): string {
  const list = readArchiveFieldList(value);
  const unique = [...new Set(list)];
  return unique.join(separator);
}

export function stripHtmlSummary(raw: string, maxLength = 280): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Ensures Archive.org playback/download URLs always point safely to archive.org over HTTPS. */
export function validateArchiveMediaUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    if (parsed.username || parsed.password) return "";
    const host = parsed.hostname.toLowerCase();
    if (host !== "archive.org" && !host.endsWith(".archive.org")) return "";
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function buildArchiveItemPermalink(identifier: string): string {
  const clean = identifier.trim();
  if (!clean) return "";
  return `${ARCHIVE_BASE_URL}/details/${encodeURIComponent(clean)}`;
}

export function buildArchiveDownloadUrl(identifier: string, fileName: string): string {
  const cleanId = identifier.trim();
  const cleanFile = fileName.replace(/^\/+/, "").trim();
  if (!cleanId || !cleanFile) return "";
  const encodedPath = cleanFile
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  if (!encodedPath) return "";
  return validateArchiveMediaUrl(`${ARCHIVE_BASE_URL}/download/${encodeURIComponent(cleanId)}/${encodedPath}`);
}

/** Parses Archive.org `length` metadata ("150.6", "02:30", or "1:02:30") into seconds. */
export function parseArchiveDuration(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  }

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
    if (parts.length === 2) {
      return Math.round(parts[0] * 60 + parts[1]);
    }
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  return 0;
}

const SUPPORTED_AUDIO_EXTENSION_SCORE: Record<string, number> = {
  ".mp3": 100,
  ".ogg": 86,
  ".oga": 85,
  ".m4a": 82,
  ".aac": 80,
  ".opus": 76,
  ".flac": 62,
  ".wav": 48,
};

const SUPPORTED_AUDIO_FORMAT_BONUS: Array<[RegExp, number]> = [
  [/vbr mp3/i, 12],
  [/128kbps mp3/i, 10],
  [/mp3/i, 8],
  [/64kbps mp3/i, 2],
  [/ogg vorbis/i, 6],
  [/mpeg-4 audio|aac/i, 5],
  [/opus/i, 4],
  [/flac/i, 3],
  [/wave|wav/i, 1],
];

const UNSUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".shn",
  ".ape",
  ".wma",
  ".ra",
  ".rm",
  ".mid",
  ".midi",
  ".ac3",
  ".aiff",
  ".aif",
  ".mpc",
  ".wv",
]);

function fileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isFilePrivate(file: ArchiveFileEntry): boolean {
  const flag = file.private;
  return flag === true || flag === "true" || flag === 1 || flag === "1";
}

function scoreSupportedAudioFile(file: ArchiveFileEntry): { supported: boolean; unsupportedAudio: boolean; score: number } {
  const name = typeof file.name === "string" ? file.name.trim() : "";
  if (!name) return { supported: false, unsupportedAudio: false, score: 0 };

  const ext = fileExtension(name);
  const format = typeof file.format === "string" ? file.format.trim() : "";

  if (UNSUPPORTED_AUDIO_EXTENSIONS.has(ext) || /shorten|monkey|windows media audio/i.test(format)) {
    return { supported: false, unsupportedAudio: true, score: 0 };
  }

  const baseScore = SUPPORTED_AUDIO_EXTENSION_SCORE[ext];
  if (!baseScore) {
    return { supported: false, unsupportedAudio: false, score: 0 };
  }

  let bonus = 0;
  for (const [pattern, points] of SUPPORTED_AUDIO_FORMAT_BONUS) {
    if (pattern.test(format)) {
      bonus = Math.max(bonus, points);
    }
  }
  const sourceBonus = file.source === "original" ? 2 : 0;
  return { supported: true, unsupportedAudio: false, score: baseScore + bonus + sourceBonus };
}

function audioGroupKey(file: ArchiveFileEntry): string {
  const original = typeof file.original === "string" ? file.original.trim() : "";
  const raw = original || (typeof file.name === "string" ? file.name.trim() : "");
  return raw.replace(/\.[^./\\]+$/, "").toLowerCase();
}

function cleanTrackTitleFromFilename(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base
    .replace(/\.[^./\\]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrackOrder(value: unknown, fallbackIndex: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)/);
    if (match) return Number(match[1]);
  }
  return 10_000 + fallbackIndex;
}

/**
 * Classifies item-level rights, access restrictions, and license status.
 * Never assumes an Archive.org item is public domain when license metadata is missing.
 */
export function resolveArchiveRights(
  metadata: ArchiveItemMetadata | undefined,
  options: { hasPlayableAudio: boolean; hasOnlyPrivateAudio: boolean; hasUnsupportedAudioOnly: boolean },
): ArchiveRightsResolution {
  const collections = readArchiveFieldList(metadata?.collection).map((entry) => entry.toLowerCase());
  const accessRestrictedFlag = metadata?.["access-restricted-item"];
  const hasAccessFlag =
    accessRestrictedFlag === true ||
    accessRestrictedFlag === "true" ||
    accessRestrictedFlag === 1 ||
    accessRestrictedFlag === "1";

  const restrictedCollection = collections.find((col) => ARCHIVE_RESTRICTED_COLLECTIONS.has(col));
  const restricted = hasAccessFlag || Boolean(restrictedCollection) || options.hasOnlyPrivateAudio;

  const rawLicenseUrl = readArchiveText(metadata?.licenseurl);
  const safeLicenseUrl = /^https?:\/\//i.test(rawLicenseUrl) ? rawLicenseUrl.replace(/^http:/i, "https:") : "";
  const rawRights = readArchiveJoined(metadata?.rights, " · ");
  const creator = readArchiveJoined(metadata?.creator) || readArchiveJoined(metadata?.artist) || "Internet Archive contributor";

  const ccMatch = safeLicenseUrl.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i);
  const pdMark = /creativecommons\.org\/publicdomain\/mark\/([\d.]+)/i.test(safeLicenseUrl);
  const ccZero = /creativecommons\.org\/publicdomain\/zero\/([\d.]+)/i.test(safeLicenseUrl);
  const rightsStatementsNoC = /rightsstatements\.org\/vocab\/NoC/i.test(safeLicenseUrl);
  const rightsStatementsInC = /rightsstatements\.org\/vocab\/InC/i.test(safeLicenseUrl);
  const explicitCopyright =
    rightsStatementsInC ||
    /\b(all rights reserved|in copyright|copyrighted|no redistribution|do not redistribute)\b/i.test(rawRights);

  const isOpenLicense = !restricted && !explicitCopyright && Boolean(ccMatch || pdMark || ccZero || rightsStatementsNoC);

  let licenseName = "Unspecified license (verify rights on Archive.org)";
  if (restricted) {
    licenseName = restrictedCollection === "stream_only"
      ? "Restricted stream-only collection (Archive.org)"
      : "Access-restricted recording (Archive.org)";
  } else if (ccMatch) {
    licenseName = `Creative Commons ${ccMatch[1].toUpperCase()} ${ccMatch[2]}`;
  } else if (ccZero) {
    licenseName = "CC0 1.0 Public Domain Dedication";
  } else if (pdMark) {
    licenseName = "Public Domain Mark 1.0";
  } else if (rightsStatementsNoC) {
    licenseName = "No Copyright (RightsStatements.org)";
  } else if (explicitCopyright) {
    licenseName = "In Copyright / Rights Reserved (Archive.org)";
  }

  let restrictionReason = "";
  if (restricted) {
    restrictionReason = restrictedCollection === "stream_only"
      ? "Marked stream-only on Archive.org — external streaming and downloading are restricted."
      : options.hasOnlyPrivateAudio
        ? "Audio files on this Archive.org item are marked private or restricted."
        : "This Archive.org item is access-restricted and cannot be downloaded or played here.";
  } else if (options.hasUnsupportedAudioOnly) {
    restrictionReason = "No browser-compatible audio format (MP3, OGG, M4A, Opus, FLAC, WAV) was found.";
  } else if (!options.hasPlayableAudio) {
    restrictionReason = "No playable public audio files were found for this Archive.org item.";
  }

  const streamingAllowed = !restricted && options.hasPlayableAudio;
  const downloadAllowed = !restricted && isOpenLicense && options.hasPlayableAudio;
  const importAllowed = !restricted && !explicitCopyright && options.hasPlayableAudio;
  const importRequiresConfirmation = importAllowed && !isOpenLicense;

  const note = restrictionReason
    ? restrictionReason
    : downloadAllowed
      ? `${licenseName} — verified open license metadata on Archive.org.`
      : explicitCopyright
        ? "Copyrighted or all-rights-reserved recording; offline downloads and imports are disabled."
        : "License unspecified on Archive.org — do not assume public domain. Verify rights before importing.";

  return {
    restricted,
    restrictionReason,
    isOpenLicense,
    isExplicitCopyright: explicitCopyright,
    importAllowed,
    importRequiresConfirmation,
    licensing: {
      name: licenseName,
      url: safeLicenseUrl || undefined,
      attribution: `${creator} · Internet Archive`,
      streamingAllowed,
      downloadAllowed,
      note,
    },
  };
}

export function selectArchiveAudioFiles(
  identifier: string,
  files: ArchiveFileEntry[] | undefined,
  metadata: ArchiveItemMetadata | undefined,
): {
  audioFiles: ArchiveAudioTrackFile[];
  skippedUnsupportedCount: number;
  skippedPrivateCount: number;
  hasOnlyPrivateAudio: boolean;
  hasUnsupportedAudioOnly: boolean;
} {
  const list = Array.isArray(files) ? files : [];
  let skippedPrivateCount = 0;
  let skippedUnsupportedCount = 0;
  let publicUnsupportedCount = 0;

  const grouped = new Map<string, { score: number; file: ArchiveFileEntry; index: number }>();

  list.forEach((file, index) => {
    const verdict = scoreSupportedAudioFile(file);
    if (verdict.unsupportedAudio) {
      skippedUnsupportedCount += 1;
      if (!isFilePrivate(file)) publicUnsupportedCount += 1;
      return;
    }
    if (!verdict.supported) return;

    if (isFilePrivate(file)) {
      skippedPrivateCount += 1;
      return;
    }

    const key = audioGroupKey(file);
    const existing = grouped.get(key);
    if (!existing || verdict.score > existing.score) {
      grouped.set(key, { score: verdict.score, file, index });
    }
  });

  const itemTitle = readArchiveText(metadata?.title) || identifier;
  const itemCreator = readArchiveJoined(metadata?.creator) || readArchiveJoined(metadata?.artist) || "Unknown creator";

  const selected = [...grouped.values()]
    .sort((a, b) => {
      const orderDiff = parseTrackOrder(a.file.track, a.index) - parseTrackOrder(b.file.track, b.index);
      if (orderDiff !== 0) return orderDiff;
      return a.index - b.index;
    })
    .map(({ file, index }): ArchiveAudioTrackFile | null => {
      const fileName = typeof file.name === "string" ? file.name.trim() : "";
      const url = buildArchiveDownloadUrl(identifier, fileName);
      if (!url) return null;

      const rawFileTitle = readArchiveText(file.title);
      const fallbackTitle = cleanTrackTitleFromFilename(fileName) || itemTitle;
      const idLower = identifier.toLowerCase();
      const candidateTitle = rawFileTitle || fallbackTitle;
      const isSingleBareId =
        grouped.size === 1 &&
        Boolean(itemTitle) &&
        itemTitle.toLowerCase() !== idLower &&
        (candidateTitle.toLowerCase() === idLower ||
          (/^[a-z0-9_-]{4,}$/i.test(candidateTitle) && !/\s/.test(candidateTitle)));
      const parsedSize = typeof file.size === "number" ? file.size : Number(file.size);

      return {
        fileName,
        format: typeof file.format === "string" && file.format.trim() ? file.format.trim() : fileExtension(fileName).replace(".", "").toUpperCase(),
        extension: fileExtension(fileName),
        title: isSingleBareId ? itemTitle : candidateTitle,
        artist: readArchiveJoined(file.artist) || readArchiveJoined(file.creator) || itemCreator,
        album: readArchiveText(file.album) || itemTitle,
        trackNumber: parseTrackOrder(file.track, index),
        duration: parseArchiveDuration(file.length),
        sizeBytes: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0,
        streamUrl: url,
      };
    })
    .filter((entry): entry is ArchiveAudioTrackFile => entry !== null);

  const hasOnlyPrivateAudio = selected.length === 0 && skippedPrivateCount > 0;
  const hasUnsupportedAudioOnly = selected.length === 0 && publicUnsupportedCount > 0 && skippedPrivateCount === 0;

  return {
    audioFiles: selected,
    skippedUnsupportedCount,
    skippedPrivateCount,
    hasOnlyPrivateAudio,
    hasUnsupportedAudioOnly,
  };
}

export function resolveArchiveArtworkUrl(
  identifier: string,
  files?: ArchiveFileEntry[],
  formats?: unknown,
): string {
  const cleanId = identifier.trim();
  if (!cleanId) return "";

  const fileList = Array.isArray(files) ? files : [];
  const imageCandidates = fileList.filter((file) => {
    if (isFilePrivate(file)) return false;
    const name = typeof file.name === "string" ? file.name.trim() : "";
    const lower = name.toLowerCase();
    if (!name || lower.includes("_spectrogram") || lower.includes("waveform")) return false;
    const format = typeof file.format === "string" ? file.format : "";
    const isImgExt = /\.(jpg|jpeg|png|webp)$/i.test(lower);
    const isImgFormat = /^(jpeg|jpeg thumb|item tile|png|cover)$/i.test(format.trim());
    return isImgExt || isImgFormat;
  });

  const nonThumb = imageCandidates.find((file) => {
    const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
    return !name.includes("__ia_thumb") && !name.endsWith("_thumb.jpg");
  });
  const chosenFile = nonThumb ?? imageCandidates[0];
  if (chosenFile && typeof chosenFile.name === "string") {
    return buildArchiveDownloadUrl(cleanId, chosenFile.name);
  }

  const formatList = readArchiveFieldList(formats).map((entry) => entry.toLowerCase());
  const hasImageFormat = formatList.some((fmt) =>
    fmt.includes("jpeg") || fmt.includes("item tile") || fmt === "png",
  );
  if (hasImageFormat) {
    return validateArchiveMediaUrl(`${ARCHIVE_BASE_URL}/services/img/${encodeURIComponent(cleanId)}`);
  }
  return "";
}

/** Escapes Lucene reserved operators while keeping clean multi-word search queries readable. */
export function sanitizeArchiveSearchTerm(term: string): string {
  return term
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function buildArchiveAdvancedSearchUrl(
  query: string,
  options: { limit?: number; offset?: number; genre?: string; sortDownloads?: boolean } = {},
): string {
  const limit = clampLimit(options.limit, 12, 30);
  const offset = clampOffset(options.offset);
  const page = Math.floor(offset / limit) + 1;

  const cleanTerm = sanitizeArchiveSearchTerm(query);
  const cleanGenre = options.genre ? sanitizeArchiveSearchTerm(options.genre) : "";

  const clauses: string[] = ["mediatype:audio"];
  if (cleanTerm) {
    const tokens = cleanTerm.split(" ").filter(Boolean);
    if (tokens.length === 1) {
      clauses.push(`(${tokens[0]})`);
    } else if (tokens.length > 1) {
      clauses.push(`(${tokens.join(" AND ")})`);
    }
  }
  if (cleanGenre) {
    clauses.push(`(subject:(${cleanGenre}) OR title:(${cleanGenre}))`);
  }

  const params = new URLSearchParams({
    q: clauses.join(" AND "),
    rows: String(limit),
    page: String(page),
    output: "json",
  });

  const fields = [
    "identifier",
    "title",
    "creator",
    "date",
    "collection",
    "licenseurl",
    "rights",
    "subject",
    "genre",
    "format",
    "access-restricted-item",
    "description",
  ];
  fields.forEach((field) => params.append("fl[]", field));

  if (options.sortDownloads || !cleanTerm) {
    params.append("sort[]", "downloads desc");
  }

  return `${ARCHIVE_ADVANCED_SEARCH_URL}?${params.toString()}`;
}

export function buildArchiveItemDetail(
  identifier: string,
  payload: ArchiveMetadataResponse | ArchiveItemMetadata,
): ArchiveItemDetail {
  const isEnvelope = "metadata" in payload || "files" in payload;
  const meta: ArchiveItemMetadata = isEnvelope
    ? (payload as ArchiveMetadataResponse).metadata ?? {}
    : (payload as ArchiveItemMetadata);
  const files = isEnvelope ? (payload as ArchiveMetadataResponse).files : undefined;

  const cleanId = (readArchiveText(meta.identifier) || identifier).trim();
  const selection = selectArchiveAudioFiles(cleanId, files, meta);
  const rights = resolveArchiveRights(meta, {
    hasPlayableAudio: selection.audioFiles.length > 0,
    hasOnlyPrivateAudio: selection.hasOnlyPrivateAudio,
    hasUnsupportedAudioOnly: selection.hasUnsupportedAudioOnly,
  });

  const audioFiles = selection.audioFiles.map((file) => ({
    ...file,
    streamUrl: rights.restricted ? "" : file.streamUrl,
    ...(rights.licensing.downloadAllowed && !rights.restricted ? { downloadUrl: file.streamUrl } : {}),
  }));

  const title = readArchiveText(meta.title) || cleanId;
  const creator = readArchiveJoined(meta.creator) || readArchiveJoined(meta.artist) || "Unknown creator";
  const album = readArchiveText(meta.album) || title;
  const collections = readArchiveFieldList(meta.collection);
  const subjects = readArchiveFieldList(meta.subject);
  const genres = readArchiveFieldList(meta.genre);
  const primaryGenre = genres[0] ?? subjects[0] ?? "Archive Audio";
  const tags = [...new Set([...genres, ...subjects])].slice(0, 8);
  const rawDate = readArchiveText(meta.date) || readArchiveText(meta.year);
  const releaseDate = rawDate ? rawDate.slice(0, 10) : undefined;
  const artwork = resolveArchiveArtworkUrl(cleanId, files, meta.format);
  const permalink = buildArchiveItemPermalink(cleanId);

  return {
    identifier: cleanId,
    title,
    creator,
    album,
    collections,
    ...(releaseDate ? { releaseDate } : {}),
    genre: primaryGenre,
    tags,
    description: stripHtmlSummary(readArchiveText(meta.description)),
    permalink,
    artwork,
    rights,
    audioFiles,
    skippedUnsupportedCount: selection.skippedUnsupportedCount,
    skippedPrivateCount: selection.skippedPrivateCount,
    unavailableReason: rights.restrictionReason,
  };
}

export function parseArchiveTrackId(trackId: string): { identifier: string; fileName?: string } {
  const withoutPrefix = trackId.replace(/^internetarchive-/, "");
  const sepIndex = withoutPrefix.indexOf("::");
  if (sepIndex < 0) return { identifier: withoutPrefix };
  const identifier = withoutPrefix.slice(0, sepIndex);
  const encodedFile = withoutPrefix.slice(sepIndex + 2);
  try {
    return { identifier, fileName: decodeURIComponent(encodedFile) };
  } catch {
    return { identifier, fileName: encodedFile };
  }
}

export function mapArchiveDetailToTrack(
  detail: ArchiveItemDetail,
  audioFile?: ArchiveAudioTrackFile,
): Track {
  const primary = audioFile ?? detail.audioFiles[0];
  const isSubTrack = Boolean(audioFile && detail.audioFiles.length > 1);
  const providerTrackId = isSubTrack && primary
    ? `${detail.identifier}::${encodeURIComponent(primary.fileName)}`
    : detail.identifier;
  const id = `internetarchive-${providerTrackId}`;
  const streamUrl = !detail.rights.restricted && primary ? primary.streamUrl : "";
  const downloadUrl =
    !detail.rights.restricted && detail.rights.licensing.downloadAllowed && primary
      ? (primary.downloadUrl || primary.streamUrl)
      : undefined;

  const rawPrimaryTitle = primary?.title?.trim() ?? "";
  const idLower = detail.identifier.toLowerCase();
  const useItemTitle =
    Boolean(detail.title) &&
    detail.title.toLowerCase() !== idLower &&
    (!rawPrimaryTitle ||
      rawPrimaryTitle.toLowerCase() === idLower ||
      (detail.audioFiles.length === 1 && /^[a-z0-9_-]{4,}$/i.test(rawPrimaryTitle) && !/\s/.test(rawPrimaryTitle)));
  const resolvedTitle = useItemTitle ? detail.title : (rawPrimaryTitle || detail.title);

  return {
    id,
    providerId: "internetarchive",
    providerName: PROVIDER_NAMES.internetarchive,
    providerTrackId,
    title: resolvedTitle,
    artist: primary?.artist || detail.creator,
    artistId: `internetarchive-${detail.identifier}`,
    album: primary?.album && primary.album.toLowerCase() !== idLower ? primary.album : detail.title,
    albumId: `internetarchive-${detail.identifier}`,
    artwork: detail.artwork,
    artworkSmall: detail.artwork,
    ...(detail.artwork
      ? {
          artworkMeta: {
            source: "internetarchive" as const,
            attribution: "Internet Archive",
            confidence: 85,
            matchType: "provider" as const,
            sourceUrl: detail.artwork,
          },
        }
      : {}),
    duration: primary?.duration ?? 0,
    streamUrl,
    ...(downloadUrl ? { downloadUrl } : {}),
    genre: detail.genre,
    tags: detail.tags,
    licensing: detail.rights.licensing,
    ...(detail.releaseDate ? { releaseDate: detail.releaseDate } : {}),
    permalink: detail.permalink,
    accent: accentFor(detail.identifier, 35),
  };
}

export function mapArchiveDetailToTracks(detail: ArchiveItemDetail): Track[] {
  if (!detail.audioFiles.length || detail.rights.restricted) {
    return [mapArchiveDetailToTrack(detail)];
  }
  return detail.audioFiles.map((file) => mapArchiveDetailToTrack(detail, file));
}

export function mapArchiveDocToArtist(doc: ArchiveItemMetadata): Artist | null {
  const identifier = readArchiveText(doc.identifier);
  const creator = readArchiveJoined(doc.creator) || readArchiveJoined(doc.artist);
  if (!identifier || !creator) return null;
  return {
    id: `internetarchive-${identifier}`,
    providerId: "internetarchive",
    providerName: PROVIDER_NAMES.internetarchive,
    providerArtistId: identifier,
    name: creator,
    avatar: resolveArchiveArtworkUrl(identifier, undefined, doc.format),
    accent: accentFor(identifier, 45),
  };
}

export function mapArchiveDocToPlaylist(doc: ArchiveItemMetadata): ProviderPlaylist | null {
  const identifier = readArchiveText(doc.identifier);
  const title = readArchiveText(doc.title);
  if (!identifier || !title) return null;
  return {
    id: `internetarchive-${identifier}`,
    providerId: "internetarchive",
    providerName: PROVIDER_NAMES.internetarchive,
    providerPlaylistId: identifier,
    name: title,
    description: stripHtmlSummary(readArchiveText(doc.description)),
    artwork: resolveArchiveArtworkUrl(identifier, undefined, doc.format),
    trackCount: 1,
    ownerName: readArchiveJoined(doc.creator) || "Internet Archive",
    accent: accentFor(identifier, 90),
    permalink: buildArchiveItemPermalink(identifier),
  };
}
