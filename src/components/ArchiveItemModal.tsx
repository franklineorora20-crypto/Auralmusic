import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  HardDrive,
  Heart,
  Loader2,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatBytes } from "../offline";
import { fetchArchiveItemDetail } from "../music/providers/internetArchive";
import {
  mapArchiveDetailToTrack,
  mapArchiveDetailToTracks,
  validateArchiveMediaUrl,
  type ArchiveAudioTrackFile,
  type ArchiveItemDetail,
} from "../music/providers/internetArchiveMeta";
import { MAX_DOWNLOAD_BYTES } from "../music/services/downloadService";
import { useStore } from "../store";
import type { Track } from "../types";

interface ArchiveItemModalProps {
  track: Track | null;
  onClose: () => void;
  onPlayTrack: (track: Track, collection?: Track[]) => void;
  onAddTrackToPlaylist: (trackId: string) => void;
  onOpenLibrary: () => void;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function ArchiveItemModal({
  track,
  onClose,
  onPlayTrack,
  onAddTrackToPlaylist,
  onOpenLibrary,
}: ArchiveItemModalProps) {
  const store = useStore();
  const [detail, setDetail] = useState<ArchiveItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [importingFile, setImportingFile] = useState<string>("");
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importedTrack, setImportedTrack] = useState<Track | null>(null);
  const [importError, setImportError] = useState("");
  const importControllerRef = useRef<AbortController | null>(null);

