import { useEffect, useState, type CSSProperties } from "react";
import { BookOpen, RotateCcw } from "lucide-react";

export interface PaperTossItem {
  id: number;
  label: string;
  accent: string;
  origin: "center" | "right" | "top";
}

/**
 * Faceted 3D-shaded crumpled paper ball rendered as crisp vector origami planes.
 * Tinted subtly with the active track's accent and Aural's warm parchment-brass palette.
 */
export function PaperBallSvg({
  accent = "#c49e64",
  className = "",
}: {
  accent?: string;
  className?: string;
}) {
  return (
    <svg
      className={`paper-ball-svg ${className}`}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      style={{ "--paper-accent": accent } as CSSProperties}
    >
      <defs>
        <radialGradient id="paper-core-glow" cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#faf4e8" stopOpacity="0.96" />
          <stop offset="55%" stopColor="#dfd3be" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#74634c" stopOpacity="0.96" />
        </radialGradient>
        <linearGradient id="paper-shadow-plane" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c9baa1" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#463b2d" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="paper-highlight-plane" x1="15%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="#fffaf0" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#cbb99b" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* Base irregular crumpled silhouette */}
      <polygon
        points="58,8 84,15 104,35 111,62 102,88 81,106 54,111 26,101 11,78 10,49 23,24 41,12"
        fill="url(#paper-core-glow)"
        stroke="rgba(36, 29, 21, 0.55)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Faceted crumpled origami planes */}
      <polygon points="58,8 41,12 49,38 68,31" fill="url(#paper-highlight-plane)" />
      <polygon points="58,8 84,15 68,31" fill="#f1e6d2" opacity="0.92" />
      <polygon points="84,15 104,35 80,44 68,31" fill="#d9cab1" opacity="0.92" />
      <polygon points="104,35 111,62 85,63 80,44" fill="url(#paper-shadow-plane)" opacity="0.88" />
      <polygon points="111,62 102,88 79,82 85,63" fill="#635340" opacity="0.9" />
      <polygon points="102,88 81,106 66,89 79,82" fill="#4f4232" opacity="0.94" />
      <polygon points="81,106 54,111 52,88 66,89" fill="#6a5844" opacity="0.92" />
      <polygon points="54,111 26,101 38,81 52,88" fill="#594a38" opacity="0.9" />
      <polygon points="26,101 11,78 33,69 38,81" fill="#7c6951" opacity="0.92" />
      <polygon points="11,78 10,49 34,50 33,69" fill="#b4a287" opacity="0.9" />
      <polygon points="10,49 23,24 41,37 34,50" fill="#e6dac4" opacity="0.94" />
      <polygon points="23,24 41,12 49,38 41,37" fill="#f7efe0" opacity="0.95" />

      {/* Inner peak & valley folds */}
      <polygon points="49,38 68,31 64,57 44,54" fill="#fbf5e9" opacity="0.96" />
      <polygon points="68,31 80,44 64,57" fill="#cfc0a7" opacity="0.9" />
      <polygon points="80,44 85,63 64,57" fill="#958268" opacity="0.88" />
      <polygon points="64,57 85,63 79,82 57,74" fill="#7f6c53" opacity="0.92" />
      <polygon points="64,57 57,74 38,81 44,54" fill="#c7b69b" opacity="0.92" />
      <polygon points="34,50 44,54 38,81 33,69" fill="#a18e73" opacity="0.9" />
      <polygon points="57,74 79,82 66,89 52,88" fill="#5e4e3b" opacity="0.92" />
      <polygon points="57,74 52,88 38,81" fill="#89765d" opacity="0.92" />

      {/* Accent tint glaze from the active track */}
      <polygon
        points="58,8 84,15 104,35 111,62 102,88 81,106 54,111 26,101 11,78 10,49 23,24 41,12"
        fill="var(--paper-accent, #c49e64)"
        opacity="0.14"
        style={{ mixBlendMode: "multiply" }}
      />

      {/* Crisp crease ridges */}
      <g stroke="rgba(26, 20, 14, 0.42)" strokeWidth="0.9" strokeLinejoin="round">
        <path d="M41 12 L49 38 L68 31 L84 15" />
        <path d="M49 38 L44 54 L64 57 L68 31" />
        <path d="M64 57 L80 44 L104 35" />
        <path d="M64 57 L85 63 L111 62" />
        <path d="M64 57 L57 74 L79 82 L102 88" />
        <path d="M57 74 L52 88 L54 111" />
        <path d="M44 54 L34 50 L10 49" />
        <path d="M44 54 L38 81 L26 101" />
        <path d="M38 81 L33 69 L11 78" />
        <path d="M23 24 L41 37 L49 38" />
      </g>

      {/* Highlighted fold edges */}
      <g stroke="rgba(255, 250, 240, 0.58)" strokeWidth="0.9" strokeLinecap="round">
        <path d="M49 38 L68 31" />
        <path d="M44 54 L64 57" />
        <path d="M24 25 L41 13 L58 9" />
      </g>
    </svg>
  );
}

