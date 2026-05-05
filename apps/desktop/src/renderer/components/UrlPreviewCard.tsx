import { useEffect, useState } from "react";
import type { UrlMetadataPreview } from "../../shared/types";
import type { Translator } from "../lib/types";

export type UrlPreviewLoadState = "idle" | "loading" | "loaded" | "error";

interface UrlPreviewCardProps {
  state: UrlPreviewLoadState;
  preview: UrlMetadataPreview | null;
  t: Translator;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function originLabel(origin: UrlMetadataPreview["origin"], t: Translator): string {
  if (origin === "youtube") {
    return t("capture:preview.originYoutube");
  }
  if (origin === "bilibili") {
    return t("capture:preview.originBilibili");
  }
  return t("capture:preview.originUrl");
}

export function UrlPreviewCard({ state, preview, t }: UrlPreviewCardProps) {
  if (state === "idle") {
    return null;
  }

  if (state === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-sm"
      >
        <span className="size-2 animate-pulse rounded-full bg-primary/70" aria-hidden />
        <span className="text-xs font-medium text-muted-foreground">{t("capture:preview.loading")}</span>
      </div>
    );
  }

  if (state === "error" || !preview) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-sm"
      >
        <span className="size-2 rounded-full bg-muted-foreground/45" aria-hidden />
        <span className="text-xs font-medium text-muted-foreground">{t("capture:preview.error")}</span>
      </div>
    );
  }

  const durationLabel = preview.durationSec !== null ? formatDuration(preview.durationSec) : "";
  const metaParts = [preview.uploader ?? "", durationLabel, originLabel(preview.origin, t)].filter(
    (part) => part.length > 0
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-border bg-elevated p-2 shadow-sm"
    >
      <PreviewThumbnail src={preview.thumbnailUrl} alt={preview.title ?? ""} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground" title={preview.title ?? undefined}>
          {preview.title ?? preview.sourceUrl}
        </div>
        {metaParts.length > 0 ? (
          <div className="truncate text-xs text-muted-foreground">{metaParts.join(" · ")}</div>
        ) : null}
      </div>
    </div>
  );
}

interface PreviewThumbnailProps {
  src: string | null;
  alt: string;
}

function PreviewThumbnail({ src, alt }: PreviewThumbnailProps) {
  const [failed, setFailed] = useState(false);

  // Reset the failed flag whenever the source URL changes so a fresh image
  // gets a chance to load.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        aria-hidden
        className="aspect-video w-20 shrink-0 rounded-md border border-border bg-muted/40"
      />
    );
  }

  return (
    <div className="aspect-video w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