  const loadDetail = async (identifier: string, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchArchiveItemDetail(identifier, ...(signal ? [{ signal }] : []));
      if (signal?.aborted) return;
      setDetail(next);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Could not load Archive.org item metadata.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    setDetail(null);
    setError("");
    setRightsConfirmed(false);
    setImportError("");
    setImportedTrack(null);
    setImportingFile("");
    setImportProgress(0);
    importControllerRef.current?.abort();

    if (!track) return;
    const controller = new AbortController();
    void loadDetail(track.providerTrackId, controller.signal);
    return () => {
      controller.abort();
      importControllerRef.current?.abort();
    };
  }, [track]);

  const itemTracks = useMemo(() => {
    if (!detail) return [] as Track[];
    return mapArchiveDetailToTracks(detail);
  }, [detail]);

  const { rememberTracks } = store;
  useEffect(() => {
    if (itemTracks.length > 0) {
      rememberTracks(itemTracks);
    }
  }, [itemTracks, rememberTracks]);

  if (!track) return null;

  const canImportItem = Boolean(
    detail &&
      detail.rights.importAllowed &&
      (!detail.rights.importRequiresConfirmation || rightsConfirmed),
  );

  const cancelActiveImport = () => {
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setImportingFile("");
    setImportProgress(0);
  };

  const handleImportFile = async (fileEntry: ArchiveAudioTrackFile) => {
    if (!detail || !canImportItem) return;
    const safeStream = validateArchiveMediaUrl(fileEntry.streamUrl);
    if (!safeStream) {
      setImportError("Blocked: invalid Internet Archive file URL.");
      return;
    }

    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    setImportingFile(fileEntry.fileName);
    setImportProgress(0);
    setImportError("");
    setImportedTrack(null);

    try {
      const response = await fetch(safeStream, {
        signal: controller.signal,
        headers: { Accept: "audio/*,application/ogg,application/octet-stream" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) {
        throw new Error(`Archive.org download failed (${response.status}).`);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const isAudio =
        contentType.startsWith("audio/") ||
        contentType.startsWith("application/ogg") ||
        contentType.includes("octet-stream");
      if (contentType && !isAudio) {
        throw new Error("Archive.org did not return a valid audio file.");
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        throw new Error("This audio file exceeds the 80 MB offline browser storage limit.");
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
            throw new Error("This audio file exceeds the 80 MB offline browser storage limit.");
          }
          chunks.push(value);
          if (declaredLength > 0) {
            setImportProgress(Math.min(99, Math.round((received / declaredLength) * 100)));
          }
        }
        blob = new Blob(chunks, { type: contentType || "audio/mpeg" });
      } else {
        blob = await response.blob();
      }

      if (!blob.size) {
        throw new Error("Archive.org returned an empty audio file.");
      }
      setImportProgress(100);

      const savedTrack = await store.importAuthorizedMedia({
        blob,
        filename: fileEntry.fileName.split("/").pop() || `${fileEntry.title}${fileEntry.extension || ".mp3"}`,
        metadata: {
          title: fileEntry.title,
          artist: fileEntry.artist,
          album: detail.title,
          duration: fileEntry.duration,
          thumbnail: detail.artwork,
          sourceUrl: detail.permalink,
          extractor: "Internet Archive",
          genre: detail.genre,
          releaseDate: detail.releaseDate,
          licensing: {
            name: detail.rights.licensing.name,
            url: detail.rights.licensing.url || detail.permalink,
            attribution: `${fileEntry.artist} · Source: Internet Archive (${detail.identifier})`,
            note: detail.rights.isOpenLicense
              ? `${detail.rights.licensing.name} — imported from Internet Archive.`
              : "Imported from Internet Archive with user rights confirmation.",
          },
        },
      });
      setImportedTrack(savedTrack);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setImportError("");
      } else {
        setImportError(err instanceof Error ? err.message : "Could not import this recording.");
      }
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
      }
      setImportingFile("");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal archive-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Internet Archive details for ${track.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close Internet Archive details">
          <X size={16} />
        </button>

        <div className="archive-modal-head">
          <p className="eyebrow">Internet Archive · Audio Item</p>
          <h2>{detail?.title || track.album || track.title}</h2>
          <p className="archive-modal-sub">
            {detail?.creator || track.artist}
            {detail?.releaseDate ? ` · ${detail.releaseDate}` : ""}
          </p>
          {(detail?.permalink || track.permalink) && (
            <a
              className="archive-external-link"
              href={detail?.permalink || track.permalink}
              target="_blank"
              rel="noopener noreferrer"
            >
              View original item on Archive.org <ExternalLink size={13} />
            </a>
          )}
        </div>

        {loading && (
          <div className="archive-status-row" role="status">
            <Loader2 size={16} className="ytdlp-spin" />
            <span>Loading item metadata & audio files…</span>
          </div>
        )}

        {error && (
          <div className="ytdlp-error-banner" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {detail && (
          <>
            {detail.description && <p className="archive-description">{detail.description}</p>}

            <div
              className={`archive-rights-box ${
                detail.rights.restricted || detail.rights.isExplicitCopyright
                  ? "is-restricted"
                  : detail.rights.isOpenLicense
                    ? "is-open"
                    : "is-caution"
              }`}
            >
              <div className="archive-rights-title">
                {detail.rights.restricted || detail.rights.isExplicitCopyright ? (
                  <ShieldAlert size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}
                <strong>{detail.rights.licensing.name}</strong>
              </div>
              <p>{detail.rights.licensing.note}</p>
              {detail.rights.licensing.url && (
                <a href={detail.rights.licensing.url} target="_blank" rel="noopener noreferrer">
                  License reference <ExternalLink size={12} />
                </a>
              )}
              {detail.rights.importRequiresConfirmation && (
                <label className="ytdlp-auth-checkbox archive-rights-confirm">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) => setRightsConfirmed(event.target.checked)}
                  />
                  <span>
                    I confirm this recording is in the public domain or I hold authorization to import it to my local library.
                  </span>
                </label>
              )}
            </div>

            {importError && (
              <p className="ytdlp-error-banner" role="alert">
                <AlertCircle size={15} />
                <span>{importError}</span>
              </p>
            )}

            {importedTrack && (
              <div className="archive-import-success" role="status">
                <CheckCircle2 size={16} />
                <span>Added &ldquo;{importedTrack.title}&rdquo; to your local library.</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    onPlayTrack(importedTrack);
                  }}
                >
                  Play
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    onClose();
                    onOpenLibrary();
                  }}
                >
                  Open Library
                </button>
              </div>
            )}

            <div className="archive-files-section">
              <div className="archive-files-header">
                <strong>Available audio files ({detail.audioFiles.length})</strong>
                {(detail.skippedUnsupportedCount > 0 || detail.skippedPrivateCount > 0) && (
                  <small>
                    {detail.skippedPrivateCount > 0 ? `${detail.skippedPrivateCount} private ` : ""}
                    {detail.skippedUnsupportedCount > 0 ? `${detail.skippedUnsupportedCount} unsupported skipped` : ""}
                  </small>
                )}
              </div>

              {detail.audioFiles.length > 0 && !detail.rights.restricted ? (
                <div className="archive-files-list">
                  {detail.audioFiles.map((file, idx) => {
                    const mappedTrack = itemTracks[idx] ?? mapArchiveDetailToTrack(detail, file);
                    const isFave = store.favouriteIds.includes(mappedTrack.id);
                    const isThisImporting = importingFile === file.fileName;
                    return (
                      <div className="archive-file-row" key={file.fileName}>
                        <button
                          type="button"
                          className="archive-file-play"
                          onClick={() => onPlayTrack(mappedTrack, itemTracks)}
                          aria-label={`Play ${file.title}`}
                        >
                          <Play size={14} fill="currentColor" />
                        </button>
                        <div className="archive-file-meta">
                          <strong>{file.title}</strong>
                          <small>
                            {file.format || "Audio"} · {formatSeconds(file.duration)}
                            {file.sizeBytes > 0 ? ` · ${formatBytes(file.sizeBytes)}` : ""}
                          </small>
                        </div>
                        <div className="archive-file-actions">
                          <button
                            type="button"
                            className={`icon-button ${isFave ? "active" : ""}`}
                            onClick={() => store.toggleFavourite(mappedTrack.id)}
                            aria-label={isFave ? `Remove ${file.title} from favourites` : `Add ${file.title} to favourites`}
                          >
                            <Heart size={14} fill={isFave ? "currentColor" : "none"} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onAddTrackToPlaylist(mappedTrack.id)}
                            aria-label={`Add ${file.title} to a playlist`}
                          >
                            <Plus size={14} />
                          </button>
                          {isThisImporting ? (
                            <button
                              type="button"
                              className="secondary-button archive-import-btn"
                              onClick={cancelActiveImport}
                            >
                              {importProgress}% Cancel
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button archive-import-btn"
                              disabled={!canImportItem || Boolean(importingFile)}
                              onClick={() => void handleImportFile(file)}
                              title={
                                detail.rights.importRequiresConfirmation && !rightsConfirmed
                                  ? "Confirm rights above before importing locally"
                                  : "Import audio into your local offline library"
                              }
                            >
                              <HardDrive size={13} /> Import
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="archive-unavailable-note">
                  {detail.unavailableReason || "No playable public audio tracks are available for this item."}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
