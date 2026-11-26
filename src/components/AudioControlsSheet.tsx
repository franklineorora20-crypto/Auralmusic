import { useState } from "react";
import {
  AudioLines,
  Gauge,
  Moon,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEFAULT_EQUALIZER_STATE,
  EQ_BAND_FREQUENCIES,
  EQ_BAND_LABELS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQUALIZER_PRESETS,
  applyPresetToState,
  clampGainDb,
  updateBandGain,
  type EqualizerState,
} from "../music/engine/equalizer";
import type { AudioEffectsRoutingStatus } from "../music/engine/audioEffects";
import {
  PLAYBACK_SPEED_PRESETS,
  SLEEP_TIMER_PRESETS,
  clampCrossfadeDuration,
  clampPlaybackSpeed,
  formatSleepTimerRemaining,
  type AutomixSuggestion,
  type CrossfadeCurve,
  type CrossfadeSettings,
  type SleepTimerState,
} from "../music/lib/playbackTools";

export type VisualAppearanceSettings = {
  liquidGlass: boolean;
  adaptiveTheme: boolean;
  animatedArtwork: boolean;
};

type TabId = "eq" | "mix" | "sleep";

interface AudioControlsSheetProps {
  onClose: () => void;
  equalizer: EqualizerState;
  onChangeEqualizer: (next: EqualizerState) => void;
  audioEffectsStatus: AudioEffectsRoutingStatus;
  crossfade: CrossfadeSettings;
  onChangeCrossfade: (next: CrossfadeSettings) => void;
  automixEnabled: boolean;
  onToggleAutomix: (enabled: boolean) => void;
  automixPreview: AutomixSuggestion | null;
  playbackSpeed: number;
  preservesPitch: boolean;
  onChangeSpeed: (speed: number) => void;
  onTogglePreservesPitch: (preserves: boolean) => void;
  sleepTimer: SleepTimerState;
  sleepRemainingMs: number;
  onStartCountdownSleep: (minutes: number) => void;
  onStartEndOfTrackSleep: () => void;
  onCancelSleepTimer: () => void;
  appearance: VisualAppearanceSettings;
  onChangeAppearance: (next: VisualAppearanceSettings) => void;
  initialTab?: TabId;
}

