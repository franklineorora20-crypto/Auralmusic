import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import CRTWarp from "./components/CRTWarp";
import Ferrofluid from "./components/Ferrofluid";
import { getCrtPreset } from "./components/crtPresets";
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, ChevronDown, ChevronUp, Download, HardDrive,
  Heart, Home, ImagePlus, Infinity as InfinityIcon, Library, Link2, ListMusic, MicVocal, Pause, Play, Plus,
  Repeat1, Repeat2, Search, Shuffle, SkipBack, SkipForward, Trash2, Upload, Volume2,
  UserRound, VolumeX, Wifi, WifiOff, X, PanelLeftClose, PanelLeftOpen, ChevronsUp, Clock, Radio,
} from "lucide-react";
import CoverArtModal from "./components/CoverArtModal";
import LibraryFileSystem from "./components/LibraryFileSystem";
import LyricsPanel from "./components/LyricsPanel";
import { CrumpledAppScreen, PaperTossOverlay, playPaperRustle, type PaperTossItem } from "./components/PaperStage";
import { DevicePermissionsCard } from "./components/DevicePermissionsCard";
import { OfflineIndicator, PWAInstallButton } from "./components/PWAInstallButton";
import { PlaylistArtwork, TrackArtwork } from "./components/TrackArtwork";
import YtdlpImportPanel from "./components/YtdlpImportPanel";
import {
  backgroundAudioBridge,
  ensurePlaybackAudioSession,
  isAudioAbortError,
  readDevicePermissionsSnapshot,
  requestNotificationPermission,
  requestPersistentStoragePermission,
  shouldHoldWakeLock,
  wakeLockController,
  type DevicePermissionsSnapshot,
} from "./music/lib/devicePermissions";
import { isDisplayableImageUrl } from "./music/lib/mediaMetadata";
import {
  registerMediaSessionHandlers,
  syncMediaSessionMetadata,
  syncMediaSessionPlaybackState,
  syncMediaSessionPosition,
} from "./music/lib/mediaSession";
import {
  computeNextTrackId,
  computePreviousTrackId,
  createShuffledIds,
  isTrackPlayable,
  resolvePlayableQueue,
} from "./music/lib/playbackQueue";
import { useOnlineStatus, usePWAInstall } from "./pwa/usePWAInstall";
import { StoreProvider, useStore } from "./store";
import { demoTracks } from "./data";
import type { Track, View } from "./types";
import { getTrending, searchMusic } from "./catalog";


const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
};