/**
 * Play a soft synthesized paper rustle sound on explicit user interactions.
 * Silently no-ops if Web Audio is unavailable or blocked.
 */
export function playPaperRustle(kind: "crumple" | "unfold" = "crumple"): void {
  try {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const duration = kind === "crumple" ? 0.14 : 0.12;
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i += 1) {
      const env =
        kind === "crumple"
          ? Math.sin((i / sampleCount) * Math.PI) * (0.65 + 0.35 * Math.sin(i * 0.04))
          : (1 - i / sampleCount) * Math.sin((i / sampleCount) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env * 0.16;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = kind === "crumple" ? 2100 : 1550;
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.value = 0.22;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.onended = () => {
      void ctx.close().catch(() => undefined);
    };
  } catch {
    // Ignore audio context errors on restricted browsers.
  }
}

/**
 * Non-blocking transient paper-ball toss layer triggered whenever panels,
 * overlays, modals, or detail views are closed / quit.
 */
export function PaperTossOverlay({ items }: { items: PaperTossItem[] }) {
  if (!items.length) return null;
  return (
    <div className="paper-toss-layer" aria-hidden="true">
      {items.map((item) => (
        <div
          key={item.id}
          className={`paper-toss-actor paper-toss-${item.origin}`}
          style={{ "--paper-accent": item.accent } as CSSProperties}
        >
          <div className="paper-toss-sheet">
            <span>{item.label}</span>
          </div>
          <div className="paper-toss-ball">
            <PaperBallSvg accent={item.accent} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Resting state after the user clicks "Quit & crumple page":
 * The app sits crumpled into an interactive 3D paper ball over the ferrofluid canvas.
 * Poking the ball bounces/spins it; clicking "Unfold page" unfolds the app back open.
 */
export function CrumpledAppScreen({
  trackTitle,
  trackArtist,
  accent,
  unfolding,
  onUnfold,
}: {
  trackTitle: string;
  trackArtist: string;
  accent: string;
  unfolding: boolean;
  onUnfold: () => void;
}) {
  const [pokeCount, setPokeCount] = useState(0);
  const [bouncing, setBouncing] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        onUnfold();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUnfold]);

  const pokeBall = () => {
    playPaperRustle("crumple");
    setPokeCount((count) => count + 1);
    setBouncing(false);
    window.requestAnimationFrame(() => setBouncing(true));
  };

  return (
    <div
      className={`crumpled-stage ${unfolding ? "is-unfolding" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Crumpled page"
    >
      <div className="crumpled-ball-cluster">
        <button
          type="button"
          className={`crumpled-ball-button ${bouncing ? "is-bouncing" : ""}`}
          onClick={pokeBall}
          onDoubleClick={onUnfold}
          onAnimationEnd={() => setBouncing(false)}
          aria-label="Crumpled paper ball. Click to bounce or double-click to unfold."
          style={{ "--poke-rot": `${(pokeCount * 47) % 360}deg` } as CSSProperties}
        >
          <span className="crumpled-ball-shadow" aria-hidden="true" />
          <PaperBallSvg accent={accent} className="crumpled-ball-hero" />
        </button>

        <div className="crumpled-copy">
          <p className="eyebrow">Page crumpled</p>
          <h1>{trackTitle}</h1>
          <p className="crumpled-artist">{trackArtist}</p>
          <div className="crumpled-actions">
            <button type="button" className="primary-button" onClick={onUnfold} autoFocus>
              <BookOpen size={16} /> Unfold page
            </button>
            <button type="button" className="secondary-button" onClick={pokeBall}>
              <RotateCcw size={15} /> Toss ball
            </button>
          </div>
          <p className="crumpled-hint">Tap the ball to toss it, or unfold to pick up where you left off.</p>
        </div>
      </div>
    </div>
  );
}
