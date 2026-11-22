export type InstallMode =
  | "installed"
  | "native-prompt"
  | "ios-safari"
  | "embedded-tab"
  | "browser-menu";

export type PlatformFamily = "ios" | "android" | "mac" | "windows" | "other";

export interface InstallEnvironmentInput {
  isStandalone: boolean;
  hasNativePrompt: boolean;
  isIOS: boolean;
  isEmbedded: boolean;
}

export interface InstallGuideContent {
  title: string;
  summary: string;
  steps: string[];
}

export function detectIsIOS(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  // iPadOS 13+ reports Macintosh with multi-touch points.
  return /macintosh/.test(ua) && maxTouchPoints > 1;
}

export function detectPlatformFamily(userAgent: string, maxTouchPoints = 0): PlatformFamily {
  if (detectIsIOS(userAgent, maxTouchPoints)) return "ios";
  const ua = userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/macintosh|mac os x/.test(ua)) return "mac";
  if (/windows/.test(ua)) return "windows";
  return "other";
}

export function resolveInstallMode({
  isStandalone,
  hasNativePrompt,
  isIOS,
  isEmbedded,
}: InstallEnvironmentInput): InstallMode {
  if (isStandalone) return "installed";
  if (hasNativePrompt) return "native-prompt";
  if (isIOS) return "ios-safari";
  if (isEmbedded) return "embedded-tab";
  return "browser-menu";
}

export function getInstallGuideContent(
  mode: InstallMode,
  platform: PlatformFamily,
): InstallGuideContent {
  if (mode === "installed") {
    return {
      title: "Aural is installed",
      summary: "You are running Aural as a standalone app with offline shell support.",
      steps: [
        "Saved tracks imported or downloaded with provider permission remain playable offline.",
      ],
    };
  }

  if (mode === "ios-safari") {
    return {
      title: "Install on iPhone or iPad",
      summary: "Add Aural to your Home Screen for full-screen playback and offline access.",
      steps: [
        "Tap the Share button in Safari's navigation bar.",
        "Scroll down and tap Add to Home Screen.",
        "Tap Add in the top corner to install Aural.",
      ],
    };
  }

  if (mode === "embedded-tab") {
    return {
      title: "Install Aural App",
      summary: "Open Aural in a standalone browser tab to trigger one-click desktop or mobile installation.",
      steps: [
        "Open Aural in a dedicated browser tab using the link below.",
        "Click the Install Aural icon in your browser's address bar or tap Install app inside Aural.",
      ],
    };
  }

  if (platform === "mac") {
    return {
      title: "Download Aural for Mac",
      summary: "Install Aural directly to your Dock or Applications launcher.",
      steps: [
        "In Chrome or Edge, click the Install icon on the right side of the address bar.",
        "In Safari on macOS, open File -> Add to Dock from the menu bar.",
      ],
    };
  }

  if (platform === "android") {
    return {
      title: "Install Aural on Android",
      summary: "Add Aural to your home screen and app drawer with full offline shell caching.",
      steps: [
        "Open your browser menu (three dots in the top corner).",
        "Tap Add to Home screen or Install app.",
      ],
    };
  }

  return {
    title: "Download Aural App",
    summary: "Install Aural for an uncluttered standalone window and instant launch.",
    steps: [
      "Look for the Install icon on the right side of your browser's address bar.",
      "Or open your browser menu and choose Install Aural / Apps -> Install this site as an app.",
    ],
  };
}
