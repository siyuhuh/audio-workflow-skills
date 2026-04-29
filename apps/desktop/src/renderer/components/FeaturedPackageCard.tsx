import { useTranslation } from "react-i18next";
import type { SavedJobHistory } from "../../shared/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";

interface FeaturedPackageCardProps {
  entry: SavedJobHistory;
  variant: "continue" | "sample";
  onEnter: () => void;
  onOpen: () => void;
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
  title,
  canEnter,
  coverUrl,
  playbackSummary
}: FeaturedPackageCardProps) {
  const { t } = useTranslation();
  const eyebrowKey = variant === "continue" ? "library:continueHeader" : "library:sampleHeader";
  const enterLabel =
    variant === "continue" ? t("common:actions.enterKaraoke") : t("common:actions.tryInKaraoke");

  return (
    <article
      data-variant={variant}
      data-enabled={canEnter}
      className={cn(
        "grid gap-4 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-md sm:grid-cols-[minmax(200px,320px)_minmax(0,1fr)]",
        variant === "sample" && "border-primary bg-gradient-to-b from-accent-soft to-card"
      )}
    >
      <div className="relative grid aspect-[16/10] min-h-[168px] place-items-stretch overflow-hidden rounded-lg bg-[#11130f]">
        {coverUrl ? (
          <video
            src={coverUrl}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover opacity-90"
          />
        ) : (
          <div className="grid size-full place-items-center bg-[linear-gradient(to_bottom,rgba(0,0,0,0.04),rgba(0,0,0,0.5)),repeating-linear-gradient(135deg,rgba(255,255,255,0.12)_0_1px,transparent_1px_12px),#27322b] text-[clamp(48px,4vw,72px)] font-black text-white/85">
            {title.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="grid content-center gap-2">
        <Eyebrow>{t(eyebrowKey)}</Eyebrow>
        <h2 className="m-0 text-2xl font-semibold leading-snug text-foreground">{title}</h2>
        <p className="m-0 text-sm font-medium text-muted-foreground">{playbackSummary}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onEnter} disabled={!canEnter}>
            {enterLabel}
          </Button>
          <Button onClick={onOpen}>{t("library:openPackage")}</Button>
        </div>
      </div>
    </article>
  );
}
