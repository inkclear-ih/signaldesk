"use client";

import { useState } from "react";

type InstagramMediaKind = "image" | "video" | "carousel" | "unknown";

export function InstagramMediaPreview({
  mediaType,
  mediaUrl
}: {
  mediaType: string | null;
  mediaUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const kind = getInstagramMediaKind(mediaType);
  const label = getInstagramMediaLabel(kind);
  const source = getSafeRemoteUrl(mediaUrl);
  const canRenderMedia = Boolean(source) && !failed;
  const showMediaLabel = kind === "carousel";

  return (
    <div className={`instagram-media instagram-media-${kind}`}>
      {canRenderMedia && kind === "video" ? (
        <video
          aria-label={label}
          className="instagram-media-asset"
          controls
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        >
          <source src={source ?? undefined} />
        </video>
      ) : canRenderMedia && (kind === "image" || kind === "carousel") ? (
        <img
          alt={label}
          className="instagram-media-asset"
          decoding="async"
          loading="lazy"
          src={source ?? undefined}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="instagram-media-fallback" role="img" aria-label={label}>
          <span>{label}</span>
          <strong>Preview unavailable</strong>
        </div>
      )}
      {showMediaLabel ? <span className="instagram-media-label">{label}</span> : null}
    </div>
  );
}

function getInstagramMediaKind(mediaType: string | null): InstagramMediaKind {
  const normalized = mediaType?.trim().toUpperCase();

  if (normalized === "IMAGE") {
    return "image";
  }

  if (normalized === "VIDEO") {
    return "video";
  }

  if (normalized === "CAROUSEL_ALBUM") {
    return "carousel";
  }

  return "unknown";
}

function getInstagramMediaLabel(kind: InstagramMediaKind): string {
  if (kind === "video") {
    return "Instagram video";
  }

  if (kind === "carousel") {
    return "Instagram carousel cover";
  }

  if (kind === "image") {
    return "Instagram image";
  }

  return "Instagram media";
}

function getSafeRemoteUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
