import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  Link2,
  ListMusic,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import {
  cancelYtdlpJob,
  discoverYtdlpMedia,
  fetchYtdlpJobFile,
  getYtdlpStatus,
  isValidHttpMediaUrl,
  startYtdlpImport,
  subscribeYtdlpJobProgress,
  type YtdlpAudioFormat,
  type YtdlpDiscoveredItem,
  type YtdlpDiscoveryResult,
  type YtdlpImportJobSnapshot,
  type YtdlpInstallationStatus,
} from "../music/providers/ytdlp";
import { useStore } from "../store";
import type { Track } from "../types";

interface YtdlpImportPanelProps {
  onPlayTrack: (track: Track) => void;
  onOpenLibrary: () => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function YtdlpImportPanel({ onPlayTrack, onOpenLibrary }: YtdlpImportPanelProps) {
  const store = useStore();
  const [status, setStatus] = useState<YtdlpInstallationStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");

  const [mediaUrl, setMediaUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<YtdlpDiscoveryResult | null>(null);
  const [discoverError, setDiscoverError] = useState("");

  const [selectedItem, setSelectedItem] = useState<YtdlpDiscoveredItem | null>(null);
  const [format, setFormat] = useState<YtdlpAudioFormat>("mp3");
  const [authorized, setAuthorized] = useState(false);

  const [job, setJob] = useState<YtdlpImportJobSnapshot | null>(null);
  const [importError, setImportError] = useState("");
  const [importedTrack, setImportedTrack] = useState<Track | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);

  const discoverAbortRef = useRef<AbortController | null>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const unsubscribeStreamRef = useRef<(() => void) | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    setStatusError("");
    try {
      const next = await getYtdlpStatus();
      setStatus(next);
    } catch (error) {
      setStatus(null);
      setStatusError(
        error instanceof Error ? error.message : "Could not reach the local yt-dlp service.",
      );
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    return () => {
      discoverAbortRef.current?.abort();
      fileAbortRef.current?.abort();
      unsubscribeStreamRef.current?.();
    };
  }, []);

