import { type CSSProperties, type PointerEvent, type RefObject, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { GeneratedAsset, PlaybackBundle, RoomQueueItem, SavedJobHistory } from "../../shared/types";
import { type Cue, formatClock } from "../lib/lyrics";
import { motionDuration, motionEase } from "../lib/motion";
import { cn } from "../lib/cn";
import { Button } from "../components/ui/Button";
import { Eyebrow } from "../components/ui/Eyebrow";
import { HoverFillGroup } from "../components/ui/HoverFillGroup";
import { Icon } from "../components/ui/Icon";
import {
  KaraokeLyricLine,
  type LyricEffect,
  type LyricFont
} from "../components/KaraokeLyricLine";
import {
  MicrophoneMonitorPanel,
  type MicrophoneMonitorController
} from "../components/MicrophoneMonitorPanel";

type TrackRole = "original" | "backing" | "vocal" | "custom";

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
  endedCount: number;
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

interface TrackAssets {
  original: GeneratedAsset | null;
  backing: GeneratedAsset | null;
  vocal: GeneratedAsset | null;
}

interface SongOption {
  id: string;
  title: string;
}

function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
}

const lyricEffectOptions: LyricEffect[] = ["sweep", "outline", "neon", "impact"];
const lyricFontOptions: LyricFont[] = ["rounded", "poster", "serif", "mono"];

const lyricFontPreviewClasses: Record<LyricFont, string> = {
  rounded: "font-sans font-semibold",
  poster: "font-black uppercase tracking-wide",
  serif: "font-serif font-semibold",
  mono: "font-mono font-semibold"
};

interface KaraokeRoomSceneProps {
  activeCue: Cue | null;
  activeCueIndex: number;
  activeReview: SavedJobHistory;
  cues: Cue[];
  playbackBundle: PlaybackBundle;
  playbackController: PlaybackController;
  roomQueue: RoomQueueItem[];
  songOptions: SongOption[];
  trackAssets: TrackAssets;
  trackRole: TrackRole;
  lyricEffect: LyricEffect;
  lyricFont: LyricFont;
  microphoneMonitor: MicrophoneMonitorController;
  reviewTitle: string;
  selectedMediaName: string;
  selectedSubtitleName: string;
  selectedSubtitlePath: string;
  scriptStatus: string;
  scriptText: string;
  onBackHome: () => void;
  onBackToLyrics: () => void;
  onLyricEffectChange: (effect: LyricEffect) => void;
  onLyricFontChange: (font: LyricFont) => void;
  onOpenOriginalVideo: () => void;
  onPackageChange: (historyId: string) => void;
  onProcessRoomItem: (item: RoomQueueItem) => void | Promise<void>;
  onRemoveRoomItem: (itemId: string) => void | Promise<void>;
  onPlayNext: () => void | Promise<void>;
  onPlayPrevious: () => void | Promise<void>;
  onScriptChange: (content: string) => void;
  onSaveLyrics: () => void | Promise<void>;
  onSplitVocals: () => void;
  onTrackRoleChange: (role: TrackRole) => void;
  isRunning: boolean;
}

