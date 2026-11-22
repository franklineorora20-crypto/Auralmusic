import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileText, Minus, Plus, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import type { Track } from "../types";
import { findActiveLyricIndex, formatLrcTimestamp, formatLyricCueTime } from "../music/lib/lyrics";
import {
  clearCustomLyrics,
  getLyricsForTrack,
  saveCustomLyrics,
  type LyricsSource,
  type TrackLyrics,
} from "../music/services/lyricsService";

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  onSeek: (timeSeconds: number) => void;
  onClose?: () => void;
  variant: "drawer" | "expanded";
};

function sourceLabel(source: LyricsSource, synced: boolean): string {
  const mode = synced ? "Synced" : "Unsynced";
  if (source === "lrclib") return `LRCLIB · ${mode}`;
  if (source === "metadata") return `Embedded metadata · ${mode}`;
  if (source === "lrc-import") return `Imported LRC · ${mode}`;
  return "";
}

export default function LyricsPanel({
  track,
  currentTime,
  onSeek,
  onClose,
  variant,
}: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<TrackLyrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [autoFollow, setAutoFollow] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftLrc, setDraftLrc] = useState("");
  const [editorError, setEditorError] = useState("");

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lrcInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSyncOffset(0);
    setAutoFollow(true);
    setEditorOpen(false);
    setEditorError("");
  }, [track.id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    getLyricsForTrack(track, {
      signal: controller.signal,
      forceRefresh: reloadToken > 0,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setLyrics(result);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load lyrics.");
        setLyrics(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [track.id, track.lyrics, reloadToken]);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced || !lyrics.lines.length) return -1;
    return findActiveLyricIndex(lyrics.lines, currentTime, syncOffset);
  }, [lyrics, currentTime, syncOffset]);

  useEffect(() => {
    if (!autoFollow || activeIndex < 0) return;
    const container = scrollContainerRef.current;
    const activeEl = lineRefs.current[activeIndex];
    if (!container || !activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const targetTop =
      container.scrollTop +
      (activeRect.top - containerRect.top) -
      container.clientHeight / 2 +
      activeRect.height / 2;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeIndex, autoFollow]);

  const handleApplyDraft = () => {
    const text = draftLrc.trim();
    if (!text) {
      setEditorError("Paste LRC or plain lyrics text first.");
      return;
    }
    const saved = saveCustomLyrics(track.id, text);
    setLyrics(saved);
    setError("");
    setEditorError("");
    setEditorOpen(false);
    setAutoFollow(true);
  };

  const handleLrcFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const content = await file.text();
      if (!content.trim()) {
        setEditorError("The selected file is empty.");
        return;
      }
      const saved = saveCustomLyrics(track.id, content);
      setLyrics(saved);
      setError("");
      setEditorError("");
      setEditorOpen(false);
      setAutoFollow(true);
    } catch {
      setEditorError("Could not read the selected lyrics file.");
    }
  };

  const handleClearCustom = () => {
    clearCustomLyrics(track.id);
    setReloadToken((value) => value + 1);
  };

  const openEditor = () => {
    if (lyrics?.synced && lyrics.lines.length) {
      setDraftLrc(
        lyrics.lines
          .map((line) => `${formatLrcTimestamp(line.time)}${line.text ? ` ${line.text}` : ""}`)
          .join("\n"),
      );
    } else if (lyrics?.plainText) {
      setDraftLrc(lyrics.plainText);
    } else {
      setDraftLrc("");
    }
    setEditorError("");
    setEditorOpen(true);
  };

  const headerMeta = lyrics && lyrics.source !== "none" ? sourceLabel(lyrics.source, lyrics.synced) : "";

  return (
    <section
      className={`lyrics-surface lyrics-${variant}`}
      aria-label="Synchronized lyrics"
      data-testid="lyrics-panel"
    >
      <header className="lyrics-header">
        <div className="lyrics-heading-copy">
          <h2 title={track.title}>{track.title}</h2>
          <p className="lyrics-subtitle">
            <span>{track.artist}</span>
            {headerMeta && (
              <>
                <span aria-hidden="true">·</span>
                <span>{headerMeta}</span>
              </>
            )}
          </p>
        </div>
        <div className="lyrics-header-actions">
          {lyrics?.source === "lrc-import" && (
            <button
              type="button"
              className="icon-button"
              onClick={handleClearCustom}
              aria-label="Reset imported lyrics"
              title="Reset to automatic lookup"
            >
              <RotateCcw size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={() => (editorOpen ? setEditorOpen(false) : openEditor())}
            aria-label={editorOpen ? "Close lyrics editor" : "Import or edit LRC lyrics"}
            title="Import or paste .lrc"
          >
            <FileText size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setReloadToken((value) => value + 1)}
            aria-label="Refresh lyrics"
            title="Refresh lyrics"
          >
            <RefreshCw size={15} />
          </button>
          {onClose && (
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close lyrics"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      {lyrics?.synced && !editorOpen && (
        <div className="lyrics-sync-bar">
          <div className="lyrics-offset-group" role="group" aria-label="Lyric timing offset">
            <button
              type="button"
              className="lyrics-chip-btn"
              onClick={() => setSyncOffset((offset) => Math.round((offset - 0.5) * 10) / 10)}
              aria-label="Delay lyrics by 0.5 seconds"
            >
              <Minus size={12} /> 0.5s
            </button>
            <span className="lyrics-offset-readout" aria-live="polite">
              {syncOffset === 0 ? "Sync 0.0s" : `Sync ${syncOffset > 0 ? "+" : ""}${syncOffset.toFixed(1)}s`}
            </span>
            <button
              type="button"
              className="lyrics-chip-btn"
              onClick={() => setSyncOffset((offset) => Math.round((offset + 0.5) * 10) / 10)}
              aria-label="Advance lyrics by 0.5 seconds"
            >
              <Plus size={12} /> 0.5s
            </button>
          </div>
          {!autoFollow && (
            <button
              type="button"
              className="lyrics-follow-btn"
              onClick={() => setAutoFollow(true)}
            >
              Follow line
            </button>
          )}
        </div>
      )}

      {editorOpen ? (
        <div className="lyrics-editor">
          <p className="lyrics-editor-hint">
            Load an <code>.lrc</code> file or paste timestamped lines (for example{" "}
            <code>[00:12.40]First line</code>).
          </p>
          <input
            ref={lrcInputRef}
            type="file"
            accept=".lrc,.txt,text/plain"
            className="hidden-input"
            onChange={handleLrcFileChange}
            aria-label="Select LRC file"
          />
          <textarea
            className="lyrics-textarea"
            value={draftLrc}
            onChange={(event) => setDraftLrc(event.target.value)}
            placeholder={"[00:08.50]Paste LRC timestamps or plain lyrics here\n[00:14.20]Click any line to seek playback"}
            rows={8}
            aria-label="Lyrics text input"
          />
          {editorError && (
            <p className="lyrics-error-note" role="alert">
              {editorError}
            </p>
          )}
          <div className="lyrics-editor-actions">
            <button
              type="button"
              className="secondary-button lyrics-action-btn"
              onClick={() => lrcInputRef.current?.click()}
            >
              <Upload size={15} /> Load .lrc file
            </button>
            <button
              type="button"
              className="primary-button lyrics-action-btn"
              onClick={handleApplyDraft}
            >
              Apply lyrics
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="lyrics-scroll"
          onWheel={() => {
            if (lyrics?.synced) setAutoFollow(false);
          }}
          onTouchMove={() => {
            if (lyrics?.synced) setAutoFollow(false);
          }}
        >
          {loading && (
            <div className="lyrics-skeleton" role="status" aria-label="Loading lyrics">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`skeleton lyrics-skeleton-line ${idx % 3 === 0 ? "short" : idx % 2 === 0 ? "mid" : ""}`}
                />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="lyrics-empty">
              <p className="lyrics-error-note" role="alert">{error}</p>
              <div className="lyrics-empty-actions">
                <button
                  type="button"
                  className="secondary-button lyrics-action-btn"
                  onClick={() => setReloadToken((value) => value + 1)}
                >
                  <RefreshCw size={15} /> Try again
                </button>
                <button
                  type="button"
                  className="secondary-button lyrics-action-btn"
                  onClick={openEditor}
                >
                  <Upload size={15} /> Import .lrc
                </button>
              </div>
            </div>
          )}

          {!loading && !error && lyrics?.synced && lyrics.lines.length > 0 && (
            <ul className="lyrics-lines">
              {lyrics.lines.map((line, index) => {
                const isActive = index === activeIndex;
                const isPast = activeIndex >= 0 && index < activeIndex;
                return (
                  <li key={`${line.time}-${index}`} className="lyrics-list-item">
                    <button
                      ref={(el) => {
                        lineRefs.current[index] = el;
                      }}
                      type="button"
                      className={`lyric-line ${isActive ? "active" : isPast ? "past" : "upcoming"}`}
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => {
                        onSeek(line.time);
                        setAutoFollow(true);
                      }}
                    >
                      <span className="lyric-cue">{formatLyricCueTime(line.time)}</span>
                      <span className="lyric-text">{line.text || "• • •"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && !error && lyrics && !lyrics.synced && lyrics.plainText && (
            <div className="lyrics-plain">
              <p className="lyrics-plain-note">Unsynced lyrics — timestamps are unavailable for this track.</p>
              {lyrics.plainText.split("\n").map((line, index) =>
                line.trim() ? (
                  <p key={index} className="lyrics-plain-line">
                    {line}
                  </p>
                ) : (
                  <div key={index} className="lyrics-stanza-break" aria-hidden="true" />
                ),
              )}
            </div>
          )}

          {!loading && !error && lyrics?.instrumental && (
            <div className="lyrics-empty">
              <h3>Instrumental track</h3>
              <p>LRCLIB lists this recording as instrumental with no vocal lyrics.</p>
            </div>
          )}

          {!loading &&
            !error &&
            (!lyrics || (!lyrics.synced && !lyrics.plainText && !lyrics.instrumental)) && (
              <div className="lyrics-empty">
                <h3>No lyrics found</h3>
                <p>
                  No synchronized or plain lyrics matched "{track.title}" on LRCLIB or in file metadata.
                </p>
                <div className="lyrics-empty-actions">
                  <button
                    type="button"
                    className="secondary-button lyrics-action-btn"
                    onClick={openEditor}
                  >
                    <Upload size={15} /> Import .lrc
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
