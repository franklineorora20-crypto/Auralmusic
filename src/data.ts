import type { Track } from "./types";
import { sampleTracks } from "./music/providers/sample";

/**
 * Demo tracks used when the live catalogue is unavailable. These are clearly
 * labelled sample previews (SoundHelix demo audio), not catalogue results.
 */
export const demoTracks: Track[] = sampleTracks;
