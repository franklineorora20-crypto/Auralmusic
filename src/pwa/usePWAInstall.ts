import { useCallback, useEffect, useState } from "react";
import {
  detectIsIOS,
  detectPlatformFamily,
  getInstallGuideContent,
  resolveInstallMode,
  type InstallGuideContent,
  type InstallMode,
  type PlatformFamily,
} from "./installState";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isEmbedded: boolean;
  platform: PlatformFamily;
  mode: InstallMode;
  guide: InstallGuideContent;
  installing: boolean;
  installOutcome: "idle" | "accepted" | "dismissed";
  install: () => Promise<boolean>;
}

const getStandaloneFlag = () => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
};

export function usePWAInstall(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => getStandaloneFlag());
  const [installing, setInstalling] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<"idle" | "accepted" | "dismissed">("idle");

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0;
  const isIOS = detectIsIOS(ua, touchPoints);
  const platform = detectPlatformFamily(ua, touchPoints);
  const isEmbedded = typeof window !== "undefined" ? window.self !== window.top : false;

  useEffect(() => {
    setIsInstalled(getStandaloneFlag());

    const media = window.matchMedia("(display-mode: standalone)");
    const handleDisplayChange = () => setIsInstalled(getStandaloneFlag());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setInstallOutcome("accepted");
    };

    media.addEventListener("change", handleDisplayChange);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      media.removeEventListener("change", handleDisplayChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
        setDeferredPrompt(null);
        setInstallOutcome("accepted");
        return true;
      }
      setInstallOutcome("dismissed");
      return false;
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  const mode = resolveInstallMode({
    isStandalone: isInstalled,
    hasNativePrompt: Boolean(deferredPrompt),
    isIOS,
    isEmbedded,
  });

  const guide = getInstallGuideContent(mode, platform);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isEmbedded,
    platform,
    mode,
    guide,
    installing,
    installOutcome,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