  const handleDiscover = async () => {
    const trimmed = mediaUrl.trim();
    if (!trimmed) {
      setDiscoverError("Enter a media or playlist URL to inspect metadata.");
      return;
    }
    if (!isValidHttpMediaUrl(trimmed)) {
      setDiscoverError("Enter a valid http:// or https:// URL.");
      return;
    }

    discoverAbortRef.current?.abort();
    const controller = new AbortController();
    discoverAbortRef.current = controller;

    setDiscovering(true);
    setDiscoverError("");
    setDiscovery(null);
    setSelectedItem(null);
    setImportError("");
    setImportedTrack(null);

    try {
      const result = await discoverYtdlpMedia(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setDiscovery(result);
      setSelectedItem(result.items[0] ?? null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDiscoverError(
        error instanceof Error ? error.message : "Could not retrieve metadata for this URL.",
      );
    } finally {
      if (discoverAbortRef.current === controller) {
        discoverAbortRef.current = null;
        setDiscovering(false);
      }
    }
  };

  const finalizeReadyJob = async (readyJob: YtdlpImportJobSnapshot, item: YtdlpDiscoveredItem) => {
    if (savingToLibrary || activeJobIdRef.current !== readyJob.jobId) return;
    setSavingToLibrary(true);
    const abortCtrl = new AbortController();
    fileAbortRef.current = abortCtrl;
    try {
      const { blob, filename } = await fetchYtdlpJobFile(readyJob.jobId, abortCtrl.signal);
      if (abortCtrl.signal.aborted) return;
      const meta = readyJob.metadata ?? item;
      const savedTrack = await store.importAuthorizedMedia({
        blob,
        filename,
        metadata: {
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          duration: meta.duration,
          thumbnail: meta.thumbnail,
          sourceUrl: meta.webpageUrl || meta.sourceUrl,
          extractor: meta.extractor,
        },
      });
      setImportedTrack(savedTrack);
      setJob({
        ...readyJob,
        state: "completed",
        percent: 100,
        statusText: "Saved to Local library and offline IndexedDB storage.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setImportError(
        error instanceof Error ? error.message : "Could not store imported audio offline.",
      );
      setJob((prev) => (prev ? { ...prev, state: "error" } : null));
    } finally {
      activeJobIdRef.current = null;
      fileAbortRef.current = null;
      setSavingToLibrary(false);
    }
  };

  const handleImport = async (targetItem?: YtdlpDiscoveredItem) => {
    const item = targetItem ?? selectedItem;
    if (!item) {
      setImportError("Fetch media metadata first, or select an item from the list.");
      return;
    }
    if (!authorized) {
      setImportError(
        "Confirm that you own the rights or have permission before importing audio.",
      );
      return;
    }

    unsubscribeStreamRef.current?.();
    fileAbortRef.current?.abort();
    setImportError("");
    setImportedTrack(null);

    try {
      const initial = await startYtdlpImport({
        url: item.sourceUrl,
        format,
        authorized: true,
        metadataHint: item,
      });
      activeJobIdRef.current = initial.jobId;
      setJob(initial);

      unsubscribeStreamRef.current = subscribeYtdlpJobProgress(
        initial.jobId,
        (snapshot) => {
          setJob(snapshot);
          if (snapshot.state === "ready") {
            void finalizeReadyJob(snapshot, item);
          } else if (snapshot.state === "error") {
            activeJobIdRef.current = null;
            setImportError(snapshot.error || "Audio import failed.");
          } else if (snapshot.state === "cancelled") {
            activeJobIdRef.current = null;
          }
        },
        () => {
          if (activeJobIdRef.current === initial.jobId) {
            setImportError("Lost connection to the local import progress stream.");
            activeJobIdRef.current = null;
          }
        },
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not start media import.");
    }
  };

  const handleCancelImport = async () => {
    const jobId = activeJobIdRef.current ?? job?.jobId;
    unsubscribeStreamRef.current?.();
    fileAbortRef.current?.abort();
    activeJobIdRef.current = null;
    if (jobId) {
      try {
        const cancelled = await cancelYtdlpJob(jobId);
        if (cancelled) setJob(cancelled);
      } catch {
        setJob((prev) =>
          prev ? { ...prev, state: "cancelled", statusText: "Import cancelled." } : null,
        );
      }
    }
  };

  const isImporting = job?.state === "queued" || job?.state === "running" || job?.state === "ready" || savingToLibrary;

  return (
    <section className="ytdlp-panel" aria-label="yt-dlp optional media import">
      <div className="ytdlp-status-card">
        <div className="ytdlp-status-copy">
          <div className="install-app-icon" aria-hidden="true">
            <Terminal size={19} />
          </div>
          <div>
            <strong>Optional yt-dlp source</strong>
            <small>
              {statusLoading
                ? "Checking local yt-dlp and ffmpeg availability…"
                : statusError
                  ? statusError
                  : status?.available
                    ? `Detected ${status.version} (${status.runnerLabel})${status.ffmpegAvailable ? " · ffmpeg ready" : " · ffmpeg missing"}`
                    : status?.installHint}
            </small>
          </div>
        </div>
        <div className="ytdlp-status-actions">
          <span
            className={`ytdlp-badge ${status?.available ? "is-ready" : "is-missing"}`}
            role="status"
          >
            {statusLoading
              ? "Checking…"
              : status?.available
                ? "Backend ready"
                : "Setup required"}
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadStatus()}
            disabled={statusLoading}
            aria-label="Refresh yt-dlp status"
          >
            <RefreshCw size={14} className={statusLoading ? "spin-icon" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="ytdlp-url-card">
        <div className="ytdlp-url-row">
          <label className="ytdlp-url-input-wrap">
            <Link2 size={16} aria-hidden="true" />
            <input
              type="url"
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !discovering) void handleDiscover();
              }}
              placeholder="Paste a public media or playlist URL (https://...)"
              aria-label="Media or playlist URL for yt-dlp"
            />
            {mediaUrl && (
              <button
                type="button"
                onClick={() => {
                  setMediaUrl("");
                  setDiscoverError("");
                }}
                aria-label="Clear media URL"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="primary-button ytdlp-fetch-btn"
            onClick={() => void handleDiscover()}
            disabled={discovering || isImporting}
          >
            {discovering ? (
              <>
                <Loader2 size={15} className="spin-icon" /> Inspecting…
              </>
            ) : (
              "Fetch metadata"
            )}
          </button>
        </div>

        <p className="ytdlp-disclaimer">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>
            Metadata retrieval inspects title, creator, duration, and source URL only. It does
            not grant permission to stream or download copyrighted content.
          </span>
        </p>

        {discoverError && (
          <p className="ytdlp-error-banner" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{discoverError}</span>
          </p>
        )}
      </div>

      {discovery && (
        <div className="ytdlp-discovery-card">
          <div className="ytdlp-discovery-header">
            <div>
              <p className="eyebrow">
                {discovery.kind === "playlist"
                  ? `Playlist · ${discovery.items.length} of ${discovery.itemCount} item${discovery.itemCount === 1 ? "" : "s"}`
                  : "Media reference"}
              </p>
              <h3>{discovery.title}</h3>
              <small>
                Uploader: {discovery.uploader} ·{" "}
                <a href={discovery.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Source URL <ExternalLink size={12} />
                </a>
              </small>
            </div>
          </div>

          {selectedItem && (
            <div className="ytdlp-selected-preview">
              <div className="ytdlp-thumb">
                {selectedItem.thumbnail ? (
                  <img
                    src={selectedItem.thumbnail}
                    alt={selectedItem.title}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <ListMusic size={22} aria-hidden="true" />
                )}
              </div>
              <div className="ytdlp-selected-meta">
                <strong>{selectedItem.title}</strong>
                <span>
                  {selectedItem.artist} · {formatDuration(selectedItem.duration)} ·{" "}
                  {selectedItem.extractor}
                </span>
                <a href={selectedItem.webpageUrl} target="_blank" rel="noopener noreferrer">
                  {selectedItem.webpageUrl}
                </a>
              </div>
            </div>
          )}

          {discovery.items.length > 1 && (
            <div className="ytdlp-playlist-list" role="list" aria-label="Discovered playlist items">
              {discovery.items.map((item, idx) => {
                const isSelected = selectedItem?.id === item.id && selectedItem?.sourceUrl === item.sourceUrl;
                return (
                  <button
                    key={`${item.id}-${idx}`}
                    type="button"
                    className={`ytdlp-playlist-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedItem(item);
                      setImportError("");
                      setImportedTrack(null);
                    }}
                  >
                    <span className="ytdlp-item-index">{idx + 1}</span>
                    <span className="ytdlp-item-copy">
                      <strong>{item.title}</strong>
                      <small>{item.artist}</small>
                    </span>
                    <span className="ytdlp-item-dur">{formatDuration(item.duration)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="ytdlp-import-controls">
            <label className="ytdlp-auth-checkbox">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(event) => {
                  setAuthorized(event.target.checked);
                  if (event.target.checked) setImportError("");
                }}
              />
              <span>
                I confirm I own the rights or have explicit authorization to import this audio into
                my offline Aural library.
              </span>
            </label>

            <div className="ytdlp-import-actions">
              <label className="ytdlp-format-select">
                <span>Format</span>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as YtdlpAudioFormat)}
                  disabled={isImporting}
                  aria-label="Audio format"
                >
                  <option value="mp3">MP3</option>
                  <option value="m4a">M4A (AAC)</option>
                  <option value="opus">Opus</option>
                  <option value="wav">WAV</option>
                </select>
              </label>

              {isImporting ? (
                <button
                  type="button"
                  className="secondary-button ytdlp-cancel-btn"
                  onClick={() => void handleCancelImport()}
                >
                  <X size={15} /> Cancel import
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleImport()}
                  disabled={!authorized || !selectedItem || status?.available === false}
                >
                  <Download size={15} /> Import authorized audio
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {job && (job.state === "running" || job.state === "queued" || job.state === "ready" || job.state === "cancelled") && (
        <div className="ytdlp-progress-card" role="status">
          <div className="ytdlp-progress-header">
            <strong>{job.statusText}</strong>
            <span>{job.state === "cancelled" ? "Cancelled" : `${job.percent}%`}</span>
          </div>
          {job.state !== "cancelled" && (
            <div
              className="ytdlp-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.percent}
            >
              <div className="ytdlp-progress-fill" style={{ width: `${job.percent}%` }} />
            </div>
          )}
        </div>
      )}

      {importError && (
        <p className="ytdlp-error-banner" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{importError}</span>
        </p>
      )}

      {importedTrack && (
        <div className="ytdlp-success-card" role="status">
          <div className="ytdlp-success-copy">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>Imported &ldquo;{importedTrack.title}&rdquo;</strong>
              <small>Saved to your Local library and IndexedDB offline storage.</small>
            </div>
          </div>
          <div className="ytdlp-success-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => onPlayTrack(importedTrack)}
            >
              <Play size={14} fill="currentColor" /> Play now
            </button>
            <button type="button" className="secondary-button" onClick={onOpenLibrary}>
              <HardDrive size={14} /> Open library
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
