import {
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type {
  GeneratedAsset,
  PlaybackBundle,
  RecordingExportFormat,
  RecordingPackage,
  RecordingSaveResult,
  RenameRecordingRequest,
  RoomQueueItem,
  SavedJobHistory,
  SaveRecordingTakeRequest,
  UpdateRecordingMixRequest
} from "../../shared/types";
import {
  KaraokeLyricLine,
  type LyricEffect,
  type LyricFont
} from "../components/KaraokeLyricLine";
import {
  MicrophoneMonitorPanel,
  type MicrophoneMonitorController
} from "../components/MicrophoneMonitorPanel";
import { HoverFillGroup } from "../components/ui/HoverFillGroup";
import { Icon } from "../components/ui/Icon";
import { type Cue, formatClock } from "../lib/lyrics";
import { motionDuration, motionEase } from "../lib/motion";
import { cn } from "../lib/cn";
import type { Translator } from "../lib/types";

type TrackRole = "original" | "backing" | "vocal" | "custom";
type RoomTool = "recordings" | "mixer" | "style" | "queue" | "settings";

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
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  play: () => void;
  pause: () => void;
  restart: () => void;
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

interface TrackAssets {
  original: GeneratedAsset | null;
  backing: GeneratedAsset | null;
  vocal: GeneratedAsset | null;
}

interface SongOption {
  id: string;
  title: string;
}

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
  onSaveRecording: (request: SaveRecordingTakeRequest) => Promise<RecordingSaveResult>;
  onUpdateRecordingMix: (request: UpdateRecordingMixRequest) => Promise<RecordingPackage>;
  onRenameRecording: (request: RenameRecordingRequest) => Promise<RecordingPackage>;
  onDeleteRecording: (recordingPackageId: string) => Promise<RecordingPackage[]>;
  onListRecordings: (sourceSongPackageId: string) => Promise<RecordingPackage[]>;
  onGetRecordingMediaUrl: (targetPath: string) => Promise<string>;
  onOpenRecordingPath: (targetPath: string) => void | Promise<void>;
  onOpenRecordingRoot: () => void | Promise<void>;
  onSplitVocals: () => void;
  onTrackRoleChange: (role: TrackRole) => void;
  isRunning: boolean;
}

const lyricEffectOptions: LyricEffect[] = ["sweep", "outline", "neon", "impact"];
const lyricFontOptions: LyricFont[] = ["rounded", "poster", "serif", "mono"];

const lyricFontPreviewClasses: Record<LyricFont, string> = {
  rounded: "font-sans font-semibold",
  poster: "font-black uppercase tracking-wide",
  serif: "font-serif font-semibold",
  mono: "font-mono font-semibold"
};

type RecordingPhase = "idle" | "preparing" | "countdown" | "recording" | "saving" | "complete" | "error";
interface RecordingMixDraft {
  vocalGain: number;
  musicGain: number;
  vocalOffsetMs: number;
  preferBackingTrack: boolean;
  exportFormat: RecordingExportFormat;
}
const RECORDING_VOCAL_OFFSET_LIMIT_MS = 500;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function clampRecordingOffset(value: number): number {
  return Math.round(
    Math.max(-RECORDING_VOCAL_OFFSET_LIMIT_MS, Math.min(RECORDING_VOCAL_OFFSET_LIMIT_MS, value))
  );
}

function recordingCalibrationStorageKey(deviceId?: string | null, deviceLabel?: string | null): string {
  const deviceKey = deviceId?.trim() || deviceLabel?.trim() || "system-default";
  return `vocalflow:recording-offset:${encodeURIComponent(deviceKey)}`;
}

function loadRecordingCalibration(
  deviceId?: string | null,
  deviceLabel?: string | null
): number | null {
  try {
    const rawValue = window.localStorage.getItem(
      recordingCalibrationStorageKey(deviceId, deviceLabel)
    );
    if (rawValue === null) {
      return null;
    }
    const value = Number(rawValue);
    return Number.isFinite(value) ? clampRecordingOffset(value) : null;
  } catch {
    return null;
  }
}

function saveRecordingCalibration(
  value: number,
  deviceId?: string | null,
  deviceLabel?: string | null
): void {
  try {
    window.localStorage.setItem(
      recordingCalibrationStorageKey(deviceId, deviceLabel),
      String(clampRecordingOffset(value))
    );
  } catch {
    // Calibration still applies to this recording when local storage is unavailable.
  }
}

function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
}

function primaryTrackRole(trackRole: TrackRole, hasBacking: boolean): "original" | "backing" {
  if (trackRole === "original" || trackRole === "backing") {
    return trackRole;
  }
  return hasBacking ? "backing" : "original";
}

function translatedTrackRoleLabel(trackRole: TrackRole, t: Translator): string {
  switch (trackRole) {
    case "backing":
      return t("room:trackLabels.backingTrack");
    case "vocal":
      return t("room:trackLabels.vocalOnly");
    case "custom":
      return t("room:trackLabels.customTrack");
    default:
      return t("room:trackLabels.originalMix");
  }
}

function primaryRecordingFile(recording: RecordingPackage): string | null {
  return recording.exports[0]?.path ?? recording.takes[0]?.path ?? null;
}

function recordingDuration(recording: RecordingPackage): number | null {
  return recording.exports[0]?.duration ?? recording.takes[0]?.duration ?? null;
}

function recordingDisplayTitle(recording: RecordingPackage, songTitle: string): string {
  const title = recording.title.trim();
  if (!title || /^(?:url|sample|local):/i.test(title) || /^untitled song\b/i.test(title)) {
    const takeTitle = recording.takes[0]?.title?.trim();
    return takeTitle ? `${songTitle} — ${takeTitle}` : songTitle;
  }
  return title;
}

function formatRecordingDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
  onSaveRecording,
  onUpdateRecordingMix,
  onRenameRecording,
  onDeleteRecording,
  onListRecordings,
  onGetRecordingMediaUrl,
  onOpenRecordingPath,
  onOpenRecordingRoot,
  onSplitVocals,
  onTrackRoleChange,
  isRunning
}: KaraokeRoomSceneProps) {
  const { t } = useTranslation();
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [lyricsOffsetSec, setLyricsOffsetSec] = useState(0);
  const [openTool, setOpenTool] = useState<RoomTool | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const [recordingCountdown, setRecordingCountdown] = useState(3);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingMessage, setRecordingMessage] = useState("");
  const [recordingPackages, setRecordingPackages] = useState<RecordingPackage[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(true);
  const [recordingsError, setRecordingsError] = useState("");
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [activeRecordingUrl, setActiveRecordingUrl] = useState("");
  const [recordingPreviewLoadingId, setRecordingPreviewLoadingId] = useState<string | null>(null);
  const [recordingMixDrafts, setRecordingMixDrafts] = useState<Record<string, Partial<RecordingMixDraft>>>({});
  const [recordingRenameDrafts, setRecordingRenameDrafts] = useState<Record<string, string>>({});
  const [recordingWorkingId, setRecordingWorkingId] = useState<string | null>(null);
  const [recordingDeletingId, setRecordingDeletingId] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const listRecordingsRef = useRef(onListRecordings);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingGenerationRef = useRef(0);
  const recordingDeviceRef = useRef<{ deviceId: string | null; deviceLabel: string | null } | null>(null);

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
  const progressPercent = progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0;
  const hasPlayableMedia = Boolean(playbackController.canControl);
  const hasBacking = Boolean(trackAssets.backing);
  const mainTrackRole = primaryTrackRole(trackRole, hasBacking);
  const recordingLocked =
    recordingPhase === "preparing" ||
    recordingPhase === "countdown" ||
    recordingPhase === "recording" ||
    recordingPhase === "saving";
  const trackRoleLabel = translatedTrackRoleLabel(trackRole, t);
  const cueKey = activeCue ? `${activeCue.start}-${activeCue.end}-${activeCue.text}` : "empty-cue";
  const queuedItems = roomQueue.filter((item) => item.status === "queued" || item.status === "running");
  const visualizerBars = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => {
        const phase = playbackController.currentTime * (0.9 + index * 0.028) + index * 0.63;
        const wave = Math.sin(phase) * 0.52 + Math.cos(phase * 0.68 + index) * 0.48;
        return Math.max(0.12, Math.min(1, 0.5 + wave * 0.42));
      }),
    [playbackController.currentTime]
  );
  const toolPanelTitle =
    openTool === "recordings"
      ? t("room:recording.library")
      : openTool === "mixer"
      ? t("room:volumes.title")
      : openTool === "style"
        ? t("room:stylePanel")
        : openTool === "queue"
          ? t("room:playlist.title")
          : t("room:settings");
  const toolPanelMeta =
    openTool === "recordings"
      ? t("room:recording.count", { count: recordingPackages.length })
      : openTool === "queue"
      ? t("room:playlist.autoNext")
      : openTool === "settings"
        ? trackRoleLabel
        : null;

  const releaseRecordingStream = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingDeviceRef.current = null;
  }, []);

  const stopAndSaveRecording = useCallback(async () => {
    if (recordingPhase === "countdown") {
      recordingGenerationRef.current += 1;
      releaseRecordingStream();
      setRecordingPhase("idle");
      setRecordingMessage("");
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive" || recordingPhase !== "recording") {
      return;
    }

    setRecordingPhase("saving");
    setRecordingMessage(t("room:recording.saving"));
    playbackController.pause();
    const duration = Math.max(0.1, (performance.now() - recordingStartedAtRef.current) / 1000);

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => resolve(new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" })),
          { once: true }
        );
        recorder.addEventListener(
          "error",
          () => reject(new Error(t("room:recording.captureFailed"))),
          { once: true }
        );
        recorder.stop();
      });
      const data = new Uint8Array(await blob.arrayBuffer());
      const selectedDevice = microphoneMonitor.devices.find(
        (candidate) => candidate.deviceId === microphoneMonitor.selectedDeviceId
      );
      const recordingDevice = recordingDeviceRef.current ?? {
        deviceId: microphoneMonitor.selectedDeviceId || null,
        deviceLabel: selectedDevice?.label ?? null
      };
      const savedCalibration = loadRecordingCalibration(
        recordingDevice.deviceId,
        recordingDevice.deviceLabel
      );
      const vocalOffsetMs = savedCalibration ?? 0;
      const result = await onSaveRecording({
        sourceSongPackageId: activeReview.id,
        sourceTitle: reviewTitle,
        data,
        mimeType: blob.type || recorder.mimeType || "audio/webm",
        duration,
        deviceId: recordingDevice.deviceId,
        deviceLabel: recordingDevice.deviceLabel,
        vocalGain: 1,
        musicGain: playbackController.muted ? 0 : playbackController.volume,
        vocalOffsetMs,
        preferBackingTrack: mainTrackRole === "backing",
        exportFormat: "m4a"
      });
      setRecordingMixDrafts((current) => ({
        ...current,
        [result.recordingPackage.id]: {
          ...result.recordingPackage.mix,
          vocalOffsetMs: result.recordingPackage.mix.vocalOffsetMs ?? vocalOffsetMs
        }
      }));
      setRecordingRenameDrafts((current) => ({
        ...current,
        [result.recordingPackage.id]: result.recordingPackage.title
      }));
      setRecordingPackages((current) => [
        result.recordingPackage,
        ...current.filter((recording) => recording.id !== result.recordingPackage.id)
      ]);
      setRecordingMessage(
        result.warning ??
          (result.mixExport ? t("room:recording.savedMix") : t("room:recording.savedVocal"))
      );
      setRecordingPhase("complete");
      const filePath = primaryRecordingFile(result.recordingPackage);
      if (filePath) {
        try {
          const mediaUrl = await onGetRecordingMediaUrl(filePath);
          setActiveRecordingId(result.recordingPackage.id);
          setActiveRecordingUrl(mediaUrl);
        } catch {
          // The recording is safely persisted even if its immediate preview cannot open.
        }
      }
      playbackController.pause();
      setOpenTool("recordings");
    } catch (error) {
      setRecordingMessage(error instanceof Error ? error.message : t("room:recording.saveFailed"));
      setRecordingPhase("error");
    } finally {
      releaseRecordingStream();
    }
  }, [
    activeReview.id,
    mainTrackRole,
    microphoneMonitor.devices,
    microphoneMonitor.selectedDeviceId,
    onGetRecordingMediaUrl,
    onSaveRecording,
    playbackController,
    reviewTitle,
    recordingPhase,
    releaseRecordingStream,
    t
  ]);

  const startRecording = useCallback(async () => {
    if (!hasPlayableMedia || recordingLocked) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingMessage(t("room:recording.unavailable"));
      setRecordingPhase("error");
      return;
    }

    const generation = recordingGenerationRef.current + 1;
    recordingGenerationRef.current = generation;
    setRecordingMessage("");
    setOpenTool(null);
    setRecordingPhase("preparing");
    setRecordingMessage(t("room:recording.preparing"));

    try {
      const stream = await microphoneMonitor.acquireRecordingStream();
      if (recordingGenerationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const trackSettings = stream.getAudioTracks()[0]?.getSettings();
      const resolvedDeviceId =
        trackSettings?.deviceId ?? (microphoneMonitor.selectedDeviceId || null);
      const resolvedDevice = microphoneMonitor.devices.find(
        (candidate) => candidate.deviceId === resolvedDeviceId
      );
      recordingDeviceRef.current = {
        deviceId: resolvedDeviceId,
        deviceLabel: resolvedDevice?.label ?? null
      };
      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 192_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 192_000 });
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      playbackController.pause();
      playbackController.seek(0, false);
      setRecordingPhase("countdown");
      for (let count = 3; count >= 1; count -= 1) {
        if (recordingGenerationRef.current !== generation) {
          return;
        }
        setRecordingCountdown(count);
        await wait(900);
      }
      if (recordingGenerationRef.current !== generation) {
        return;
      }

      recorder.start(1000);
      recordingStartedAtRef.current = performance.now();
      setRecordingElapsed(0);
      setRecordingPhase("recording");
      setRecordingMessage(t("room:recording.live"));
      playbackController.seek(0, false);
      playbackController.play();
    } catch (error) {
      releaseRecordingStream();
      setRecordingMessage(error instanceof Error ? error.message : t("room:recording.captureFailed"));
      setRecordingPhase("error");
    }
  }, [
    hasPlayableMedia,
    microphoneMonitor.devices,
    microphoneMonitor.noiseReduction,
    microphoneMonitor.selectedDeviceId,
    playbackController,
    recordingLocked,
    releaseRecordingStream,
    t
  ]);

  useEffect(() => {
    listRecordingsRef.current = onListRecordings;
  }, [onListRecordings]);

  useEffect(() => {
    let cancelled = false;
    setRecordingsLoading(true);
    setRecordingsError("");
    setActiveRecordingId(null);
    setActiveRecordingUrl("");
    setRecordingMixDrafts({});
    setRecordingRenameDrafts({});
    setRecordingWorkingId(null);
    setRecordingDeletingId(null);
    void listRecordingsRef.current(activeReview.id)
      .then((recordings) => {
        if (!cancelled) {
          setRecordingPackages(recordings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRecordingPackages([]);
          setRecordingsError(
            error instanceof Error ? error.message : t("room:recording.loadFailed")
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecordingsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeReview.id, t]);

  useEffect(() => {
    if (recordingPhase !== "recording") {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setRecordingElapsed(Math.max(0, (performance.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recordingPhase]);

  const endedCountRef = useRef(playbackController.endedCount);
  useEffect(() => {
    if (
      playbackController.endedCount > endedCountRef.current &&
      recordingPhase === "recording"
    ) {
      void stopAndSaveRecording();
    }
    endedCountRef.current = playbackController.endedCount;
  }, [playbackController.endedCount, recordingPhase, stopAndSaveRecording]);

  useEffect(() => {
    return () => {
      recordingGenerationRef.current += 1;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      releaseRecordingStream();
    };
  }, [releaseRecordingStream]);

  useEffect(() => {
    if (!openTool) {
      return undefined;
    }

    function handleOutsidePointer(event: globalThis.PointerEvent) {
      if (event.target instanceof Node && !toolsRef.current?.contains(event.target)) {
        setOpenTool(null);
      }
    }

    function handleToolKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenTool(null);
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleToolKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleToolKeydown);
    };
  }, [openTool]);

  async function toggleRecordingPreview(recording: RecordingPackage) {
    if (activeRecordingId === recording.id) {
      setActiveRecordingId(null);
      setActiveRecordingUrl("");
      return;
    }
    const filePath = primaryRecordingFile(recording);
    if (!filePath) {
      return;
    }
    setRecordingPreviewLoadingId(recording.id);
    setRecordingsError("");
    try {
      const mediaUrl = await onGetRecordingMediaUrl(filePath);
      setActiveRecordingId(recording.id);
      setActiveRecordingUrl(mediaUrl);
    } catch (error) {
      setRecordingsError(
        error instanceof Error ? error.message : t("room:recording.previewFailed")
      );
    } finally {
      setRecordingPreviewLoadingId(null);
    }
  }

  async function applyRecordingMix(recording: RecordingPackage) {
    const draft = recordingMixDrafts[recording.id] ?? {};
    const vocalOffsetMs = clampRecordingOffset(
      draft.vocalOffsetMs ?? recording.mix.vocalOffsetMs ?? 0
    );
    setRecordingWorkingId(recording.id);
    setRecordingsError("");
    try {
      const updatedRecording = await onUpdateRecordingMix({
        recordingPackageId: recording.id,
        vocalGain: draft.vocalGain ?? recording.mix.vocalGain,
        musicGain: draft.musicGain ?? recording.mix.musicGain,
        vocalOffsetMs,
        preferBackingTrack: draft.preferBackingTrack ?? recording.mix.preferBackingTrack,
        exportFormat: draft.exportFormat ?? recording.mix.exportFormat
      });
      setRecordingPackages((current) =>
        current.map((candidate) =>
          candidate.id === updatedRecording.id ? updatedRecording : candidate
        )
      );
      setRecordingMixDrafts((current) => ({
        ...current,
        [updatedRecording.id]: {
          ...updatedRecording.mix,
          vocalOffsetMs: updatedRecording.mix.vocalOffsetMs ?? vocalOffsetMs
        }
      }));
      const take = updatedRecording.takes.find(
        (candidate) => candidate.id === updatedRecording.mix.activeTakeId
      ) ?? updatedRecording.takes[0];
      saveRecordingCalibration(vocalOffsetMs, take?.deviceId, take?.deviceLabel);

      const filePath = primaryRecordingFile(updatedRecording);
      if (filePath) {
        const mediaUrl = await onGetRecordingMediaUrl(filePath);
        setActiveRecordingId(updatedRecording.id);
        setActiveRecordingUrl(mediaUrl);
      }
      setRecordingMessage(t("room:recording.mixUpdated"));
    } catch (error) {
      setRecordingsError(
        error instanceof Error ? error.message : t("room:recording.mixFailed")
      );
    } finally {
      setRecordingWorkingId(null);
    }
  }

  async function applyRecordingRename(recording: RecordingPackage) {
    const title = (
      recordingRenameDrafts[recording.id]
      ?? recordingDisplayTitle(recording, reviewTitle)
    ).trim();
    if (!title || title === recording.title) {
      return;
    }
    setRecordingWorkingId(recording.id);
    setRecordingsError("");
    try {
      const updatedRecording = await onRenameRecording({
        recordingPackageId: recording.id,
        title
      });
      setRecordingPackages((current) =>
        current.map((candidate) =>
          candidate.id === updatedRecording.id ? updatedRecording : candidate
        )
      );
      setRecordingRenameDrafts((current) => ({
        ...current,
        [updatedRecording.id]: updatedRecording.title
      }));
      setRecordingMessage(t("room:recording.renamed"));
    } catch (error) {
      setRecordingsError(
        error instanceof Error ? error.message : t("room:recording.renameFailed")
      );
    } finally {
      setRecordingWorkingId(null);
    }
  }

  async function removeRecording(recording: RecordingPackage) {
    const title = recordingDisplayTitle(recording, reviewTitle);
    if (!window.confirm(t("room:recording.deleteConfirm", { title }))) {
      return;
    }
    setRecordingDeletingId(recording.id);
    setRecordingsError("");
    try {
      const remaining = await onDeleteRecording(recording.id);
      setRecordingPackages(
        remaining.filter((candidate) => candidate.sourceSongPackageId === activeReview.id)
      );
      setRecordingMixDrafts((current) => {
        const next = { ...current };
        delete next[recording.id];
        return next;
      });
      setRecordingRenameDrafts((current) => {
        const next = { ...current };
        delete next[recording.id];
        return next;
      });
      if (activeRecordingId === recording.id) {
        setActiveRecordingId(null);
        setActiveRecordingUrl("");
      }
      setRecordingMessage(t("room:recording.deleted"));
    } catch (error) {
      setRecordingsError(
        error instanceof Error ? error.message : t("room:recording.deleteFailed")
      );
    } finally {
      setRecordingDeletingId(null);
    }
  }

  function seekFromProgressPointer(event: PointerEvent<HTMLDivElement>) {
    if (!hasPlayableMedia || recordingLocked || progressMax <= 0) {
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

  function toggleMicrophone() {
    if (microphoneMonitor.isMonitoring) {
      microphoneMonitor.setIsMonitoring(false);
      return;
    }
    if (microphoneMonitor.monitorGain <= 0) {
      microphoneMonitor.setMonitorGain(0.35);
    }
    microphoneMonitor.setIsMonitoring(true);
  }

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
      data-theme="dark"
      className="roomStage"
    >
      <section className="roomStageCanvas">
        {showVisualPreview ? (
          <video
            ref={playbackController.previewRef}
            className="roomStageMedia"
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
            className="roomStageMedia"
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
          <div className="roomStageFallback" data-playing={playbackController.isPlaying}>
            <div className="roomStageOrb" aria-hidden="true">
              <span>{reviewTitle.slice(0, 1).toUpperCase()}</span>
            </div>
            <div className="roomStageVisualizer" aria-hidden="true">
              {visualizerBars.map((scale, index) => (
                <span key={index} style={{ transform: `scaleY(${scale})` }} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="roomStageScrim" aria-hidden="true" />

        <header className="roomStageTopbar">
          <div className="roomStageNow">
            <span>{t("room:nowSinging")}</span>
            <strong title={reviewTitle}>{reviewTitle}</strong>
            <p>{trackRoleLabel} · {selectedMediaName}</p>
          </div>
          <button
            type="button"
            className="roomStageExit"
            onClick={onBackHome}
            disabled={recordingLocked}
            aria-label={t("room:leaveStage")}
            title={t("room:leaveStage")}
          >
            <Icon name="home" />
          </button>
        </header>

        {recordingPhase === "countdown" ? (
          <div className="roomRecordingCountdown" role="status" aria-live="assertive">
            <span>{t("room:recording.getReady")}</span>
            <strong>{recordingCountdown}</strong>
            <button type="button" onClick={() => void stopAndSaveRecording()}>
              {t("room:recording.cancel")}
            </button>
          </div>
        ) : null}

        {recordingPhase === "recording" || recordingPhase === "saving" ? (
          <div className="roomRecordingLive" data-phase={recordingPhase} role="status" aria-live="polite">
            <span aria-hidden="true" />
            <strong>
              {recordingPhase === "recording"
                ? `${t("room:recording.live")} · ${formatClock(recordingElapsed)}`
                : t("room:recording.saving")}
            </strong>
          </div>
        ) : null}

        <div className="roomLyrics roomStageLyrics" data-effect={lyricEffect} data-font={lyricFont}>
          <p className="roomLyricContext">{previousCue?.text ?? ""}</p>
          <KaraokeLyricLine
            key={cueKey}
            cue={activeCue}
            currentTime={playbackController.currentTime}
            effect={lyricEffect}
          />
          <p className="roomLyricContext">{nextCue?.text ?? ""}</p>
        </div>
      </section>

      <footer className="roomControlDock">
        <div
          ref={progressRef}
          role="slider"
          aria-label={t("room:transport.position")}
          aria-valuemin={0}
          aria-valuemax={Math.round(progressMax)}
          aria-valuenow={Math.round(progressValue)}
          aria-valuetext={`${formatClock(progressValue)} / ${progressMax > 0 ? formatClock(progressMax) : "--:--"}`}
          data-disabled={!hasPlayableMedia || recordingLocked}
          className="roomProgress"
          onPointerDown={handleProgressPointerDown}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekFromProgressPointer(event);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onKeyDown={(event) => {
            if (!hasPlayableMedia || recordingLocked || progressMax <= 0) {
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
          tabIndex={hasPlayableMedia && !recordingLocked ? 0 : -1}
        >
          <span className="roomProgressTrack" />
          <span className="roomProgressFill" style={{ transform: `scaleX(${progressPercent / 100})` }} />
          <span className="roomProgressThumb" style={{ left: `${progressPercent}%` }} />
        </div>

        <div className="roomControlRow">
          <div className="roomControlTrack">
            <HoverFillGroup<TrackRole>
              ariaLabel={t("room:trackRole")}
              className="grid-cols-2"
              value={mainTrackRole}
              onChange={onTrackRoleChange}
              items={[
                { value: "original", label: t("room:tracks.original"), disabled: recordingLocked || !trackAssets.original },
                { value: "backing", label: t("room:tracks.backing"), disabled: recordingLocked || !trackAssets.backing }
              ]}
            />
          </div>

          <div className="roomTransport">
            <span className="roomTransportTime">{formatClock(progressValue)}</span>
            <button
              type="button"
              disabled={!hasPlayableMedia || recordingLocked}
              onClick={() => void onPlayPrevious()}
              aria-label={t("room:transport.previous")}
              title={t("room:transport.previous")}
              className="roomTransportButton"
            >
              <Icon name="previous" />
            </button>
            <button
              type="button"
              disabled={!hasPlayableMedia || recordingLocked}
              onClick={playbackController.isPlaying ? playbackController.pause : playbackController.play}
              aria-label={playbackController.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
              title={playbackController.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
              className="roomTransportButton roomTransportButton--primary"
            >
              <Icon name={playbackController.isPlaying ? "pause" : "play"} />
            </button>
            <button
              type="button"
              disabled={!hasPlayableMedia || recordingLocked}
              onClick={() => void onPlayNext()}
              aria-label={t("room:transport.next")}
              title={t("room:transport.next")}
              className="roomTransportButton"
            >
              <Icon name="next" />
            </button>
            <span className="roomTransportTime">{progressMax > 0 ? formatClock(progressMax) : "--:--"}</span>
          </div>

          <div className="roomTools" ref={toolsRef}>
            <button
              type="button"
              className="roomRecordButton"
              data-phase={recordingPhase}
              disabled={
                !hasPlayableMedia ||
                recordingPhase === "preparing" ||
                recordingPhase === "saving"
              }
              onClick={() => {
                if (recordingPhase === "recording" || recordingPhase === "countdown") {
                  void stopAndSaveRecording();
                } else {
                  void startRecording();
                }
              }}
              aria-label={
                recordingPhase === "recording"
                  ? t("room:recording.stop")
                  : t("room:recording.start")
              }
              title={recordingMessage || t("room:recording.startHint")}
            >
              <span className="roomRecordGlyph" aria-hidden="true" />
              <span>
                {recordingPhase === "recording"
                  ? formatClock(recordingElapsed)
                  : recordingPhase === "preparing"
                    ? t("room:recording.preparing")
                  : recordingPhase === "saving"
                    ? t("room:recording.saving")
                    : t("room:recording.record")}
              </span>
            </button>

            <button
              type="button"
              className="roomToolTrigger"
              data-open={openTool === "recordings"}
              onClick={() => setOpenTool((current) => current === "recordings" ? null : "recordings")}
              aria-label={t("room:recording.library")}
              title={recordingMessage || t("room:recording.library")}
              aria-expanded={openTool === "recordings"}
              aria-controls="roomToolPanel"
              disabled={recordingLocked}
            >
              <Icon name="headphones" />
              {recordingPackages.length > 0 ? (
                <span className="roomToolBadge">{recordingPackages.length}</span>
              ) : null}
            </button>

            <button
              type="button"
              className="roomToolTrigger"
              data-open={openTool === "mixer"}
              onClick={() => setOpenTool((current) => current === "mixer" ? null : "mixer")}
              aria-label={t("room:volumes.title")}
              title={t("room:volumes.title")}
              aria-expanded={openTool === "mixer"}
              aria-controls="roomToolPanel"
              disabled={recordingLocked}
            >
              <Icon name={playbackController.muted ? "volumeMute" : "volume"} />
            </button>

            <button
              type="button"
              className="roomToolTrigger roomToolTrigger--text"
              data-open={openTool === "style"}
              onClick={() => setOpenTool((current) => current === "style" ? null : "style")}
              aria-label={t("room:stylePanel")}
              title={t("room:stylePanel")}
              aria-expanded={openTool === "style"}
              aria-controls="roomToolPanel"
            >
              Aa
            </button>

            <button
              type="button"
              className="roomToolTrigger"
              data-open={openTool === "queue"}
              onClick={() => setOpenTool((current) => current === "queue" ? null : "queue")}
              aria-label={t("room:playlist.title")}
              title={t("room:playlist.title")}
              aria-expanded={openTool === "queue"}
              aria-controls="roomToolPanel"
              disabled={recordingLocked}
            >
              <Icon name="menu" />
              {queuedItems.length > 0 ? <span className="roomToolBadge">{queuedItems.length}</span> : null}
            </button>

            <button
              type="button"
              className="roomToolTrigger"
              data-open={openTool === "settings"}
              onClick={() => setOpenTool((current) => current === "settings" ? null : "settings")}
              aria-label={t("room:settings")}
              title={t("room:settings")}
              aria-expanded={openTool === "settings"}
              aria-controls="roomToolPanel"
              disabled={recordingLocked}
            >
              <Icon name="settings" />
            </button>

            {openTool ? (
              <div
                id="roomToolPanel"
                className="roomToolPanel"
                data-tool={openTool}
                role="dialog"
                aria-modal="false"
                aria-label={toolPanelTitle}
              >
                <header className="roomToolPanelHeader">
                  <div>
                    <strong>{toolPanelTitle}</strong>
                    {toolPanelMeta ? <span>{toolPanelMeta}</span> : null}
                  </div>
                  <button
                    type="button"
                    className="roomToolPanelClose"
                    onClick={() => setOpenTool(null)}
                    aria-label={t("common:notifications.dismiss")}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </header>

                {openTool === "recordings" ? (
                  <div className="roomRecordingLibrary">
                    <div className="roomRecordingLibraryIntro">
                      <div>
                        <strong>{t("room:recording.savedOnMac")}</strong>
                        <span>~/Music/VocalFlow/Recordings</span>
                      </div>
                      <button type="button" onClick={() => void onOpenRecordingRoot()}>
                        <Icon name="folder" />
                        {t("room:recording.openAll")}
                      </button>
                    </div>

                    {recordingsError ? (
                      <p className="roomRecordingLibraryNotice" role="alert">{recordingsError}</p>
                    ) : null}

                    {recordingsLoading ? (
                      <p className="roomRecordingLibraryNotice" aria-live="polite">
                        {t("room:recording.loading")}
                      </p>
                    ) : recordingPackages.length === 0 ? (
                      <div className="roomRecordingEmpty">
                        <span className="roomRecordGlyph" aria-hidden="true" />
                        <strong>{t("room:recording.empty")}</strong>
                        <p>{t("room:recording.emptyHint")}</p>
                      </div>
                    ) : (
                      <div className="roomRecordingList" role="list">
                        {recordingPackages.map((recording, index) => {
                          const displayTitle = recordingDisplayTitle(recording, reviewTitle);
                          const filePath = primaryRecordingFile(recording);
                          const duration = recordingDuration(recording);
                          const format = recording.exports[0]?.format ?? "wav";
                          const isPreviewOpen =
                            activeRecordingId === recording.id && Boolean(activeRecordingUrl);
                          const mixDraft = recordingMixDrafts[recording.id] ?? {};
                          const draftVocalGain = mixDraft.vocalGain ?? recording.mix.vocalGain;
                          const draftMusicGain = mixDraft.musicGain ?? recording.mix.musicGain;
                          const savedVocalOffsetMs = recording.mix.vocalOffsetMs ?? 0;
                          const draftVocalOffsetMs =
                            mixDraft.vocalOffsetMs ?? savedVocalOffsetMs;
                          const draftPreferBacking =
                            mixDraft.preferBackingTrack ?? recording.mix.preferBackingTrack;
                          const draftExportFormat =
                            mixDraft.exportFormat ?? recording.mix.exportFormat;
                          const renameDraft =
                            recordingRenameDrafts[recording.id] ?? displayTitle;
                          const mixChanged =
                            !recording.exports[0]
                            || draftVocalGain !== recording.mix.vocalGain
                            || draftMusicGain !== recording.mix.musicGain
                            || draftVocalOffsetMs !== savedVocalOffsetMs
                            || draftPreferBacking !== recording.mix.preferBackingTrack
                            || draftExportFormat !== recording.mix.exportFormat;
                          const vocalOffsetLabel =
                            draftVocalOffsetMs > 0
                              ? t("room:recording.advanceVocal", {
                                  value: draftVocalOffsetMs
                                })
                              : draftVocalOffsetMs < 0
                                ? t("room:recording.delayVocal", {
                                    value: Math.abs(draftVocalOffsetMs)
                                  })
                                : t("room:recording.noOffset");
                          return (
                            <article
                              className="roomRecordingItem"
                              data-preview-open={isPreviewOpen}
                              key={recording.id}
                              role="listitem"
                              title={recording.outputDir}
                            >
                              <div className="roomRecordingItemMain">
                                <span className="roomRecordingIndex">
                                  {String(recordingPackages.length - index).padStart(2, "0")}
                                </span>
                                <div>
                                  <strong>{displayTitle}</strong>
                                  <span>
                                    <time dateTime={recording.createdAt}>
                                      {formatRecordingDate(recording.createdAt)}
                                    </time>
                                    {" · "}
                                    {duration ? formatClock(duration) : "--:--"}
                                    {" · "}
                                    {format.toUpperCase()}
                                  </span>
                                </div>
                              </div>
                              <div className="roomRecordingActions">
                                <button
                                  type="button"
                                  onClick={() => void toggleRecordingPreview(recording)}
                                  disabled={!filePath || recordingPreviewLoadingId === recording.id}
                                  aria-label={
                                    isPreviewOpen
                                      ? t("room:recording.hidePreview")
                                      : t("room:recording.preview")
                                  }
                                >
                                  <Icon name={isPreviewOpen ? "stop" : "play"} />
                                  {recordingPreviewLoadingId === recording.id
                                    ? t("room:recording.loading")
                                    : isPreviewOpen
                                      ? t("room:recording.hidePreview")
                                      : t("room:recording.preview")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => filePath && void onOpenRecordingPath(filePath)}
                                  disabled={!filePath}
                                  aria-label={t("room:recording.openFile")}
                                  title={t("room:recording.openFile")}
                                >
                                  <Icon name="music" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void onOpenRecordingPath(recording.outputDir)}
                                  aria-label={t("room:recording.openFolder")}
                                  title={t("room:recording.openFolder")}
                                >
                                  <Icon name="folder" />
                                </button>
                                <button
                                  type="button"
                                  className="roomRecordingDelete"
                                  onClick={() => void removeRecording(recording)}
                                  disabled={recordingDeletingId === recording.id}
                                  aria-label={t("room:recording.delete")}
                                  title={t("room:recording.delete")}
                                >
                                  <Icon name="trash" />
                                </button>
                              </div>
                              {isPreviewOpen ? (
                                <>
                                  <audio
                                    className="roomRecordingAudio"
                                    src={activeRecordingUrl}
                                    controls
                                    autoPlay
                                    preload="metadata"
                                  />
                                  <div className="roomRecordingReviewEditor">
                                    <div className="roomRecordingRename">
                                      <input
                                        type="text"
                                        value={renameDraft}
                                        maxLength={120}
                                        aria-label={t("room:recording.name")}
                                        onChange={(event) => {
                                          setRecordingRenameDrafts((current) => ({
                                            ...current,
                                            [recording.id]: event.currentTarget.value
                                          }));
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            void applyRecordingRename(recording);
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        disabled={
                                          recordingWorkingId === recording.id
                                          || !renameDraft.trim()
                                          || renameDraft.trim() === recording.title
                                        }
                                        onClick={() => void applyRecordingRename(recording)}
                                      >
                                        {t("room:recording.rename")}
                                      </button>
                                    </div>

                                    <div className="roomRecordingMixGrid">
                                      <label>
                                        <span>{t("room:recording.vocalGain")}</span>
                                        <strong>{draftVocalGain.toFixed(2)}×</strong>
                                        <input
                                          type="range"
                                          min={0}
                                          max={2}
                                          step={0.05}
                                          value={draftVocalGain}
                                          onChange={(event) => {
                                            const vocalGain = Number(event.currentTarget.value);
                                            setRecordingMixDrafts((current) => ({
                                              ...current,
                                              [recording.id]: {
                                                ...current[recording.id],
                                                vocalGain
                                              }
                                            }));
                                          }}
                                        />
                                      </label>
                                      <label>
                                        <span>{t("room:recording.musicGain")}</span>
                                        <strong>{draftMusicGain.toFixed(2)}×</strong>
                                        <input
                                          type="range"
                                          min={0}
                                          max={2}
                                          step={0.05}
                                          value={draftMusicGain}
                                          onChange={(event) => {
                                            const musicGain = Number(event.currentTarget.value);
                                            setRecordingMixDrafts((current) => ({
                                              ...current,
                                              [recording.id]: {
                                                ...current[recording.id],
                                                musicGain
                                              }
                                            }));
                                          }}
                                        />
                                      </label>
                                    </div>

                                    <div className="roomRecordingCalibration">
                                      <div>
                                        <strong>{t("room:recording.alignment")}</strong>
                                        <span>{vocalOffsetLabel}</span>
                                      </div>
                                      <input
                                        type="range"
                                        min={-RECORDING_VOCAL_OFFSET_LIMIT_MS}
                                        max={RECORDING_VOCAL_OFFSET_LIMIT_MS}
                                        step={10}
                                        value={draftVocalOffsetMs}
                                        onChange={(event) => {
                                          const vocalOffsetMs = clampRecordingOffset(
                                            Number(event.currentTarget.value)
                                          );
                                          setRecordingMixDrafts((current) => ({
                                            ...current,
                                            [recording.id]: {
                                              ...current[recording.id],
                                              vocalOffsetMs
                                            }
                                          }));
                                        }}
                                        aria-label={t("room:recording.alignment")}
                                      />
                                    </div>

                                    <div className="roomRecordingExportRow">
                                      <label>
                                        <span>{t("room:recording.format")}</span>
                                        <select
                                          value={draftExportFormat}
                                          onChange={(event) => {
                                            const exportFormat = event.currentTarget.value as RecordingExportFormat;
                                            setRecordingMixDrafts((current) => ({
                                              ...current,
                                              [recording.id]: {
                                                ...current[recording.id],
                                                exportFormat
                                              }
                                            }));
                                          }}
                                        >
                                          <option value="m4a">M4A</option>
                                          <option value="mp3">MP3</option>
                                          <option value="wav">WAV</option>
                                        </select>
                                      </label>
                                      <label className="roomRecordingBackingChoice">
                                        <input
                                          type="checkbox"
                                          checked={draftPreferBacking}
                                          disabled={!trackAssets.backing}
                                          onChange={(event) => {
                                            const preferBackingTrack = event.currentTarget.checked;
                                            setRecordingMixDrafts((current) => ({
                                              ...current,
                                              [recording.id]: {
                                                ...current[recording.id],
                                                preferBackingTrack
                                              }
                                            }));
                                          }}
                                        />
                                        <span>{t("room:recording.useBacking")}</span>
                                      </label>
                                    </div>

                                    <div className="roomRecordingCalibrationActions">
                                      <button
                                        type="button"
                                        disabled={draftVocalOffsetMs === 0}
                                        onClick={() => {
                                          setRecordingMixDrafts((current) => ({
                                            ...current,
                                            [recording.id]: {
                                              ...current[recording.id],
                                              vocalOffsetMs: 0
                                            }
                                          }));
                                        }}
                                      >
                                        {t("room:recording.resetAlignment")}
                                      </button>
                                      <button
                                        type="button"
                                        className="roomRecordingApplyMix"
                                        disabled={recordingWorkingId === recording.id || !mixChanged}
                                        onClick={() => void applyRecordingMix(recording)}
                                      >
                                        {recordingWorkingId === recording.id
                                          ? t("room:recording.remixing")
                                          : t("room:recording.applyMix")}
                                      </button>
                                    </div>
                                  </div>
                                </>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {openTool === "mixer" ? (
                  <RoomMixerPanel
                    mediaVolume={playbackController.volume}
                    mediaMuted={playbackController.muted}
                    mediaDisabled={!hasPlayableMedia}
                    onMediaVolumeChange={playbackController.setVolume}
                    onToggleMediaMute={playbackController.toggleMute}
                    micGain={microphoneMonitor.monitorGain}
                    micEnabled={microphoneMonitor.isMonitoring}
                    onMicGainChange={(gain) => {
                      microphoneMonitor.setMonitorGain(gain);
                      if (gain > 0 && !microphoneMonitor.isMonitoring) {
                        microphoneMonitor.setIsMonitoring(true);
                      }
                    }}
                    onToggleMic={toggleMicrophone}
                  />
                ) : null}

                {openTool === "style" ? (
                  <div className="roomToolSectionStack">
                    <div className="roomStylePreview" data-effect={lyricEffect} data-font={lyricFont}>
                      <span>{t("room:stylePreview")}</span>
                      <strong className={cn("stageStylePreview", lyricFontPreviewClasses[lyricFont])}>
                        {t("room:styleSample")}
                      </strong>
                    </div>
                    <section>
                      <span className="roomPopoverLabel">{t("room:effect")}</span>
                      <div className="roomStyleGrid">
                        {lyricEffectOptions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            data-selected={lyricEffect === value}
                            onClick={() => onLyricEffectChange(value)}
                          >
                            {t(`room:effects.${value}`)}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section>
                      <span className="roomPopoverLabel">{t("room:font")}</span>
                      <div className="roomStyleGrid">
                        {lyricFontOptions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            data-selected={lyricFont === value}
                            onClick={() => onLyricFontChange(value)}
                          >
                            {t(`room:fonts.${value}`)}
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : null}

                {openTool === "queue" ? (
                  <div className="roomQueueList">
                    {queuedItems.map((item) => (
                      <div className="roomQueueItem" key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <span>{t("room:playlist.phoneRequest")} · {item.requestedBy}</span>
                        </div>
                        <div>
                          {item.status === "queued" ? (
                            <button
                              type="button"
                              onClick={() => void onProcessRoomItem(item)}
                              disabled={isRunning}
                              aria-label={t("room:queueRun")}
                            >
                              <Icon name="play" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void onRemoveRoomItem(item.id)}
                            disabled={item.status === "running"}
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
                        className="roomSongItem"
                        data-active={entry.id === activeReview.id}
                        onClick={() => onPackageChange(entry.id)}
                        disabled={recordingLocked}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{entry.title}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}

                {openTool === "settings" ? (
                  <div className="roomSettingsStack">
                    <label className="roomSettingsField">
                      <span>{t("room:song")}</span>
                      <select
                        value={activeReview.id}
                        onChange={(event) => onPackageChange(event.target.value)}
                        disabled={songOptions.length <= 1}
                      >
                        {songOptions.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.title}</option>
                        ))}
                      </select>
                    </label>
                    <MicrophoneMonitorPanel monitor={microphoneMonitor} />
                    <div className="roomStageMenu">
                      <button type="button" onClick={() => { setOpenTool(null); setLyricsEditorOpen(true); }}>
                        <Icon name="lyrics" />
                        {t("room:lyricsEditor.button")}
                        <span>{selectedSubtitleName}</span>
                      </button>
                      {!hasBacking ? (
                        <button type="button" onClick={onSplitVocals} disabled={isRunning}>
                          <Icon name="music" />
                          {isRunning ? t("package:splitRunning") : t("package:splitVocals")}
                        </button>
                      ) : null}
                      <button type="button" onClick={onBackToLyrics}>
                        <Icon name="lyrics" />
                        {t("room:editLyrics")}
                      </button>
                      {activeReview.sourceUrl ? (
                        <button type="button" onClick={onOpenOriginalVideo}>
                          <Icon name="play" />
                          {t("package:openOriginal")}
                        </button>
                      ) : null}
                      <button type="button" onClick={onBackHome}>
                        <Icon name="home" />
                        {t("room:leaveStage")}
                      </button>
                    </div>
                    {!playbackController.mediaUrl ? (
                      <p className="roomSettingsNotice">
                        {playbackController.mediaStatus || playbackBundle.unavailableReason || t("room:noLocalAudio")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {playbackController.mediaUrl && !showLocalVideo ? (
          <audio
            key={playbackController.mediaUrl}
            ref={playbackController.mediaRef as RefObject<HTMLAudioElement>}
            src={playbackController.mediaUrl}
            preload="auto"
            className="roomHiddenMedia"
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
      </footer>

      <AnimatePresence>
        {lyricsEditorOpen ? (
          <motion.div
            className="roomEditorBackdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionDuration.fast, ease: motionEase }}
            role="dialog"
            aria-modal="true"
            aria-label={t("room:lyricsEditor.title")}
          >
            <motion.section
              className="roomEditor"
              initial={{ opacity: 0, transform: "scale(0.97)" }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              exit={{ opacity: 0, transform: "scale(0.98)" }}
              transition={{ duration: motionDuration.panel, ease: motionEase }}
            >
              <header className="roomEditorHeader">
                <div>
                  <strong>{t("room:lyricsEditor.title")}</strong>
                  <span>{selectedSubtitleName}</span>
                </div>
                <div className="roomEditorNudge">
                  <button type="button" onClick={() => applyLyricOffset(-0.1)} disabled={!selectedSubtitlePath}>
                    −
                  </button>
                  <span>{lyricsOffsetSec >= 0 ? "+" : ""}{lyricsOffsetSec.toFixed(2)}s</span>
                  <button type="button" onClick={() => applyLyricOffset(0.1)} disabled={!selectedSubtitlePath}>
                    +
                  </button>
                </div>
              </header>

              <div className="roomEditorHint">
                <span>{formatClock(progressValue)}</span>
                <p>{t("room:lyricsEditor.hint")}</p>
                <span>{progressMax > 0 ? formatClock(progressMax) : "--:--"}</span>
              </div>

              <div className="roomEditorBody">
                <div className="roomEditorCues">
                  {cues.length > 0 ? cues.map((cue, index) => (
                    <button
                      key={`${cue.start}-${index}`}
                      type="button"
                      onClick={() => syncCueToPlayback(cue)}
                      data-active={index === activeCueIndex}
                    >
                      <span>{formatClock(cue.start)}</span>
                      <strong>{cue.text}</strong>
                    </button>
                  )) : <p>{t("room:lyricsEditor.empty")}</p>}
                </div>
                <textarea
                  value={scriptText}
                  onChange={(event) => onScriptChange(event.target.value)}
                  spellCheck={false}
                  disabled={!selectedSubtitlePath}
                  placeholder={t("room:lyricsEditor.empty")}
                />
              </div>

              <footer className="roomEditorFooter">
                <span>{scriptStatus}</span>
                <div>
                  <button type="button" onClick={() => setLyricsEditorOpen(false)}>
                    {t("common:actions.cancel")}
                  </button>
                  <button
                    type="button"
                    className="roomEditorSave"
                    disabled={!selectedSubtitlePath}
                    onClick={() => {
                      void onSaveLyrics();
                      setLyricsEditorOpen(false);
                    }}
                  >
                    {t("common:actions.save")}
                  </button>
                </div>
              </footer>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.main>
  );
}

interface RoomMixerPanelProps {
  mediaVolume: number;
  mediaMuted: boolean;
  mediaDisabled: boolean;
  onMediaVolumeChange: (volume: number) => void;
  onToggleMediaMute: () => void;
  micGain: number;
  micEnabled: boolean;
  onMicGainChange: (gain: number) => void;
  onToggleMic: () => void;
}

function RoomMixerPanel({
  mediaVolume,
  mediaMuted,
  mediaDisabled,
  onMediaVolumeChange,
  onToggleMediaMute,
  micGain,
  micEnabled,
  onMicGainChange,
  onToggleMic
}: RoomMixerPanelProps) {
  const { t } = useTranslation();
  const mediaSilent = mediaMuted || mediaVolume <= 0;
  const micSilent = !micEnabled || micGain <= 0;

  return (
    <div className="roomMixer" aria-label={t("room:volumes.title")}>
      <div className="roomMixerRow">
        <button
          type="button"
          disabled={mediaDisabled}
          onClick={onToggleMediaMute}
          aria-label={mediaSilent ? t("room:volumes.unmuteBacking") : t("room:volumes.muteBacking")}
          aria-pressed={mediaSilent}
        >
          <Icon name={mediaSilent ? "volumeMute" : "volume"} />
        </button>
        <span>{t("room:volumes.backing")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={mediaSilent ? 0 : mediaVolume}
          disabled={mediaDisabled}
          onChange={(event) => onMediaVolumeChange(Number(event.currentTarget.value))}
          aria-label={t("room:volumes.backing")}
        />
        <output>{Math.round((mediaSilent ? 0 : mediaVolume) * 100)}</output>
      </div>
      <div className="roomMixerRow">
        <button
          type="button"
          onClick={onToggleMic}
          aria-label={micSilent ? t("room:volumes.enableVocal") : t("room:volumes.muteVocal")}
          aria-pressed={!micSilent}
        >
          <Icon name="mic" />
        </button>
        <span>{t("room:volumes.vocal")}</span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={micGain}
          onChange={(event) => onMicGainChange(Number(event.currentTarget.value))}
          aria-label={t("room:volumes.vocal")}
        />
        <output>{Math.round(micGain * 100)}</output>
      </div>
    </div>
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