export function KaraokeRoomScene({
  activeCue,
  activeCueIndex,
  activeReview,
  cues,
  playbackBundle,
  playbackController,
  roomQueue,
  songOptions,
  trackAssets,
  trackRole,
  lyricEffect,
  lyricFont,
  microphoneMonitor,
  reviewTitle,
  selectedMediaName,
  selectedSubtitleName,
  selectedSubtitlePath,
  scriptStatus,
  scriptText,
  onBackHome,
  onBackToLyrics,
  onLyricEffectChange,
  onLyricFontChange,
  onOpenOriginalVideo,
  onPackageChange,
  onProcessRoomItem,
  onRemoveRoomItem,
  onPlayNext,
  onPlayPrevious,
  onScriptChange,
  onSaveLyrics,
  onSplitVocals,
  onTrackRoleChange,
  isRunning
}: KaraokeRoomSceneProps) {
  const { t } = useTranslation();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [lyricsOffsetSec, setLyricsOffsetSec] = useState(0);
  const previousCue = activeCueIndex > 0 ? cues[activeCueIndex - 1] : null;
  const nextCue = activeCueIndex >= 0 ? cues[activeCueIndex + 1] : cues[0] ?? null;
  const showVisualPreview = Boolean(playbackController.previewUrl);
  const showLocalVideo =
    !showVisualPreview && playbackController.mediaUrl && isVideoPath(playbackController.mediaUrl);
  const cueDuration = cues.at(-1)?.end ?? 0;
  const progressMax = Math.max(
    playbackController.duration,
    cueDuration,
    playbackController.currentTime,
    0
  );
  const progressValue = progressMax > 0 ? Math.min(playbackController.currentTime, progressMax) : 0;
  const hasPlayableMedia = Boolean(playbackController.canControl);
  const hasStems = Boolean(trackAssets.backing && trackAssets.vocal);
  const trackRoleLabel =
    trackRole === "backing"
      ? t("room:trackLabels.backingTrack")
      : trackRole === "vocal"
        ? t("room:trackLabels.vocalOnly")
        : trackRole === "custom"
          ? t("room:trackLabels.customTrack")
          : t("room:trackLabels.originalMix");
  const mainTrackRole: "original" | "backing" =
    trackRole === "vocal" || trackRole === "custom"
      ? trackAssets.backing
        ? "backing"
        : "original"
      : (trackRole as "original" | "backing");
  const cueKey = activeCue ? `${activeCue.start}-${activeCue.end}-${activeCue.text}` : "empty-cue";
  const progressRef = useRef<HTMLDivElement | null>(null);
  const progressPercent = progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0;

  function seekFromProgressPointer(event: PointerEvent<HTMLDivElement>) {
    if (!hasPlayableMedia || progressMax <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    playbackController.seek(ratio * progressMax, playbackController.isPlaying);
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!hasPlayableMedia) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromProgressPointer(event);
  }

  function handleProgressPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    seekFromProgressPointer(event);
  }

  function applyLyricOffset(offsetSeconds: number) {
    if (!scriptText.trim() || Math.abs(offsetSeconds) < 0.001) {
      return;
    }
    const shifted = shiftTimedText(scriptText, offsetSeconds);
    if (shifted !== scriptText) {
      setLyricsOffsetSec((current) => current + offsetSeconds);
      onScriptChange(shifted);
    }
  }

  function syncCueToPlayback(cue: Cue) {
    applyLyricOffset(playbackController.currentTime - cue.start);
  }

  const visualizerBars = useMemo(
    () =>
      Array.from({ length: 18 }, (_, index) => {
        const phase = playbackController.currentTime * (1.05 + index * 0.035) + index * 0.68;
        const wave = Math.sin(phase) * 0.5 + Math.cos(phase * 0.72 + index) * 0.5;
        return Math.max(0.18, Math.min(1, 0.52 + wave * 0.42));
      }),
    [playbackController.currentTime]
  );
  const roomQueuedItems = roomQueue.filter((item) => item.status === "queued" || item.status === "running");

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
      data-theme="dark"
      className="appSceneFrame relative grid min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-ktv-bg text-white"
    >
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ktv-line bg-ktv-bg/85 px-6 py-4 backdrop-blur-xl">
        <div className="grid min-w-0 gap-1">
          <Eyebrow className="text-white/60">{t("room:title")}</Eyebrow>
          <h1 className="m-0 truncate text-xl font-semibold text-white">{reviewTitle}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onBackHome}
            className="border-ktv-line bg-transparent text-white/85 hover:enabled:border-white/30 hover:enabled:bg-white/10"
          >
            {t("common:nav.home")}
          </Button>
          {activeReview.sourceUrl ? (
            <Button
              onClick={onOpenOriginalVideo}
              className="border-ktv-line bg-transparent text-white/85 hover:enabled:border-white/30 hover:enabled:bg-white/10"
            >
              {t("package:openOriginal")}
            </Button>
          ) : null}
          <Button
            onClick={onBackToLyrics}
            className="border-ktv-line bg-transparent text-white/85 hover:enabled:border-white/30 hover:enabled:bg-white/10"
          >
            {t("room:editLyrics")}
          </Button>
        </div>
      </header>

      <section className="relative grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <div className="relative grid place-items-center overflow-hidden bg-ktv-bg">
          {showVisualPreview ? (
            <video
              ref={playbackController.previewRef}
              className="absolute inset-0 size-full object-cover opacity-95"
              src={playbackController.previewUrl}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={playbackController.onLoadedMetadata}
              onDurationChange={playbackController.onDurationChange}
            />
          ) : null}
          {showLocalVideo ? (
            <video
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLVideoElement>}
              className="absolute inset-0 size-full object-cover"
              src={playbackController.mediaUrl}
              playsInline
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
          ) : null}
          {!showVisualPreview && !showLocalVideo ? (
            <div
              data-playing={playbackController.isPlaying}
              className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_72%,color-mix(in_oklch,var(--color-ktv-accent)_18%,transparent),transparent_34%)]"
            >
              <div className="grid place-items-center gap-4" aria-hidden="true">
                <div className="size-32 rounded-full border border-ktv-accent/40" />
                <div className="flex h-10 items-end gap-1">
                  {visualizerBars.map((scale, index) => (
                    <span
                      key={index}
                      style={{ height: `${Math.round(scale * 100)}%` }}
                      className="block w-1 rounded-full bg-ktv-accent"
                    />
                  ))}
                </div>
              </div>
              <div className="absolute bottom-[44%] grid place-items-center gap-1 text-center">
                <strong className="text-base font-medium text-white">{reviewTitle}</strong>
                <span className="text-sm font-normal text-ktv-text-muted">
                  {playbackController.previewStatus ||
                    playbackBundle?.unavailableReason ||
                    trackRoleLabel}
                </span>
              </div>
            </div>
          ) : null}

          {/* Lyric overlay */}
          <div
            className="roomLyrics pointer-events-none absolute inset-x-[3vw] bottom-[max(160px,22vh)] grid gap-2 text-center"
            data-effect={lyricEffect}
            data-font={lyricFont}
          >
            <p className="roomLyricContext m-0 min-h-[28px] text-[clamp(20px,2.5vw,34px)] font-bold text-white/55">
              {previousCue?.text ?? ""}
            </p>
            <KaraokeLyricLine
              key={cueKey}
              cue={activeCue}
              currentTime={playbackController.currentTime}
              effect={lyricEffect}
            />
            <p className="roomLyricContext m-0 min-h-[28px] text-[clamp(20px,2.5vw,34px)] font-bold text-white/55">
              {nextCue?.text ?? ""}
            </p>
          </div>
        </div>

        {/* Transport dock */}
        <aside className="relative z-[2] grid gap-3 bg-ktv-bg/90 px-6 pb-4 pt-4 backdrop-blur-xl">
          <div
            ref={progressRef}
            role="slider"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(progressMax)}
            aria-valuenow={Math.round(progressValue)}
            aria-valuetext={`${formatClock(progressValue)} / ${progressMax > 0 ? formatClock(progressMax) : "--:--"}`}
            data-disabled={!hasPlayableMedia}
            className="stageTopProgress"
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
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
                playbackController.seek(Math.max(0, progressValue - 5), playbackController.isPlaying);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                playbackController.seek(Math.min(progressMax, progressValue + 5), playbackController.isPlaying);
              }
            }}
            tabIndex={hasPlayableMedia ? 0 : -1}
          >
            <span className="stageTopProgressTrack" />
            <span className="stageTopProgressFill" style={{ width: `${progressPercent}%` }} />
            <span className="stageTopProgressThumb" style={{ left: `${progressPercent}%` }} />
            <span className="stageTopProgressTime" style={{ left: `${progressPercent}%` }}>
              {formatClock(progressValue)} / {progressMax > 0 ? formatClock(progressMax) : "--:--"}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="grid size-10 place-items-center rounded-md bg-ktv-accent text-base font-semibold text-black"
                aria-hidden="true"
              >
                {reviewTitle.slice(0, 2).toUpperCase()}
              </div>
              <div className="grid min-w-0 gap-0.5">
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-white">
                  {reviewTitle}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal text-ktv-text-muted">
                  {trackRoleLabel} · {selectedMediaName}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-self-center">
              <button
                type="button"
                disabled={!hasPlayableMedia}
                onClick={() => void onPlayPrevious()}
                aria-label={t("room:transport.previous")}
                title={t("room:transport.previous")}
                className={transportIconBtnClasses}
              >
                <Icon name="previous" />
              </button>
              <button
                type="button"
                disabled={!hasPlayableMedia}
                onClick={
                  playbackController.isPlaying
                    ? playbackController.pause
                    : playbackController.play
                }
                aria-label={playbackController.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
                title={playbackController.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
                className={cn(transportIconBtnClasses, "bg-ktv-accent text-black hover:enabled:bg-ktv-accent/90")}
              >
                <Icon name={playbackController.isPlaying ? "pause" : "play"} />
              </button>
              <button
                type="button"
                disabled={!hasPlayableMedia}
                onClick={() => void onPlayNext()}
                aria-label={t("room:transport.next")}
                title={t("room:transport.next")}
                className={transportIconBtnClasses}
              >
                <Icon name="next" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-self-end">
              <HoverFillGroup<TrackRole>
                ariaLabel={t("room:trackRole")}
                className="grid-cols-2"
                value={mainTrackRole}
                onChange={onTrackRoleChange}
                items={[
                  {
                    value: "original",
                    label: t("room:tracks.original"),
                    disabled: !trackAssets.original
                  },
                  {
                    value: "backing",
                    label: t("room:tracks.backing"),
                    disabled: !trackAssets.backing
                  }
                ]}
              />

              <details className="group relative">
                <summary
                  className={cn(
                    transportBtnClasses,
                    "list-none cursor-pointer [&::-webkit-details-marker]:hidden"
                  )}
                >
                  <Icon name="sliders" />
                  {t("room:style")}
                </summary>
                <div className="absolute bottom-full right-[calc(100%+10px)] z-10 mb-2 grid w-[min(380px,calc(100vw-32px))] gap-4 rounded-xl border border-ktv-line bg-ktv-surface p-4 shadow-[var(--shadow-overlay)]">
                  <header className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <strong className="text-sm font-semibold text-white">{t("room:stylePanel")}</strong>
                      <span className="text-xs font-medium text-ktv-text-muted">{t("room:styleHint")}</span>
                    </div>
                    <span className="rounded-full border border-ktv-line bg-ktv-surface-strong px-2 py-1 text-[11px] font-medium text-ktv-text-muted">
                      {t("room:styleLive")}
                    </span>
                  </header>

                  <div
                    className="rounded-lg border border-ktv-line bg-ktv-surface-strong px-4 py-3"
                    data-effect={lyricEffect}
                    data-font={lyricFont}
                  >
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ktv-text-muted">
                      {t("room:stylePreview")}
                    </span>
                    <strong
                      className={cn(
                        "stageStylePreview mt-2 block truncate text-2xl leading-tight",
                        lyricFontPreviewClasses[lyricFont]
                      )}
                    >
                      {t("room:styleSample")}
                    </strong>
                  </div>

                  <section className="grid gap-2" aria-label={t("room:effect")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">{t("room:effect")}</span>
                      <span className="text-[11px] text-ktv-text-muted">{t("room:effectHint")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {lyricEffectOptions.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={lyricEffect === value}
                          onClick={() => onLyricEffectChange(value)}
                          className={cn(
                            "group grid min-h-[68px] gap-1 rounded-lg border p-3 text-left transition-[background-color,border-color,color,transform] duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]",
                            lyricEffect === value
                              ? "border-ktv-accent bg-ktv-accent/15 text-white"
                              : "border-ktv-line bg-ktv-surface-strong text-white/78 hover:border-white/30 hover:bg-white/5"
                          )}
                        >
                          <span className="text-sm font-semibold">{t(`room:effects.${value}`)}</span>
                          <span className="text-[11px] font-medium text-ktv-text-muted">
                            {t(`room:effectDescriptions.${value}`)}
                          </span>
                          <span
                            className={cn(
                              "mt-1 h-1.5 rounded-full",
                              value === "outline" && "bg-white/80",
                              value === "sweep" && "bg-gradient-to-r from-white/25 via-ktv-accent to-ktv-accent/35",
                              value === "neon" && "bg-ktv-accent shadow-[0_0_14px_color-mix(in_oklch,var(--color-ktv-accent)_80%,transparent)]",
                              value === "impact" && "bg-gradient-to-r from-transparent via-ktv-accent to-transparent"
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-2" aria-label={t("room:font")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">{t("room:font")}</span>
                      <span className="text-[11px] text-ktv-text-muted">{t("room:fontHint")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {lyricFontOptions.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={lyricFont === value}
                          onClick={() => onLyricFontChange(value)}
                          className={cn(
                            "grid min-h-[58px] gap-1 rounded-lg border p-3 text-left transition-[background-color,border-color,color,transform] duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]",
                            lyricFont === value
                              ? "border-ktv-accent bg-ktv-accent/15 text-white"
                              : "border-ktv-line bg-ktv-surface-strong text-white/78 hover:border-white/30 hover:bg-white/5"
                          )}
                        >
                          <span className={cn("text-lg leading-none", lyricFontPreviewClasses[value])}>
                            Aa 字
                          </span>
                          <span className="text-[11px] font-medium text-ktv-text-muted">
                            {t(`room:fonts.${value}`)} · {t(`room:fontDescriptions.${value}`)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </details>

              {!hasStems ? (
                <button
                  type="button"
                  onClick={onSplitVocals}
                  disabled={isRunning}
                  className={transportBtnClasses}
                >
                  <Icon name="music" />
                  {isRunning ? t("package:splitRunning") : t("package:splitVocals")}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setLyricsEditorOpen(true)}
                className={transportBtnClasses}
              >
                <Icon name="lyrics" />
                {t("room:lyricsEditor.button")}
              </button>

              <details className="group relative" open={playlistOpen} onToggle={(event) => setPlaylistOpen(event.currentTarget.open)}>
                <summary
                  className={cn(
                    transportBtnClasses,
                    "list-none cursor-pointer [&::-webkit-details-marker]:hidden"
                  )}
                >
                  <Icon name="menu" />
                  {t("room:playlist.title")}
                </summary>
                <div className="absolute bottom-full right-0 z-30 mb-2 grid w-[min(360px,calc(100vw-32px))] max-h-[60vh] gap-3 overflow-y-auto rounded-lg border border-ktv-line bg-ktv-surface p-3 shadow-[var(--shadow-overlay)]">
                  <header className="flex items-center justify-between gap-3">
                    <strong className="text-sm font-semibold text-white">
                      {t("room:playlist.title")}
                      <span className="ml-1 text-xs text-ktv-text-muted tabular-nums">
                        {songOptions.length + roomQueuedItems.length}
                      </span>
                    </strong>
                    <span className="text-xs font-medium text-ktv-text-muted">{t("room:playlist.autoNext")}</span>
                  </header>
                  <div className="grid gap-1">
                    {roomQueuedItems.map((item) => (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-white/82 hover:bg-white/5">
                        <div className="min-w-0">
                          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                            {item.title}
                          </strong>
                          <span className="text-xs text-ktv-text-muted">
                            {t("room:playlist.phoneRequest")} · {item.requestedBy}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {item.status === "queued" ? (
                            <button
                              type="button"
                              onClick={() => void onProcessRoomItem(item)}
                              disabled={isRunning}
                              className="grid size-8 place-items-center rounded-full border border-ktv-line text-white/80 hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
                              aria-label={t("room:queueRun")}
                            >
                              <Icon name="play" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void onRemoveRoomItem(item.id)}
                            disabled={item.status === "running"}
                            className="grid size-8 place-items-center rounded-full border border-ktv-line text-white/60 hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
                            aria-label={t("room:queueRemove")}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {songOptions.map((entry, index) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => onPackageChange(entry.id)}
                        data-active={entry.id === activeReview.id}
                        className={cn(
                          "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-2 text-left",
                          entry.id === activeReview.id ? "bg-ktv-accent/20 text-white" : "text-white/82 hover:bg-white/5"
                        )}
                      >
                        <span className="font-mono text-xs text-ktv-text-muted tabular-nums">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                          {entry.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </details>

              <details className="group relative">
                <summary
                  className={cn(
                    transportBtnClasses,
                    "list-none cursor-pointer [&::-webkit-details-marker]:hidden"
                  )}
                >
                  <Icon name="settings" />
                  {t("room:settings")}
                </summary>
                <div className="absolute bottom-full right-0 z-20 mb-2 grid w-[min(380px,calc(100vw-32px))] max-h-[60vh] gap-3 overflow-y-auto rounded-lg border border-ktv-line bg-ktv-surface p-3 shadow-[var(--shadow-overlay)]">
                  <MicrophoneMonitorPanel monitor={microphoneMonitor} />

                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-ktv-text-muted">
                      {t("room:song")}
                    </span>
                    <select
                      value={activeReview.id}
                      onChange={(event) => onPackageChange(event.target.value)}
                      disabled={songOptions.length <= 1}
                      className="min-h-9 rounded-md border border-ktv-line bg-ktv-surface-strong px-3 text-sm text-white"
                    >
                      {songOptions.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-1 rounded-md border border-ktv-line bg-ktv-surface-strong px-3 py-2.5">
                    <span className="text-xs font-medium text-ktv-text-muted">
                      {t("room:lyrics")}
                    </span>
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-white">
                      {selectedSubtitleName}
                    </strong>
                  </div>

                  {trackAssets.vocal ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-ktv-line bg-ktv-surface-strong px-3 py-2.5">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="text-xs font-medium text-ktv-text-muted">
                          {t("room:optionalStem")}
                        </span>
                        <strong className="text-sm font-medium text-white">
                          {t("room:vocalOnly")}
                        </strong>
                      </div>
                      <button
                        type="button"
                        data-selected={trackRole === "vocal"}
                        onClick={() =>
                          onTrackRoleChange(
                            trackRole === "vocal"
                              ? trackAssets.backing
                                ? "backing"
                                : "original"
                              : "vocal"
                          )
                        }
                        className={cn(
                          "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold whitespace-nowrap",
                          trackRole === "vocal"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-ktv-line bg-transparent text-white/80 hover:border-white/30"
                        )}
                      >
                        <Icon name={trackRole === "vocal" ? "restart" : "mic"} />
                        {trackRole === "vocal" ? t("room:returnTrack") : t("room:useTrack")}
                      </button>
                    </div>
                  ) : null}

                  {!playbackController.mediaUrl ? (
                    <p className="m-0 text-xs font-medium text-ktv-text-muted">
                      {playbackController.mediaStatus ||
                        playbackBundle?.unavailableReason ||
                        t("room:noLocalAudio")}
                    </p>
                  ) : null}

                  <div className="grid auto-rows-min gap-1 max-h-[280px] overflow-y-auto">
                    {cues.map((cue, index) => (
                      <motion.button
                        key={`${cue.start}-${index}`}
                        type="button"
                        data-active={index === activeCueIndex}
                        onClick={() => playbackController.seek(cue.start, true)}
                        animate={index === activeCueIndex ? { x: 2 } : { x: 0 }}
                        transition={{ duration: motionDuration.fast, ease: motionEase }}
                        className={cn(
                          "grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left",
                          index === activeCueIndex
                            ? "bg-ktv-accent/20 text-white"
                            : "text-white/75 hover:bg-white/5"
                        )}
                      >
                        <span className="font-mono text-xs font-semibold text-ktv-text-muted tabular-nums">
                          {formatClock(cue.start)}
                        </span>
                        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">
                          {cue.text}
                        </strong>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>

          {playbackController.mediaUrl && !showLocalVideo ? (
            <audio
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLAudioElement>}
              src={playbackController.mediaUrl}
              preload="auto"
              className="absolute size-px overflow-hidden opacity-0"
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
          ) : null}
        </aside>

        <AnimatePresence>
          {lyricsEditorOpen ? (
            <motion.div
              className="fixed inset-0 z-40 grid place-items-center bg-black/36 px-4 py-8 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionDuration.fast, ease: motionEase }}
              role="dialog"
              aria-label={t("room:lyricsEditor.title")}
            >
              <motion.section
                className="grid max-h-[min(760px,88vh)] w-[min(560px,calc(100vw-32px))] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-ktv-line bg-black/88 text-white shadow-[var(--shadow-overlay)]"
                initial={{ y: 18, scale: 0.98 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 12, scale: 0.98 }}
                transition={{ duration: motionDuration.panel, ease: motionEase }}
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ktv-line px-4 py-3">
                  <div className="grid gap-0.5">
                    <strong className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                      <Icon name="lyrics" />
                      {t("room:lyricsEditor.title")}
                    </strong>
                    <span className="text-xs font-medium text-ktv-text-muted">
                      {selectedSubtitleName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => applyLyricOffset(-0.1)}
                      disabled={!selectedSubtitlePath}
                      className="grid size-9 place-items-center rounded-full border border-white/20 bg-white/8 text-base font-semibold text-white transition-colors hover:enabled:border-white/35 hover:enabled:bg-white/14 disabled:opacity-40"
                      aria-label={t("room:lyricsEditor.nudgeEarlier")}
                    >
                      -
                    </button>
                    <span className="min-w-[72px] rounded-full border border-ktv-line bg-ktv-surface px-3 py-2 text-center font-mono text-xs font-semibold text-white">
                      {lyricsOffsetSec >= 0 ? "+" : ""}
                      {lyricsOffsetSec.toFixed(2)}s
                    </span>
                    <button
                      type="button"
                      onClick={() => applyLyricOffset(0.1)}
                      disabled={!selectedSubtitlePath}
                      className="grid size-9 place-items-center rounded-full border border-white/20 bg-white/8 text-base font-semibold text-white transition-colors hover:enabled:border-white/35 hover:enabled:bg-white/14 disabled:opacity-40"
                      aria-label={t("room:lyricsEditor.nudgeLater")}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onSaveLyrics();
                        setLyricsEditorOpen(false);
                      }}
                      className="inline-flex min-h-9 items-center justify-center rounded-full border border-ktv-accent bg-ktv-accent px-5 text-sm font-semibold text-black shadow-sm transition-colors hover:enabled:bg-ktv-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {t("room:lyricsEditor.done")}
                    </button>
                  </div>
                </header>

                <div className="grid gap-2 border-b border-ktv-line px-4 py-3">
                  <div className="flex items-center justify-between font-mono text-xs font-semibold text-ktv-text-muted tabular-nums">
                    <span>{formatClock(progressValue)}</span>
                    <span>{progressMax > 0 ? formatClock(progressMax) : "--:--"}</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/12">
                    <div
                      className="h-full rounded-full bg-ktv-accent"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="m-0 text-center text-xs font-medium text-ktv-text-muted">
                    {t("room:lyricsEditor.hint")}
                  </p>
                </div>

                <div className="grid min-h-0 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                  <div className="min-h-0 overflow-y-auto border-b border-ktv-line p-3 md:border-b-0 md:border-r">
                    <div className="grid auto-rows-min gap-1">
                      {cues.map((cue, index) => (
                        <button
                          key={`${cue.start}-${index}`}
                          type="button"
                          onClick={() => syncCueToPlayback(cue)}
                          data-active={index === activeCueIndex}
                          className={cn(
                            "grid grid-cols-[54px_minmax(0,1fr)] items-center gap-2 rounded-md px-3 py-2 text-left",
                            index === activeCueIndex ? "bg-white/12 text-white" : "text-white/72 hover:bg-white/6"
                          )}
                        >
                          <span className="font-mono text-xs font-semibold text-ktv-text-muted tabular-nums">
                            {formatClock(cue.start)}
                          </span>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">
                            {cue.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={scriptText}
                    onChange={(event) => onScriptChange(event.target.value)}
                    spellCheck={false}
                    disabled={!selectedSubtitlePath}
                    className="min-h-[280px] resize-none border-0 bg-black/20 p-4 font-mono text-sm leading-relaxed text-white outline-none placeholder:text-white/35 disabled:opacity-55"
                    placeholder={t("room:lyricsEditor.empty")}
                  />
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-ktv-line px-4 py-3">
                  <span className="text-xs font-medium text-ktv-text-muted">{scriptStatus}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLyricsEditorOpen(false)}
                      className={transportBtnClasses}
                    >
                      {t("common:actions.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSaveLyrics()}
                      disabled={!selectedSubtitlePath}
                      className={cn(transportBtnClasses, "bg-ktv-accent text-black hover:enabled:bg-ktv-accent/90")}
                    >
                      {t("common:actions.save")}
                    </button>
                  </div>
                </footer>
              </motion.section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>
    </motion.main>
  );
}

function secondsFromTimestamp(hours: number, minutes: number, seconds: number, fraction: string): number {
  const fractionValue = fraction ? Number(`0.${fraction.padEnd(3, "0").slice(0, 3)}`) : 0;
  return hours * 3600 + minutes * 60 + seconds + fractionValue;
}

function formatTimestamp(totalSeconds: number, separator: "," | ".", fractionLength: number, hourWidth: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const fractionBase = 10 ** fractionLength;
  const fraction = Math.round((safeSeconds - Math.floor(safeSeconds)) * fractionBase);
  return `${String(hours).padStart(hourWidth, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(fraction).padStart(fractionLength, "0").slice(0, fractionLength)}`;
}

function formatLrcTimestamp(totalSeconds: number, minuteWidth: number, fractionLength: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const fractionBase = 10 ** fractionLength;
  const fraction = Math.round((safeSeconds - Math.floor(safeSeconds)) * fractionBase);
  return `[${String(minutes).padStart(minuteWidth, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(fractionLength, "0").slice(0, fractionLength)}]`;
}

function shiftTimedText(text: string, offsetSeconds: number): string {
  let shifted = text.replace(
    /\b(\d{1,2}):(\d{2}):(\d{2})([,.])(\d{1,3})\b/g,
    (match, hourText: string, minuteText: string, secondText: string, separator: "," | ".", fractionText: string) => {
      const nextSeconds =
        secondsFromTimestamp(Number(hourText), Number(minuteText), Number(secondText), fractionText) + offsetSeconds;
      return formatTimestamp(nextSeconds, separator, fractionText.length, hourText.length);
    }
  );

  shifted = shifted.replace(
    /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g,
    (match, minuteText: string, secondText: string, fractionText = "00") => {
      const nextSeconds = Number(minuteText) * 60 + Number(secondText) + Number(`0.${fractionText}`) + offsetSeconds;
      return formatLrcTimestamp(nextSeconds, minuteText.length, fractionText.length || 2);
    }
  );

  return shifted;
}

const transportBtnClasses =
  "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ktv-line bg-transparent px-4 text-sm font-medium text-white/85 transition-colors duration-150 ease-out hover:enabled:border-white/30 hover:enabled:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

const transportIconBtnClasses =
  "inline-grid size-9 place-items-center rounded-full border border-ktv-line bg-transparent text-white/85 transition-colors duration-150 ease-out hover:enabled:border-white/30 hover:enabled:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";
