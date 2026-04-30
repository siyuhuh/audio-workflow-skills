import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { SavedJobHistory } from "../../shared/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { Icon } from "./ui/Icon";
import { AlbumHoloCard } from "./visual/AlbumHoloCard";

interface FeaturedPackageCardProps {
  entry: SavedJobHistory;
  variant: "continue" | "sample";
  onEnter: () => void;
  onOpen: () => void;
  onDelete: () => void;
  title: string;
  canEnter: boolean;
  coverUrl: string | null;
  playbackSummary: string;
}

export function FeaturedPackageCard({
  entry: _entry,
  variant,
  onEnter,
  onOpen,
  onDelete,
  title,
  canEnter,
  coverUrl,
  playbackSummary
}: FeaturedPackageCardProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const eyebrowKey = variant === "continue" ? "library:continueHeader" : "library:sampleHeader";
  const enterLabel =
    variant === "continue" ? t("common:actions.enterKaraoke") : t("common:actions.tryInKaraoke");

  return (
    <motion.article
      data-variant={variant}
      data-enabled={canEnter}
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      whileHover={canEnter ? { y: -10, scale: 1.01 } : undefined}
      transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.8 }}
      className={cn(
        "selectionTile group relative grid gap-4 overflow-hidden rounded-lg border border-border bg-card/82 p-3 shadow-md backdrop-blur-md sm:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]",
        variant === "sample" && "border-primary bg-gradient-to-b from-accent-soft to-card"
      )}
    >
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("common:actions.remove")}
        className="selectionTrashButton"
      >
        <Icon name="trash" />
      </button>

      <div className="relative grid aspect-[16/10] min-h-[210px] place-items-stretch overflow-hidden rounded-lg bg-[#11130f]">
        <AlbumHoloCard title={title} coverUrl={coverUrl} active={focused} className="absolute inset-0" />
        <span className="selectionPlayBadge">
          <Icon name="play" />
        </span>
      </div>

      <div className="grid content-center gap-2">
        <Eyebrow>{t(eyebrowKey)}</Eyebrow>
        <h2 className="m-0 text-2xl font-semibold leading-snug text-foreground">{title}</h2>
        <p className="m-0 text-sm font-medium text-muted-foreground">{playbackSummary}</p>
        <div className="selectionActions flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={onEnter} disabled={!canEnter} className="gap-2">
            <Icon name="mic" />
            {enterLabel}
          </Button>
          <Button onClick={onOpen} className="gap-2">
            <Icon name="folder" />
            {t("library:editPackage")}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
