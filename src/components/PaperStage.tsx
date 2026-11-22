import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
 * The app sits crumpled into an interactive physics-enabled 3D paper ball over
 * the ferrofluid canvas. Drag-and-flick or tap "Toss ball" to throw it around
 * the viewport with gravity and wall bounces; click "Unfold page" to restore.
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
  const ballRef = useRef<HTMLButtonElement>(null);
  const physicsRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    angVel: 0,
    active: false,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragStartX: 0,
    dragStartY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    lastTime: 0,
    movedDuringDrag: false,
  });
  const rafRef = useRef<number | null>(null);
  const [tossCount, setTossCount] = useState(0);

  const applyTransform = useCallback(() => {
    const el = ballRef.current;
    if (!el) return;
    const p = physicsRef.current;
    el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(1)}deg)`;
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    physicsRef.current.active = false;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    physicsRef.current.active = true;
    let previousTs = performance.now();

    const step = (ts: number) => {
      const dt = Math.min(0.032, Math.max(0.004, (ts - previousTs) / 1000));
      previousTs = ts;
      const p = physicsRef.current;

      if (p.dragging) {
        applyTransform();
        rafRef.current = window.requestAnimationFrame(step);
        return;
      }

      const ballWidth = ballRef.current?.offsetWidth ?? 150;
      const maxX = Math.max(80, window.innerWidth / 2 - ballWidth * 0.55);
      const maxUp = Math.max(80, window.innerHeight * 0.36);
      const floorY = Math.max(20, window.innerHeight * 0.16);

      // Gravity + spring gently back toward resting spot once settled near floor
      const gravity = 1650;
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.angVel * dt;

      // Wall collisions
      if (p.x > maxX) {
        p.x = maxX;
        p.vx = -Math.abs(p.vx) * 0.72;
        p.angVel = -p.angVel * 0.7 + (p.vy * 0.12);
        playPaperRustle("crumple");
      } else if (p.x < -maxX) {
        p.x = -maxX;
        p.vx = Math.abs(p.vx) * 0.72;
        p.angVel = -p.angVel * 0.7 - (p.vy * 0.12);
        playPaperRustle("crumple");
      }

      // Ceiling collision
      if (p.y < -maxUp) {
        p.y = -maxUp;
        p.vy = Math.abs(p.vy) * 0.65;
      }

      // Floor collision with bounce
      if (p.y > floorY) {
        p.y = floorY;
        if (Math.abs(p.vy) > 95) {
          p.vy = -Math.abs(p.vy) * 0.62;
          p.vx *= 0.86;
          p.angVel = p.vx * 0.45;
          playPaperRustle("crumple");
        } else {
          p.vy = 0;
          p.vx *= 0.9;
          p.angVel = p.vx * 0.4;
        }
      }

      // Air drag
      p.vx *= Math.pow(0.84, dt * 6);
      p.angVel *= Math.pow(0.86, dt * 6);

      // Gentle return home once resting on the floor
      if (Math.abs(p.y - floorY) < 2 && Math.abs(p.vy) < 10 && Math.abs(p.vx) < 25) {
        p.x += (0 - p.x) * Math.min(1, dt * 5.5);
        p.y += (0 - p.y) * Math.min(1, dt * 5.5);
        p.rot += (0 - (p.rot % 360)) * Math.min(1, dt * 4);
      }

      applyTransform();

      const settled =
        Math.abs(p.x) < 0.8 &&
        Math.abs(p.y) < 0.8 &&
        Math.abs(p.vx) < 8 &&
        Math.abs(p.vy) < 8;

      if (settled) {
        p.x = 0;
        p.y = 0;
        p.vx = 0;
        p.vy = 0;
        p.angVel = 0;
        applyTransform();
        stopLoop();
        return;
      }

      rafRef.current = window.requestAnimationFrame(step);
    };

    rafRef.current = window.requestAnimationFrame(step);
  }, [applyTransform, stopLoop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        onUnfold();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopLoop();
    };
  }, [onUnfold, stopLoop]);

  const launchToss = useCallback(
    (customVx?: number, customVy?: number) => {
      playPaperRustle("crumple");
      const p = physicsRef.current;
      const dir = Math.random() > 0.5 ? 1 : -1;
      p.vx = customVx ?? dir * (340 + Math.random() * 340);
      p.vy = customVy ?? -(540 + Math.random() * 260);
      p.angVel = (p.vx >= 0 ? 1 : -1) * (320 + Math.random() * 260);
      setTossCount((count) => count + 1);
      startLoop();
    },
    [startLoop],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = physicsRef.current;
    p.dragging = true;
    p.movedDuringDrag = false;
    p.dragStartX = event.clientX;
    p.dragStartY = event.clientY;
    p.lastPointerX = event.clientX;
    p.lastPointerY = event.clientY;
    p.dragOffsetX = event.clientX - p.x;
    p.dragOffsetY = event.clientY - p.y;
    p.lastTime = performance.now();
    p.vx = 0;
    p.vy = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    startLoop();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = physicsRef.current;
    if (!p.dragging) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - p.lastTime) / 1000);
    const nextX = event.clientX - p.dragOffsetX;
    const nextY = event.clientY - p.dragOffsetY;
    if (Math.hypot(event.clientX - p.dragStartX, event.clientY - p.dragStartY) > 5) {
      p.movedDuringDrag = true;
    }
    const instVx = Math.max(-1600, Math.min(1600, (event.clientX - p.lastPointerX) / dt));
    const instVy = Math.max(-1600, Math.min(1600, (event.clientY - p.lastPointerY) / dt));
    p.vx = p.vx * 0.35 + instVx * 0.65;
    p.vy = p.vy * 0.35 + instVy * 0.65;
    p.x = nextX;
    p.y = nextY;
    p.rot += (event.clientX - p.lastPointerX) * 0.45;
    p.lastPointerX = event.clientX;
    p.lastPointerY = event.clientY;
    p.lastTime = now;
    applyTransform();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = physicsRef.current;
    if (!p.dragging) return;
    p.dragging = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!p.movedDuringDrag) {
      launchToss();
    } else {
      playPaperRustle("crumple");
      p.angVel = p.vx * 0.55;
      setTossCount((count) => count + 1);
      startLoop();
    }
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
          ref={ballRef}
          type="button"
          className="crumpled-ball-button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={onUnfold}
          aria-label="Crumpled paper ball. Drag and throw, tap to toss, or double-click to unfold."
        >
          <span className="crumpled-ball-shadow" aria-hidden="true" />
          <PaperBallSvg accent={accent} className="crumpled-ball-hero" />
        </button>

        <div className="crumpled-copy">
          <p className="eyebrow">Page crumpled{tossCount > 0 ? ` · ${tossCount} toss${tossCount === 1 ? "" : "es"}` : ""}</p>
          <h1>{trackTitle}</h1>
          <p className="crumpled-artist">{trackArtist}</p>
          <div className="crumpled-actions">
            <button type="button" className="primary-button" onClick={onUnfold} autoFocus>
              <BookOpen size={16} /> Unfold page
            </button>
            <button type="button" className="secondary-button" onClick={() => launchToss()}>
              <RotateCcw size={15} /> Toss ball
            </button>
          </div>
          <p className="crumpled-hint">Drag &amp; throw the ball anywhere, tap Toss ball, or unfold to resume.</p>
        </div>
      </div>
    </div>
  );
}
