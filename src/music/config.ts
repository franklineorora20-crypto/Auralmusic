import type { ProviderId, ProviderStatus } from "./types/music";
import { PROVIDER_DOCS, PROVIDER_NAMES } from "./types/music";

/**
 * Runtime configuration for the music layer.
 *
 * Nothing secret is compiled into the bundle: values come from Vite
 * environment variables (see `.env.example`) and, for the Jamendo client id,
 * optionally from a value the operator pastes into the app at runtime.
 */

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {};

/** Audius only needs an app name for attribution and rate-limit bucketing. */
export const AUDIUS_APP_NAME = (env.VITE_AUDIUS_APP_NAME ?? "aural").trim() || "aural";

/**
 * Optional secure proxy (e.g. a serverless function) that forwards provider
 * requests and injects keys server-side. When set, every request is rewritten
 * to `${MUSIC_PROXY_URL}/<provider>/<path>`.
 */
export const MUSIC_PROXY_URL = (env.VITE_MUSIC_PROXY_URL ?? "").trim().replace(/\/+$/, "");

const JAMENDO_STORAGE_KEY = "aural-jamendo-client-id";
const ENV_JAMENDO_CLIENT_ID = (env.VITE_JAMENDO_CLIENT_ID ?? "").trim();

type Listener = () => void;
const listeners = new Set<Listener>();

function readStoredJamendoClientId(): string {
  try {
    return (localStorage.getItem(JAMENDO_STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

let jamendoOverride = readStoredJamendoClientId();

export function getJamendoClientId(): string {
  return jamendoOverride || ENV_JAMENDO_CLIENT_ID;
}

export function setJamendoClientId(value: string): void {
  jamendoOverride = value.trim();
  try {
    if (jamendoOverride) localStorage.setItem(JAMENDO_STORAGE_KEY, jamendoOverride);
    else localStorage.removeItem(JAMENDO_STORAGE_KEY);
  } catch {
    // A blocked storage API must not break provider configuration.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeToConfig(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Jamendo client ids are public identifiers, but they are still not hardcoded. */
export function isJamendoConfigured(): boolean {
  return getJamendoClientId().length > 0;
}

export function buildProviderUrl(provider: ProviderId, url: string): string {
  if (!MUSIC_PROXY_URL) return url;
  return `${MUSIC_PROXY_URL}/${provider}/${url.replace(/^https?:\/\//, "")}`;
}

export function getProviderStatuses(): ProviderStatus[] {
  return [
    {
      id: "audius",
      name: PROVIDER_NAMES.audius,
      ready: true,
      requiresKey: false,
      docsUrl: PROVIDER_DOCS.audius,
    },
    {
      id: "jamendo",
      name: PROVIDER_NAMES.jamendo,
      ready: isJamendoConfigured(),
      requiresKey: true,
      reason: isJamendoConfigured()
        ? undefined
        : "Add a free Jamendo client ID in Discover → Providers, or set VITE_JAMENDO_CLIENT_ID.",
      docsUrl: PROVIDER_DOCS.jamendo,
    },
    {
      id: "internetarchive",
      name: PROVIDER_NAMES.internetarchive,
      ready: true,
      requiresKey: false,
      docsUrl: PROVIDER_DOCS.internetarchive,
    },
    {
      id: "local",
      name: PROVIDER_NAMES.local,
      ready: true,
      requiresKey: false,
      docsUrl: PROVIDER_DOCS.local,
    },
    {
      id: "ytdlp",
      name: PROVIDER_NAMES.ytdlp,
      ready: true,
      requiresKey: false,
      reason: "Optional URL metadata lookup and rights-confirmed local import via the local yt-dlp backend.",
      docsUrl: PROVIDER_DOCS.ytdlp,
    },
  ];
}
