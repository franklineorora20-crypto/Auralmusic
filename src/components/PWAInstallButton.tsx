import { useState } from "react";
import { Check, ExternalLink, Laptop, Share, Smartphone, X } from "lucide-react";
import type { PWAInstallState } from "../pwa/usePWAInstall";

interface PWAInstallButtonProps {
  pwa: PWAInstallState;
  variant?: "topbar" | "sidebar" | "card";
}

export function PWAInstallButton({ pwa, variant = "topbar" }: PWAInstallButtonProps) {
  const [guideOpen, setGuideOpen] = useState(false);

  const handleAction = async () => {
    if (pwa.isInstallable) {
      await pwa.install();
      return;
    }
    setGuideOpen(true);
  };

  if (pwa.isInstalled && variant !== "card") {
    return null;
  }

  const label = pwa.isInstalled
    ? "App installed"
    : pwa.isInstallable
      ? "Install app"
      : pwa.isIOS
        ? "Install on iOS"
        : "Download app";

  const trigger =
    variant === "card" ? (
      <section className="install-app-card" aria-label="App download">
        <div className="install-app-copy">
          <div className="install-app-icon" aria-hidden="true">
            {pwa.platform === "ios" || pwa.platform === "android" ? (
              <Smartphone size={20} />
            ) : (
              <Laptop size={20} />
            )}
          </div>
          <div>
            <strong>{pwa.isInstalled ? "Aural is installed on this device" : "Download Aural app"}</strong>
            <small>
              {pwa.isInstalled
                ? "Running in standalone app mode with offline shell caching active."
                : pwa.isInstallable
                  ? "Install Aural for a dedicated window, quick launch, and offline playback."
                  : pwa.guide.summary}
            </small>
          </div>
        </div>
        {pwa.isInstalled ? (
          <span className="install-status-badge">
            <Check size={14} /> Installed
          </span>
        ) : (
          <button
            type="button"
            className="primary-button install-card-btn"
            onClick={() => {
              void handleAction();
            }}
            disabled={pwa.installing}
          >
            {pwa.installing ? "Installing…" : label}
          </button>
        )}
      </section>
    ) : variant === "sidebar" ? (
      <button
        type="button"
        className="install-sidebar-button"
        onClick={() => {
          void handleAction();
        }}
        aria-label={label}
        disabled={pwa.installing}
      >
        <Laptop size={16} />
        <span>{pwa.installing ? "Installing…" : label}</span>
      </button>
    ) : (
      <button
        type="button"
        className="install-topbar-button"
        onClick={() => {
          void handleAction();
        }}
        aria-label={label}
        disabled={pwa.installing}
      >
        <Laptop size={14} />
        <span>{pwa.installing ? "Installing…" : label}</span>
      </button>
    );

  const openHref = typeof window !== "undefined" ? window.location.href : "/";

  return (
    <>
      {trigger}
      {guideOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGuideOpen(false);
          }}
        >
          <div className="modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
            <button
              type="button"
              className="modal-close"
              onClick={() => setGuideOpen(false)}
              aria-label="Close install guide"
            >
              <X size={18} />
            </button>
            <div className="install-modal-header">
              <div className="install-modal-emblem" aria-hidden="true">
                {pwa.isIOS ? <Share size={18} /> : <Laptop size={18} />}
              </div>
              <div>
                <p className="eyebrow">Desktop &amp; mobile app</p>
                <h2 id="install-guide-title">{pwa.guide.title}</h2>
              </div>
            </div>
            <p>{pwa.guide.summary}</p>
            <ol className="install-steps">
              {pwa.guide.steps.map((step, index) => (
                <li key={step}>
                  <span className="install-step-num">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="install-modal-actions">
              {pwa.isEmbedded && (
                <a
                  className="primary-button"
                  href={openHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} /> Open in browser tab
                </a>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setGuideOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <div className="offline-indicator" role="status" aria-live="polite">
      <span className="offline-dot" aria-hidden="true" />
      <span>Offline Mode — Cached shell &amp; downloaded tracks ready</span>
    </div>
  );
}
