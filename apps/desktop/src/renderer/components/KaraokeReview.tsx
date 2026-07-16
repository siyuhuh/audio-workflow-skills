import { useTranslation } from "react-i18next";
import type { GeneratedAsset, PlaybackBundle } from "../../shared/types";
import { type Cue, formatClock } from "../lib/lyrics";
import { StudioPlaybackBar } from "./StudioPlaybackBar";

interface PlaybackController {
  mediaRef: import("react").RefObject<HTMLMediaElement | null>;
  mediaUrl: string;
  mediaStatus: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  canControl: boolean;
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  play: () => void;
  pause: () => void;
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
    <div className="karaokeReview">
      <div className="karaokeReviewMain">
        <div className="karaokeReviewStatus" data-ready={stemReady}>
          <span className="karaokeReviewStatusDot" aria-hidden="true" />
          <div>
            <strong>
              {stemReady ? t("package:split.ready") : t("package:split.missing")}
            </strong>
            <span>
              {stemReady ? t("package:split.readyHint") : t("package:split.missingHint")}
            </span>
          </div>
        </div>

        <div className="karaokeReviewBindings">
          <BindingField label={t("package:playbackTrack")} value={selectedMediaName} />
          <BindingField label={t("package:lyricsBound")} value={selectedSubtitleName} />
        </div>

        {playbackController.mediaUrl ? (
          <StudioPlaybackBar
            controller={playbackController}
            variant={isVideo ? "video" : "audio"}
          />
        ) : (
          <p className="karaokeReviewEmpty">
            {playbackController.mediaStatus ||
              playbackBundle.unavailableReason ||
              t("package:noLocalMedia")}
          </p>
        )}

        <div className="karaokeReviewNow">
          <p className="karaokeReviewNowPrev">{previousCue?.text ?? "\u00a0"}</p>
          <p className="karaokeReviewNowActive">{activeCue?.text ?? t("package:playToFollow")}</p>
          <p className="karaokeReviewNowNext">{nextCue?.text ?? "\u00a0"}</p>
        </div>
      </div>

      <div aria-label={t("package:timedLines")} className="karaokeReviewLines">
        {cues.length === 0 ? (
          <p className="karaokeReviewEmpty">{t("package:noTimedSubtitles")}</p>
        ) : (
          cues.map((cue, index) => (
            <button
              key={`${cue.start}-${index}`}
              type="button"
              data-active={index === activeCueIndex}
              onClick={() => onSeek(cue)}
              className="karaokeReviewLine"
            >
              <span className="karaokeReviewLineTime">{formatClock(cue.start)}</span>
              <strong className="karaokeReviewLineText">{cue.text}</strong>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BindingField({ label, value }: { label: string; value: string }) {
  return (
    <div className="karaokeReviewBinding">
      <span className="karaokeReviewBindingLabel">{label}</span>
      <strong className="karaokeReviewBindingValue">{value}</strong>
    </div>
  );
}
