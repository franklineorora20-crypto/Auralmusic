import { safeUrl } from "../lib/http";
import type { Artist, ProviderPlaylist, Track } from "../types/music";
import { PROVIDER_ACCENTS, PROVIDER_NAMES } from "../types/music";
import { accentFor, type ListOptions, type MusicProvider, type TrackQueryOptions } from "./base";

export type YtdlpAudioFormat = "mp3" | "m4a" | "opus" | "wav";

export interface YtdlpInstallationStatus {
  available: boolean;
  runnerLabel: string;
  version: string;
  ffmpegAvailable: boolean;
  supportedFormats: YtdlpAudioFormat[];
  installHint: string;
}

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

export type YtdlpJobState = "queued" | "running" | "ready" | "completed" | "cancelled" | "error";

export interface YtdlpImportJobSnapshot {
  jobId: string;
  state: YtdlpJobState;
  percent: number;
  statusText: string;
  format: YtdlpAudioFormat;
  sourceUrl: string;
  error?: string;
  filename?: string;
  mimeType?: string;
  bytes?: number;
  metadata?: YtdlpDiscoveredItem;
}

export function isValidHttpMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalises a discovered yt-dlp metadata entry into Aural's Track shape for
 * previewing only. Notice `streamingAllowed` and `downloadAllowed` remain false
 * because metadata inspection is never treated as permission to stream or
 * download copyrighted media.
 */
export function mapYtdlpPreviewTrack(item: YtdlpDiscoveredItem): Track {
  const safeThumb = safeUrl(item.thumbnail);
  const safeSource = safeUrl(item.webpageUrl || item.sourceUrl);
  return {
    id: `ytdlp-${item.id}`,
    providerId: "ytdlp",
    providerName: PROVIDER_NAMES.ytdlp,
    providerTrackId: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album || "Single",
    artwork: safeThumb,
    artworkSmall: safeThumb,
    ...(safeThumb
      ? {
          artworkMeta: {
            source: "user" as const,
            attribution: `${item.extractor || "yt-dlp"} preview`,
            confidence: 70,
            matchType: "track" as const,
            sourceUrl: safeThumb,
          },
        }
      : {}),
    duration: Math.max(0, item.duration || 0),
    streamUrl: "",
    genre: "Imported",
    tags: [item.extractor.toLowerCase()].filter(Boolean),
    licensing: {
      name: "Rights confirmation required",
      ...(safeSource ? { url: safeSource } : {}),
      attribution: `Source: ${item.extractor || "yt-dlp"} — metadata only`,
      streamingAllowed: false,
      downloadAllowed: false,
      note: "Metadata preview only. Confirm rights or permission before importing to your offline library.",
    },
    ...(safeSource ? { permalink: safeSource } : {}),
    accent: accentFor(item.id, 12) || PROVIDER_ACCENTS.ytdlp,
  };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Ignore non-JSON error responses.
  }
  return fallback;
}

