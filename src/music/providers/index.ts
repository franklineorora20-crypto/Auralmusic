import type { ProviderId } from "../types/music";
import { audiusProvider } from "./audius";
import type { MusicProvider } from "./base";
import { internetArchiveProvider } from "./internetArchive";
import { jamendoProvider } from "./jamendo";
import { localProvider, setLocalTracks } from "./local";
import { sampleProvider } from "./sample";
import { ytdlpProvider } from "./ytdlp";

/** Every provider the app knows about, in default query order. */
export const PROVIDERS: MusicProvider[] = [
  audiusProvider,
  jamendoProvider,
  internetArchiveProvider,
  localProvider,
  sampleProvider,
  ytdlpProvider,
];

export const NETWORK_PROVIDERS: MusicProvider[] = [audiusProvider, jamendoProvider, internetArchiveProvider];

export function getProvider(id: ProviderId): MusicProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Providers that can answer a request right now (configured + enabled). */
export function enabledProviders(): MusicProvider[] {
  return PROVIDERS.filter((provider) => provider.isEnabled());
}

export function catalogProviders(): MusicProvider[] {
  return NETWORK_PROVIDERS.filter((provider) => provider.isEnabled());
}

export { setLocalTracks };
export type { MusicProvider };
export type { ListOptions, TrackQueryOptions } from "./base";
