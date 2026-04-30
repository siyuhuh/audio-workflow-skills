import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { AlbumHoloCard } from "./visual/AlbumHoloCard";

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
  const [focused, setFocused] = useState(false);

  return (
    <motion.article
      data-disabled={!canEnter}
      data-variant={isSample ? "sample" : "user"}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      whileHover={canEnter ? { y: -8, scale: 1.015 } : undefined}
      transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.8 }}
      className={cn(
        "selectionTile group relative grid min-w-0 overflow-hidden rounded-lg bg-[#10110f] shadow-md",
        "border transition-colors duration-200 ease-out",
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
        onClick={onDelete}
        aria-label={t("common:actions.remove")}
        className="selectionTrashButton"
      >
        <Icon name="trash" />
      </button>

      <button
        type="button"
        disabled={!canEnter}
        onClick={onEnter}
        className="relative block w-full min-h-[210px] overflow-hidden border-0 bg-[#11130f] p-0 text-left text-white disabled:cursor-default disabled:opacity-100"
      >
        <AlbumHoloCard title={title} coverUrl={coverUrl} active={focused} className="absolute inset-0" />
        <div className="absolute inset-0 grid content-end gap-1 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.1),transparent_34%,rgba(0,0,0,0.84)),linear-gradient(to_right,rgba(0,0,0,0.45),transparent)] p-3.5">
          <span className="selectionPlayBadge">
            <Icon name="play" />
          </span>
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

      <div className="selectionActions flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!canEnter}
          onClick={onEnter}
          className="gap-1.5 text-sm"
        >
          <Icon name="mic" />
          {canEnter ? t("package:enterKaraoke") : t("package:badges.needsMedia")}
        </Button>
        <Button size="sm" onClick={onReview} className="gap-1.5 text-sm">
          <Icon name="folder" />
          {t("library:editPackage")}
        </Button>
      </div>
    </motion.article>
  );
}