export async function getYtdlpStatus(signal?: AbortSignal): Promise<YtdlpInstallationStatus> {
  const response = await fetch("/api/ytdlp/status", {
    ...(signal ? { signal } : {}),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Local yt-dlp service is unavailable."));
  }
  return (await response.json()) as YtdlpInstallationStatus;
}

export async function discoverYtdlpMedia(
  url: string,
  signal?: AbortSignal,
): Promise<YtdlpDiscoveryResult> {
  const response = await fetch("/api/ytdlp/discover", {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not retrieve metadata for this URL."));
  }
  return (await response.json()) as YtdlpDiscoveryResult;
}

export async function startYtdlpImport(params: {
  url: string;
  format: YtdlpAudioFormat;
  authorized: boolean;
  metadataHint?: YtdlpDiscoveredItem;
  signal?: AbortSignal;
}): Promise<YtdlpImportJobSnapshot> {
  const response = await fetch("/api/ytdlp/import", {
    method: "POST",
    ...(params.signal ? { signal: params.signal } : {}),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      url: params.url,
      format: params.format,
      authorized: params.authorized,
      ...(params.metadataHint ? { metadataHint: params.metadataHint } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not start authorized import."));
  }
  return (await response.json()) as YtdlpImportJobSnapshot;
}

export async function getYtdlpJob(jobId: string, signal?: AbortSignal): Promise<YtdlpImportJobSnapshot> {
  const response = await fetch(`/api/ytdlp/jobs/${encodeURIComponent(jobId)}`, {
    ...(signal ? { signal } : {}),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not read import job status."));
  }
  return (await response.json()) as YtdlpImportJobSnapshot;
}

export async function cancelYtdlpJob(jobId: string): Promise<YtdlpImportJobSnapshot | null> {
  const response = await fetch(`/api/ytdlp/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not cancel import job."));
  }
  return (await response.json()) as YtdlpImportJobSnapshot;
}

export function subscribeYtdlpJobProgress(
  jobId: string,
  onUpdate: (snapshot: YtdlpImportJobSnapshot) => void,
  onError?: () => void,
): () => void {
  if (typeof EventSource === "undefined") {
    let active = true;
    const timer = window.setInterval(() => {
      if (!active) return;
      void getYtdlpJob(jobId)
        .then((snap) => {
          if (!active) return;
          onUpdate(snap);
          if (snap.state === "ready" || snap.state === "completed" || snap.state === "cancelled" || snap.state === "error") {
            window.clearInterval(timer);
          }
        })
        .catch(() => {
          window.clearInterval(timer);
          onError?.();
        });
    }, 600);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }

  const source = new EventSource(`/api/ytdlp/jobs/${encodeURIComponent(jobId)}/stream`);
  source.onmessage = (event) => {
    try {
      const snapshot = JSON.parse(event.data) as YtdlpImportJobSnapshot;
      onUpdate(snapshot);
      if (
        snapshot.state === "ready" ||
        snapshot.state === "completed" ||
        snapshot.state === "cancelled" ||
        snapshot.state === "error"
      ) {
        source.close();
      }
    } catch {
      // Ignore malformed SSE chunks.
    }
  };
  source.onerror = () => {
    source.close();
    onError?.();
  };
  return () => {
    source.close();
  };
}

export async function fetchYtdlpJobFile(
  jobId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const response = await fetch(`/api/ytdlp/jobs/${encodeURIComponent(jobId)}/file`, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not retrieve extracted audio file."));
  }
  const encodedName = response.headers.get("X-Aural-Filename");
  const filename = encodedName ? decodeURIComponent(encodedName) : `ytdlp-${jobId}.mp3`;
  const mimeType = response.headers.get("Content-Type") || "audio/mpeg";
  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("Extracted audio file was empty.");
  }
  return { blob, filename, mimeType };
}

/**
 * Conforms to Aural's `MusicProvider` contract as an optional, URL-driven
 * source. Passive keyword searches stay disabled (`isEnabled: () => false`) so
 * Audius, Jamendo, and Local library remain primary for catalogue browsing.
 */
export const ytdlpProvider: MusicProvider = {
  id: "ytdlp",
  name: PROVIDER_NAMES.ytdlp,

  isEnabled: () => false,
  disabledReason: () =>
    "yt-dlp is an optional URL-based metadata and authorized import source. Select yt-dlp in Search to look up a URL.",

  async searchTracks(query, options: TrackQueryOptions) {
    if (!isValidHttpMediaUrl(query)) return [];
    const discovery = await discoverYtdlpMedia(query, options.signal);
    return discovery.items.map(mapYtdlpPreviewTrack);
  },

  async searchArtists(_query: string, _options: ListOptions) {
    return [] as Artist[];
  },

  async searchPlaylists(_query: string, _options: ListOptions) {
    return [] as ProviderPlaylist[];
  },

  async getTrending() {
    return [] as Track[];
  },

  async getGenreTracks() {
    return [] as Track[];
  },

  async getPopularArtists() {
    return [] as Artist[];
  },

  async getFeaturedPlaylists() {
    return [] as ProviderPlaylist[];
  },

  async getArtist() {
    return null;
  },

  async getArtistTracks() {
    return [] as Track[];
  },

  async getPlaylist() {
    return null;
  },

  async getPlaylistTracks() {
    return [] as Track[];
  },

  async getTrack() {
    return null;
  },
};
