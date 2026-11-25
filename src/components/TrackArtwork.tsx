import { memo, useEffect, useRef, useState } from "react";
import { ListMusic } from "lucide-react";
import { isDisplayableImageUrl } from "../music/lib/mediaMetadata";
import { getArtworkStatus, subscribeArtworkStatus, type ArtworkTrackStatus } from "../music/services/artwork/artworkService";
import { useStore } from "../store";
import type { Track } from "../types";

type ArtworkSize = "card" | "small" | "hero";

interface TrackArtworkProps {
  track: Track;
  size?: ArtworkSize;
  className?: string;
  autoFetch?: boolean;
}

function getInitials(title: string): string {
  const letters = title
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "AU";
}

/**
 * Displays authentic track/album artwork across cards, rows, hero views, and
 * players while preserving aspect ratios, loading states, error recovery, and
 * consistent fallback initials.
 */
export const TrackArtwork = memo(function TrackArtwork({
  track,
  size = "card",
  className = "",
  autoFetch = true,
}: TrackArtworkProps) {
  const store = useStore();
  const preferredSrc = size === "hero" ? (track.artwork || track.artworkSmall) : (track.artworkSmall || track.artwork);
  const hasUrl = isDisplayableImageUrl(preferredSrc);

  const [lookupStatus, setLookupStatus] = useState<ArtworkTrackStatus>(() => getArtworkStatus(track.id));
  const [loadedSrc, setLoadedSrc] = useState<string>("");
  const [failedSrc, setFailedSrc] = useState<string>("");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLookupStatus(getArtworkStatus(track.id));
    return subscribeArtworkStatus((changedId, nextStatus) => {
      if (changedId === track.id) {
        setLookupStatus(nextStatus);
      }
    });
  }, [track.id]);

  useEffect(() => {
    if (hasUrl && imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoadedSrc(preferredSrc);
    }
  }, [hasUrl, preferredSrc]);

  useEffect(() => {
    if (!autoFetch) return;
    if (hasUrl) return;
    if (track.providerId === "sample") return;
    if (track.artworkMeta?.source === "user") return;
    if (track.artworkMeta?.attribution === "Custom cover removed") return;
    if (track.artworkMeta?.source === "none" && lookupStatus === "missing") return;
    void store.requestTrackArtwork(track.id);
  }, [
    autoFetch,
    hasUrl,
    lookupStatus,
    store,
    track.artworkMeta?.attribution,
    track.artworkMeta?.source,
    track.id,
    track.providerId,
  ]);

  const showImg = hasUrl && failedSrc !== preferredSrc;
  const imgLoaded = showImg && loadedSrc === preferredSrc;

  let visualState: "loading" | "loaded" | "missing" | "error" = "missing";
  if (imgLoaded) {
    visualState = "loaded";
  } else if (showImg || lookupStatus === "loading") {
    visualState = "loading";
  } else if (lookupStatus === "error" || (hasUrl && failedSrc === preferredSrc)) {
    visualState = "error";
  }

  const dim = size === "small" ? 56 : size === "hero" ? 300 : 400;

  return (
    <div
      className={`artwork artwork-${size} ${className}`.trim()}
      style={{ background: track.accent }}
      data-artwork-state={visualState}
      data-artwork-source={track.artworkMeta?.source ?? "none"}
      aria-label={`${track.album} artwork`}
    >
      {showImg ? (
        <img
          ref={imgRef}
          src={preferredSrc}
          alt=""
          loading={size === "hero" ? "eager" : "lazy"}
          decoding="async"
          width={dim}
          height={dim}
          onLoad={() => setLoadedSrc(preferredSrc)}
          onError={() => {
            setFailedSrc(preferredSrc);
            store.reportBrokenArtwork(track.id, preferredSrc);
          }}
        />
      ) : null}
      <span aria-hidden="true">{getInitials(track.title)}</span>
    </div>
  );
});

interface PlaylistArtworkProps {
  tracks: Track[];
  variant: "card" | "hero";
}

/** Renders up to 4 unique authentic covers from playlist tracks, or a clean icon placeholder. */
export const PlaylistArtwork = memo(function PlaylistArtwork({ tracks, variant }: PlaylistArtworkProps) {
  const uniqueCovers: Array<{ track: Track; src: string }> = [];
  const seenUrls = new Set<string>();

  for (const track of tracks) {
    const src = variant === "hero" ? (track.artwork || track.artworkSmall) : (track.artworkSmall || track.artwork);
    if (!isDisplayableImageUrl(src) || seenUrls.has(src)) continue;
    seenUrls.add(src);
    uniqueCovers.push({ track, src });
    if (uniqueCovers.length >= 4) break;
  }

  if (uniqueCovers.length === 0) {
    if (variant === "hero") {
      return (
        <div className="playlist-art">
          <ListMusic size={48} />
        </div>
      );
    }
    return (
      <span>
        <ListMusic size={28} />
      </span>
    );
  }

  if (uniqueCovers.length < 4) {
    return (
      <div className={variant === "hero" ? "playlist-art has-cover" : "playlist-single-cover"}>
        <img src={uniqueCovers[0].src} alt="" loading="lazy" decoding="async" />
      </div>
    );
  }

  return (
    <div className={variant === "hero" ? "playlist-art playlist-mosaic" : "playlist-mosaic"}>
      {uniqueCovers.map((entry) => (
        <img key={entry.track.id} src={entry.src} alt="" loading="lazy" decoding="async" />
      ))}
    </div>
  );
});

export default TrackArtwork;
