import { useState, type ChangeEvent, type DragEvent } from "react";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { fileToCoverDataUrl, isDisplayableImageUrl } from "../music/lib/mediaMetadata";
import type { Track } from "../types";

interface CoverArtModalProps {
  track: Track | null;
  onClose: () => void;
  onSaveArtwork: (trackId: string, artworkDataUrl: string) => Promise<void>;
}

export default function CoverArtModal({ track, onClose, onSaveArtwork }: CoverArtModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  if (!track) return null;

  const hasCover = isDisplayableImageUrl(track.artwork);
  const initials = track.title
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

  const applyFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
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
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSaveArtwork(track.id, "");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not remove this picture.");
    } finally {
      setBusy(false);
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
            Embedded pictures are detected automatically when imported. Drop an image here or pick one from your device.
          </small>
        </div>

        {error && (
          <p className="catalogue-error" role="alert">
            {error}
          </p>
        )}

        <div className="cover-modal-actions">
          <label className={`primary-button cover-upload-label ${busy ? "is-disabled" : ""}`}>
            <Upload size={16} />
            <span>{busy ? "Saving…" : hasCover ? "Choose new picture" : "Choose picture"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden-input"
              aria-label="Choose cover picture"
              disabled={busy}
              onChange={handleFileChange}
            />
          </label>
          {hasCover && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleRemove()}
              disabled={busy}
            >
              <Trash2 size={15} /> Remove picture
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
