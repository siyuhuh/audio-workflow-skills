import { type PointerEvent, type RefObject, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "../lib/lyrics";
import { Icon } from "./ui/Icon";

export interface StudioPlaybackController {
  mediaRef: RefObject<HTMLMediaElement | null>;
  mediaUrl: string;
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
  onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onDurationChange: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onCanPlay: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onPlay: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onPause: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onEnded: () => void;
  onSeeking: (event: SyntheticEvent<HTMLMediaElement>) => void;
  onSeeked: (event: SyntheticEvent<HTMLMediaElement>) => void;
}

interface StudioPlaybackBarProps {
  controller: StudioPlaybackController;
  variant?: "audio" | "video";
}

export function StudioPlaybackBar({ controller, variant = "audio" }: StudioPlaybackBarProps) {
  const { t } = useTranslation();
  const progressMax = Math.max(controller.duration, controller.currentTime, 0);
  const progressValue = progressMax > 0 ? Math.min(controller.currentTime, progressMax) : 0;
  const progressPercent = progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0;
  const hasPlayableMedia = Boolean(controller.canControl && controller.mediaUrl);
  const mediaHandlers = {
    onLoadedMetadata: controller.onLoadedMetadata,
    onDurationChange: controller.onDurationChange,
    onCanPlay: controller.onCanPlay,
    onTimeUpdate: controller.onTimeUpdate,
    onPlay: controller.onPlay,
    onPause: controller.onPause,
    onEnded: controller.onEnded,
    onSeeking: controller.onSeeking,
    onSeeked: controller.onSeeked
  };

  function seekFromProgressPointer(event: PointerEvent<HTMLDivElement>) {
    if (!hasPlayableMedia || progressMax <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    controller.seek(ratio * progressMax, controller.isPlaying);
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!hasPlayableMedia) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromProgressPointer(event);
  }

  return (
    <div className="studioPlayback" data-variant={variant}>
      {variant === "video" ? (
        <video
          key={controller.mediaUrl}
          ref={controller.mediaRef as RefObject<HTMLVideoElement>}
          className="studioPlaybackVideo"
          src={controller.mediaUrl}
          preload="auto"
          playsInline
          {...mediaHandlers}
        />
      ) : (
        <audio
          key={controller.mediaUrl}
          ref={controller.mediaRef as RefObject<HTMLAudioElement>}
          className="studioPlaybackMedia"
          src={controller.mediaUrl}
          preload="auto"
          {...mediaHandlers}
        />
      )}

      <div className="studioPlaybackBar">
        <button
          type="button"
          className="studioPlaybackPlay"
          disabled={!hasPlayableMedia}
          onClick={controller.isPlaying ? controller.pause : controller.play}
          aria-label={controller.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
          title={controller.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
        >
          <Icon name={controller.isPlaying ? "pause" : "play"} />
        </button>

        <span className="studioPlaybackTime" aria-hidden="true">
          {formatClock(progressValue)}
        </span>

        <div
          className="studioPlaybackProgress"
          data-disabled={!hasPlayableMedia || progressMax <= 0}
          role="slider"
          aria-label={t("package:playback.progress")}
          aria-valuemin={0}
          aria-valuemax={progressMax}
          aria-valuenow={progressValue}
          aria-disabled={!hasPlayableMedia || progressMax <= 0}
          tabIndex={hasPlayableMedia && progressMax > 0 ? 0 : -1}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={(event) => {
            if (event.buttons !== 1 || !event.currentTarget.hasPointerCapture(event.pointerId)) {
              return;
            }
            seekFromProgressPointer(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onKeyDown={(event) => {
            if (!hasPlayableMedia || progressMax <= 0) {
              return;
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              controller.seek(Math.max(0, progressValue - 5), controller.isPlaying);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              controller.seek(Math.min(progressMax, progressValue + 5), controller.isPlaying);
            }
          }}
        >
          <span className="studioPlaybackProgressTrack" />
          <span
            className="studioPlaybackProgressFill"
            style={{ transform: `scaleX(${progressPercent / 100})` }}
          />
          <span className="studioPlaybackProgressThumb" style={{ left: `${progressPercent}%` }} />
        </div>

        <span className="studioPlaybackTime" aria-hidden="true">
          {progressMax > 0 ? formatClock(progressMax) : "--:--"}
        </span>

        <div className="studioPlaybackVolume">
          <button
            type="button"
            className="studioPlaybackVolumeToggle"
            disabled={!hasPlayableMedia}
            onClick={controller.toggleMute}
            aria-label={controller.muted ? t("package:playback.unmute") : t("package:playback.mute")}
            title={controller.muted ? t("package:playback.unmute") : t("package:playback.mute")}
          >
            <Icon name={controller.muted ? "volumeMute" : "volume"} />
          </button>
          <input
            type="range"
            className="studioPlaybackVolumeSlider"
            min={0}
            max={1}
            step={0.01}
            value={controller.muted ? 0 : controller.volume}
            disabled={!hasPlayableMedia}
            aria-label={t("package:playback.volume")}
            onChange={(event) => controller.setVolume(Number(event.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
