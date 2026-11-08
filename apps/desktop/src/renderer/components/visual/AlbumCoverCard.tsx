import { useState } from "react";
import { cn } from "../../lib/cn";

interface AlbumCoverCardProps {
  title: string;
  /** Media URL of the package video. Only loaded while the card is active. */
  coverUrl: string | null;
  /** Controlled hover/focus state; falls back to the card's own pointer state. */
  active?: boolean;
  className?: string;
}

/**
 * Library cover tile: a monogram tile that tilts and catches a sheen on hover,
 * and plays a muted preview of the package video while active.
 * Pure CSS; replaces the former WebGL card so a large library costs no GPU contexts.
 */
export function AlbumCoverCard({ title, coverUrl, active: controlledActive, className }: AlbumCoverCardProps) {
  const [hovered, setHovered] = useState(false);
  const active = controlledActive ?? hovered;
  const monogram = title.trim().slice(0, 2).toUpperCase() || "♪";

  return (
    <div
      className={cn("albumCoverCard", className)}
      data-active={active ? "true" : "false"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="albumCoverCardFace">
        <span className="albumCoverCardMonogram" aria-hidden="true">
          {monogram}
        </span>
        {coverUrl && active ? (
          <video
            className="albumCoverCardVideo"
            src={coverUrl}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