export default function AudioControlsSheet({
  onClose,
  equalizer,
  onChangeEqualizer,
  audioEffectsStatus,
  crossfade,
  onChangeCrossfade,
  automixEnabled,
  onToggleAutomix,
  automixPreview,
  playbackSpeed,
  preservesPitch,
  onChangeSpeed,
  onTogglePreservesPitch,
  sleepTimer,
  sleepRemainingMs,
  onStartCountdownSleep,
  onStartEndOfTrackSleep,
  onCancelSleepTimer,
  appearance,
  onChangeAppearance,
  initialTab = "eq",
}: AudioControlsSheetProps) {
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <aside
      className="audio-controls-sheet liquid-glass-surface paper-unfold"
      role="dialog"
      aria-label="Audio, equalizer and mix controls"
      data-testid="audio-controls-sheet"
    >
      <header className="ac-header">
        <div className="ac-title">
          <SlidersHorizontal size={17} />
          <div>
            <p className="eyebrow">Audio Studio</p>
            <h2>Sound &amp; Transitions</h2>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close audio controls">
          <X size={18} />
        </button>
      </header>

      <div className="ac-tabs" role="tablist" aria-label="Audio control sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "eq"}
          className={tab === "eq" ? "active" : ""}
          onClick={() => setTab("eq")}
        >
          <AudioLines size={14} /> Equalizer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mix"}
          className={tab === "mix" ? "active" : ""}
          onClick={() => setTab("mix")}
        >
          <Sparkles size={14} /> Mix &amp; Speed
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sleep"}
          className={tab === "sleep" ? "active" : ""}
          onClick={() => setTab("sleep")}
        >
          <Moon size={14} /> Sleep &amp; Glass
        </button>
      </div>

      <div className="ac-body">
        {tab === "eq" && (
          <div className="ac-section" role="tabpanel" aria-label="Equalizer">
            <div className="ac-row-between">
              <label className="ac-switch">
                <input
                  type="checkbox"
                  checked={equalizer.enabled && !equalizer.bitPerfectBypass}
                  onChange={(e) =>
                    onChangeEqualizer({
                      ...equalizer,
                      enabled: e.target.checked,
                      bitPerfectBypass: !e.target.checked ? equalizer.bitPerfectBypass : false,
                    })
                  }
                />
                <span>10-Band Equalizer</span>
              </label>
              <div className="ac-inline-actions">
                <button
                  type="button"
                  className={`ac-chip ${equalizer.bitPerfectBypass ? "active" : ""}`}
                  onClick={() =>
                    onChangeEqualizer({
                      ...equalizer,
                      bitPerfectBypass: !equalizer.bitPerfectBypass,
                    })
                  }
                  aria-pressed={equalizer.bitPerfectBypass}
                  title="Direct unity gain bypass"
                >
                  Bit-Perfect
                </button>
                <button
                  type="button"
                  className="ac-chip"
                  onClick={() => onChangeEqualizer({ ...DEFAULT_EQUALIZER_STATE, bandsDb: [...DEFAULT_EQUALIZER_STATE.bandsDb] })}
                  title="Reset to Flat"
                >
                  <RotateCcw size={12} /> Flat
                </button>
              </div>
            </div>

            <p className={`ac-status-note mode-${audioEffectsStatus.mode}`} role="status">
              {audioEffectsStatus.note}
            </p>

            <div className="ac-presets" role="group" aria-label="Equalizer presets">
              {EQUALIZER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`ac-preset-chip ${equalizer.presetId === preset.id && !equalizer.bitPerfectBypass ? "active" : ""}`}
                  onClick={() => onChangeEqualizer(applyPresetToState(equalizer, preset.id))}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="ac-preamp-row">
              <span>Preamp</span>
              <input
                type="range"
                min={EQ_MIN_DB}
                max={EQ_MAX_DB}
                step={0.5}
                disabled={equalizer.bitPerfectBypass || !equalizer.enabled}
                value={equalizer.preampDb}
                onChange={(e) =>
                  onChangeEqualizer({
                    ...equalizer,
                    preampDb: clampGainDb(Number(e.target.value)),
                    presetId: "custom",
                  })
                }
                aria-label="Equalizer preamp gain"
              />
              <strong>{equalizer.preampDb > 0 ? `+${equalizer.preampDb}` : equalizer.preampDb} dB</strong>
            </div>

            <div className="eq-bands-grid" role="group" aria-label="10-band equalizer sliders">
              {EQ_BAND_FREQUENCIES.map((freq, idx) => {
                const value = equalizer.bandsDb[idx] ?? 0;
                const disabled = equalizer.bitPerfectBypass || !equalizer.enabled;
                return (
                  <div className={`eq-band ${disabled ? "is-bypassed" : ""}`} key={freq}>
                    <span className="eq-db">{value > 0 ? `+${value.toFixed(0)}` : value.toFixed(0)}</span>
                    <div className="eq-slider-wrap">
                      <input
                        className="eq-vertical-slider"
                        type="range"
                        min={EQ_MIN_DB}
                        max={EQ_MAX_DB}
                        step={0.5}
                        disabled={disabled}
                        value={value}
                        onChange={(e) => onChangeEqualizer(updateBandGain(equalizer, idx, Number(e.target.value)))}
                        aria-label={`${EQ_BAND_LABELS[idx]} Hz gain`}
                      />
                    </div>
                    <span className="eq-freq">{EQ_BAND_LABELS[idx]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "mix" && (
          <div className="ac-section" role="tabpanel" aria-label="Mix and Playback Speed">
            <div className="ac-card">
              <div className="ac-row-between">
                <div>
                  <strong>Crossfade transitions</strong>
                  <small>Smoothly overlap outgoing and incoming audio</small>
                </div>
                <input
                  type="checkbox"
                  checked={crossfade.enabled}
                  onChange={(e) => onChangeCrossfade({ ...crossfade, enabled: e.target.checked })}
                  aria-label="Enable crossfade"
                />
              </div>

              <div className="ac-slider-line">
                <span>Duration</span>
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={crossfade.durationSeconds}
                  onChange={(e) =>
                    onChangeCrossfade({
                      ...crossfade,
                      durationSeconds: clampCrossfadeDuration(Number(e.target.value)),
                    })
                  }
                  aria-label="Crossfade duration seconds"
                />
                <strong>{crossfade.durationSeconds}s</strong>
              </div>

              <div className="ac-curve-row" role="group" aria-label="Crossfade curve">
                {(
                  [
                    { id: "equal-power", label: "Equal-Power" },
                    { id: "smooth", label: "Smooth S" },
                    { id: "linear", label: "Linear" },
                  ] as Array<{ id: CrossfadeCurve; label: string }>
                ).map((curve) => (
                  <button
                    key={curve.id}
                    type="button"
                    className={`ac-chip ${crossfade.curve === curve.id ? "active" : ""}`}
                    onClick={() => onChangeCrossfade({ ...crossfade, curve: curve.id })}
                  >
                    {curve.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ac-card">
              <div className="ac-row-between">
                <div>
                  <strong>Intelligent Automix</strong>
                  <small>Selects harmonious next tracks by genre, texture &amp; pacing</small>
                </div>
                <input
                  type="checkbox"
                  checked={automixEnabled}
                  onChange={(e) => onToggleAutomix(e.target.checked)}
                  aria-label="Enable Intelligent Automix"
                />
              </div>
              {automixEnabled && automixPreview && (
                <div className="ac-automix-preview">
                  <Sparkles size={14} />
                  <div>
                    <strong>Next blend: {automixPreview.track.title}</strong>
                    <small>
                      {automixPreview.track.artist} · {automixPreview.reason} · {automixPreview.recommendedFadeSeconds}s overlap
                    </small>
                  </div>
                </div>
              )}
            </div>

            <div className="ac-card">
              <div className="ac-row-between">
                <div className="ac-title-inline">
                  <Gauge size={15} />
                  <strong>Playback Speed</strong>
                </div>
                <span className="ac-speed-badge">{playbackSpeed.toFixed(2).replace(/\.00$/, ".0")}×</span>
              </div>

              <div className="ac-presets">
                {PLAYBACK_SPEED_PRESETS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={`ac-preset-chip ${Math.abs(playbackSpeed - speed) < 0.01 ? "active" : ""}`}
                    onClick={() => onChangeSpeed(speed)}
                  >
                    {speed}×
                  </button>
                ))}
              </div>

              <div className="ac-slider-line">
                <span>Fine tune</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={playbackSpeed}
                  onChange={(e) => onChangeSpeed(clampPlaybackSpeed(Number(e.target.value)))}
                  aria-label="Playback speed"
                />
                <strong>{playbackSpeed.toFixed(2)}×</strong>
              </div>

              <label className="ac-switch">
                <input
                  type="checkbox"
                  checked={preservesPitch}
                  onChange={(e) => onTogglePreservesPitch(e.target.checked)}
                />
                <span>Preserve vocal pitch when changing speed</span>
              </label>
            </div>
          </div>
        )}

        {tab === "sleep" && (
          <div className="ac-section" role="tabpanel" aria-label="Sleep Timer and Liquid Glass">
            <div className="ac-card">
              <div className="ac-row-between">
                <div>
                  <strong>Sleep Timer</strong>
                  <small>
                    {sleepTimer.mode === "countdown"
                      ? `Pauses in ${formatSleepTimerRemaining(sleepRemainingMs)}`
                      : sleepTimer.mode === "end-of-track"
                        ? "Pauses when the current track finishes"
                        : "Automatically pause playback after a duration"}
                  </small>
                </div>
                {sleepTimer.mode !== "off" && (
                  <button type="button" className="ac-chip active" onClick={onCancelSleepTimer}>
                    Cancel
                  </button>
                )}
              </div>

              <div className="ac-presets">
                {SLEEP_TIMER_PRESETS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className={`ac-preset-chip ${sleepTimer.mode === "countdown" && sleepTimer.durationMinutes === mins ? "active" : ""}`}
                    onClick={() => onStartCountdownSleep(mins)}
                  >
                    {mins} min
                  </button>
                ))}
                <button
                  type="button"
                  className={`ac-preset-chip ${sleepTimer.mode === "end-of-track" ? "active" : ""}`}
                  onClick={onStartEndOfTrackSleep}
                >
                  End of track
                </button>
              </div>
            </div>

            <div className="ac-card">
              <strong>Liquid Glass &amp; Dynamic Theme</strong>
              <label className="ac-switch">
                <input
                  type="checkbox"
                  checked={appearance.liquidGlass}
                  onChange={(e) => onChangeAppearance({ ...appearance, liquidGlass: e.target.checked })}
                />
                <span>Liquid Glass refractive player &amp; sheets</span>
              </label>
              <label className="ac-switch">
                <input
                  type="checkbox"
                  checked={appearance.adaptiveTheme}
                  onChange={(e) => onChangeAppearance({ ...appearance, adaptiveTheme: e.target.checked })}
                />
                <span>Adaptive colors sampled from album artwork</span>
              </label>
              <label className="ac-switch">
                <input
                  type="checkbox"
                  checked={appearance.animatedArtwork}
                  onChange={(e) => onChangeAppearance({ ...appearance, animatedArtwork: e.target.checked })}
                />
                <span>Animated artwork aura &amp; breathing motion</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
