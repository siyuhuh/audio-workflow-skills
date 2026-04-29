import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";

interface ProcessedResourceCardProps {
  title: string;
  canEnter: boolean;
  isSample: boolean;
  hasStems: boolean;
  hasLyrics: boolean;
  playbackSummary: string;
  coverUrl: string | null;
  onEnter: () => void;
  onReview: () => void;
  onDelete: () => void;
}

export function ProcessedResourceCard({
  title,
  canEnter,
  isSample,
  hasStems,
  hasLyrics,
  playbackSummary,
  coverUrl,
  onEnter,
  onReview,
  onDelete
}: ProcessedResourceCardProps) {
  const { t } = useTranslation();

  return (
    <article
      data-disabled={!canEnter}
      data-variant={isSample ? "sample" : "user"}
      className={cn(
        "relative grid min-w-0 gap-2 overflow-hidden rounded-xl bg-[#10110f] shadow-md",
        "border",
        isSample
          ? "border-[color-mix(in_oklch,var(--secondary)_54%,var(--color-border))] bg-card"
          : "border-foreground/15"
      )}
    >
      {isSample ? (
        <span className="absolute left-2 top-2 z-[2] rounded-full bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-card">
          {t("library:tagSample")}
        </span>
      ) : null}

      <button
        type="button"
        disabled={!canEnter}
        onClick={onEnter}
        className="relative block w-full min-h-[150px] overflow-hidden border-0 bg-[#11130f] p-0 text-left text-white disabled:cursor-default disabled:opacity-100"
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#1f2933,#10110f_55%,#304638),#10110f]">
          {coverUrl ? (
            <video
              src={coverUrl}
              muted
              playsInline
              preload="metadata"
              className="size-full object-cover opacity-85 [filter:saturate(0.9)_contrast(1.04)_brightness(0.82)]"
            />
          ) : (
            <div className="grid size-full place-items-center bg-[linear-gradient(to_bottom,rgba(0,0,0,0.04),rgba(0,0,0,0.5)),repeating-linear-gradient(135deg,rgba(255,255,255,0.12)_0_1px,transparent_1px_12px),#27322b] text-[58px] font-black text-white/90">
              {title.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
        <div className="absolute inset-0 grid content-end gap-1 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.1),transparent_34%,rgba(0,0,0,0.84)),linear-gradient(to_right,rgba(0,0,0,0.45),transparent)] p-3.5">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-lg font-black text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.72)]">
            {title}
          </strong>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold text-white/70">
            {isSample ? t("library:tagSample") : playbackSummary}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs font-bold text-white/80">
              {hasStems ? t("package:badges.stems") : t("package:badges.original")}
            </span>
            <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs font-bold text-white/80">
              {hasLyrics ? t("package:badges.lyrics") : t("package:badges.noLyrics")}
            </span>
          </div>
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
        <Button
          variant="primary"
          size="sm"
          disabled={!canEnter}
          onClick={onEnter}
          className="text-sm"
        >
          {canEnter ? t("package:enterKaraoke") : t("package:badges.needsMedia")}
        </Button>
        <Button size="sm" onClick={onReview} className="text-sm">
          {t("package:openPackage")}
        </Button>
        <Button
          size="sm"
          onClick={onDelete}
          className="ml-auto border-white/20 bg-white/10 text-sm text-white/80 hover:enabled:border-white/35 hover:enabled:bg-white/15"
        >
          {t("common:actions.remove")}
        </Button>
      </div>
    </article>
  );
}
