import { useTranslation } from "react-i18next";
import type { PlaybackBundle } from "../../shared/types";

interface PackageBadgesProps {
  playbackBundle: PlaybackBundle;
  trackAssets: {
    backing: unknown;
  };
}

export function PackageBadges({ playbackBundle, trackAssets }: PackageBadgesProps) {
  const { t } = useTranslation();
  const badges = [
    playbackBundle.controllable
      ? t("package:badges.localPlayback")
      : t("package:badges.playbackMissing"),
    trackAssets.backing ? t("package:badges.backingStem") : null,
    playbackBundle.videoPreviewPath ? t("package:badges.videoPreview") : null
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t("package:contents")}>
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground"
        >
          {badge}
        </span>
      ))}
    </div>
  );
}
