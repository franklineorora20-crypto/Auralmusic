import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { ImagePlus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { fileToCoverDataUrl, isDisplayableImageUrl } from "../music/lib/mediaMetadata";
import type { Track } from "../types";

interface CoverArtModalProps {
  track: Track | null;
  onClose: () => void;
  onSaveArtwork: (trackId: string, artworkDataUrl: string) => Promise<void>;
  onAutoFindArtwork?: (trackId: string) => Promise<void>;
}

export default function CoverArtModal({ track, onClose, onSaveArtwork, onAutoFindArtwork }: CoverArtModalProps) {
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, track]);

  if (!track) return null;

  const hasCover = isDisplayableImageUrl(track.artwork);
  const initials = track.title
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

  const sourceLabel = track.artworkMeta?.attribution || (hasCover ? track.providerName : "No verified original cover");
  const matchBadge = track.artworkMeta?.matchType && track.artworkMeta.matchType !== "user" && track.artworkMeta.matchType !== "provider"
    ? track.artworkMeta.matchType
    : null;

  const applyFile = async (file: File | undefined) => {
    if (!file || busy || searching) return;
    setBusy(true);
    setError("");
    setStatusMessage("");
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      await onSaveArtwork(track.id, dataUrl);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load this picture.");
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void applyFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    void applyFile(file);
  };

  const handleRemove = async () => {
    if (busy || searching) return;
    setBusy(true);
    setError("");
    setStatusMessage("");
    try {
      await onSaveArtwork(track.id, "");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not remove this picture.");
    } finally {
      setBusy(false);
    }
  };

  const handleAutoFind = async () => {
    if (!onAutoFindArtwork || busy || searching) return;
    setSearching(true);
    setError("");
    setStatusMessage("Checking MusicBrainz, Cover Art Archive, and official release databases…");
    try {
      await onAutoFindArtwork(track.id);
      setStatusMessage("Original release lookup finished.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not look up release artwork.");
      setStatusMessage("");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal paper-unfold cover-art-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-art-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 id="cover-art-title">{hasCover ? "Change cover picture" : "Add cover picture"}</h2>
        <p className="cover-art-track-label">
          {track.title} · {track.artist}
        </p>
        <p className="cover-art-source-meta">
          <span>Source: {sourceLabel}</span>
          {matchBadge && <span className="cover-meta-badge">{matchBadge}</span>}
        </p>

        <div
          className={`cover-modal-dropzone ${dragOver ? "is-drag-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="cover-modal-preview" style={{ background: track.accent }}>
            {hasCover ? (
              <img src={track.artwork} alt={`${track.title} cover`} />
            ) : (
              <span aria-hidden="true">{initials || <ImagePlus size={28} />}</span>
            )}
          </div>
          <small className="cover-modal-hint">
            Embedded and original release covers are matched automatically. Drop an image here or pick one from your device.
          </small>
        </div>

        {statusMessage && (
          <p className="catalogue-status" role="status">
            {statusMessage}
          </p>
        )}

        {error && (
          <p className="catalogue-error" role="alert">
            {error}
          </p>
        )}

        <div className="cover-modal-actions">
          <label className={`primary-button cover-upload-label ${busy || searching ? "is-disabled" : ""}`}>
            <Upload size={16} />
            <span>{busy ? "Saving…" : hasCover ? "Choose new picture" : "Choose picture"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden-input"
              aria-label="Choose cover picture"
              disabled={busy || searching}
              onChange={handleFileChange}
            />
          </label>
          {onAutoFindArtwork && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleAutoFind()}
              disabled={busy || searching}
            >
              <RefreshCw size={15} className={searching ? "spin-icon" : ""} />
              <span>{searching ? "Searching…" : "Auto-find cover"}</span>
            </button>
          )}
          {hasCover && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleRemove()}
              disabled={busy || searching}
            >
              <Trash2 size={15} /> Remove picture
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
