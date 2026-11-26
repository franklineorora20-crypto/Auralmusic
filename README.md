# Aural

Aural is an original, responsive music streaming web application built with React, TypeScript and Vite.

## Features

- Home recommendations and discovery sections
- Functional song, artist, album and genre search
- Favourites and recently played music
- Playlists with create, rename, delete, add, remove and reorder operations
- Persistent playlists, favourites, player preferences and imported tracks
- Real HTML audio playback with seek, volume, shuffle, repeat and queue controls
- Artist and album views
- Local audio-file import
- Responsive desktop and mobile layouts
- Loading and error states

## Run locally

```powershell
npm install
npm run dev
```

Open the URL printed by Vite. Use `npm run build` to create a production build.

## Audio

The sample previews use example MP3 endpoints to exercise the player. Their displayed song metadata is illustrative, not catalogue information, and these tracks are not download eligible. Import your own properly licensed audio files through **Import audio** in the sidebar or library.

## Data persistence

The app stores playlists, favourites, recently played tracks, preferences and cached catalogue metadata in browser `localStorage`. Imported and downloaded audio files are stored in IndexedDB and remain available after reload.

## Live catalogue and offline audio

- Discovery, trending tracks, artwork, and track search use the public Audius API. No private API key is embedded in the frontend. The browser needs an internet connection to refresh the catalogue; cached Audius metadata remains available locally.
- The built-in sample previews are demonstration audio, not catalogue results. They are labeled as samples and are not eligible for downloads.
- A download control appears only when Audius explicitly marks a track as downloadable. Downloads are fetched through the provider's download endpoint, checked for an audio response and non-empty content, then stored with their metadata in IndexedDB. Imported audio is stored there as well, so it remains available after reload and while offline.
- Playlists, likes, search history, player settings, and cached catalogue metadata use localStorage. Offline audio uses IndexedDB. Browser storage limits apply; removing a downloaded track frees its stored audio.
- A cancelled or interrupted download is not retained as a partial file and must be started again. Provider availability, CORS, network access, and each track's licensing determine whether streaming or downloading succeeds.

This repository has no authentication or cloud backend. Library data is local to the browser profile and is not synchronized across devices. Audius playback and download availability are controlled by Audius and each uploader; a stream URL alone is never treated as download permission.

## Internet Archive music provider

Aural integrates [Internet Archive](https://archive.org/) in **Search -> Source -> Internet Archive** (and **All sources**) using the official public Advanced Search API (`https://archive.org/advancedsearch.php`) and Metadata API (`https://archive.org/metadata/<identifier>`). No API key is required.

- **Playback & metadata**: Searches filter to `mediatype:audio` with pagination and hydrate track titles, creators, durations, release dates, cover images, and direct links to the original `archive.org/details/<identifier>` item page.
- **Playlists, favourites & local library**: Eligible playable recordings can be played through Aural's audio engine, added to favourites or playlists, and imported into the browser's IndexedDB local library from the item details dialog.
- **Rights & limitations**:
  - Items marked `access-restricted-item`, `stream_only`, lending/inlibrary collections, or private files are surfaced as unavailable and cannot be played or downloaded.
  - Explicit Creative Commons / Public Domain Mark / CC0 / NoC licenses allow direct offline downloads. Unspecified-license items never assume public domain and require explicit user confirmation before local import, while explicit copyright/all-rights-reserved items block downloading and importing.
  - Legacy or non-browser audio formats (such as `.shn`, `.ape`, `.wma`) are skipped unless a compatible derivative (`MP3`, `OGG`, `M4A`, `Opus`, `FLAC`, `WAV`) is available.
  - Streaming and importing rely on Archive.org availability and CORS headers; single-track offline imports remain capped at 80 MB.

## Optional yt-dlp media-import provider

Aural includes an optional `yt-dlp` source in **Search -> Source -> yt-dlp** (and **Import URL** in Library/Downloads) backed by a local Express service (`server.ts` + `server/ytdlpService.ts`). The React renderer never executes shell commands or spawns processes directly.

### Installation (local development)

1. Install Node.js 20+ and Python 3.10+.
2. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and `ffmpeg`:
   - Windows: `winget install yt-dlp.yt-dlp Gyan.FFmpeg` (or `pip install yt-dlp`, or place `yt-dlp.exe` and `ffmpeg.exe` in `resources/bin/` or set `YTDLP_PATH` / `FFMPEG_PATH`).
   - Linux / macOS: `pip install yt-dlp` and install `ffmpeg` via your package manager.
3. Run `npm install` and `npm run dev` (starts Express + Vite on `http://localhost:3000`).

### Windows Electron packaging

```powershell
# Optional: download official yt-dlp.exe into resources/bin/
node scripts/prepare-win-binaries.mjs
# Place ffmpeg.exe in resources/bin/ for audio conversion (MP3/M4A/Opus)

# Build frontend, backend server bundle, and Windows x64 Electron installer + zip
npm run electron:build:win
```

Packaged Electron builds boot the local backend on `127.0.0.1` (`electron/main.cjs`) and automatically detect `yt-dlp.exe` and `ffmpeg.exe` inside `process.resourcesPath/bin` (`extraResources` from `resources/bin`).

### Licensing & usage limitations

- **Metadata vs. authorization**: Fetching metadata (`title`, `artist`/`uploader`, `duration`, `thumbnail`, `sourceUrl`) inspects public reference information only and **never grants permission** to stream or download copyrighted content.
- **Rights confirmation**: Importing audio requires confirming that you own the rights or have explicit authorization from the rights holder.
- **Third-party licenses**: `yt-dlp` is released under [The Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); `ffmpeg` builds are licensed under LGPL v2.1+ / GPL v2+ depending on build configuration. Check binary redistribution obligations before distributing bundled `ffmpeg.exe` binaries.
- **Security & limits**: Only `http://` and `https://` public URLs are accepted; local/private network addresses are blocked; subprocesses run without a shell using fixed flags (`--ignore-config`, `--no-exec`) and an 80 MB per-track offline storage limit.

