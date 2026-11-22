import type { Track } from "../types/music";

/** 80 MB is well beyond any provider's audio file and keeps IndexedDB sane. */
export const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;

export class DownloadNotPermittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadNotPermittedError";
  }
}

/**
 * A stream URL is never treated as download permission. The provider must have
 * explicitly marked the track downloadable and supplied a download endpoint.
 */
export function canDownload(track: Track): boolean {
  return Boolean(
    track.downloadUrl &&
      track.licensing.downloadAllowed &&
      track.providerId !== "sample" &&
      track.streamUrl !== track.downloadUrl,
  );
}

export function assertDownloadPermitted(track: Track): void {
  if (!track.licensing.downloadAllowed) {
    throw new DownloadNotPermittedError(
      `${track.providerName} has not released "${track.title}" for download.`,
    );
  }
  if (!track.downloadUrl) {
    throw new DownloadNotPermittedError(
      `${track.providerName} did not provide a download endpoint for "${track.title}".`,
    );
  }
  if (!canDownload(track)) {
    throw new DownloadNotPermittedError(
      "Only provider-approved downloads can be stored for offline playback.",
    );
  }
}

export type DownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};

export type DownloadResult = {
  blob: Blob;
  contentType: string;
  bytes: number;
};

/**
 * Streams an approved download to a Blob, reporting intermediate progress and
 * enforcing a size ceiling. Aborting the signal leaves nothing behind.
 */
export async function fetchTrackAudio(track: Track, options: DownloadOptions = {}): Promise<DownloadResult> {
  assertDownloadPermitted(track);
  const downloadUrl = track.downloadUrl;
  if (!downloadUrl) throw new DownloadNotPermittedError("This track has no download endpoint.");

  const response = await fetch(downloadUrl, {
    ...(options.signal ? { signal: options.signal } : {}),
    headers: { Accept: "audio/*,application/octet-stream" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    throw new Error(`The ${track.providerName} download failed (${response.status}).`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isAudio = contentType.startsWith("audio/") || contentType.includes("octet-stream");
  if (contentType && !isAudio) {
    throw new Error(`${track.providerName} did not return an audio file.`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("This file is larger than the offline storage limit.");
  }

  const reader = response.body?.getReader();
  let blob: Blob;

  if (reader) {
    const chunks: BlobPart[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error("This file is larger than the offline storage limit.");
      }
      chunks.push(value);
      if (declaredLength > 0) {
        options.onProgress?.(Math.min(99, Math.round((received / declaredLength) * 100)));
      }
    }
    blob = new Blob(chunks, { type: contentType || "audio/mpeg" });
  } else {
    blob = await response.blob();
  }

  if (!blob.size) throw new Error(`${track.providerName} returned an empty audio file.`);
  options.onProgress?.(100);
  return { blob, contentType: blob.type || "audio/mpeg", bytes: blob.size };
}
