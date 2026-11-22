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
