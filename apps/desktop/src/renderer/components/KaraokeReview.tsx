import { type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { GeneratedAsset, PlaybackBundle } from "../../shared/types";
import { type Cue, formatClock } from "../lib/lyrics";
import { cn } from "../lib/cn";

interface PlaybackController {
  mediaRef: RefObject<HTMLMediaElement | null>;
  previewRef: RefObject<HTMLVideoElement | null>;
  mediaUrl: string;
  previewUrl: string;
  mediaStatus: string;
  previewStatus: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  canControl: boolean;
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (time: number, shouldPlay?: boolean) => void;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onDurationChange: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onCanPlay: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onPlay: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onEnded: () => void;
  onSeeking: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
  onSeeked: (event: React.SyntheticEvent<HTMLMediaElement>) => void;
}

interface KaraokeReviewProps {
  activeCue: Cue | null;
  activeCueIndex: number;
  cues: Cue[];
  playbackBundle: PlaybackBundle;
  playbackController: PlaybackController;
  playableAssets: GeneratedAsset[];
  selectedMediaPath: string;
  selectedSubtitlePath: string;
  isVideo: boolean;
  selectedSubtitleName: string;
  selectedMediaName: string;
  onSeek: (cue: Cue) => void;
}

export function KaraokeReview({
  activeCue,
  activeCueIndex,
  cues,
  playbackBundle,
  playbackController,
  playableAssets,
  isVideo,
  selectedSubtitleName,
  selectedMediaName,
  onSeek
}: KaraokeReviewProps) {
  const { t } = useTranslation();
  const previousCue = activeCueIndex > 0 ? cues[activeCueIndex - 1] : null;
  const nextCue = activeCueIndex >= 0 ? cues[activeCueIndex + 1] : cues[0] ?? null;
  const hasBacking = playableAssets.some((asset) => asset.role === "backing");
  const stemReady = hasBacking;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-3">
        <div
          data-ready={stemReady}
          className={cn(
            "grid gap-1 rounded-lg border px-3 py-2.5",
            stemReady ? "border-primary/40 bg-accent-soft" : "border-border bg-muted"
          )}
        >
          <strong className="text-sm font-semibold text-foreground">
            {stemReady ? t("package:split.ready") : t("package:split.missing")}
          </strong>
          <span className="text-xs font-medium text-muted-foreground">
            {stemReady ? t("package:split.readyHint") : t("package:split.missingHint")}
          </span>
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
          <BindingField label={t("package:playbackTrack")} value={selectedMediaName} />
          <BindingField label={t("package:lyricsBound")} value={selectedSubtitleName} />
        </div>

        {playbackController.mediaUrl ? (
          isVideo ? (
            <video
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLVideoElement>}
              className="aspect-video w-full rounded-lg border border-border bg-black"
              src={playbackController.mediaUrl}
              controls
              preload="auto"
              onLoadedMetadata={playbackController.onLoadedMetadata}
              onDurationChange={playbackController.onDurationChange}
              onCanPlay={playbackController.onCanPlay}
              onPlay={playbackController.onPlay}
              onPause={playbackController.onPause}
              onEnded={playbackController.onEnded}
              onSeeking={playbackController.onSeeking}
              onSeeked={playbackController.onSeeked}
              onTimeUpdate={playbackController.onTimeUpdate}
            />
          ) : (
            <audio
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLAudioElement>}
              className="w-full rounded-md border border-border bg-card"
              src={playbackController.mediaUrl}
              controls
              preload="auto"
              onLoadedMetadata={playbackController.onLoadedMetadata}
              onDurationChange={playbackController.onDurationChange}
              onCanPlay={playbackController.onCanPlay}
              onPlay={playbackController.onPlay}
              onPause={playbackController.onPause}
              onEnded={playbackController.onEnded}
              onSeeking={playbackController.onSeeking}
              onSeeked={playbackController.onSeeked}
              onTimeUpdate={playbackController.onTimeUpdate}
            />
          )
        ) : (
          <p className="m-0 text-sm font-medium text-muted-foreground">
            {playbackController.mediaStatus ||
              playbackBundle.unavailableReason ||
              t("package:noLocalMedia")}
          </p>
        )}

        <div className="grid gap-1 rounded-lg border border-border bg-elevated px-4 py-5 text-center">
          <p className="m-0 text-sm font-medium text-faint">{previousCue?.text ?? "\u00a0"}</p>
          <p className="m-0 text-2xl font-semibold leading-snug text-foreground">
            {activeCue?.text ?? t("package:playToFollow")}
          </p>
          <p className="m-0 text-sm font-medium text-faint">{nextCue?.text ?? "\u00a0"}</p>
        </div>
      </div>

      <div
        aria-label={t("package:timedLines")}
        className="grid max-h-[640px] auto-rows-min gap-1 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-sm"
      >
        {cues.length === 0 ? (
          <p className="m-0 px-2 py-4 text-sm font-medium text-muted-foreground">
            {t("package:noTimedSubtitles")}
          </p>
        ) : (
          cues.map((cue, index) => (
            <button
              key={`${cue.start}-${index}`}
              type="button"
              data-active={index === activeCueIndex}
              onClick={() => onSeek(cue)}
              className={cn(
                "grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-150 ease-out",
                "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                index === activeCueIndex
                  ? "bg-accent-soft text-foreground"
                  : "bg-transparent text-foreground hover:bg-muted"
              )}
            >
              <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                {formatClock(cue.start)}
              </span>
              <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">
                {cue.text}
              </strong>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BindingField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-faint">{label}</span>
      <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
        {value}
      </strong>
    </div>
  );
}