function AuralApp() {
  const store = useStore();
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState("All");
  const [searchProvider, setSearchProvider] = useState<"all" | "audius" | "jamendo" | "local" | "ytdlp">("all");
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState("");
  const online = useOnlineStatus();
  const pwa = usePWAInstall();
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("aural-search-history") ?? "[]") as string[]; }
    catch { return []; }
  });
  const [currentId, setCurrentId] = useState(store.queueIds[0] ?? demoTracks[0].id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [addTrackId, setAddTrackId] = useState("");
  const [coverEditTrackId, setCoverEditTrackId] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [history, setHistory] = useState<Array<{ view: View; selectedId: string }>>([{ view: "home", selectedId: "" }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 900);
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [npLyricsOpen, setNpLyricsOpen] = useState(false);
  const [stageScrolled, setStageScrolled] = useState(false);
  const [paperPhase, setPaperPhase] = useState<"open" | "crumpling" | "crumpled" | "unfolding">("open");
  const [paperTosses, setPaperTosses] = useState<PaperTossItem[]>([]);
  const tossIdRef = useRef(0);
  const paperTimerRef = useRef<number | null>(null);
  const mainStageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (event: MediaQueryListEvent) => {
      setSidebarCollapsed(event.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (paperTimerRef.current !== null) window.clearTimeout(paperTimerRef.current);
    };
  }, []);
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aural-autoplay") ?? "true") as boolean; } catch { return true; }
  });
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aural-crossfade") ?? "false") as boolean; } catch { return false; }
  });
  const [crtVisualizer, setCrtVisualizer] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aural-crt") ?? "false") as boolean; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("aural-autoplay", JSON.stringify(autoplayEnabled)); } catch { /* storage unavailable */ }
  }, [autoplayEnabled]);
  useEffect(() => {
    try { localStorage.setItem("aural-crossfade", JSON.stringify(crossfadeEnabled)); } catch { /* storage unavailable */ }
  }, [crossfadeEnabled]);
  useEffect(() => {
    try { localStorage.setItem("aural-crt", JSON.stringify(crtVisualizer)); } catch { /* storage unavailable */ }
  }, [crtVisualizer]);

  const [wakeLockEnabled, setWakeLockEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aural-wakelock") ?? "true") as boolean; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("aural-wakelock", JSON.stringify(wakeLockEnabled)); } catch { /* storage unavailable */ }
  }, [wakeLockEnabled]);

  const [devicePermissions, setDevicePermissions] = useState<DevicePermissionsSnapshot>(() => ({
    audioSession: "unsupported",
    mediaSession: typeof navigator !== "undefined" && "mediaSession" in navigator ? "active" : "unsupported",
    persistentStorage: "prompt",
    notifications: "prompt",
    wakeLockSupported: typeof navigator !== "undefined" && "wakeLock" in navigator,
    wakeLockEnabled,
    wakeLockActive: false,
    keepAliveActive: false,
  }));
  const [requestingPermissions, setRequestingPermissions] = useState(false);

  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const playHistoryRef = useRef<string[]>([]);
  const crossfadeRef = useRef<HTMLAudioElement | null>(null);
  const fadingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importTargetFolderRef = useRef<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);
  const loadedTrackIdRef = useRef(currentId);
  const trackSwitchingRef = useRef(false);
  const trackSwitchTimerRef = useRef<number | null>(null);

  const clearTrackSwitchGuard = () => {
    trackSwitchingRef.current = false;
    if (trackSwitchTimerRef.current !== null) {
      window.clearTimeout(trackSwitchTimerRef.current);
      trackSwitchTimerRef.current = null;
    }
  };

  const beginTrackSwitchGuard = () => {
    trackSwitchingRef.current = true;
    if (trackSwitchTimerRef.current !== null) {
      window.clearTimeout(trackSwitchTimerRef.current);
    }
    trackSwitchTimerRef.current = window.setTimeout(() => {
      trackSwitchingRef.current = false;
      trackSwitchTimerRef.current = null;
    }, 5000);
  };

  const refreshDevicePermissions = async () => {
    const next = await readDevicePermissionsSnapshot(wakeLockEnabled);
    setDevicePermissions(next);
  };

  useEffect(() => {
    ensurePlaybackAudioSession();
    void refreshDevicePermissions();
    if (pwa.isInstalled) {
      void requestPersistentStoragePermission().then(() => refreshDevicePermissions());
    }
    return () => {
      clearTrackSwitchGuard();
      void wakeLockController.release();
      void backgroundAudioBridge.stop();
    };
  }, []);

  useEffect(() => {
    const syncWake = async () => {
      if (shouldHoldWakeLock(isPlaying, wakeLockEnabled)) {
        await wakeLockController.acquire();
      } else {
        await wakeLockController.release();
      }
      await refreshDevicePermissions();
    };
    void syncWake();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && shouldHoldWakeLock(isPlaying, wakeLockEnabled)) {
        void wakeLockController.acquire().then(() => refreshDevicePermissions());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isPlaying, wakeLockEnabled]);

  const grantAllDevicePermissions = async () => {
    setRequestingPermissions(true);
    try {
      ensurePlaybackAudioSession();
      if (isPlaying) {
        await backgroundAudioBridge.start();
      }
      await requestPersistentStoragePermission();
      await requestNotificationPermission();
      setWakeLockEnabled(true);
      if (isPlaying) {
        await wakeLockController.acquire();
      }
      await refreshDevicePermissions();
      setImportMessage("Device & lock-screen playback permissions updated.");
      window.setTimeout(() => setImportMessage(""), 3500);
    } finally {
      setRequestingPermissions(false);
    }
  };

  const current = store.tracks.find((track) => track.id === currentId) ?? store.tracks[0];
  const recentTracks = store.recentIds.map((id) => store.tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track));
  const queueTracks = store.queueIds.map((id) => store.tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track));
  const downloadedIds = useMemo(() => new Set(store.downloads.map((track) => track.id)), [store.downloads]);

  useEffect(() => {
    if (!store.shuffle) {
      setShuffleOrder([]);
      return;
    }
    const availability = { online, downloadedIds };
    const activeIds = resolvePlayableQueue(store.queueIds, store.tracks, currentId, availability);
    const availablePoolIds = store.tracks
      .filter((track) => isTrackPlayable(track, availability))
      .map((track) => track.id);
    const activeSet = new Set(activeIds);
    const extraIds = availablePoolIds.filter((id) => !activeSet.has(id));

    setShuffleOrder((previous) => {
      if (previous.length === 0) {
        return [
          ...createShuffledIds(activeIds, currentId),
          ...createShuffledIds(extraIds),
        ];
      }
      const prevActive = previous.filter((id) => activeSet.has(id));
      const prevActiveSet = new Set(prevActive);
      const missingActive = activeIds.filter((id) => !prevActiveSet.has(id));
      const mergedActive = prevActive.length > 0
        ? [...prevActive, ...createShuffledIds(missingActive)]
        : createShuffledIds(activeIds, currentId);

      const mergedActiveSet = new Set(mergedActive);
      const extraSet = new Set(extraIds);
      const prevExtra = previous.filter((id) => extraSet.has(id) && !mergedActiveSet.has(id));
      const prevExtraSet = new Set(prevExtra);
      const missingExtra = extraIds.filter((id) => !prevExtraSet.has(id));

      return [...mergedActive, ...prevExtra, ...createShuffledIds(missingExtra)];
    });
  }, [store.shuffle, store.queueIds, store.tracks, online, downloadedIds, currentId]);

  const nextTrackId = useMemo(
    () =>
      computeNextTrackId({
        queueIds: store.queueIds,
        tracks: store.tracks,
        currentId,
        shuffle: store.shuffle,
        repeat: store.repeat,
        autoplay: autoplayEnabled,
        online,
        downloadedIds,
        shuffleOrder,
        recentIds: store.recentIds,
      }),
    [
      store.queueIds,
      store.tracks,
      currentId,
      store.shuffle,
      store.repeat,
      autoplayEnabled,
      online,
      downloadedIds,
      shuffleOrder,
      store.recentIds,
    ],
  );

  const nextQueueTrack = useMemo(
    () => (nextTrackId && nextTrackId !== currentId ? store.tracks.find((t) => t.id === nextTrackId) : undefined),
    [nextTrackId, currentId, store.tracks],
  );

  /**
   * Crossfade: starts a second audio element ~6s before track end, ramps both
   * volumes, then hands playback back to the main element. Plain media elements
   * (no Web Audio decode) so CORS-restricted provider streams keep working.
   */
  useEffect(() => {
    const primary = audioRef.current;
    if (!primary || !crossfadeEnabled || !isPlaying || store.repeat === "one") return;
    const CROSSFADE_SECONDS = 6;

    const startFade = () => {
      if (fadingRef.current || !primary.duration || !Number.isFinite(primary.duration)) return;
      if (primary.duration <= CROSSFADE_SECONDS * 1.5) return;
      const remaining = primary.duration - primary.currentTime;
      if (remaining > CROSSFADE_SECONDS || remaining <= 0.2) return;
      if (!autoplayEnabled && store.repeat === "off") {
        const currentInQueue = store.queueIds.indexOf(currentId);
        const hasQueuedNext =
          store.queueIds.length > 1 &&
          (store.shuffle || (currentInQueue >= 0 && currentInQueue < store.queueIds.length - 1));
        if (!hasQueuedNext) return;
      }
      if (!nextTrackId || nextTrackId === currentId) return;
      const nextTrack = store.tracks.find((track) => track.id === nextTrackId);
      if (!nextTrack) return;

      fadingRef.current = true;
      const ghost = new Audio(nextTrack.streamUrl);
      ghost.volume = 0;
      ghost.preload = "auto";
      crossfadeRef.current = ghost;
      const startVolume = store.volume;

      const fade = window.setInterval(() => {
        primary.volume = Math.max(0, primary.volume - 0.05);
        ghost.volume = Math.min(startVolume, ghost.volume + 0.05);
        if (primary.volume <= 0.02) {
          window.clearInterval(fade);
          fadingRef.current = false;
          crossfadeRef.current = null;
          if (currentId && currentId !== nextTrack.id) {
            playHistoryRef.current = [...playHistoryRef.current.slice(-49), currentId];
          }
          if (!store.queueIds.includes(nextTrack.id)) {
            store.setQueue([...store.queueIds, nextTrack.id]);
          }
          loadedTrackIdRef.current = nextTrack.id;
          beginTrackSwitchGuard();
          ensurePlaybackAudioSession();
          syncMediaSessionMetadata(nextTrack);
          syncMediaSessionPlaybackState(true);
          setCurrentId(nextTrack.id);
          store.addRecent(nextTrack.id);
          setCurrentTime(0);
          setDuration(nextTrack.duration ?? 0);
          setIsPlaying(true);
          const primaryAfter = audioRef.current;
          if (primaryAfter) {
            primaryAfter.volume = startVolume;
            primaryAfter.src = nextTrack.streamUrl;
            void primaryAfter.play().catch((error) => {
              if (!isAudioAbortError(error)) {
                clearTrackSwitchGuard();
                setIsPlaying(false);
              }
            });
          }
          ghost.pause();
          ghost.src = "";
        }
      }, 250);

      ghost.onerror = () => {
        window.clearInterval(fade);
        fadingRef.current = false;
        crossfadeRef.current = null;
        if (audioRef.current) audioRef.current.volume = startVolume;
      };
    };

    primary.addEventListener("timeupdate", startFade);
    return () => {
      primary.removeEventListener("timeupdate", startFade);
      crossfadeRef.current?.pause();
      crossfadeRef.current = null;
      fadingRef.current = false;
      if (audioRef.current) audioRef.current.volume = store.volume;
    };
  }, [autoplayEnabled, crossfadeEnabled, isPlaying, currentId, nextTrackId, store.queueIds, store.repeat, store.shuffle, store.tracks, store.volume]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogueLoading(true);
        getTrending(controller.signal)

      .then((tracks) => {
        store.addCatalogueTracks(tracks);
        setCatalogueError("");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCatalogueError(error instanceof Error ? error.message : "Could not load the Audius catalogue.");
        }
      })
      .finally(() => setCatalogueLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (view !== "search" || !term || searchProvider === "ytdlp" || searchProvider === "local") {
      setSearchTracks([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    setSearchTracks([]);
    setSearchHasMore(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError("");
      setSearchOffset(0);
            searchMusic(term, controller.signal)

        .then((tracks) => {
          setSearchTracks(tracks);
          setSearchHasMore(tracks.length === 20);
          store.addCatalogueTracks(tracks);
          setSearchHistory((previous) => {
            const updated = [term, ...previous.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 8);
            localStorage.setItem("aural-search-history", JSON.stringify(updated));
            return updated;
          });
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setSearchError(error instanceof Error ? error.message : "Could not search the Audius catalogue.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
    };
  }, [query, view, searchProvider]);

  const loadMoreSearchResults = () => {
    const term = query.trim();
    if (!term || searchLoading) return;
    const nextOffset = searchOffset + 20;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setSearchLoading(true);
        searchMusic(term, controller.signal, nextOffset)

      .then((tracks) => {
        setSearchTracks((previous) => [...previous, ...tracks]);
        setSearchOffset(nextOffset);
        setSearchHasMore(tracks.length === 20);
        store.addCatalogueTracks(tracks);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchError(error instanceof Error ? error.message : "Could not load more catalogue results.");
        }
      })
      .finally(() => {
        if (loadMoreController.current === controller) {
          loadMoreController.current = null;
          setSearchLoading(false);
        }
      });
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = store.volume;
  }, [store.volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (loadedTrackIdRef.current === currentId) return;
    loadedTrackIdRef.current = currentId;
    if (isPlaying) {
      beginTrackSwitchGuard();
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      void audioRef.current.play().catch((error) => {
        if (isAudioAbortError(error)) return;
        clearTrackSwitchGuard();
        setIsPlaying(false);
      });
    } else {
      audioRef.current.load();
    }
  }, [currentId, isPlaying]);

  const switchToTrack = (trackId: string, autoplay = true) => {
    const nextTrack = store.tracks.find((track) => track.id === trackId);
    loadedTrackIdRef.current = trackId;
    if (autoplay) {
      beginTrackSwitchGuard();
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      if (nextTrack) {
        syncMediaSessionMetadata(nextTrack);
        syncMediaSessionPlaybackState(true);
        syncMediaSessionPosition(nextTrack.duration ?? 0, 0);
      }
    } else {
      clearTrackSwitchGuard();
    }
    setCurrentId(trackId);
    store.addRecent(trackId);
    setCurrentTime(0);
    setDuration(nextTrack?.duration ?? 0);
    setPlaybackError("");
    if (audioRef.current && nextTrack) {
      audioRef.current.src = nextTrack.streamUrl;
      if (autoplay) {
        setIsPlaying(true);
        void audioRef.current.play().catch((error) => {
          if (isAudioAbortError(error) || loadedTrackIdRef.current !== trackId) return;
          clearTrackSwitchGuard();
          setIsPlaying(false);
        });
      } else {
        audioRef.current.load();
        setIsPlaying(false);
      }
    } else {
      setIsPlaying(autoplay);
    }
  };

  const playTrack = (track: Track, collection?: Track[]) => {
    if (collection?.length) {
      const collectionIds = collection.map((item) => item.id);
      store.setQueue(collectionIds);
      if (store.shuffle) {
        const activeSet = new Set(collectionIds);
        const extraIds = store.tracks
          .filter((item) => !activeSet.has(item.id) && isTrackPlayable(item, { online, downloadedIds }))
          .map((item) => item.id);
        setShuffleOrder([
          ...createShuffledIds(collectionIds, track.id),
          ...createShuffledIds(extraIds),
        ]);
      }
    } else if (!store.queueIds.includes(track.id)) {
      store.setQueue([...store.queueIds, track.id]);
    }
    store.addRecent(track.id);
    if (track.id === currentId) {
      if (audioRef.current) {
        if (isPlaying) {
          clearTrackSwitchGuard();
          audioRef.current.pause();
          void backgroundAudioBridge.stop();
        } else {
          ensurePlaybackAudioSession();
          void backgroundAudioBridge.start();
          void audioRef.current.play().catch((error) => {
            if (!isAudioAbortError(error)) setIsPlaying(false);
          });
        }
      }
      setIsPlaying((playing) => !playing);
    } else {
      if (currentId) {
        playHistoryRef.current = [...playHistoryRef.current.slice(-49), currentId];
      }
      switchToTrack(track.id, true);
    }
    setPlaybackError("");
  };

  const startShuffle = (collection: Track[]) => {
    const availability = { online, downloadedIds };
    const playable = collection.filter((track) => isTrackPlayable(track, availability));
    const pool = playable.length ? playable : collection;
    if (!pool.length) return;
    const nonCurrentPool = pool.filter((item) => item.id !== currentId);
    const pickPool = nonCurrentPool.length ? nonCurrentPool : pool;
    const firstTrack = pickPool[Math.floor(Math.random() * pickPool.length)];
    const activeIds = collection.map((item) => item.id);
    const activeSet = new Set(activeIds);
    const extraIds = store.tracks
      .filter((item) => !activeSet.has(item.id) && isTrackPlayable(item, availability))
      .map((item) => item.id);

    store.setShuffle(true);
    setShuffleOrder([
      ...createShuffledIds(activeIds, firstTrack.id),
      ...createShuffledIds(extraIds),
    ]);
    store.setQueue(activeIds);
    store.addRecent(firstTrack.id);
    if (firstTrack.id === currentId) {
      seekToTime(0);
      if (audioRef.current && !isPlaying) {
        ensurePlaybackAudioSession();
        void backgroundAudioBridge.start();
        void audioRef.current.play().then(() => setIsPlaying(true)).catch((error) => {
          if (!isAudioAbortError(error)) setIsPlaying(false);
        });
      }
    } else {
      if (currentId) {
        playHistoryRef.current = [...playHistoryRef.current.slice(-49), currentId];
      }
      switchToTrack(firstTrack.id, true);
    }
    setPlaybackError("");
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      clearTrackSwitchGuard();
      audioRef.current.pause();
      void backgroundAudioBridge.stop();
      setIsPlaying(false);
    } else {
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      void audioRef.current.play().then(() => setIsPlaying(true)).catch((error) => {
        if (!isAudioAbortError(error)) setIsPlaying(false);
      });
    }
  };

  const seekToTime = (seconds: number) => {
    const maxDuration = duration || current?.duration || 0;
    const clamped = Math.max(0, Number.isFinite(seconds) ? (maxDuration > 0 ? Math.min(maxDuration, seconds) : seconds) : 0);
    setCurrentTime(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
    syncMediaSessionPosition(maxDuration, clamped);
  };

  const playNext = () => {
    const nextId = computeNextTrackId({
      queueIds: store.queueIds,
      tracks: store.tracks,
      currentId,
      shuffle: store.shuffle,
      repeat: store.repeat,
      autoplay: autoplayEnabled,
      online,
      downloadedIds,
      shuffleOrder,
      recentIds: store.recentIds,
    });
    if (!nextId) {
      clearTrackSwitchGuard();
      audioRef.current?.pause();
      void backgroundAudioBridge.stop();
      setIsPlaying(false);
      return;
    }
    if (nextId === currentId && store.repeat === "all" && audioRef.current) {
      beginTrackSwitchGuard();
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      audioRef.current.currentTime = 0;
      setIsPlaying(true);
      syncMediaSessionPlaybackState(true);
      void audioRef.current.play().catch((error) => {
        if (!isAudioAbortError(error)) {
          clearTrackSwitchGuard();
          setIsPlaying(false);
        }
      });
      return;
    }
    if (currentId && currentId !== nextId) {
      playHistoryRef.current = [...playHistoryRef.current.slice(-49), currentId];
    }
    if (!store.queueIds.includes(nextId)) {
      store.setQueue([...store.queueIds, nextId]);
    }
    switchToTrack(nextId, true);
  };

  const playPrevious = () => {
    const result = computePreviousTrackId({
      queueIds: store.queueIds,
      tracks: store.tracks,
      currentId,
      repeat: store.repeat,
      currentTime: audioRef.current?.currentTime ?? currentTime,
      shuffle: store.shuffle,
      historyIds: playHistoryRef.current,
      online,
      downloadedIds,
    });
    if (result.action === "restart") {
      seekToTime(0);
      return;
    }
    if (result.action === "switch" && result.trackId) {
      if (store.shuffle && playHistoryRef.current.length > 0) {
        const idx = playHistoryRef.current.lastIndexOf(result.trackId);
        if (idx >= 0) {
          playHistoryRef.current = playHistoryRef.current.slice(0, idx);
        }
      }
      switchToTrack(result.trackId, true);
    }
  };

  const handleEnded = () => {
    if (store.repeat === "one" && audioRef.current) {
      beginTrackSwitchGuard();
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      audioRef.current.currentTime = 0;
      setIsPlaying(true);
      syncMediaSessionPlaybackState(true);
      void audioRef.current.play().catch((error) => {
        if (!isAudioAbortError(error)) {
          clearTrackSwitchGuard();
          setIsPlaying(false);
        }
      });
      return;
    }
    if (!autoplayEnabled && store.repeat === "off") {
      const currentInQueue = store.queueIds.indexOf(currentId);
      const hasQueuedNext =
        store.queueIds.length > 1 &&
        (store.shuffle || (currentInQueue >= 0 && currentInQueue < store.queueIds.length - 1));
      if (!hasQueuedNext) {
        clearTrackSwitchGuard();
        audioRef.current?.pause();
        void backgroundAudioBridge.stop();
        setIsPlaying(false);
        return;
      }
    }
    playNext();
  };

  const mediaHandlersRef = useRef({
    play: () => {
      if (!audioRef.current) return;
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      syncMediaSessionPlaybackState(true);
      void audioRef.current.play().then(() => setIsPlaying(true)).catch((error) => {
        if (!isAudioAbortError(error)) setIsPlaying(false);
      });
    },
    pause: () => {
      clearTrackSwitchGuard();
      audioRef.current?.pause();
      void backgroundAudioBridge.stop();
      setIsPlaying(false);
    },
    next: playNext,
    previous: playPrevious,
    seekTo: seekToTime,
    seekBackward: (offset: number) => seekToTime(Math.max(0, (audioRef.current?.currentTime ?? currentTime) - offset)),
    seekForward: (offset: number) => seekToTime((audioRef.current?.currentTime ?? currentTime) + offset),
    stop: () => {
      clearTrackSwitchGuard();
      audioRef.current?.pause();
      void backgroundAudioBridge.stop();
      seekToTime(0);
      setIsPlaying(false);
    },
  });
  mediaHandlersRef.current = {
    play: () => {
      if (!audioRef.current) return;
      ensurePlaybackAudioSession();
      void backgroundAudioBridge.start();
      syncMediaSessionPlaybackState(true);
      void audioRef.current.play().then(() => setIsPlaying(true)).catch((error) => {
        if (!isAudioAbortError(error)) setIsPlaying(false);
      });
    },
    pause: () => {
      clearTrackSwitchGuard();
      audioRef.current?.pause();
      void backgroundAudioBridge.stop();
      setIsPlaying(false);
    },
    next: playNext,
    previous: playPrevious,
    seekTo: seekToTime,
    seekBackward: (offset: number) => seekToTime(Math.max(0, (audioRef.current?.currentTime ?? currentTime) - offset)),
    seekForward: (offset: number) => seekToTime((audioRef.current?.currentTime ?? currentTime) + offset),
    stop: () => {
      clearTrackSwitchGuard();
      audioRef.current?.pause();
      void backgroundAudioBridge.stop();
      seekToTime(0);
      setIsPlaying(false);
    },
  };

  useEffect(() => {
    return registerMediaSessionHandlers({
      onPlay: () => mediaHandlersRef.current.play(),
      onPause: () => mediaHandlersRef.current.pause(),
      onNextTrack: () => mediaHandlersRef.current.next(),
      onPreviousTrack: () => mediaHandlersRef.current.previous(),
      onSeekTo: (seconds) => mediaHandlersRef.current.seekTo(seconds),
      onSeekBackward: (offset) => mediaHandlersRef.current.seekBackward(offset),
      onSeekForward: (offset) => mediaHandlersRef.current.seekForward(offset),
      onStop: () => mediaHandlersRef.current.stop(),
    });
  }, []);

  useEffect(() => {
    syncMediaSessionMetadata(current);
  }, [current]);

  useEffect(() => {
    syncMediaSessionPlaybackState(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    syncMediaSessionPosition(duration || current?.duration || 0, currentTime);
  }, [duration, current?.duration, currentTime]);

  const spawnPaperToss = (label: string, origin: PaperTossItem["origin"] = "center", accent = current.accent) => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = ++tossIdRef.current;
    setPaperTosses((prev) => [...prev.slice(-3), { id, label, origin, accent }]);
    window.setTimeout(() => {
      setPaperTosses((prev) => prev.filter((item) => item.id !== id));
    }, 680);
  };

  const closeExpandedPlayer = () => {
    if (!expandedPlayer) return;
    spawnPaperToss(current.title, "center", current.accent);
    setExpandedPlayer(false);
  };

  const closeQueuePanel = () => {
    if (!queueOpen) return;
    spawnPaperToss("Queue", "right", current.accent);
    setQueueOpen(false);
  };

  const closeLyricsPanel = () => {
    if (!lyricsOpen) return;
    spawnPaperToss("Lyrics", "right", current.accent);
    setLyricsOpen(false);
  };

  const closeCreateModal = () => {
    if (!createOpen) return;
    spawnPaperToss("New playlist", "center", "#c49e64");
    setCreateOpen(false);
  };

  const closeAddModal = () => {
    if (!addTrackId) return;
    spawnPaperToss("Add to playlist", "center", "#c49e64");
    setAddTrackId("");
  };

  const quitToPaperBall = () => {
    if (paperPhase !== "open") return;
    playPaperRustle("crumple");
    audioRef.current?.pause();
    setIsPlaying(false);
    setExpandedPlayer(false);
    setQueueOpen(false);
    setLyricsOpen(false);
    setCreateOpen(false);
    setAddTrackId("");
    setPaperPhase("crumpling");
    if (paperTimerRef.current !== null) window.clearTimeout(paperTimerRef.current);
    paperTimerRef.current = window.setTimeout(() => {
      setPaperPhase("crumpled");
      paperTimerRef.current = null;
    }, 380);
  };

  const unfoldFromPaperBall = () => {
    if (paperPhase !== "crumpled") return;
    playPaperRustle("unfold");
    setPaperPhase("unfolding");
    if (paperTimerRef.current !== null) window.clearTimeout(paperTimerRef.current);
    paperTimerRef.current = window.setTimeout(() => {
      setPaperPhase("open");
      paperTimerRef.current = null;
    }, 420);
  };

  const navigate = (nextView: View, id = "") => {
    const leavingDetail =
      (view === "artist" || view === "album" || view === "playlist") &&
      (nextView !== view || id !== selectedId);
    if (leavingDetail) {
      spawnPaperToss(selectedId || view, "top", current.accent);
    }
    setView(nextView);
    setSelectedId(id);
    if (mainStageRef.current) mainStageRef.current.scrollTop = 0;
    setStageScrolled(false);
    setHistory((currentHistory) => {
      const active = currentHistory.slice(0, historyIndex + 1);
      const next = [...active, { view: nextView, selectedId: id }];
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const navigateHistory = (offset: -1 | 1) => {
    const nextIndex = historyIndex + offset;
    const destination = history[nextIndex];
    if (!destination) return;
    if (view === "artist" || view === "album" || view === "playlist") {
      spawnPaperToss(selectedId || view, "top", current.accent);
    }
    setHistoryIndex(nextIndex);
    setView(destination.view);
    setSelectedId(destination.selectedId);
    if (mainStageRef.current) mainStageRef.current.scrollTop = 0;
    setStageScrolled(false);
  };

  const shortcutRef = useRef({
    togglePlayback,
    seekToTime,
    playNext,
    playPrevious,
    currentTime,
    expandedPlayer,
    closeExpandedPlayer,
    closeQueuePanel,
    closeLyricsPanel,
    closeCreateModal,
    closeAddModal,
  });
  shortcutRef.current = {
    togglePlayback,
    seekToTime,
    playNext,
    playPrevious,
    currentTime,
    expandedPlayer,
    closeExpandedPlayer,
    closeQueuePanel,
    closeLyricsPanel,
    closeCreateModal,
    closeAddModal,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        if (target?.tagName === "BUTTON") return;
        event.preventDefault();
        shortcutRef.current.togglePlayback();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) shortcutRef.current.playNext();
        else shortcutRef.current.seekToTime(shortcutRef.current.currentTime + 5);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) shortcutRef.current.playPrevious();
        else shortcutRef.current.seekToTime(Math.max(0, shortcutRef.current.currentTime - 5));
      } else if (key === "f") {
        setExpandedPlayer((open) => !open);
      } else if (key === "l") {
        if (shortcutRef.current.expandedPlayer) {
          setNpLyricsOpen((open) => !open);
        } else {
          setLyricsOpen((open) => {
            const next = !open;
            if (next) setQueueOpen(false);
            return next;
          });
        }
      } else if (key === "q") {
        setQueueOpen((open) => {
          const next = !open;
          if (next) setLyricsOpen(false);
          return next;
        });
      } else if (event.key === "Escape") {
        shortcutRef.current.closeExpandedPlayer();
        shortcutRef.current.closeLyricsPanel();
        shortcutRef.current.closeQueuePanel();
        shortcutRef.current.closeCreateModal();
        shortcutRef.current.closeAddModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleDropImport = (files: File[], targetFolderId?: string | null) => {
    if (!files.length) return;
    void store.importAudio(files, targetFolderId ?? null).then(() => {
      setImportMessage(`${files.length} audio file${files.length === 1 ? "" : "s"} added to your offline library`);
    }).catch((error: unknown) => {
      setImportMessage(error instanceof Error ? error.message : "The audio files could not be imported.");
    }).finally(() => window.setTimeout(() => setImportMessage(""), 3500));
  };

  const triggerImportPicker = (targetFolderId: string | null = null) => {
    importTargetFolderRef.current = targetFolderId;
    fileRef.current?.click();
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const targetFolderId = importTargetFolderRef.current;
    importTargetFolderRef.current = null;
    if (!files.length) return;
    handleDropImport(files, targetFolderId);
    event.target.value = "";
  };

  const createPlaylist = () => {
    if (!playlistName.trim()) return;
    store.createPlaylist(playlistName);
    setPlaylistName("");
    setCreateOpen(false);
  };

  const renderTrackRow = ({ track, index, playlistId, collection }: { track: Track; index?: number; playlistId?: string; collection?: Track[] }) => {
    const isCurrentTrack = track.id === currentId;
    const isTrackPlaying = isCurrentTrack && isPlaying;
    return (
      <div key={track.id} className={`track-row ${isCurrentTrack ? "is-current" : ""}`}>
        {typeof index === "number" ? (
          isTrackPlaying ? (
            <span className="row-equalizer" aria-label="Playing"><span /><span /><span /></span>
          ) : (
            <span className="track-index">{index + 1}</span>
          )
        ) : (
          <button className="icon-button" onClick={() => playTrack(track, collection)} aria-label={isTrackPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>
            {isTrackPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
        )}
        <button className="track-main" onClick={() => playTrack(track, collection)}>
          <TrackArtwork track={track} size="small" />
          <span>
            <strong>{track.title}</strong>
            <small>{track.artist}{track.providerId === "sample" ? " · Sample preview" : track.providerId === "audius" ? " · Audius" : track.providerId === "jamendo" ? " · Jamendo" : ""}</small>
          </span>
        </button>
        <button className="track-album" onClick={() => navigate("album", track.album)}>{track.album}</button>
        <button
          className={`icon-button favourite ${store.favouriteIds.includes(track.id) ? "active" : ""}`}
          onClick={() => store.toggleFavourite(track.id)}
          aria-label={store.favouriteIds.includes(track.id) ? "Remove from favourites" : "Add to favourites"}
        ><Heart size={16} fill={store.favouriteIds.includes(track.id) ? "currentColor" : "none"} /></button>
        {playlistId && <div className="track-reorder">
          <button className="icon-button" onClick={() => store.reorderPlaylistTrack(playlistId, track.id, -1)} aria-label="Move track up"><ChevronUp size={15} /></button>
          <button className="icon-button" onClick={() => store.reorderPlaylistTrack(playlistId, track.id, 1)} aria-label="Move track down"><ChevronDown size={15} /></button>
        </div>}
        <span className="track-duration">{formatTime(track.duration)}</span>
        {playlistId
          ? <button className="icon-button" onClick={() => store.removeFromPlaylist(playlistId, track.id)} aria-label={`Remove ${track.title}`}><Trash2 size={15} /></button>
          : <button className="icon-button" onClick={() => setAddTrackId(track.id)} aria-label={`Add ${track.title} to a playlist`}><Plus size={15} /></button>}
        <div className="track-row-end-actions">
          <button
            className={`icon-button ${isDisplayableImageUrl(track.artwork) ? "active" : ""}`}
            onClick={() => setCoverEditTrackId(track.id)}
            aria-label={isDisplayableImageUrl(track.artwork) ? `Change cover for ${track.title}` : `Add cover for ${track.title}`}
            title={isDisplayableImageUrl(track.artwork) ? "Change cover picture" : "Add cover picture"}
          >
            <ImagePlus size={15} />
          </button>
          {store.downloadProgress[track.id] !== undefined
            ? <button className="download-progress-control" onClick={() => store.cancelDownload(track.id)} aria-label={`Cancel download of ${track.title}`} title="Cancel download">
              <span role={store.downloadProgress[track.id] < 0 ? "status" : "progressbar"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={store.downloadProgress[track.id] >= 0 ? store.downloadProgress[track.id] : undefined}>
                {store.downloadProgress[track.id] < 0 ? "…" : `${store.downloadProgress[track.id]}%`}
              </span><X size={14} />
            </button>
            : downloadedIds.has(track.id)
              ? <button className="icon-button active" onClick={() => { void store.removeDownload(track.id).catch(() => undefined); }} aria-label={`Remove ${track.title} download`} title="Available offline"><HardDrive size={15} /></button>
              : track.downloadUrl
                ? <button className="icon-button" onClick={() => {
                  void store.downloadTrack(track.id).then((completed) => {
                    if (completed) {
                      setImportMessage(`${track.title} is ready for offline listening.`);
                      window.setTimeout(() => setImportMessage(""), 3500);
                    }
                  }).catch(() => undefined);
                }} aria-label={`Download ${track.title}`} title="Request provider-authorized download"><Download size={15} /></button>
                : null}
        </div>
      </div>
    );
  };

  const renderCardGrid = (tracks: Track[], title: string) => (
    <section className="content-section">
      <div className="section-heading"><h2>{title}</h2><button onClick={() => navigate("search")}>Explore <ArrowRight size={15} /></button></div>
      <div className="card-grid">
        {tracks.map((track) => {
          const isCurrentTrack = track.id === currentId;
          const isTrackPlaying = isCurrentTrack && isPlaying;
          return (
            <article className={`music-card ${isCurrentTrack ? "is-current" : ""}`} key={track.id}>
              <button className="cover-button" onClick={() => playTrack(track, tracks)} aria-label={isTrackPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>
                <TrackArtwork track={track} />
                <span className={`card-play ${isTrackPlaying ? "is-playing" : ""}`}>
                  {isTrackPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                </span>
              </button>
              <button className="card-copy" onClick={() => navigate("album", track.album)}>
                <strong>{track.album && track.album !== "Single" && track.album !== "Imported" ? track.album : track.title}</strong>
                <small>
                  {track.artist}
                  {downloadedIds.has(track.id) ? " · Offline" : track.providerId === "sample" ? " · Sample" : ""}
                </small>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );

  const filteredTracks = useMemo(() => {
    const term = query.trim().toLowerCase();
    return store.tracks.filter((track) => {
      const matchesText = !term || `${track.title} ${track.artist} ${track.album} ${track.genre}`.toLowerCase().includes(term);
      let matchesFilter = true;
      if (searchFilter === "Artists") {
        matchesFilter = !term || track.artist.toLowerCase().includes(term);
      } else if (searchFilter === "Albums") {
        matchesFilter = !term || track.album.toLowerCase().includes(term);
      } else if (searchFilter === "Genres") {
        matchesFilter = !term || track.genre.toLowerCase().includes(term);
      }
      return matchesText && matchesFilter;
    });
  }, [query, searchFilter, store.tracks]);

  const renderHomeView = () => (
    <div className="page home-page page-enter" key="home">
      <header className="welcome-row">
        <h1>Good evening</h1>
      </header>
      {recentTracks.length > 0 && <div className="section-heading recent-heading"><h2>Recently played</h2></div>}
      <section className="quick-grid">
        {recentTracks.slice(0, 6).map((track) => (
          <button className="quick-card" key={track.id} onClick={() => playTrack(track, recentTracks.slice(0, 6))}>
            <TrackArtwork track={track} size="small" />
            <strong>{track.album && track.album !== "Single" && track.album !== "Imported" ? track.album : track.title}{track.providerId === "sample" ? " · Sample" : ""}</strong>
            <span className="quick-play"><Play size={16} fill="currentColor" /></span>
          </button>
        ))}
      </section>
            {catalogueLoading && (
        <div className="skeleton-grid" role="status" aria-label="Loading tracks">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="skeleton-card" key={index}><div className="skeleton skeleton-art" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>
          ))}
        </div>
      )}
      {catalogueError && <p className="catalogue-error" role="alert">{catalogueError} Cached tracks and your library are still available.</p>}
      {!catalogueLoading && store.catalogueTracks.length > 0 && (() => {
        const audiusTrending = store.catalogueTracks.filter(t => t.providerId === "audius");
        const jamendoTrending = store.catalogueTracks.filter(t => t.providerId === "jamendo");
        const hero = audiusTrending[0] ?? jamendoTrending[0] ?? demoTracks[0];
        const heroCollection = [hero, ...store.catalogueTracks.filter(t => t.id !== hero.id).slice(0, 11)];
        return (
          <>
            {hero && (
              <section className="hero-row" aria-label="Featured track">
                <button className={`hero-card ${current.id === hero.id && isPlaying ? "is-playing" : ""}`} style={{ "--accent": hero.accent } as React.CSSProperties} onClick={() => playTrack(hero, heroCollection)}>
                  <span className="hero-crt" aria-hidden="true">
                    <CRTWarp
                      {...getCrtPreset("hero", {
                        isPlaying: current.id === hero.id && isPlaying,
                        trackAccent: hero.accent,
                      })}
                    />
                  </span>
                  <span className="hero-copy">
                    <span className="eyebrow">Featured · {hero.providerName}</span>
                    <h2>{hero.title}</h2>
                    <p>{hero.artist} — {hero.album}</p>
                    <span className="hero-play-cue">
                      {current.id === hero.id && isPlaying ? <><Pause size={14} fill="currentColor" /> Playing now</> : <><Play size={14} fill="currentColor" /> Listen now</>}
                    </span>
                  </span>
                  <span className="hero-actions">
                    <TrackArtwork track={hero} size="hero" />
                  </span>
                </button>
              </section>
            )}
            {renderCardGrid((audiusTrending.length > 6 ? audiusTrending.filter((t) => t.id !== hero?.id) : audiusTrending).slice(0, 6), "Trending on Audius")}
            {renderCardGrid(jamendoTrending.slice(0, 6), "Featured on Jamendo")}
          </>
        );
      })()}
      {!catalogueLoading && store.catalogueTracks.length === 0 && renderCardGrid(demoTracks, "Sample previews · not catalogue results")}
      <section className="content-section">
        <div className="section-heading"><h2>Explore by mood</h2></div>
        <div className="mood-grid">
          {["Electronic", "Ambient", "Indie", "Soul", "Pop", "Alternative"].map((mood, index) => (
            <button key={mood} className="mood-card" onClick={() => { setQuery(mood); setSearchFilter("Genres"); navigate("search"); }} style={{ "--mood": ["#8a633b", "#2d5241", "#8b4e3c", "#7a313c", "#2f4562", "#5c6142"][index] } as React.CSSProperties}>
              <strong>{mood}</strong><span>Explore</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const renderSearchView = () => (
    <div className="page search-page page-enter" key="search">
      {searchProvider !== "ytdlp" && (
        <div className="search-hero">
          <label className="search-box">
            <Search size={20} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to listen to?" aria-label="Search music" />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>}
          </label>
        </div>
      )}
      <div className="source-selector-row" role="group" aria-label="Music sources">
        <span className="source-selector-label">Source</span>
        <div className="filter-row source-filter-row">
          {(
            [
              { id: "all", label: "All sources" },
              { id: "audius", label: "Audius" },
              { id: "jamendo", label: "Jamendo" },
              { id: "local", label: "Local library" },
              { id: "ytdlp", label: "yt-dlp" },
            ] as const
          ).map((source) => (
            <button
              key={source.id}
              type="button"
              className={searchProvider === source.id ? "active" : ""}
              onClick={() => setSearchProvider(source.id)}
              aria-pressed={searchProvider === source.id}
            >
              {source.label}
            </button>
          ))}
        </div>
      </div>

      {searchProvider === "ytdlp" ? (
        <YtdlpImportPanel
          onPlayTrack={(track) => playTrack(track)}
          onOpenLibrary={() => navigate("library")}
        />
      ) : (
        <>
          <div className="filter-row" role="group" aria-label="Search filters">
            {["All", "Songs", "Artists", "Albums", "Playlists", "Genres"].map((filter) => (
              <button key={filter} className={searchFilter === filter ? "active" : ""} onClick={() => setSearchFilter(filter)}>{filter}</button>
            ))}
          </div>
          {query ? (
            <section className="search-results">
              {searchProvider !== "local" && (
                <>
                  <div className="section-heading"><h2>{searchFilter === "Playlists" ? "Your playlists" : "Catalogue results"}</h2><small>{searchFilter === "Playlists" ? store.playlists.filter((playlist) => playlist.name.toLowerCase().includes(query.toLowerCase())).length : searchTracks.filter((t) => searchProvider === "all" || t.providerId === searchProvider).length} results</small></div>
                  {searchLoading && <p className="catalogue-status" role="status">Searching Audius and Jamendo…</p>}
                  {searchError && <p className="catalogue-error" role="alert">{searchError}</p>}
                  {searchFilter === "Playlists"
                    ? store.playlists.filter((playlist) => playlist.name.toLowerCase().includes(query.toLowerCase())).map((playlist) => (
                      <button className="search-playlist-result" key={playlist.id} onClick={() => navigate("playlist", playlist.id)}><ListMusic size={19} /><strong>{playlist.name}</strong><small>{playlist.trackIds.length} tracks · Your playlist</small></button>
                    ))
                    : (() => {
                      const displayedSearchTracks = searchTracks
                        .map((track) => store.getTrack(track.id) ?? track)
                        .filter((track) => {
                          if (searchProvider !== "all" && track.providerId !== searchProvider) return false;
                          const term = query.trim().toLowerCase();
                          if (searchFilter === "Artists") return track.artist.toLowerCase().includes(term);
                          if (searchFilter === "Albums") return track.album.toLowerCase().includes(term);
                          if (searchFilter === "Genres") return track.genre.toLowerCase().includes(term);
                          return true;
                        });
                      return displayedSearchTracks.map((track, index) => renderTrackRow({ track, index, collection: displayedSearchTracks }));
                    })()}
                  {!searchLoading && !searchError && !searchTracks.filter((t) => searchProvider === "all" || t.providerId === searchProvider).length && searchFilter !== "Playlists" && <p className="catalogue-status">No matches for this search.</p>}
                  {searchHasMore && <button className="secondary-button load-more" onClick={loadMoreSearchResults} disabled={searchLoading}>Load more</button>}
                </>
              )}
              {(searchProvider === "all" || searchProvider === "local") && searchFilter !== "Playlists" && filteredTracks.some((track) => track.providerId === "sample" || track.providerId === "local") && (() => {
                const localMatches = filteredTracks.filter((track) =>
                  searchProvider === "local" ? track.providerId === "local" : track.providerId === "sample" || track.providerId === "local",
                );
                if (!localMatches.length) return null;
                return (
                  <section className="content-section">
                    <div className="section-heading"><h2>{searchProvider === "local" ? "Your local library" : "Your library & sample previews"}</h2><small>Stored locally</small></div>
                    {localMatches.map((track, index) => renderTrackRow({ track, index, collection: localMatches }))}
                  </section>
                );
              })()}
            </section>
          ) : (
            <section className="content-section">
              <div className="section-heading"><h2>Browse categories</h2></div>
              {searchHistory.length > 0 && <div className="search-history"><span>Recent searches</span>{searchHistory.map((term) => <button key={term} onClick={() => setQuery(term)}>{term}</button>)}</div>}
              <div className="category-grid">
                {["Electronic", "Ambient", "Indie", "Soul", "Pop", "Alternative"].map((category, index) => (
                  <button
                    key={category}
                    style={{ "--cat-color": ["#8a633b", "#2d5241", "#8b4e3c", "#7a313c", "#2f4562", "#5c6142"][index] } as React.CSSProperties}
                    onClick={() => { setQuery(category); setSearchFilter(category === "Focus" || category === "Chill" ? "All" : "Genres"); }}
                  >
                    <strong>{category}</strong>
                    <span>Explore genre</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );

  const renderLibraryView = () => (
    <div className="page library-page page-enter" key="library">
      <div className="library-header">
        <div><p className="eyebrow">Collection</p><h1>Library</h1></div>
        <div className="library-actions">
          <button onClick={() => triggerImportPicker(null)}><Upload size={16} /> Import audio</button>
          <button onClick={() => { setSearchProvider("ytdlp"); navigate("search"); }}><Link2 size={16} /> Import URL</button>
          <button onClick={() => setCreateOpen(true)}><Plus size={16} /> New playlist</button>
        </div>
      </div>
      <button className="downloads-link" onClick={() => navigate("downloads")}><Download size={16} /> Downloads <span>{store.downloads.length}</span></button>
      <LibraryFileSystem
        currentId={currentId}
        isPlaying={isPlaying}
        onPlayTrack={playTrack}
        onShuffleTracks={startShuffle}
        onNavigate={navigate}
        onAddTrackToPlaylist={(trackId) => setAddTrackId(trackId)}
        onOpenNewPlaylist={() => setCreateOpen(true)}
        onImportFiles={handleDropImport}
        onTriggerImportPicker={triggerImportPicker}
        onEditCover={(track) => setCoverEditTrackId(track.id)}
        onFolderExitToss={(label) => spawnPaperToss(label, "top", current.accent)}
      />
      <section className="content-section">
        <div className="section-heading"><h2>Playlists</h2></div>
        <div className="playlist-grid">
          {store.playlists.map((playlist) => {
            const playlistTracks = playlist.trackIds
              .map((id) => store.tracks.find((track) => track.id === id))
              .filter((track): track is Track => Boolean(track));
            return (
              <article className="playlist-card" key={playlist.id}>
                <button className="playlist-cover" onClick={() => navigate("playlist", playlist.id)} aria-label={`Open ${playlist.name}`}>
                  <PlaylistArtwork tracks={playlistTracks} variant="card" />
                </button>
                <button onClick={() => navigate("playlist", playlist.id)}><strong>{playlist.name}</strong><small>{playlist.trackIds.length} tracks</small></button>
                <button className={`icon-button ${store.likedPlaylistIds.includes(playlist.id) ? "active" : ""}`} onClick={() => store.togglePlaylistLike(playlist.id)} aria-label="Like playlist"><Heart size={16} fill={store.likedPlaylistIds.includes(playlist.id) ? "currentColor" : "none"} /></button>
              </article>
            );
          })}
        </div>
        {!store.playlists.length && <div className="empty-state"><ListMusic size={24} /><h3>Your playlists will show up here</h3><p>Create a playlist and add music from search or discovery.</p></div>}
      </section>
      {store.savedAlbumIds.length > 0 && (
        <section className="content-section">
          <div className="section-heading"><h2>Saved albums</h2></div>
          <div className="playlist-grid">
            {store.savedAlbumIds.map((albumName) => {
              const albumTrack = store.tracks.find((track) => track.album === albumName);
              return albumTrack ? <button className="music-card saved-album-card" key={albumName} onClick={() => navigate("album", albumName)}>
                <TrackArtwork track={albumTrack} /><strong>{albumName}</strong><small>{albumTrack.artist}</small>
              </button> : null;
            })}
          </div>
        </section>
      )}
      {store.followedArtistIds.length > 0 && (
        <section className="content-section">
          <div className="section-heading"><h2>Followed artists</h2></div>
          <div className="search-history">
            {store.followedArtistIds.map((artist) => <button key={artist} onClick={() => navigate("artist", artist)}>{artist}</button>)}
          </div>
        </section>
      )}
      <section className="content-section">
        <div className="section-heading"><h2>Saved tracks</h2></div>
        {(() => {
          const saved = store.tracks.filter((track) => store.favouriteIds.includes(track.id));
          return saved.map((track) => renderTrackRow({ track, collection: saved }));
        })()}
        {!store.favouriteIds.length && <div className="empty-state"><Heart size={24} /><h3>No saved tracks yet</h3><p>Use the heart control beside a track to save it.</p></div>}
      </section>
      {recentTracks.length > 0 && (
        <section className="content-section">
          <div className="section-heading"><h2>Recently played</h2></div>
          {recentTracks.map((track) => renderTrackRow({ track, collection: recentTracks }))}
        </section>
      )}
      {store.favouriteIds.length > 0 && (
        <section className="content-section">
          <div className="section-heading"><h2>Your favourite genres</h2></div>
          <div className="search-history">
            {[...new Set(store.tracks.filter((track) => store.favouriteIds.includes(track.id)).flatMap((track) => track.genre.split(",").map((genre) => genre.trim())).filter(Boolean))].map((genre) => (
              <button key={genre} onClick={() => { setSearchFilter("Genres"); setQuery(genre); navigate("search"); }}>{genre}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const renderDownloadsView = () => (
    <div className="page downloads-page page-enter" key="downloads">
      <div className="library-header">
        <div><p className="eyebrow">Available without internet</p><h1>Downloads</h1></div>
        <div className="library-actions">
          {store.downloads.length > 1 && (
            <button onClick={() => startShuffle(store.downloads)}><Shuffle size={16} /> Shuffle</button>
          )}
          <button onClick={() => triggerImportPicker(null)}><Upload size={16} /> Import audio</button>
          <button onClick={() => { setSearchProvider("ytdlp"); navigate("search"); }}><Link2 size={16} /> Import URL</button>
          <div className={`connection-status ${online ? "online" : "offline"}`} role="status">
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}{online ? "Online" : "Offline"}
          </div>
        </div>
      </div>
      <PWAInstallButton pwa={pwa} variant="card" />
      <DevicePermissionsCard
        permissions={devicePermissions}
        wakeLockEnabled={wakeLockEnabled}
        onToggleWakeLock={(enabled) => setWakeLockEnabled(enabled)}
        onGrantAll={grantAllDevicePermissions}
        requesting={requestingPermissions}
      />
      <div className="storage-card">
        <HardDrive size={19} />
        <div><strong>{store.downloads.length} offline track{store.downloads.length === 1 ? "" : "s"}</strong><small>{(store.storageUsage / (1024 * 1024)).toFixed(1)} MB stored in this browser</small></div>
      </div>
      {store.storageError && <p className="catalogue-error" role="alert">{store.storageError}</p>}
      <p className="offline-note">Only provider-approved downloads and audio you import are saved here. Stream links are never treated as download permission.</p>
      <section className="content-section">
        <div className="section-heading"><h2>Downloaded music</h2></div>
        {store.downloads.map((track, index) => renderTrackRow({ track, index, collection: store.downloads }))}
        {!store.downloads.length && <div className="empty-state"><Download size={28} /><h3>No offline music yet</h3><p>Download a track when its provider explicitly permits it, or import your own audio.</p></div>}
      </section>
    </div>
  );

  const renderArtistView = () => {
    const artistTracks = store.tracks.filter((track) => track.artist === selectedId);
    const artist = artistTracks[0];
    if (!artist) return <div className="empty-state"><h3>Artist unavailable</h3></div>;
    const albums = [...new Set(artistTracks.map((track) => track.album))];
    const totalDuration = artistTracks.reduce((total, track) => total + (track.duration || 0), 0);
    return (
      <div className="page detail-page page-enter" key={`artist-${selectedId}`}>
        <section className="detail-hero artist-hero" style={{ "--accent": artist.accent } as React.CSSProperties}>
          <button className="back-button" onClick={() => navigateHistory(-1)} aria-label="Go back"><ArrowLeft size={18} /></button>
          <TrackArtwork track={artist} size="hero" className="artist-artwork" />
          <div><p className="eyebrow">Artist</p><h1>{artist.artist}</h1>
            <p>{artistTracks.length} track{artistTracks.length === 1 ? "" : "s"} · {albums.length} album{albums.length === 1 ? "" : "s"} · {formatTime(totalDuration)} total</p>
            <div className="detail-actions">
              <button className="primary-button" onClick={() => artistTracks[0] && playTrack(artistTracks[0], artistTracks)}><Play size={18} fill="currentColor" /> Play</button>
              <button className="secondary-button" onClick={() => startShuffle(artistTracks)}>
                <Shuffle size={16} /> Shuffle
              </button>
              <button className={`secondary-button ${store.followedArtistIds.includes(artist.artist) ? "active" : ""}`} onClick={() => store.toggleFollowedArtist(artist.artist)}>
                {store.followedArtistIds.includes(artist.artist) ? "Following" : "Follow artist"}
              </button>
            </div>
          </div>
        </section>
        <section className="content-section"><div className="section-heading"><h2>Popular tracks</h2></div>{artistTracks.map((track, index) => renderTrackRow({ track, index, collection: artistTracks }))}</section>
        {albums.length > 1 && (
          <section className="content-section">
            <div className="section-heading"><h2>Albums & singles</h2></div>
            <div className="card-grid">
              {albums.map((albumName) => {
                const albumTrack = artistTracks.find((track) => track.album === albumName);
                return albumTrack ? (
                  <article className="music-card" key={albumName}>
                    <button className="cover-button" onClick={() => navigate("album", albumName)} aria-label={`Open ${albumName}`}>
                      <TrackArtwork track={albumTrack} />
                    </button>
                    <button className="card-copy" onClick={() => navigate("album", albumName)}>
                      <strong>{albumName}</strong>
                      <small>{artistTracks.filter((track) => track.album === albumName).length} tracks</small>
                    </button>
                  </article>
                ) : null;
              })}
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderAlbumView = () => {
    const albumTracks = store.tracks.filter((track) => track.album === selectedId);
    const album = albumTracks[0];
    if (!album) return <div className="empty-state"><h3>Album unavailable</h3></div>;
    const totalDuration = albumTracks.reduce((total, track) => total + (track.duration || 0), 0);
    const releaseYear = albumTracks.find((track) => track.releaseDate)?.releaseDate?.slice(0, 4);
    const downloadableCount = albumTracks.filter((track) => track.downloadUrl).length;
    return (
      <div className="page detail-page page-enter" key={`album-${selectedId}`}>
        <section className="detail-hero" style={{ "--accent": album.accent } as React.CSSProperties}>
          <button className="back-button" onClick={() => navigateHistory(-1)} aria-label="Go back"><ArrowLeft size={18} /></button>
          <TrackArtwork track={album} size="hero" />
          <div><p className="eyebrow">Album</p><h1>{album.album}</h1>
            <p>By <button className="text-link" onClick={() => navigate("artist", album.artist)}>{album.artist}</button>{releaseYear ? ` · ${releaseYear}` : ""} · {albumTracks.length} track{albumTracks.length === 1 ? "" : "s"} · {formatTime(totalDuration)}</p>
            {(album.genre || album.artworkMeta?.attribution) && (
              <p className="hero-genre">
                {album.genre && <span>{album.genre}</span>}
                {downloadableCount > 0 && <><span aria-hidden="true">·</span><span className="hero-genre-accent">{downloadableCount} downloadable</span></>}
                {album.providerId !== "sample" && <><span aria-hidden="true">·</span><span>via {album.providerName}</span></>}
                {album.artworkMeta?.attribution && album.artworkMeta.source !== "none" && (
                  <><span aria-hidden="true">·</span><span className="artwork-source-note">Cover: {album.artworkMeta.attribution}</span></>
                )}
              </p>
            )}
            <div className="detail-actions">
              <button className="primary-button" onClick={() => albumTracks[0] && playTrack(albumTracks[0], albumTracks)}><Play size={18} fill="currentColor" /> Play</button>
              <button className="secondary-button" onClick={() => startShuffle(albumTracks)}>
                <Shuffle size={16} /> Shuffle
              </button>
              <button className={`secondary-button ${store.savedAlbumIds.includes(album.album) ? "active" : ""}`} onClick={() => store.toggleSavedAlbum(album.album)}>
                {store.savedAlbumIds.includes(album.album) ? "Saved album" : "Save album"}
              </button>
              <button className="secondary-button" onClick={() => setCoverEditTrackId(album.id)}>
                <ImagePlus size={16} /> Cover art
              </button>
            </div>
          </div>
        </section>
        <section className="content-section"><div className="section-heading"><h2>Track listing</h2><small>{formatTime(totalDuration)}</small></div>{albumTracks.map((track, index) => renderTrackRow({ track, index, collection: albumTracks }))}</section>
      </div>
    );
  };

  const renderPlaylistView = () => {
    const playlist = store.playlists.find((item) => item.id === selectedId);
    if (!playlist) return <div className="empty-state"><h3>Playlist unavailable</h3></div>;
    const tracks = playlist.trackIds.map((id) => store.tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track));
    return (
      <div className="page detail-page page-enter" key={`playlist-${selectedId}`}>
        <section className="detail-hero playlist-hero" style={{ "--accent": "#5b7c65" } as React.CSSProperties}>
          <button className="back-button" onClick={() => navigate("library")} aria-label="Go back"><ArrowLeft size={18} /></button>
          <PlaylistArtwork tracks={tracks} variant="hero" />
          <div>
            <p className="eyebrow">Playlist</p>
            <h1 contentEditable suppressContentEditableWarning onBlur={(event) => store.renamePlaylist(playlist.id, event.currentTarget.textContent ?? "")}>{playlist.name}</h1>
            <p>{playlist.description}</p>
            <div className="detail-actions">
              {tracks[0] && <button className="primary-button" onClick={() => playTrack(tracks[0], tracks)}><Play size={18} fill="currentColor" /> Play</button>}
              {tracks.length > 1 && <button className="secondary-button" onClick={() => startShuffle(tracks)}><Shuffle size={16} /> Shuffle</button>}
              <button className="secondary-button" onClick={() => store.deletePlaylist(playlist.id)}><Trash2 size={16} /> Delete</button>
            </div>
          </div>
        </section>
        <section className="content-section">
          <div className="section-heading"><h2>Tracks</h2></div>
          {tracks.map((track, index) => renderTrackRow({ track, index, playlistId: playlist.id, collection: tracks }))}
          {!tracks.length && <div className="empty-state"><ListMusic size={28} /><h3>This playlist is empty</h3><p>Add tracks using the queue/add control from search or home.</p></div>}
        </section>
      </div>
    );
  };

  const content = view === "home" ? renderHomeView()
    : view === "search" ? renderSearchView()
    : view === "library" ? renderLibraryView()
    : view === "downloads" ? renderDownloadsView()
    : view === "artist" ? renderArtistView()
    : view === "album" ? renderAlbumView()
    : renderPlaylistView();

  return (
    <>
      <div className="app-ferrofluid-bg" aria-hidden="true">
        <Ferrofluid
          colors={["#e6c88f", "#c49e64", "#6b502a"]}
          color="#100f0d"
          spikeHeight={0.9}
          sharpness={2.4}
          tilt={28}
          scale={1.45}
          magnets={isPlaying ? 1.25 : 0.92}
          speed={isPlaying ? 0.46 : 0.24}
          turbulence={1.0}
          fluidity={0.58}
          brightness={0.92}
          opacity={0.72}
          transparent
          mouseInteraction
          clickPulse
          paused={expandedPlayer}
          dpr={1}
          fps={36}
        />
      </div>
      {paperPhase !== "crumpled" && (
      <div
        className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isPlaying ? "is-playing" : ""} ${paperPhase === "crumpling" ? "app-shell--crumpling" : paperPhase === "unfolding" ? "app-shell--unfolding" : ""}`}
        style={{ "--ambient-accent": current.accent } as React.CSSProperties}
      >
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Aural home">
          <span className="brand-mark"><span /><span /><span /></span>
          <strong>Aural</strong>
        </button>
        <nav className="primary-nav" aria-label="Primary">
          <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")} aria-label="Home"><Home size={19} /> <span>Home</span></button>
          <button className={view === "search" ? "active" : ""} onClick={() => navigate("search")} aria-label="Search"><Search size={19} /> <span>Search</span></button>
          <button className={view === "library" ? "active" : ""} onClick={() => navigate("library")} aria-label="Your library"><Library size={19} /> <span>Your library</span></button>
          <button className={view === "downloads" ? "active" : ""} onClick={() => navigate("downloads")} aria-label="Downloads"><Download size={19} /> <span>Downloads</span></button>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-heading"><span>Playlists</span><button onClick={() => setCreateOpen(true)} aria-label="Create playlist"><Plus size={17} /></button></div>
          {store.playlists.map((playlist) => (
            <button key={playlist.id} className={view === "playlist" && selectedId === playlist.id ? "active" : ""} onClick={() => navigate("playlist", playlist.id)}>
              <span className="playlist-dot" />{playlist.name}
            </button>
          ))}
          {!store.playlists.length && <p className="sidebar-empty">No playlists yet</p>}
        </div>
        <div className="sidebar-footer">
          <PWAInstallButton pwa={pwa} variant="sidebar" />
          <button className="import-button" onClick={() => triggerImportPicker(null)}><Upload size={16} /> Import audio</button>
          <button className="collapse-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
          </button>
        </div>
      </aside>

      <main
        ref={mainStageRef}
        className="main-stage"
        onScroll={(event) => setStageScrolled(event.currentTarget.scrollTop > 12)}
      >
        <header className={`topbar ${stageScrolled ? "scrolled" : ""}`}>
          <div className="history-buttons"><button onClick={() => navigateHistory(-1)} disabled={historyIndex === 0} aria-label="Back"><ArrowLeft size={16} /></button><button onClick={() => navigateHistory(1)} disabled={historyIndex >= history.length - 1} aria-label="Forward"><ArrowRight size={16} /></button></div>
          <div className="topbar-actions">
            <PWAInstallButton pwa={pwa} variant="topbar" />
            <button
              className="quit-crumple-button"
              onClick={quitToPaperBall}
              aria-label="Quit and crumple page"
              title="Quit & crumple page"
            >
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M4 2.5h6.5L14.5 6.5V15a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M10.5 2.5V6.5H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6.5 9.8l5 3.4M11.5 9.8l-5 3.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
              <span>Quit</span>
            </button>
            <button className="profile-chip" aria-label="Open local library profile" title="Library" onClick={() => navigate("library")}><UserRound size={16} /></button>
          </div>
        </header>
        {content}
        {importMessage && <div className="toast global-toast" role="status">{importMessage}</div>}
        {store.storageError && view !== "downloads" && <p className="catalogue-error storage-error" role="alert">{store.storageError}</p>}
      </main>
      <OfflineIndicator online={online} />

      <footer
        className="player"
        aria-label="Music player"
        style={{
          "--progress": `${duration ? Math.min(100, (currentTime / (duration || current.duration || 1)) * 100) : 0}%`,
        } as React.CSSProperties}
      >
        <div className="now-playing">
          <button className="np-thumb-trigger" onClick={() => setExpandedPlayer(true)} aria-label="Open now playing view">
            <TrackArtwork track={current} size="small" />
          </button>
          <div key={current.id} className="np-track-unfold"><strong>{current.title}</strong><button onClick={() => navigate("artist", current.artist)}>{current.artist}{current.providerId === "sample" ? " · Sample preview" : ""}</button></div>
          <button className={`icon-button ${store.favouriteIds.includes(current.id) ? "active" : ""}`} onClick={() => store.toggleFavourite(current.id)} aria-label="Favourite current track"><Heart size={17} fill={store.favouriteIds.includes(current.id) ? "currentColor" : "none"} /></button>
          <button className="icon-button expand-button" onClick={() => setExpandedPlayer(true)} aria-label="Expand player" title="Expand (F)"><ChevronsUp size={16} /></button>
        </div>
        <div className="player-center">
          <div className="player-controls">
            <button className={store.shuffle ? "active" : ""} onClick={() => store.setShuffle(!store.shuffle)} aria-label="Shuffle"><Shuffle size={16} /></button>
            <button onClick={playPrevious} aria-label="Previous track"><SkipBack size={18} fill="currentColor" /></button>
            <button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button onClick={playNext} aria-label="Next track"><SkipForward size={18} fill="currentColor" /></button>
            <button className={store.repeat !== "off" ? "active" : ""} onClick={() => store.setRepeat(store.repeat === "off" ? "all" : store.repeat === "all" ? "one" : "off")} aria-label={`Repeat mode: ${store.repeat}`} title={`Repeat ${store.repeat}`}>
              {store.repeat === "one" ? <Repeat1 size={16} /> : <Repeat2 size={16} />}
            </button>
          </div>
          <div className="progress-row">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={duration || current.duration || 0}
              value={Math.min(currentTime, duration || current.duration || 0)}
              style={{ "--fill": `${duration ? Math.min(100, (currentTime / (duration || current.duration || 1)) * 100) : 0}%` } as React.CSSProperties}
              onChange={(event) => {
                const value = Number(event.target.value);
                setCurrentTime(value);
                if (audioRef.current) audioRef.current.currentTime = value;
              }}
              aria-label="Playback position"
            />
            <span>{formatTime(duration || current.duration)}</span>
          </div>
          {playbackError && <p className="playback-error" role="alert">{playbackError}</p>}
        </div>
        <div className="player-tools">
          <button
            className={autoplayEnabled ? "active" : ""}
            onClick={() => setAutoplayEnabled(!autoplayEnabled)}
            aria-label="Autoplay"
            aria-pressed={autoplayEnabled}
            title={autoplayEnabled ? "Autoplay next available song: on" : "Autoplay next available song: off"}
          ><InfinityIcon size={17} /></button>
          <button className={crossfadeEnabled ? "active" : ""} onClick={() => setCrossfadeEnabled(!crossfadeEnabled)} aria-label="Crossfade" aria-pressed={crossfadeEnabled} title="Crossfade between tracks"><ArrowLeftRight size={17} /></button>
          <button
            className={lyricsOpen ? "active" : ""}
            onClick={() => {
              setLyricsOpen((open) => {
                const next = !open;
                if (next) setQueueOpen(false);
                return next;
              });
            }}
            aria-label="Lyrics"
            aria-pressed={lyricsOpen}
            title="Synchronized lyrics"
          ><MicVocal size={17} /></button>
          <button
            className={queueOpen ? "active" : ""}
            onClick={() => {
              setQueueOpen((open) => {
                const next = !open;
                if (next) setLyricsOpen(false);
                return next;
              });
            }}
            aria-label="Open queue"
          ><ListMusic size={18} /></button>
          <button onClick={() => store.setVolume(store.volume ? 0 : 0.72)} aria-label={store.volume ? "Mute" : "Unmute"}>{store.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <input type="range" min="0" max="1" step="0.01" value={store.volume} style={{ "--fill": `${store.volume * 100}%` } as React.CSSProperties} onChange={(event) => store.setVolume(Number(event.target.value))} aria-label="Volume" />
        </div>
      </footer>

      <audio
        ref={audioRef}
        src={current.streamUrl}
        preload="auto"
        playsInline
        onPlay={() => {
          clearTrackSwitchGuard();
          ensurePlaybackAudioSession();
          void backgroundAudioBridge.start();
          setIsPlaying(true);
          setPlaybackError("");
        }}
        onPlaying={() => {
          clearTrackSwitchGuard();
          setIsPlaying(true);
          setPlaybackError("");
        }}
        onPause={(event) => {
          if (trackSwitchingRef.current || event.currentTarget.ended) return;
          setIsPlaying(false);
          void backgroundAudioBridge.stop();
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onError={() => {
          clearTrackSwitchGuard();
          setIsPlaying(false);
          void backgroundAudioBridge.stop();
          setPlaybackError(online ? "This audio could not be loaded." : "This track is not downloaded for offline playback.");
        }}
        onEnded={handleEnded}
      />

      {expandedPlayer && (
        <div
          className={`now-playing-overlay paper-unfold ${npLyricsOpen ? "with-lyrics" : ""} ${isPlaying ? "is-playing" : "is-paused"}`}
          style={{ "--accent": current.accent } as React.CSSProperties}
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          onKeyDown={(event) => { if (event.key === "Escape") closeExpandedPlayer(); }}
          onClick={(event) => { if (event.target === event.currentTarget) closeExpandedPlayer(); }}
        >
          {isDisplayableImageUrl(current.artwork) && (
            <img
              className="np-ambient-art"
              src={current.artwork}
              alt=""
              aria-hidden="true"
              onError={(event) => { event.currentTarget.style.display = "none"; }}
            />
          )}
          {crtVisualizer && (
            <span className="np-crt-layer" aria-hidden="true">
              <CRTWarp
                {...getCrtPreset("stage", {
                  isPlaying,
                  trackAccent: current.accent,
                })}
              />
            </span>
          )}
          <div className="np-top-actions">
            <button className={`icon-button np-fav ${store.favouriteIds.includes(current.id) ? "active" : ""}`} onClick={() => store.toggleFavourite(current.id)} aria-label="Favourite current track">
              <Heart size={19} fill={store.favouriteIds.includes(current.id) ? "currentColor" : "none"} />
            </button>
            <button
              className={`icon-button np-crt ${crtVisualizer ? "active" : ""}`}
              onClick={() => setCrtVisualizer(!crtVisualizer)}
              aria-label="CRT visualizer"
              aria-pressed={crtVisualizer}
              title="CRT visualizer"
            ><Radio size={19} /></button>
            <button
              className={`icon-button ${isDisplayableImageUrl(current.artwork) ? "active" : ""}`}
              onClick={() => setCoverEditTrackId(current.id)}
              aria-label={isDisplayableImageUrl(current.artwork) ? "Change cover picture" : "Add cover picture"}
              title={isDisplayableImageUrl(current.artwork) ? "Change cover picture" : "Add cover picture"}
            ><ImagePlus size={19} /></button>
          </div>
          <button className="icon-button np-close" onClick={closeExpandedPlayer} aria-label="Close player" autoFocus><X size={20} /></button>
          <div className="now-playing-layout">
            <div className="now-playing-view">
              <div key={`art-${current.id}`} className={`np-artwork-frame np-track-unfold ${crtVisualizer ? "has-crt" : ""}`}>
                <TrackArtwork track={current} size="hero" />
              </div>
              <div key={`meta-${current.id}`} className="np-meta np-track-unfold">
                <strong>{current.title}</strong>
                <button onClick={() => { setExpandedPlayer(false); navigate("artist", current.artist); }}>{current.artist}</button>
                {current.artworkMeta?.attribution && current.artworkMeta.source !== "none" && (
                  <small className="artwork-source-note">{current.artworkMeta.attribution}</small>
                )}
              </div>
              <div className="progress-row">
                <span>{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={duration || current.duration || 0}
                  value={Math.min(currentTime, duration || current.duration || 0)}
                  style={{ "--fill": `${duration ? Math.min(100, (currentTime / (duration || current.duration || 1)) * 100) : 0}%` } as React.CSSProperties}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    seekToTime(value);
                  }}
                  aria-label="Playback position"
                />
                <span>{formatTime(duration || current.duration)}</span>
              </div>
              <div className="player-controls">
                <button className={store.shuffle ? "active" : ""} onClick={() => store.setShuffle(!store.shuffle)} aria-label="Shuffle"><Shuffle size={18} /></button>
                <button onClick={playPrevious} aria-label="Previous track"><SkipBack size={22} fill="currentColor" /></button>
                <button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
                <button onClick={playNext} aria-label="Next track"><SkipForward size={22} fill="currentColor" /></button>
                <button className={store.repeat !== "off" ? "active" : ""} onClick={() => store.setRepeat(store.repeat === "off" ? "all" : store.repeat === "all" ? "one" : "off")} aria-label={`Repeat mode: ${store.repeat}`}>
                  {store.repeat === "one" ? <Repeat1 size={18} /> : <Repeat2 size={18} />}
                </button>
              </div>
              <div className="np-bottom-actions">
                <button className={`secondary-button ${autoplayEnabled ? "active" : ""}`} onClick={() => setAutoplayEnabled(!autoplayEnabled)} aria-pressed={autoplayEnabled}>
                  <InfinityIcon size={16} /> Autoplay
                </button>
                <button className={`secondary-button ${npLyricsOpen ? "active" : ""}`} onClick={() => setNpLyricsOpen(!npLyricsOpen)}>
                  <MicVocal size={16} /> {npLyricsOpen ? "Hide lyrics" : "Lyrics"}
                </button>
                <button className="secondary-button" onClick={() => { setExpandedPlayer(false); setQueueOpen(true); }}><ListMusic size={16} /> Open queue</button>
              </div>
              {nextQueueTrack && (
                <button className="np-up-next" onClick={playNext} aria-label={`Play next track: ${nextQueueTrack.title}`}>
                  <span>Up next ·</span>
                  <strong>{nextQueueTrack.title}</strong>
                  <SkipForward size={13} />
                </button>
              )}
            </div>
            {npLyricsOpen && current && (
              <div className="np-lyrics-column">
                <LyricsPanel
                  variant="expanded"
                  track={current}
                  currentTime={currentTime}
                  onSeek={seekToTime}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <input ref={fileRef} className="hidden-input" type="file" accept="audio/*" multiple onChange={handleImport} />

      {createOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreateModal(); }}>
          <div className="modal paper-unfold" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <button className="modal-close" onClick={closeCreateModal} aria-label="Close"><X size={18} /></button>
            <h2 id="create-title">Create a playlist</h2>
            <p>Give this collection a name.</p>
            <input autoFocus value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createPlaylist(); }} placeholder="Playlist name" />
            <button className="primary-button" onClick={createPlaylist} disabled={!playlistName.trim()}><Plus size={17} /> Create playlist</button>
          </div>
        </div>
      )}

      {addTrackId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAddModal(); }}>
          <div className="modal paper-unfold" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <button className="modal-close" onClick={closeAddModal} aria-label="Close"><X size={18} /></button>
            <h2 id="add-title">Add to playlist</h2>
            <p>Choose a playlist for this track.</p>
            {store.playlists.map((playlist) => (
              <button key={playlist.id} className="secondary-button" onClick={() => { store.addToPlaylist(playlist.id, addTrackId); setAddTrackId(""); }}>
                <ListMusic size={16} /> {playlist.name}
              </button>
            ))}
            {!store.playlists.length && <p>No playlists yet. Create one from the library.</p>}
          </div>
        </div>
      )}

      {coverEditTrackId && (
        <CoverArtModal
          track={store.getTrack(coverEditTrackId) ?? null}
          onClose={() => setCoverEditTrackId("")}
          onSaveArtwork={async (trackId, dataUrl) => {
            await store.updateTrackArtwork(trackId, dataUrl);
            setImportMessage(dataUrl ? "Cover picture saved." : "Cover picture removed.");
            window.setTimeout(() => setImportMessage(""), 3000);
          }}
          onAutoFindArtwork={async (trackId) => {
            await store.requestTrackArtwork(trackId, { forceRefresh: true });
          }}
        />
      )}

      {queueOpen && (
        <aside className="queue-panel paper-unfold" aria-label="Queue">
          <header>
            <div><p className="eyebrow">Now next</p><h2>Queue</h2></div>
            <div className="queue-header-actions">
              <button
                className={`icon-button ${autoplayEnabled ? "active" : ""}`}
                onClick={() => setAutoplayEnabled(!autoplayEnabled)}
                aria-label="Autoplay"
                aria-pressed={autoplayEnabled}
                title={autoplayEnabled ? "Autoplay next available song: on" : "Autoplay next available song: off"}
              ><InfinityIcon size={16} /></button>
              <button className="icon-button" onClick={closeQueuePanel} aria-label="Close queue"><X size={18} /></button>
            </div>
          </header>
          <div className="queue-list">
            {current && (
              <div className="queue-item now-playing-item" aria-current="true">
                <TrackArtwork track={current} size="small" />
                <div className="queue-item-copy"><strong>{current.title}</strong><small>{current.artist} · Now playing</small></div>
                {isPlaying && <span className="queue-equalizer" aria-hidden="true"><span /><span /><span /></span>}
              </div>
            )}
            {queueTracks.length > 0 && <p className="queue-section-label">Up next</p>}
            {queueTracks.map((track, index) => (
              <div className="queue-item" key={track.id}>
                <span className="queue-index">{index + 1}</span>
                <TrackArtwork track={track} size="small" />
                <button className="queue-item-copy" onClick={() => playTrack(track)}><strong>{track.title}</strong><small>{track.artist}</small></button>
                <div className="queue-reorder">
                  <button className="icon-button" disabled={index === 0} onClick={() => store.setQueue(store.queueIds.map((id, i, arr) => i === index ? arr[index - 1] : i === index - 1 ? arr[index] : id))} aria-label={`Move ${track.title} up in queue`}><ChevronUp size={13} /></button>
                  <button className="icon-button" disabled={index === queueTracks.length - 1} onClick={() => store.setQueue(store.queueIds.map((id, i, arr) => i === index ? arr[index + 1] : i === index + 1 ? arr[index] : id))} aria-label={`Move ${track.title} down in queue`}><ChevronDown size={13} /></button>
                </div>
                <button className="icon-button" onClick={() => store.setQueue(store.queueIds.filter((id) => id !== track.id))} aria-label={`Remove ${track.title} from queue`}><Trash2 size={15} /></button>
              </div>
            ))}
            {autoplayEnabled && nextQueueTrack && !store.queueIds.slice(Math.max(0, store.queueIds.indexOf(currentId) + 1)).includes(nextQueueTrack.id) && (
              <div className="queue-autoplay-section">
                <p className="queue-section-label">{store.shuffle ? "Autoplay · Shuffled next" : "Autoplay · Next available"}</p>
                <button className="queue-autoplay-preview" onClick={playNext}>
                  <TrackArtwork track={nextQueueTrack} size="small" />
                  <span className="queue-item-copy">
                    <strong>{nextQueueTrack.title}</strong>
                    <small>{nextQueueTrack.artist}</small>
                  </span>
                  <SkipForward size={15} />
                </button>
              </div>
            )}
            {!queueTracks.length && (!autoplayEnabled || !nextQueueTrack) && <div className="empty-state"><ListMusic size={24} /><h3>Queue is empty</h3><p>Play something, or add tracks from search to build a listening line-up.</p></div>}
          </div>
          {queueTracks.length > 0 && <button className="secondary-button" onClick={() => store.setQueue([])}>Clear queue</button>}
        </aside>
      )}
      {lyricsOpen && current && (
        <aside className="lyrics-panel paper-unfold" aria-label="Lyrics">
          <LyricsPanel
            variant="drawer"
            track={current}
            currentTime={currentTime}
            onSeek={seekToTime}
            onClose={closeLyricsPanel}
          />
        </aside>
      )}
      </div>
      )}
      {(paperPhase === "crumpled" || paperPhase === "unfolding") && (
        <CrumpledAppScreen
          trackTitle={current.title}
          trackArtist={current.artist}
          accent={current.accent}
          unfolding={paperPhase === "unfolding"}
          onUnfold={unfoldFromPaperBall}
        />
      )}
      <PaperTossOverlay items={paperTosses} />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AuralApp />
    </StoreProvider>
  );
}
