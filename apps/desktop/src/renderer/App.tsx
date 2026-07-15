import { type CSSProperties, type DragEvent, type RefObject, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import type {
  AccentColor,
  AppLocale,
  AudioWorkflowApi,
  CommandPreview,
  GeneratedAsset,
  JobOptions,
  JobResult,
  OutputFormat,
  PlaybackBundle,
  RoomQueueItem,
  RoomStatus,
  SavedJobHistory,
  ThemeMode,
  UrlMetadataPreview,
  UserSettings,
  UvrDetectionResult,
  WorkflowMode,
  YoutubeSearchResult
} from "../shared/types";
import type { JobFailedEvent, JobProgressStage } from "../shared/types";
import type { JobErrorReason } from "../shared/job-events";
import { hydrateLocaleFromHost, setAppLocale } from "./i18n";
import { motionDuration, motionEase } from "./lib/motion";
import {
  clientHistoryPackageKey,
  derivePackageStats,
  isPreviewVideoPath,
  isSampleHistoryEntry,
  isVideoPath,
  mediaFamilyKeyFromName,
  normalizeSourceUrlForKey,
  packageVideoPathForReview,
  reviewDisplayTitle,
  reviewMediaFamilyKey,
  shortInputLabel,
  sourceUrlForKey
} from "./lib/packageStats";
import type { Translator } from "./lib/types";
import {
  type Cue,
  type TimedWord,
  formatClock,
  inferTimedWords,
  shouldUseCompactWordSpacing,
  withTimedWords,
  wordProgressForTime
} from "./lib/lyrics";
import { StageChain, clampProgress, type StageProgress } from "./components/StageChain";
import { LiveJobStatus } from "./components/LiveJobStatus";
import { HeaderJobStatusPill } from "./components/HeaderJobStatusPill";
import { UrlPreviewCard, type UrlPreviewLoadState } from "./components/UrlPreviewCard";
import { useActiveJobStream } from "./lib/jobStream";
import { FloatingBottomNav, type AppNavTarget } from "./components/FloatingBottomNav";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { NotificationToaster } from "./components/NotificationToaster";
import { useNotifications, type NotificationAction } from "./lib/notifications";
import { RoomRemoteDrawer } from "./components/RoomRemoteDrawer";
import { RoomSetlistPanel } from "./components/RoomSetlistPanel";
import { IntroSplash, shouldShowIntroSplash } from "./components/IntroSplash";
import {
  classifyCaptureInput,
  isHttpInput,
  mergeMediaSearchResults,
  normalizeCaptureInput,
  SHORT_CLIP_MAX_SEC
} from "./lib/captureInput";
import { SettingsPanel, HF_TOKEN_FIELD_ID, SEPARATOR_MODEL_DIR_FIELD_ID } from "./components/SettingsPanel";
import { PackageBadges } from "./components/PackageBadges";
import { FeaturedPackageCard } from "./components/FeaturedPackageCard";
import { ProcessedResourceCard } from "./components/ProcessedResourceCard";
import { ScriptReview } from "./components/ScriptReview";
import { FilesReview } from "./components/FilesReview";
import { KaraokeReview } from "./components/KaraokeReview";
import { type LyricEffect, type LyricFont } from "./components/KaraokeLyricLine";
import {
  type AudioInputDevice,
  type MicrophoneMonitorController
} from "./components/MicrophoneMonitorPanel";
import { LyricsReviewScene } from "./scenes/LyricsReviewScene";
import { KaraokeRoomScene } from "./scenes/KaraokeRoomScene";
import { cn } from "./lib/cn";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import { Eyebrow } from "./components/ui/Eyebrow";
import { Field } from "./components/ui/Field";
import { Checkbox } from "./components/ui/Checkbox";
import { SegmentedControl } from "./components/ui/SegmentedControl";
import { Icon } from "./components/ui/Icon";

const CAPTURE_SCOPE_BARS = [
  28, 46, 62, 38, 74, 52, 88, 40, 66, 54, 78, 34, 70, 48, 92, 36, 60, 44, 82, 50, 68, 42, 76, 58, 84, 32, 64, 56, 90, 46, 72,
  38, 80, 52, 66, 44, 86, 48, 70, 40, 76, 54, 62, 36, 88, 50, 68, 42
] as const;

interface ProcessedResourceCardEntryProps {
  entry: SavedJobHistory;
  onEnter: () => void;
  onReview: () => void;
  onDelete: () => void;
}

function ProcessedResourceCardEntry({ entry, onEnter, onReview, onDelete }: ProcessedResourceCardEntryProps) {
  const title = reviewDisplayTitle(entry);
  const canEnter = Boolean(entry.playbackBundle.controllable && entry.primarySubtitle);
  const isSample = isSampleHistoryEntry(entry);
  const hasStems = entry.assets.some(
    (asset) => asset.exists && asset.role === "backing"
  );
  const hasLyrics = Boolean(entry.primarySubtitle);
  const coverPath =
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath)
      ? entry.playbackBundle.localVideoPath
      : null);
  const coverUrl = useMediaUrl(coverPath) || null;
  return (
    <ProcessedResourceCard
      title={title}
      canEnter={canEnter}
      isSample={isSample}
      hasStems={hasStems}
      hasLyrics={hasLyrics}
      playbackSummary={playbackSummary(entry.playbackBundle)}
      coverUrl={coverUrl}
      onEnter={onEnter}
      onReview={onReview}
      onDelete={onDelete}
    />
  );
}

interface FeaturedPackageEntryProps {
  entry: SavedJobHistory;
  variant: "continue" | "sample";
  onEnter: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

function FeaturedPackageEntry({ entry, variant, onEnter, onOpen, onDelete }: FeaturedPackageEntryProps) {
  const title = reviewDisplayTitle(entry);
  const canEnter = Boolean(entry.playbackBundle.controllable && entry.primarySubtitle);
  const coverPath =
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath)
      ? entry.playbackBundle.localVideoPath
      : null);
  const coverUrl = useMediaUrl(coverPath) || null;
  return (
    <FeaturedPackageCard
      entry={entry}
      variant={variant}
      onEnter={onEnter}
      onOpen={onOpen}
      onDelete={onDelete}
      title={title}
      canEnter={canEnter}
      coverUrl={coverUrl}
      playbackSummary={playbackSummary(entry.playbackBundle)}
    />
  );
}

declare global {
  interface Window {
    audioWorkflow?: AudioWorkflowApi;
  }
}

type JobStatus = "idle" | "running" | "complete" | "failed" | "canceled";
type ReviewTab = "karaoke" | "script" | "files";
type AppScene = "workspace" | "lyrics-review" | "karaoke-room";

type TrackRole = "original" | "backing" | "vocal" | "custom";

interface JobRecord {
  id: string;
  input: string;
  status: JobStatus;
  startedAt: string;
  result?: JobResult;
}

interface TrackAssets {
  original: GeneratedAsset | null;
  backing: GeneratedAsset | null;
  vocal: GeneratedAsset | null;
}

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

const allFormats: OutputFormat[] = ["lrc", "srt", "vtt", "txt", "json", "ass"];
const hasNativeAudioWorkflow = Boolean(window.audioWorkflow);
const httpAudioWorkflow = createHttpAudioWorkflowApi();
const audioWorkflow: AudioWorkflowApi = {
  ...httpAudioWorkflow,
  ...window.audioWorkflow,
  youtubeSearch: window.audioWorkflow?.youtubeSearch ?? httpAudioWorkflow.youtubeSearch,
  bilibiliSearch: window.audioWorkflow?.bilibiliSearch ?? httpAudioWorkflow.bilibiliSearch,
  getRoomStatus: window.audioWorkflow?.getRoomStatus ?? httpAudioWorkflow.getRoomStatus,
  enqueueRoomSong: window.audioWorkflow?.enqueueRoomSong ?? httpAudioWorkflow.enqueueRoomSong,
  startRoomQueueItem: window.audioWorkflow?.startRoomQueueItem ?? httpAudioWorkflow.startRoomQueueItem,
  finishRoomQueueItem: window.audioWorkflow?.finishRoomQueueItem ?? httpAudioWorkflow.finishRoomQueueItem,
  removeRoomQueueItem: window.audioWorkflow?.removeRoomQueueItem ?? httpAudioWorkflow.removeRoomQueueItem,
  clearRoomQueue: window.audioWorkflow?.clearRoomQueue ?? httpAudioWorkflow.clearRoomQueue,
  getSystemLocale: window.audioWorkflow?.getSystemLocale ?? httpAudioWorkflow.getSystemLocale,
  getSettings: window.audioWorkflow?.getSettings ?? httpAudioWorkflow.getSettings,
  setSettings: window.audioWorkflow?.setSettings ?? httpAudioWorkflow.setSettings
};

const defaultOptions: JobOptions = {
  input: "",
  workflowMode: "karaoke",
  outputDir: "",
  subtitleSource: "auto",
  localFallback: true,
  separate: true,
  saveAudio: false,
  keepPlatformSubs: false,
  simplifiedChinese: true,
  model: "small",
  language: "",
  subLangs: "",
  browser: "",
  cookies: "",
  formats: ["lrc"]
};

function isAccentColor(value: unknown): value is AccentColor {
  return value === "sage" || value === "slate" || value === "ink" || value === "clay";
}

function normalizeAccentColor(value: unknown): AccentColor {
  if (isAccentColor(value)) return value;
  if (value === "green") return "sage";
  if (value === "lime") return "slate";
  if (value === "mint") return "ink";
  if (value === "teal") return "clay";
  return "sage";
}

function reasonToCamelCase(reason: JobErrorReason): string {
  return reason.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function setupCommandForReason(reason: JobErrorReason): string {
  switch (reason) {
    case "model_missing":
      return "pip install --upgrade faster-whisper";
    case "separator_missing":
      return "pip install --upgrade 'audio-separator[cpu]'";
    case "ffmpeg_missing":
      return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
        ? "brew install ffmpeg"
        : "Install ffmpeg from https://ffmpeg.org/download.html";
    case "ytdlp_missing":
      return "pip install --upgrade yt-dlp";
    default:
      return "";
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function createHttpAudioWorkflowApi(): AudioWorkflowApi {
  const baseUrl = "http://127.0.0.1:5175";
  const readFallbackSettings = (): UserSettings => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem("vocalflow.settings") ?? "{}") as Partial<UserSettings>;
      return {
        locale: parsed.locale === "en" || parsed.locale === "zh" ? parsed.locale : null,
        themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" || parsed.themeMode === "system" ? parsed.themeMode : "light",
        accentColor: normalizeAccentColor(parsed.accentColor),
        hfToken: typeof parsed.hfToken === "string" && parsed.hfToken.trim() ? parsed.hfToken.trim() : null,
        hfEndpoint:
          typeof parsed.hfEndpoint === "string" && parsed.hfEndpoint.trim()
            ? parsed.hfEndpoint.trim().replace(/\/+$/, "")
            : null,
        separatorModelDir:
          typeof parsed.separatorModelDir === "string" && parsed.separatorModelDir.trim()
            ? parsed.separatorModelDir.trim()
            : null
      };
    } catch {
      return {
        locale: null,
        themeMode: "light",
        accentColor: "sage",
        hfToken: null,
        hfEndpoint: null,
        separatorModelDir: null
      };
    }
  };

  return {
    selectInput: async () => null,
    selectOutputDir: async () => null,
    previewCommand: (options) => postJson<CommandPreview>(baseUrl, "/api/preview-command", { options }),
    runJob: (jobId, options) => postJson<JobResult>(baseUrl, "/api/run-job", { jobId, options }),
    cancelJob: (jobId) => postJson<boolean>(baseUrl, "/api/cancel-job", { jobId }),
    openPath: async (targetPath) => {
      await postJson<{ ok: true }>(baseUrl, "/api/open-path", { targetPath });
    },
    openExternalUrl: async (url) => {
      await postJson<{ ok: true }>(baseUrl, "/api/open-external-url", { url });
    },
    readTextFile: async (targetPath) => {
      const result = await postJson<{ content: string }>(baseUrl, "/api/read-text", { targetPath });
      return result.content;
    },
    writeTextFile: async (targetPath, content) => {
      await postJson<{ ok: true }>(baseUrl, "/api/write-text", { targetPath, content });
    },
    getMediaUrl: async (targetPath) => {
      const result = await postJson<{ url: string }>(baseUrl, "/api/media-url", { targetPath });
      return result.url;
    },
    listHistory: () => getJson<SavedJobHistory[]>(baseUrl, "/api/history"),
    removeHistory: (historyId) => deleteJson<SavedJobHistory[]>(baseUrl, `/api/history/${encodeURIComponent(historyId)}`),
    onJobLog: (callback) => {
      const source = new EventSource(`${baseUrl}/api/logs`);
      source.addEventListener("log", (event) => {
        callback(JSON.parse((event as MessageEvent<string>).data));
      });
      return () => source.close();
    },
    youtubeSearch: (query, opts) =>
      postJson<YoutubeSearchResult[]>(baseUrl, "/api/youtube-search", {
        query,
        appendKaraoke: opts?.appendKaraoke ?? false
      }),
    bilibiliSearch: (query, opts) =>
      postJson<YoutubeSearchResult[]>(baseUrl, "/api/bilibili-search", {
        query,
        appendKaraoke: opts?.appendKaraoke ?? false
      }),
    getRoomStatus: () => getJson<RoomStatus>(baseUrl, "/api/room/status"),
    enqueueRoomSong: (input, title, requestedBy) => postJson<RoomStatus>(baseUrl, "/api/room/enqueue", { input, title, requestedBy }),
    startRoomQueueItem: (itemId) => postJson<RoomStatus>(baseUrl, "/api/room/start-item", { itemId }),
    finishRoomQueueItem: (itemId, status, resultHistoryId, error) =>
      postJson<RoomStatus>(baseUrl, "/api/room/finish-item", { itemId, status, resultHistoryId, error }),
    removeRoomQueueItem: (itemId) => postJson<RoomStatus>(baseUrl, "/api/room/remove-item", { itemId }),
    clearRoomQueue: () => postJson<RoomStatus>(baseUrl, "/api/room/clear", {}),
    getSystemLocale: async () => window.navigator.language || "en-US",
    getSettings: async () => readFallbackSettings(),
    setSettings: async (patch) => {
      const next = { ...readFallbackSettings(), ...patch };
      window.localStorage.setItem("vocalflow.settings", JSON.stringify(next));
      return next;
    }
  };
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  return requestJson<T>(`${baseUrl}${path}`);
}

async function deleteJson<T>(baseUrl: string, path: string): Promise<T> {
  return requestJson<T>(`${baseUrl}${path}`, { method: "DELETE" });
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return requestJson<T>(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export default function App() {
  const { t, i18n } = useTranslation();
  const liveJob = useActiveJobStream();
  const currentLocale = (i18n.resolvedLanguage ?? i18n.language ?? "en") as AppLocale;
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [accentColor, setAccentColor] = useState<AccentColor>("sage");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hfToken, setHfToken] = useState<string | null>(null);
  const [hfEndpoint, setHfEndpoint] = useState<string | null>(null);
  const [separatorModelDir, setSeparatorModelDir] = useState<string | null>(null);
  const [uvrDetection, setUvrDetection] = useState<UvrDetectionResult | null>(null);
  const [options, setOptions] = useState<JobOptions>(defaultOptions);
  const [preview, setPreview] = useState<CommandPreview | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [history, setHistory] = useState<SavedJobHistory[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const logsRef = useRef("");
  const [statusMessage, setStatusMessage] = useState<string>(() => t("common:status.ready"));
  const [appScene, setAppScene] = useState<AppScene>("workspace");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("karaoke");
  const [trackRole, setTrackRole] = useState<TrackRole>("backing");
  const [selectedSubtitlePath, setSelectedSubtitlePath] = useState("");
  const [selectedMediaPath, setSelectedMediaPath] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [wordTimingText, setWordTimingText] = useState("");
  const [scriptStatus, setScriptStatus] = useState("");
  const [lyricEffect, setLyricEffect] = useState<LyricEffect>("sweep");
  const [lyricFont, setLyricFont] = useState<LyricFont>("rounded");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [captureOptionsOpen, setCaptureOptionsOpen] = useState(false);
  const [showIntroSplash, setShowIntroSplash] = useState(() => shouldShowIntroSplash());
  const [workspaceMode, setWorkspaceMode] = useState<"home" | "add" | "karaoke">("home");
  const [setlistOrder, setSetlistOrder] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("vocalflow.setlistOrder");
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [youtubeAppendKaraoke, setYoutubeAppendKaraoke] = useState(false);
  const [youtubeResults, setYoutubeResults] = useState<YoutubeSearchResult[]>([]);
  const [youtubeSearching, setYoutubeSearching] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomMessage, setRoomMessage] = useState("");
  const [roomQrDataUrl, setRoomQrDataUrl] = useState("");
  const [progressStages, setProgressStages] = useState<Map<string, StageProgress>>(() => new Map());
  const [roomDrawerOpen, setRoomDrawerOpen] = useState(false);
  const [urlPreview, setUrlPreview] = useState<UrlMetadataPreview | null>(null);
  const [urlPreviewState, setUrlPreviewState] = useState<UrlPreviewLoadState>("idle");
  const previewRequestIdRef = useRef(0);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const handledEndedCountRef = useRef(0);
  const autoplayPackageIdRef = useRef<string | null>(null);

  const { push: pushNotification } = useNotifications();
  const tRef = useRef(t);
  tRef.current = t;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const progressStagesRef = useRef(progressStages);
  progressStagesRef.current = progressStages;
  const failedEventJobIdsRef = useRef<Set<string>>(new Set());
  const runJobRef = useRef<((overrides?: Partial<JobOptions>) => Promise<JobResult | null>) | null>(null);

  const activeJob = useMemo(
    () => (activeJobId ? jobs.find((job) => job.id === activeJobId) ?? null : selectedHistoryId ? null : jobs[0] ?? null),
    [activeJobId, jobs, selectedHistoryId]
  );
  const runningJob = useMemo(() => jobs.find((job) => job.status === "running") ?? null, [jobs]);
  const selectedHistory = useMemo(
    () => history.find((entry) => entry.id === selectedHistoryId) ?? null,
    [history, selectedHistoryId]
  );
  const activeReview = selectedHistory ?? activeJob?.result?.historyEntry ?? null;
  const subtitleAssets = useMemo(() => scopeSubtitleAssetsToReview(activeReview, activeReview?.assets.filter((asset) => asset.type === "subtitle") ?? []), [activeReview]);
  const playableAssets = useMemo(
    () => activeReview?.assets.filter((asset) => (asset.type === "media" || asset.type === "stem") && asset.exists) ?? [],
    [activeReview]
  );
  const playbackAssets = useMemo(() => scopePlayableAssetsToReview(activeReview, playableAssets), [activeReview, playableAssets]);
  const trackAssets = useMemo(() => buildTrackAssets(playbackAssets), [playbackAssets]);
  const playbackBundle = useMemo(() => activeReview?.playbackBundle ?? null, [activeReview]);
  const packageVideoPath = useMemo(() => packageVideoPathForReview(activeReview), [activeReview]);
  // Online MV stage backdrop: when the package has no local video but came
  // from a URL, resolve a direct stream URL on room entry so the muted MV
  // can play over the backing-stem audio. Resolved URLs expire after a few
  // hours, so this is per-session state and never persisted.
  const [onlineMvUrl, setOnlineMvUrl] = useState("");
  const onlineMvSourceUrl = playbackBundle?.sourceUrl ?? null;
  useEffect(() => {
    let ignore = false;
    setOnlineMvUrl("");
    if (appScene !== "karaoke-room" || !onlineMvSourceUrl || packageVideoPath || !audioWorkflow.resolveStreamUrl) {
      return;
    }
    audioWorkflow
      .resolveStreamUrl(onlineMvSourceUrl)
      .then((url) => {
        if (!ignore && url) {
          setOnlineMvUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [appScene, onlineMvSourceUrl, packageVideoPath]);
  const previewVideoPath =
    packageVideoPath && packageVideoPath !== selectedMediaPath ? packageVideoPath : onlineMvUrl || null;
  const playbackController = usePlaybackController(selectedMediaPath, previewVideoPath);
  const microphoneMonitor = useMicrophoneMonitor();
  const wordTimingSubtitlePath = useMemo(() => bestWordTimingSubtitlePath(selectedSubtitlePath, subtitleAssets), [selectedSubtitlePath, subtitleAssets]);
  const cues = useMemo(() => {
    const primaryCues = parseSubtitleFile(selectedSubtitlePath, scriptText);
    if (wordTimingSubtitlePath && wordTimingSubtitlePath !== selectedSubtitlePath && wordTimingText.trim()) {
      const wordTimingCues = parseSubtitleFile(wordTimingSubtitlePath, wordTimingText);
      return wordTimingCues.length > 0 ? wordTimingCues : primaryCues;
    }
    return primaryCues;
  }, [scriptText, selectedSubtitlePath, wordTimingSubtitlePath, wordTimingText]);
  const activeCueIndex = useMemo(() => findActiveCue(cues, playbackController.currentTime), [cues, playbackController.currentTime]);
  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;
  const isRunning = Boolean(runningJob);
  const autoSavesAudio = shouldAutoSaveAudio(options);
  const activeReviewTitle = activeReview ? reviewDisplayTitle(activeReview) : "";
  const stats = useMemo(() => derivePackageStats(history), [history]);
  const karaokePackages = useMemo(
    () => Array.from(stats.byKey.values()).map((group) => group.entry),
    [stats]
  );
  const orderedKaraokePackages = useMemo(() => {
    const byId = new Map(karaokePackages.map((entry) => [entry.id, entry]));
    const ordered: SavedJobHistory[] = [];
    for (const id of setlistOrder) {
      const entry = byId.get(id);
      if (entry) {
        ordered.push(entry);
        byId.delete(id);
      }
    }
    for (const entry of karaokePackages) {
      if (byId.has(entry.id)) {
        ordered.push(entry);
      }
    }
    return ordered;
  }, [karaokePackages, setlistOrder]);
  const roomSetlistItems = useMemo(
    () =>
      orderedKaraokePackages.map((entry) => ({
        entry,
        title: reviewDisplayTitle(entry),
        ready: Boolean(entry.workflowMode === "karaoke" && entry.playbackBundle.controllable && entry.primarySubtitle)
      })),
    [orderedKaraokePackages]
  );
  const featuredVariant: "continue" | "sample" =
    stats.featured && !isSampleHistoryEntry(stats.featured.entry) ? "continue" : "sample";
  const cachedPackageForInput = useMemo(() => {
    const sourceUrl = sourceUrlForKey(options.input);
    if (!sourceUrl) {
      return null;
    }
    const key = normalizeSourceUrlForKey(sourceUrl);
    return (
      history.find((entry) => {
        if (isSampleHistoryEntry(entry)) {
          return false;
        }
        const entryUrl = entry.sourceUrl || sourceUrlForKey(entry.input);
        return entryUrl ? normalizeSourceUrlForKey(entryUrl) === key : false;
      }) ?? null
    );
  }, [history, options.input]);
  const roomQueue = roomStatus?.queue ?? [];
  const nextRoomRequest = roomQueue.find((item) => item.status === "queued") ?? null;
  const showWorkspace = Boolean(
    workspaceMode !== "karaoke" && (activeReview || jobs.length > 0 || advancedOpen || workspaceMode === "add")
  );
  const showActivityPane = Boolean(jobs.length > 0 || advancedOpen);
  const effectiveTheme = themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  const currentNavTarget: AppNavTarget =
    appScene === "karaoke-room" || appScene === "lyrics-review" ? "karaoke" : workspaceMode;
  const canEnterActiveStage = Boolean(
    activeReview?.workflowMode === "karaoke" && activeReview.playbackBundle.controllable && selectedSubtitlePath
  );

  useEffect(() => {
    try {
      window.localStorage.setItem("vocalflow.setlistOrder", JSON.stringify(setlistOrder));
    } catch {
      // ignore quota / private mode failures
    }
  }, [setlistOrder]);

  useEffect(() => {
    audioWorkflow
      .listHistory()
      .then(setHistory)
      .catch((error: Error) => {
        if (hasNativeAudioWorkflow) {
          setStatusMessage(error.message);
        }
      });
  }, []);

  useEffect(() => {
    void hydrateLocaleFromHost(audioWorkflow);
  }, []);

  useEffect(() => {
    let ignore = false;
    audioWorkflow
      .getSettings?.()
      .then((settings) => {
        if (ignore) {
          return;
        }
        setThemeMode(settings?.themeMode ?? "light");
        setAccentColor(normalizeAccentColor(settings?.accentColor));
        setHfToken(settings?.hfToken ?? null);
        setHfEndpoint(settings?.hfEndpoint ?? null);
        setSeparatorModelDir(settings?.separatorModelDir ?? null);
      })
      .catch(() => undefined);
    // Run UVR detection on first render so we can show the auto-link
    // badge in Settings without forcing the user to hit "Re-detect"
    // manually. Detection is cheap (filesystem-only) and idempotent.
    audioWorkflow
      .detectUvr?.()
      .then((payload) => {
        if (ignore || !payload) {
          return;
        }
        setUvrDetection(payload);
        if (payload.appliedToSettings && payload.currentSeparatorModelDir) {
          setSeparatorModelDir(payload.currentSeparatorModelDir);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) {
      setSystemPrefersDark(false);
      return;
    }
    const update = () => setSystemPrefersDark(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  const handleLanguageChange = useCallback(
    async (nextLocale: AppLocale) => {
      if (nextLocale === currentLocale) {
        return;
      }
      try {
        await setAppLocale(nextLocale, audioWorkflow);
      } catch {
        // Locale is best-effort; renderer keeps current language on failure.
      }
    },
    [currentLocale]
  );

  const handleThemeModeChange = useCallback(async (nextThemeMode: ThemeMode) => {
    setThemeMode(nextThemeMode);
    try {
      await audioWorkflow.setSettings?.({ themeMode: nextThemeMode });
    } catch {
      // Theme still updates for this session.
    }
  }, []);

  const handleAccentColorChange = useCallback(async (nextAccentColor: AccentColor) => {
    setAccentColor(nextAccentColor);
    try {
      await audioWorkflow.setSettings?.({ accentColor: nextAccentColor });
    } catch {
      // Accent still updates for this session.
    }
  }, []);

  const handleHfTokenChange = useCallback(async (nextToken: string | null) => {
    setHfToken(nextToken);
    try {
      await audioWorkflow.setSettings?.({ hfToken: nextToken });
    } catch {
      // Token still updates for this session.
    }
  }, []);

  const handleHfEndpointChange = useCallback(async (nextEndpoint: string | null) => {
    setHfEndpoint(nextEndpoint);
    try {
      await audioWorkflow.setSettings?.({ hfEndpoint: nextEndpoint });
    } catch {
      // Endpoint still updates for this session.
    }
  }, []);

  const handleSeparatorModelDirChange = useCallback(async (nextDir: string | null) => {
    setSeparatorModelDir(nextDir);
    try {
      await audioWorkflow.setSettings?.({ separatorModelDir: nextDir });
    } catch {
      // Dir still updates for this session.
    }
  }, []);

  const handlePickFolder = useCallback(async (): Promise<string | null> => {
    if (!audioWorkflow.selectFolder) {
      return null;
    }
    try {
      return await audioWorkflow.selectFolder();
    } catch {
      return null;
    }
  }, []);

  const handleRedetectUvr = useCallback(async (): Promise<UvrDetectionResult | null> => {
    if (!audioWorkflow.detectUvr) {
      return null;
    }
    try {
      const payload = await audioWorkflow.detectUvr();
      if (payload) {
        setUvrDetection(payload);
        if (payload.appliedToSettings && payload.currentSeparatorModelDir) {
          setSeparatorModelDir(payload.currentSeparatorModelDir);
        }
      }
      return payload;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const refresh = () => {
      audioWorkflow
        .getRoomStatus()
        .then((nextStatus) => {
          if (!ignore) {
            setRoomStatus(nextStatus);
          }
        })
        .catch((error: Error) => {
          if (!ignore) {
            setRoomMessage(error.message);
          }
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!roomStatus?.remoteUrl) {
      setRoomQrDataUrl("");
      return;
    }
    QRCode.toDataURL(roomStatus.remoteUrl, {
      color: {
        dark: "#11120e",
        light: "#ffffff"
      },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220
    })
      .then((url) => {
        if (!ignore) {
          setRoomQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!ignore) {
          setRoomQrDataUrl("");
        }
      });
    return () => {
      ignore = true;
    };
  }, [roomStatus?.remoteUrl]);

  useEffect(() => {
    const stopListening = audioWorkflow.onJobLog((log) => {
      setLogs((current) => {
        const next = current + log.chunk;
        logsRef.current = next;
        return next;
      });
    });
    return stopListening;
  }, []);

  useEffect(() => {
    const stop = audioWorkflow.onJobProgress?.((event: JobProgressStage) => {
      setProgressStages((current) => {
        const next = new Map(current);
        const existing = next.get(event.name);
        next.set(event.name, {
          name: event.name,
          progress: clampProgress(event.progress >= 0 ? event.progress : existing?.progress ?? 0),
          message: event.message ?? existing?.message,
          done: event.done ?? existing?.done ?? false,
          failed: event.failed ?? existing?.failed ?? false
        });
        return next;
      });
    });
    return () => {
      if (stop) {
        stop();
      }
    };
  }, []);

  const openSettingsToField = useCallback((fieldId: string) => {
    setSettingsOpen(true);
    // Wait for the settings drawer animation (motion-duration ~ 220ms) before
    // attempting to scroll/focus, otherwise the input is still hidden by the
    // initial transform and `scrollIntoView` does nothing.
    window.setTimeout(() => {
      const target = document.getElementById(fieldId);
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }, 280);
  }, []);
  const openSettingsToHfToken = useCallback(
    () => openSettingsToField(HF_TOKEN_FIELD_ID),
    [openSettingsToField]
  );
  const openSettingsToSeparatorModelDir = useCallback(
    () => openSettingsToField(SEPARATOR_MODEL_DIR_FIELD_ID),
    [openSettingsToField]
  );

  useEffect(() => {
    const stop = audioWorkflow.onJobFailed?.((event: JobFailedEvent) => {
      // User-initiated cancellations are not failures from the user's POV.
      if (event.reason === "canceled") {
        return;
      }
      failedEventJobIdsRef.current.add(event.jobId);
      window.setTimeout(() => failedEventJobIdsRef.current.delete(event.jobId), 2000);

      const reasonKey = reasonToCamelCase(event.reason);
      const tNow = tRef.current;
      const title = tNow(`capture:error.${reasonKey}.title`);
      const body = tNow(`capture:error.${reasonKey}.body`);
      const actions: NotificationAction[] = [];
      for (const action of event.hint?.actions ?? []) {
        actions.push({
          id: action.id,
          label: tNow(action.labelKey),
          onClick: () => {
            const tHandler = tRef.current;
            switch (action.id) {
              case "openAdvancedCookies":
                setAdvancedOpen(true);
                break;
              case "enableLocalFallback":
                setOptions((current) => ({ ...current, subtitleSource: "local", localFallback: true }));
                runJobRef.current?.({ subtitleSource: "local", localFallback: true });
                break;
              case "disableSeparation":
                // One-shot recovery: re-run THIS job without separation, but
                // leave the checkbox checked so the next paste defaults back
                // to "create backing" (the normal karaoke default). The disable
                // toast is for when separation flaked once, not a permanent
                // preference change).
                runJobRef.current?.({ separate: false });
                break;
              case "retry":
                runJobRef.current?.();
                break;
              case "waitAndRetry":
                // informational — the toast itself is the acknowledgement
                break;
              case "copySetupCommand": {
                const cmd = setupCommandForReason(event.reason);
                void copyToClipboard(cmd).then((ok) => {
                  if (ok) {
                    pushNotification({
                      level: "info",
                      title: tHandler("capture:error.copySuccess.command"),
                      ttlMs: 3000
                    });
                  }
                });
                break;
              }
              case "openOutputFolder": {
                const target = optionsRef.current.outputDir || "";
                if (target) {
                  void audioWorkflow.openPath(target);
                }
                break;
              }
              case "copyLog": {
                void copyToClipboard(logsRef.current).then((ok) => {
                  if (ok) {
                    pushNotification({
                      level: "info",
                      title: tHandler("capture:error.copySuccess.log"),
                      ttlMs: 3000
                    });
                  }
                });
                break;
              }
              case "openHfTokenSettings":
                openSettingsToHfToken();
                break;
              case "openSeparatorModelDirSettings":
                openSettingsToSeparatorModelDir();
                break;
            }
          }
        });
      }
      pushNotification({
        id: `job-failed-${event.jobId}`,
        level: "error",
        title,
        body,
        actions,
        jobId: event.jobId
      });
    });
    return () => {
      if (stop) {
        stop();
      }
    };
  }, [pushNotification]);

  const warnedStageKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!liveJob || liveJob.failedStages.length === 0) {
      return;
    }
    const tNow = tRef.current;
    for (const stage of liveJob.failedStages) {
      const key = `${liveJob.jobId}:${stage}`;
      if (warnedStageKeysRef.current.has(key)) {
        continue;
      }
      warnedStageKeysRef.current.add(key);
      // Today only `separation` has an actionable mid-flight recovery; other
      // stage failures (when the CLI keeps going) reach the user via the
      // success/warning toast at job end. Extend this switch when more
      // non-fatal stages land.
      if (stage !== "separation") {
        continue;
      }
      const actions: NotificationAction[] = [
        {
          id: "disableSeparation",
          label: tNow("capture:error.action.disableSeparation"),
          onClick: () => {
            // One-shot retry without separation. Don't mutate `options` so
            // the checkbox stays in its user-chosen state for the next run.
            runJobRef.current?.({ separate: false });
          }
        },
        {
          id: "copySetupCommand",
          label: tNow("capture:error.action.copySetupCommand"),
          onClick: () => {
            const cmd = setupCommandForReason("separator_missing");
            void copyToClipboard(cmd).then((ok) => {
              if (ok) {
                pushNotification({
                  level: "info",
                  title: tRef.current("capture:error.copySuccess.command"),
                  ttlMs: 3000
                });
              }
            });
          }
        },
        {
          id: "copyLog",
          label: tNow("capture:error.action.copyLog"),
          onClick: () => {
            void copyToClipboard(logsRef.current).then((ok) => {
              if (ok) {
                pushNotification({
                  level: "info",
                  title: tRef.current("capture:error.copySuccess.log"),
                  ttlMs: 3000
                });
              }
            });
          }
        }
      ];
      pushNotification({
        id: `stage-warn-${liveJob.jobId}-${stage}`,
        level: "warning",
        title: tNow("capture:warn.separationSkipped.title"),
        body: tNow("capture:warn.separationSkipped.body"),
        actions,
        jobId: liveJob.jobId
      });
    }
  }, [liveJob, pushNotification]);

  useEffect(() => {
    let ignore = false;

    if (!options.input.trim()) {
      setPreview(null);
      return;
    }

    audioWorkflow
      .previewCommand(options)
      .then((nextPreview) => {
        if (!ignore) {
          setPreview(nextPreview);
        }
      })
      .catch((error: Error) => {
        if (!ignore) {
          setPreview(null);
          setStatusMessage(error.message);
        }
      });

    return () => {
      ignore = true;
    };
  }, [options]);

  useEffect(() => {
    const nextSubtitle = selectReviewSubtitlePath(activeReview, subtitleAssets);
    const nextRole: TrackRole = trackAssets.backing ? "backing" : trackAssets.original ? "original" : "custom";
    const nextMedia =
      nextRole === "custom"
        ? playbackBundle?.localAudioPath ?? playbackBundle?.localVideoPath ?? activeReview?.primaryMedia ?? playbackAssets[0]?.path ?? ""
        : trackAssets[nextRole]?.path ?? "";
    setSelectedSubtitlePath(nextSubtitle);
    setSelectedMediaPath(nextMedia);
    setTrackRole(nextRole);
    if (activeReview) {
      setReviewTab("karaoke");
    }
  }, [activeReview?.id, playbackAssets, playbackBundle, subtitleAssets, trackAssets]);

  useEffect(() => {
    if (trackRole === "custom") {
      return;
    }
    const asset = trackAssets[trackRole];
    if (asset) {
      setSelectedMediaPath(asset.path);
    }
  }, [trackRole, trackAssets]);

  useEffect(() => {
    let ignore = false;
    setScriptText("");
    setScriptStatus("");

    if (!selectedSubtitlePath) {
      return;
    }

    audioWorkflow
      .readTextFile(selectedSubtitlePath)
      .then((content) => {
        if (!ignore) {
          setScriptText(content);
          setScriptStatus(t("capture:script.status.loaded"));
        }
      })
      .catch((error: Error) => {
        if (!ignore) {
          setScriptStatus(error.message);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedSubtitlePath]);

  useEffect(() => {
    let ignore = false;

    if (!wordTimingSubtitlePath || wordTimingSubtitlePath === selectedSubtitlePath) {
      setWordTimingText("");
      return () => {
        ignore = true;
      };
    }

    audioWorkflow
      .readTextFile(wordTimingSubtitlePath)
      .then((content) => {
        if (!ignore) {
          setWordTimingText(content);
        }
      })
      .catch(() => {
        if (!ignore) {
          setWordTimingText("");
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedSubtitlePath, wordTimingSubtitlePath]);

  const captureInputKind = useMemo(() => classifyCaptureInput(options.input), [options.input]);
  const captureBusy = isRunning || youtubeSearching;
  const captureScopeProgress = useMemo(() => {
    if (youtubeSearching) {
      return 0.42;
    }
    if (!isRunning) {
      return options.input.trim() ? 0.08 : 0.03;
    }
    const stages = [...progressStages.values()];
    if (stages.length === 0) {
      return 0.12;
    }
    const done = stages.filter((stage) => stage.done || stage.failed).length;
    return Math.min(0.94, 0.12 + done / Math.max(stages.length, 1));
  }, [isRunning, options.input, progressStages, youtubeSearching]);
  const captureLcdReadout = useMemo(() => {
    if (cachedPackageForInput) {
      return reviewDisplayTitle(cachedPackageForInput).slice(0, 28);
    }
    if (urlPreview?.title) {
      return urlPreview.title.slice(0, 28);
    }
    const trimmed = options.input.trim();
    if (!trimmed) {
      return "STANDBY";
    }
    if (captureInputKind === "search") {
      return trimmed.slice(0, 28).toUpperCase();
    }
    try {
      return new URL(normalizeCaptureInput(trimmed)).hostname.replace(/^www\./, "").toUpperCase();
    } catch {
      return trimmed.slice(0, 28).toUpperCase();
    }
  }, [cachedPackageForInput, captureInputKind, options.input, urlPreview?.title]);
  const captureLcdStatus = youtubeSearching
    ? "SEARCH"
    : isRunning
      ? "RUN"
      : cachedPackageForInput
        ? "CACHE"
        : captureInputKind === "url"
          ? "LINK"
          : captureInputKind === "local"
            ? "FILE"
            : options.input.trim()
              ? "QUERY"
              : "READY";

  useEffect(() => {
    const trimmed = options.input.trim();
    const normalized = normalizeCaptureInput(trimmed);
    if (classifyCaptureInput(trimmed) !== "url") {
      setUrlPreview(null);
      setUrlPreviewState("idle");
      return;
    }
    if (!audioWorkflow.prefetchUrlMetadata) {
      return;
    }
    const requestId = ++previewRequestIdRef.current;
    setUrlPreviewState("loading");
    const handle = window.setTimeout(() => {
      audioWorkflow
        .prefetchUrlMetadata?.(normalized)
        .then((value) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }
          if (value) {
            setUrlPreview(value);
            setUrlPreviewState("loaded");
          } else {
            setUrlPreview(null);
            setUrlPreviewState("error");
          }
        })
        .catch(() => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }
          setUrlPreview(null);
          setUrlPreviewState("error");
        });
    }, 350);
    return () => {
      window.clearTimeout(handle);
    };
  }, [options.input]);

  function updateOptions(update: Partial<JobOptions>) {
    setOptions((current) => ({ ...current, ...update }));
  }

  function setWorkflowMode(workflowMode: WorkflowMode) {
    updateOptions({
      workflowMode,
      localFallback: workflowMode === "karaoke",
      separate: workflowMode === "karaoke",
      saveAudio: false,
      formats: workflowMode === "karaoke" ? ["lrc"] : ["srt"]
    });
  }

  async function chooseInput() {
    const selected = await audioWorkflow.selectInput();
    if (selected) {
      updateOptions({ input: selected });
    }
  }

  async function chooseOutputDir() {
    const selected = await audioWorkflow.selectOutputDir();
    if (selected) {
      updateOptions({ outputDir: selected });
    }
  }

  async function runUnifiedMediaSearch(queryOverride?: string) {
    const query = (queryOverride ?? options.input).trim();
    if (!query || classifyCaptureInput(query) !== "search") {
      return;
    }
    setYoutubeError("");
    setYoutubeSearching(true);
    setYoutubeResults([]);
    try {
      const searchOpts = { appendKaraoke: youtubeAppendKaraoke };
      const settled = await Promise.allSettled([
        audioWorkflow.youtubeSearch(query, searchOpts),
        audioWorkflow.bilibiliSearch(query, searchOpts)
      ]);
      const youtubeRows = settled[0].status === "fulfilled" ? settled[0].value : [];
      const bilibiliRows = settled[1].status === "fulfilled" ? settled[1].value : [];
      const merged = mergeMediaSearchResults([youtubeRows, bilibiliRows]);
      setYoutubeResults(merged);
      if (!merged.length) {
        if (settled.every((result) => result.status === "rejected")) {
          const firstError = settled.find((result) => result.status === "rejected");
          setYoutubeError(
            firstError && firstError.status === "rejected" && firstError.reason instanceof Error
              ? firstError.reason.message
              : t("capture:search.failedBoth")
          );
        } else {
          setYoutubeError(t("capture:search.noResults"));
        }
      } else {
        window.setTimeout(() => {
          document.getElementById("mediaSearchResults")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    } catch (error) {
      setYoutubeResults([]);
      setYoutubeError(error instanceof Error ? error.message : t("capture:search.failedBoth"));
    } finally {
      setYoutubeSearching(false);
    }
  }

  function submitCaptureInput() {
    if (!options.input.trim() || isRunning) {
      return;
    }
    if (cachedPackageForInput) {
      openCachedInputPackage();
      return;
    }
    if (captureInputKind === "search") {
      void runUnifiedMediaSearch();
      return;
    }
    const normalized = normalizeCaptureInput(options.input);
    if (normalized !== options.input.trim()) {
      updateOptions({ input: normalized });
    }
    void runJob({ input: normalized });
    window.setTimeout(() => {
      document.getElementById("captureStatus")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  function applyYoutubeResult(row: YoutubeSearchResult, andProcess = false) {
    updateOptions({ input: row.url });
    setYoutubeError("");
    setWorkspaceMode("add");
    if (andProcess && !isRunning) {
      window.setTimeout(() => {
        void runJobRef.current?.({ input: row.url });
        window.setTimeout(() => {
          document.getElementById("captureStatus")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }, 0);
    } else {
      window.setTimeout(() => captureInputRef.current?.focus(), 0);
    }
  }

  function openCachedInputPackage() {
    if (!cachedPackageForInput) {
      return;
    }
    setSelectedHistoryId(cachedPackageForInput.id);
    setActiveJobId(null);
    setReviewTab("karaoke");
    setWorkspaceMode("home");
    setAppScene(cachedPackageForInput.workflowMode === "karaoke" ? "lyrics-review" : "workspace");
    setStatusMessage(t("capture:cache.openedExisting"));
  }

  function navigateHome() {
    setWorkspaceMode("home");
    setAppScene("workspace");
  }

  function navigateAdd() {
    setWorkspaceMode("add");
    setAppScene("workspace");
    window.setTimeout(() => captureInputRef.current?.focus(), 0);
  }

  function navigateKaraokeLobby() {
    setWorkspaceMode("karaoke");
    setAppScene("workspace");
  }

  function moveSetlistItem(historyId: string, direction: -1 | 1) {
    const ids = orderedKaraokePackages.map((entry) => entry.id);
    const index = ids.indexOf(historyId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
      return;
    }
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setSetlistOrder(next);
  }

  function enterKaraokeStage(historyId?: string) {
    const targetId =
      historyId ??
      (selectedHistoryId && orderedKaraokePackages.some((entry) => entry.id === selectedHistoryId)
        ? selectedHistoryId
        : orderedKaraokePackages.find((entry) => entry.playbackBundle.controllable && entry.primarySubtitle)?.id) ??
      orderedKaraokePackages[0]?.id;
    if (!targetId) {
      navigateKaraokeLobby();
      return;
    }
    const entry = history.find((item) => item.id === targetId) ?? orderedKaraokePackages.find((item) => item.id === targetId);
    if (!entry || entry.workflowMode !== "karaoke") {
      navigateKaraokeLobby();
      return;
    }
    if (!entry.playbackBundle.controllable || !entry.primarySubtitle) {
      selectHistoryEntry(entry.id);
      return;
    }
    enterKaraokeFromHistoryAndPlay(entry.id);
  }

  function handleFloatingKaraokeNav() {
    if (appScene === "karaoke-room") {
      return;
    }
    if (appScene === "lyrics-review" && canEnterActiveStage) {
      setReviewTab("karaoke");
      setAppScene("karaoke-room");
      return;
    }
    navigateKaraokeLobby();
  }

  const dockTitle =
    currentNavTarget === "add"
      ? t("common:dock.addTitle")
      : currentNavTarget === "karaoke"
        ? t("common:dock.karaokeTitle")
        : t("common:dock.homeTitle");
  const dockSubtitle =
    currentNavTarget === "add"
      ? options.input.trim() || t("common:dock.addEmpty")
      : currentNavTarget === "karaoke"
        ? activeReviewTitle || t("common:dock.karaokeEmpty")
        : activeReviewTitle || t("common:dock.homeEmpty");
  const dockAction =
    currentNavTarget === "karaoke"
      ? roomSetlistItems.some((item) => item.ready)
        ? t("common:dock.ready")
        : t("common:dock.needsPackage")
      : currentNavTarget === "add" && cachedPackageForInput
        ? t("common:dock.cached")
        : undefined;

  const floatingNav =
    appScene === "karaoke-room" || appScene === "lyrics-review" ? (
      <FloatingBottomNav
        active={currentNavTarget}
        karaokeDisabled={false}
        contextTitle={dockTitle}
        contextSubtitle={dockSubtitle}
        contextAction={dockAction}
        onHome={navigateHome}
        onAdd={navigateAdd}
        onKaraoke={handleFloatingKaraokeNav}
        t={t}
      />
    ) : null;

  function handleHeaderNav(target: AppNavTarget) {
    if (target === "home") {
      navigateHome();
      return;
    }
    if (target === "add") {
      navigateAdd();
      return;
    }
    // Room tab opens the setlist lobby — never jump straight onto Stage from Home/Add.
    // If already singing, keep the Stage; use playlist controls to change songs.
    if (appScene === "karaoke-room") {
      return;
    }
    navigateKaraokeLobby();
  }

  const studioChromeHeader = (
    <header className="brandHeader">
      <div className="brandLogo" aria-label={t("common:appName")}>
        <span className="brandLogoLine">
          <span className="brandLogoStrong">Vocal</span>
          <span className="brandLogoLight">Flow</span>
        </span>
        <span className="brandLogoMeta">{t("common:home.established")}</span>
      </div>

      <div className="brandHeaderNav">
        <SegmentedControl
          variant="pill"
          value={currentNavTarget}
          options={[
            ["home", t("common:nav.home")],
            ["add", t("common:nav.add")],
            ["karaoke", t("common:nav.karaoke")]
          ]}
          onChange={handleHeaderNav}
        />
      </div>

      <div className="brandHeaderActions">
        <HeaderJobStatusPill
          job={liveJob}
          t={t}
          onActivate={() => {
            if (appScene !== "workspace") {
              navigateAdd();
            }
            window.setTimeout(() => {
              const target = document.getElementById("captureStatus");
              if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 0);
          }}
        />
        <button
          className="brandIconButton"
          type="button"
          onClick={() => setRoomDrawerOpen((open) => !open)}
          aria-label={t("room:drawerToggle")}
          aria-expanded={roomDrawerOpen}
          aria-controls="vocalflow-room-drawer"
        >
          <Icon name="qr" />
          {roomQueue.length > 0 || roomStatus?.nowPlaying ? (
            <span className="brandIconStatusDot" aria-label={t("room:statusDot")} />
          ) : null}
        </button>
        <button
          className="brandIconButton"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("settings:button")}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );

  const studioOverlays = (
    <>
      <RoomRemoteDrawer
        open={roomDrawerOpen}
        onClose={() => setRoomDrawerOpen(false)}
        roomStatus={roomStatus}
        roomQrDataUrl={roomQrDataUrl}
        roomMessage={roomMessage}
        roomQueue={roomQueue}
        nextRoomRequest={nextRoomRequest}
        isRunning={isRunning}
        onCopyLink={copyRemoteRoomLink}
        onProcessItem={(item) => {
          void processRoomQueueItem(item);
        }}
        onRemoveItem={removeRoomItem}
        onClearQueue={clearRoomQueue}
        t={t}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        themeMode={themeMode}
        accentColor={accentColor}
        locale={currentLocale}
        hfToken={hfToken}
        hfEndpoint={hfEndpoint}
        separatorModelDir={separatorModelDir}
        uvrDetection={uvrDetection}
        onThemeModeChange={handleThemeModeChange}
        onAccentColorChange={handleAccentColorChange}
        onLocaleChange={handleLanguageChange}
        onHfTokenChange={handleHfTokenChange}
        onHfEndpointChange={handleHfEndpointChange}
        onSeparatorModelDirChange={handleSeparatorModelDirChange}
        onPickFolder={handlePickFolder}
        onRedetectUvr={handleRedetectUvr}
        t={t}
      />
    </>
  );

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const firstFile = event.dataTransfer.files.item(0) as (File & { path?: string }) | null;
    if (firstFile?.path) {
      updateOptions({ input: firstFile.path });
      setWorkspaceMode("add");
    }
  }

  async function runJob(overrides: Partial<JobOptions> = {}): Promise<JobResult | null> {
    const jobId = crypto.randomUUID();
    const runOptions = withPackageOutputDir({ ...options, ...overrides }, jobId, overrides);
    if (!runOptions.input.trim() || isRunning) {
      return null;
    }

    const nextJob: JobRecord = {
      id: jobId,
      input: runOptions.input,
      status: "running",
      startedAt: new Date().toLocaleTimeString()
    };

    // Activity column shows ONE card per distinct input. Retrying the
    // same URL/file replaces its prior `complete | failed | canceled`
    // card instead of appending — otherwise a flaky bilibili import that
    // takes 4 retries to succeed creates 4 stacked cards saying the same
    // title, which is exactly what the user complained about. We keep
    // genuinely-running jobs for *other* inputs (the IPC layer only
    // allows one in flight today, but we don't hardcode that here).
    const nextInputKey = runOptions.input.trim();
    setJobs((current) => [
      nextJob,
      ...current.filter((job) => {
        if (job.status === "running") {
          return job.input.trim() !== nextInputKey;
        }
        return job.input.trim() !== nextInputKey;
      })
    ]);
    setActiveJobId(jobId);
    setSelectedHistoryId(null);
    setWorkspaceMode("add");
    logsRef.current = "";
    setLogs("");
    setProgressStages(new Map());
    setStatusMessage(t("common:status.running"));

    try {
      const result = await audioWorkflow.runJob(jobId, runOptions);
      const nextStatus = statusFromResult(result);
      setJobs((current) =>
        current.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: nextStatus,
                result
              }
            : job
        )
      );
      if (result.historyEntry) {
        setHistory((current) => upsertHistoryEntry(current, result.historyEntry!));
        setSelectedHistoryId(result.historyEntry.id);
        setWorkspaceMode("home");
        setAppScene("workspace");
        setReviewTab(result.historyEntry.workflowMode === "karaoke" ? "karaoke" : "script");
      }
      const localizedFailure = nextStatus === "failed" ? localizeCliError(logsRef.current, t) : null;
      setStatusMessage(
        nextStatus === "complete"
          ? t("common:status.complete")
          : nextStatus === "canceled"
            ? t("common:status.canceled")
            : localizedFailure ?? t("common:status.failedWithCode", { code: result.exitCode ?? "?" })
      );

      if (nextStatus === "complete" && result.historyEntry) {
        // Surface a success toast — and warn when an enhancement stage was
        // silently skipped (e.g. backing creation falling back to original
        // source) so the user understands why their package lacks backing.
        const skippedStages: string[] = [];
        for (const [name, stage] of progressStagesRef.current.entries()) {
          if (stage.failed) {
            skippedStages.push(t(`capture:stages.${name}`, { defaultValue: name }));
          }
        }
        const successTitle = t("capture:notify.successTitle", {
          title: reviewDisplayTitle(result.historyEntry)
        });
        const successBody =
          skippedStages.length > 0
            ? `${t("capture:notify.successBody")} · ${t("capture:notify.skippedSuffix", {
                stages: skippedStages.join(", "),
                defaultValue: `Skipped: ${skippedStages.join(", ")}`
              })}`
            : t("capture:notify.successBody");
        const actions: NotificationAction[] = [];
        const historyEntryId = result.historyEntry.id;
        if (result.historyEntry.workflowMode === "karaoke") {
          actions.push({
            id: "enterKaraoke",
            label: t("capture:notify.enterKaraokeAction"),
            onClick: () => {
              setSelectedHistoryId(historyEntryId);
              setWorkspaceMode("home");
              setReviewTab("karaoke");
              setAppScene("karaoke-room");
            }
          });
        }
        actions.push({
          id: "view",
          label: t("capture:notify.viewAction"),
          onClick: () => {
            setSelectedHistoryId(historyEntryId);
            setWorkspaceMode("home");
            setAppScene("workspace");
          }
        });
        actions.push({
          id: "addToRoom",
          label: t("capture:notify.roomAction"),
          onClick: () => {
            setSelectedHistoryId(historyEntryId);
            navigateKaraokeLobby();
          }
        });
        pushNotification({
          id: `job-succeeded-${jobId}`,
          level: skippedStages.length > 0 ? "warning" : "success",
          title: successTitle,
          body: successBody,
          actions,
          jobId
        });
      }
      return result;
    } catch (error) {
      setJobs((current) =>
        current.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: "failed"
              }
            : job
        )
      );
      const rawMessage = error instanceof Error ? error.message : "";
      setStatusMessage(localizeCliError(rawMessage, t) ?? rawMessage ?? t("common:status.failed"));

      // De-dupe against the IPC-driven failure toast: wait for the `job:failed`
      // event to land (~150 ms in practice; cap the wait at 500 ms), and only
      // push a generic fallback toast when the IPC path didn't already.
      window.setTimeout(() => {
        if (failedEventJobIdsRef.current.has(jobId)) {
          return;
        }
        const tNow = tRef.current;
        pushNotification({
          id: `job-failed-fallback-${jobId}`,
          level: "error",
          title: tNow("capture:error.unknown.title"),
          body: rawMessage || tNow("capture:error.unknown.body"),
          actions: [
            {
              id: "copyLog",
              label: tNow("capture:error.action.copyLog"),
              onClick: () => {
                void copyToClipboard(logsRef.current).then((ok) => {
                  if (ok) {
                    pushNotification({
                      level: "info",
                      title: tNow("capture:error.copySuccess.log"),
                      ttlMs: 3000
                    });
                  }
                });
              }
            }
          ],
          jobId
        });
      }, 500);
      return null;
    }
  }
  runJobRef.current = runJob;

  async function processRoomQueueItem(item: RoomQueueItem, enterAfterComplete = false): Promise<JobResult | null> {
    if (isRunning || item.status !== "queued") {
      return null;
    }
    try {
      setRoomMessage(t("capture:room.processing", { title: item.title }));
      setRoomStatus(await audioWorkflow.startRoomQueueItem(item.id));
      const result = await runJob({
        input: item.input,
        workflowMode: "karaoke",
        localFallback: true,
        formats: ["lrc"]
      });
      const complete = Boolean(result && statusFromResult(result) === "complete");
      setRoomStatus(
        await audioWorkflow.finishRoomQueueItem(
          item.id,
          complete ? "complete" : "failed",
          result?.historyEntry?.id ?? null,
          complete ? null : t("capture:room.failed")
        )
      );
      setRoomMessage(complete ? t("capture:room.processed") : t("capture:room.requestFailed"));
      if (enterAfterComplete && complete && result?.historyEntry) {
        autoplayPackageIdRef.current = result.historyEntry.id;
        setSelectedHistoryId(result.historyEntry.id);
        setActiveJobId(null);
        setReviewTab("karaoke");
        setAppScene("karaoke-room");
      }
      return result;
    } catch (error) {
      setRoomStatus(await audioWorkflow.finishRoomQueueItem(item.id, "failed", null, error instanceof Error ? error.message : t("capture:room.failed")));
      setRoomMessage(error instanceof Error ? error.message : t("capture:room.failed"));
      return null;
    }
  }

  async function copyRemoteRoomLink() {
    if (!roomStatus?.remoteUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(roomStatus.remoteUrl);
      setRoomMessage(t("room:copied"));
    } catch {
      setRoomMessage(roomStatus.remoteUrl);
    }
  }

  async function removeRoomItem(itemId: string) {
    try {
      setRoomStatus(await audioWorkflow.removeRoomQueueItem(itemId));
    } catch (error) {
      setRoomMessage(error instanceof Error ? error.message : t("capture:room.removeFailed"));
    }
  }

  async function clearRoomQueue() {
    try {
      setRoomStatus(await audioWorkflow.clearRoomQueue());
    } catch (error) {
      setRoomMessage(error instanceof Error ? error.message : t("capture:room.clearFailed"));
    }
  }

  async function cancelJob() {
    if (!runningJob) {
      return;
    }
    const canceled = await audioWorkflow.cancelJob(runningJob.id);
    if (canceled) {
      setJobs((current) => current.map((job) => (job.id === runningJob.id ? { ...job, status: "canceled" } : job)));
      setStatusMessage(t("common:status.canceled"));
    }
  }

  async function saveScript(): Promise<boolean> {
    if (!selectedSubtitlePath) {
      return false;
    }
    setScriptStatus(t("capture:script.status.saving"));
    try {
      await audioWorkflow.writeTextFile(selectedSubtitlePath, scriptText);
      setScriptStatus(t("capture:script.status.saved"));
      return true;
    } catch (error) {
      setScriptStatus(error instanceof Error ? error.message : "Save failed");
      return false;
    }
  }

  async function saveAndEnterKaraoke() {
    const saved = await saveScript();
    if (saved || !selectedSubtitlePath) {
      setAppScene("karaoke-room");
    }
  }

  async function removeHistoryEntry(historyId: string) {
    await removeHistoryEntries([historyId]);
  }

  async function removeHistoryEntries(historyIds: string[]) {
    const uniqueIds = [...new Set(historyIds)];
    let nextHistory = history;
    for (const historyId of uniqueIds) {
      nextHistory = await audioWorkflow.removeHistory(historyId);
    }
    setHistory(nextHistory);
    if (selectedHistoryId && uniqueIds.includes(selectedHistoryId)) {
      setSelectedHistoryId(null);
    }
  }

  function selectQueueJob(jobId: string) {
    setActiveJobId(jobId);
    setSelectedHistoryId(null);
    const job = jobs.find((item) => item.id === jobId);
    setAppScene(job?.result?.historyEntry?.workflowMode === "karaoke" ? "lyrics-review" : "workspace");
  }

  function selectHistoryEntry(historyId: string) {
    const entry = history.find((item) => item.id === historyId);
    setSelectedHistoryId(historyId);
    setActiveJobId(null);
    setAppScene(entry?.workflowMode === "karaoke" ? "lyrics-review" : "workspace");
    setReviewTab("script");
  }

  function enterKaraokeFromHistory(historyId: string) {
    const entry = history.find((item) => item.id === historyId);
    setSelectedHistoryId(historyId);
    setActiveJobId(null);
    setReviewTab("karaoke");
    setAppScene(entry?.workflowMode === "karaoke" ? "karaoke-room" : "workspace");
  }

  function enterKaraokeFromHistoryAndPlay(historyId: string) {
    autoplayPackageIdRef.current = historyId;
    enterKaraokeFromHistory(historyId);
  }

  async function playNextInRoom() {
    const queuedRoomItem = roomQueue.find((item) => item.status === "queued");
    if (queuedRoomItem) {
      await processRoomQueueItem(queuedRoomItem, true);
      return;
    }
    if (!activeReview) {
      return;
    }
    const currentIndex = orderedKaraokePackages.findIndex((entry) => entry.id === activeReview.id);
    const nextPackage = currentIndex >= 0 ? orderedKaraokePackages[currentIndex + 1] : orderedKaraokePackages[0];
    if (nextPackage) {
      enterKaraokeFromHistoryAndPlay(nextPackage.id);
    }
  }

  function playPreviousInRoom() {
    if (!activeReview) {
      return;
    }
    const currentIndex = orderedKaraokePackages.findIndex((entry) => entry.id === activeReview.id);
    const previousPackage =
      currentIndex > 0
        ? orderedKaraokePackages[currentIndex - 1]
        : currentIndex === 0
          ? orderedKaraokePackages.at(-1)
          : null;
    if (previousPackage && previousPackage.id !== activeReview.id) {
      enterKaraokeFromHistoryAndPlay(previousPackage.id);
    }
  }

  function toggleFormat(format: OutputFormat) {
    const nextFormats = options.formats.includes(format)
      ? options.formats.filter((item) => item !== format)
      : [...options.formats, format];
    updateOptions({ formats: nextFormats });
  }

  function seekToCue(cue: Cue) {
    playbackController.seek(cue.start, true);
  }

  function splitActiveReview() {
    if (!activeReview || isRunning) {
      return;
    }
    const splitSource = splitSourceForReview(activeReview);
    void runJob({
      input: splitSource.input,
      workflowMode: "karaoke",
      separate: splitSource.separate,
      localFallback: true,
      saveAudio: true,
      outputDir: activeReview.outputDir,
      formats: ensureKaraokeFormats()
    });
  }

  useEffect(() => {
    if (appScene !== "karaoke-room" || playbackController.endedCount === 0) {
      return;
    }
    if (handledEndedCountRef.current === playbackController.endedCount) {
      return;
    }
    handledEndedCountRef.current = playbackController.endedCount;
    void playNextInRoom();
  }, [appScene, playbackController.endedCount]);

  useEffect(() => {
    if (appScene !== "karaoke-room" || !activeReview || autoplayPackageIdRef.current !== activeReview.id) {
      return;
    }
    const timer = window.setTimeout(() => {
      playbackController.play();
      autoplayPackageIdRef.current = null;
    }, 320);
    return () => window.clearTimeout(timer);
  }, [activeReview?.id, appScene, playbackController.mediaUrl]);

  if (appScene === "lyrics-review" && activeReview) {
    return (
      <>
        <IntroSplash open={showIntroSplash} onDone={() => setShowIntroSplash(false)} />
      <div className="appSceneFrame appSceneFrame--withChrome" data-theme={effectiveTheme} data-accent={accentColor}>
        {studioChromeHeader}
        <div className="studioScrollRegion">
        <LyricsReviewScene
          activeReview={activeReview}
          cues={cues}
          scriptStatus={scriptStatus}
          scriptText={scriptText}
          selectedSubtitlePath={selectedSubtitlePath}
          subtitleAssets={subtitleAssets}
          reviewTitle={reviewDisplayTitle(activeReview)}
          onBack={() => {
            setWorkspaceMode("home");
            setAppScene("workspace");
          }}
          onCueSeek={(cue) => playbackController.seek(cue.start, true)}
          onEnterKaraoke={saveAndEnterKaraoke}
          onOpenFolder={() => activeReview.outputDir && audioWorkflow.openPath(activeReview.outputDir)}
          onScriptChange={setScriptText}
          onSave={saveScript}
        />
        </div>
        {studioOverlays}
        {floatingNav}
        <NotificationToaster />
      </div>
      </>
    );
  }

  if (appScene === "karaoke-room" && activeReview) {
    return (
      <>
        <IntroSplash open={showIntroSplash} onDone={() => setShowIntroSplash(false)} />
      <div className="appSceneFrame appSceneFrame--withChrome" data-theme="dark" data-accent={accentColor}>
        {studioChromeHeader}
        <div className="studioScrollRegion">
        <KaraokeRoomScene
          activeCue={activeCue}
          activeCueIndex={activeCueIndex}
          activeReview={activeReview}
          cues={cues}
          playbackBundle={activeReview.playbackBundle}
          playbackController={playbackController}
          roomQueue={roomQueue}
          songOptions={
            orderedKaraokePackages.some((entry) => entry.id === activeReview.id)
              ? orderedKaraokePackages.map((entry) => ({ id: entry.id, title: reviewDisplayTitle(entry) }))
              : [
                  { id: activeReview.id, title: reviewDisplayTitle(activeReview) },
                  ...orderedKaraokePackages.map((entry) => ({ id: entry.id, title: reviewDisplayTitle(entry) }))
                ]
          }
          trackAssets={trackAssets}
          trackRole={trackRole}
          lyricEffect={lyricEffect}
          lyricFont={lyricFont}
          microphoneMonitor={microphoneMonitor}
          reviewTitle={reviewDisplayTitle(activeReview)}
          selectedMediaName={
            playbackAssets.find((asset) => asset.path === selectedMediaPath)?.name ??
            t("room:noLocalTrack")
          }
          selectedSubtitleName={
            selectedSubtitlePath ? fileNameFromPath(selectedSubtitlePath) : t("package:badges.noLyrics")
          }
          selectedSubtitlePath={selectedSubtitlePath}
          scriptStatus={scriptStatus}
          scriptText={scriptText}
          onBackHome={() => {
            setWorkspaceMode("home");
            setAppScene("workspace");
          }}
          onBackToLyrics={() => setAppScene("lyrics-review")}
          onLyricEffectChange={setLyricEffect}
          onLyricFontChange={setLyricFont}
          onOpenOriginalVideo={() => activeReview.sourceUrl && audioWorkflow.openExternalUrl(activeReview.sourceUrl)}
          onPackageChange={enterKaraokeFromHistory}
          onProcessRoomItem={(item) => {
            void processRoomQueueItem(item, true);
          }}
          onRemoveRoomItem={removeRoomItem}
          onPlayNext={() => {
            void playNextInRoom();
          }}
          onPlayPrevious={playPreviousInRoom}
          onScriptChange={setScriptText}
          onSaveLyrics={() => {
            void saveScript();
          }}
          onSplitVocals={splitActiveReview}
          onTrackRoleChange={setTrackRole}
          isRunning={isRunning}
        />
        </div>
        {studioOverlays}
        {floatingNav}
        <NotificationToaster />
      </div>
      </>
    );
  }

  return (
    <>
      <IntroSplash open={showIntroSplash} onDone={() => setShowIntroSplash(false)} />
    <motion.main
      className="appShell w-full"
      data-has-workspace={showWorkspace}
      data-workspace-mode={workspaceMode}
      data-theme={effectiveTheme}
      data-accent={accentColor}
      initial={{ opacity: showIntroSplash ? 1 : 0, y: showIntroSplash ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
    >
      {studioChromeHeader}

      <div className="studioScrollRegion">
      <div
        className="studioHeroBand"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="studioHeroInner">

        {/* Brand hero / Capture console */}
        {workspaceMode === "add" ? (
        <section className="captureConsole" aria-label={t("capture:inputLabel")}>
          <div className="captureDeck" data-busy={captureBusy ? "true" : "false"}>
            <div className="captureScope" aria-hidden="true">
              <div className="captureScopeWave">
                <div className="captureScopeBars">
                  {CAPTURE_SCOPE_BARS.map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
                <div
                  className="captureScopePlayhead"
                  style={{ left: `calc(${Math.round(captureScopeProgress * 100)}% - 1px)` }}
                />
              </div>
              <div className="captureScopeRuler">
                <span>00:00</span>
                <span>00:15</span>
                <span>00:30</span>
                <span>00:45</span>
                <span>01:00</span>
              </div>
            </div>

            <div className="captureMid">
              <div className="captureLcd">
                <div className="captureLcdTop">
                  <span className="captureLcdRec" data-live={captureBusy ? "true" : "false"}>
                    <span className="captureLcdRecDot" />
                    {captureBusy ? "LIVE" : "IDLE"}
                  </span>
                  <span className="captureLcdBadge">{captureLcdStatus}</span>
                </div>
                <p className="captureLcdReadout" title={captureLcdReadout}>
                  {captureLcdReadout}
                </p>
                <div className="captureLcdMeta">
                  <span>
                    {options.workflowMode.toUpperCase()} ·{" "}
                    {(options.language || "auto").toUpperCase()}
                    {options.separate ? " · STEM" : ""}
                  </span>
                  <span>
                    {captureInputKind === "search"
                      ? t("capture:search.unifiedHint")
                      : options.input.trim() || t("common:home.captureHint")}
                  </span>
                </div>
                <div className="captureLcdMeters" aria-hidden="true">
                  <div className="captureLcdMeterRow">
                    <span>L</span>
                    <div className="captureLcdMeterTrack">
                      <div
                        className="captureLcdMeterFill"
                        style={{ width: `${Math.round((captureBusy ? 0.72 : 0.18 + captureScopeProgress * 0.4) * 100)}%` }}
                      />
                    </div>
                    <span>-12</span>
                  </div>
                  <div className="captureLcdMeterRow">
                    <span>R</span>
                    <div className="captureLcdMeterTrack">
                      <div
                        className="captureLcdMeterFill"
                        style={{ width: `${Math.round((captureBusy ? 0.58 : 0.12 + captureScopeProgress * 0.35) * 100)}%` }}
                      />
                    </div>
                    <span>-18</span>
                  </div>
                </div>
              </div>

              <div className="captureCluster">
                <div className="captureCircleStack">
                  <button
                    type="button"
                    className="uiKey uiKeyCircle captureCircle captureCircleStop"
                    data-armed={isRunning ? "true" : "false"}
                    onClick={cancelJob}
                    disabled={!isRunning}
                    aria-label={t("common:actions.stop")}
                  >
                    <span className="captureCircleIcon">
                      <Icon name="stop" />
                      STOP
                    </span>
                  </button>
                  <button
                    type="button"
                    className="uiKey uiKeyCircle uiKeyPrimary captureCircle captureCircleGo"
                    onClick={submitCaptureInput}
                    disabled={!options.input.trim() || isRunning || youtubeSearching}
                    aria-label={
                      cachedPackageForInput
                        ? t("capture:cache.openExisting")
                        : captureInputKind === "search"
                          ? t("common:actions.search")
                          : t("common:actions.addSong")
                    }
                  >
                    <span className="captureCircleIcon">
                      <Icon
                        name={
                          cachedPackageForInput
                            ? "folder"
                            : captureInputKind === "search"
                              ? "search"
                              : "spark"
                        }
                      />
                      {youtubeSearching
                        ? "…"
                        : cachedPackageForInput
                          ? "OPEN"
                          : captureInputKind === "search"
                            ? "FIND"
                            : "GO"}
                    </span>
                  </button>
                </div>
                <div className="capturePad" aria-hidden="true">
                  <div className="capturePadRing" />
                  <span className="capturePadLabel" data-slot="n">
                    YT
                  </span>
                  <span className="capturePadLabel" data-slot="s">
                    BL
                  </span>
                  <span className="capturePadLabel" data-slot="w">
                    URL
                  </span>
                  <span className="capturePadLabel" data-slot="e">
                    LOC
                  </span>
                  <button
                    type="button"
                    className="capturePadCore"
                    onClick={chooseInput}
                    aria-label={t("capture:selectFile")}
                  >
                    <Icon name="folder" />
                  </button>
                </div>
              </div>
            </div>

            <div className="captureFoot">
              <div className="captureSearchWell">
                <span className="captureSearchWellIcon" aria-hidden="true">
                  <Icon name={captureInputKind === "search" ? "search" : "spark"} />
                </span>
                <input
                  id="input"
                  ref={captureInputRef}
                  value={options.input}
                  onChange={(event) => updateOptions({ input: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !options.input.trim() || isRunning) {
                      return;
                    }
                    event.preventDefault();
                    submitCaptureInput();
                  }}
                  placeholder={t("capture:inputPlaceholder")}
                  className="captureSearchInput"
                  aria-label={t("capture:inputLabel")}
                />
                <span className="captureSearchChip" data-active="true">
                  {captureInputKind === "search" ? "SEARCH" : captureInputKind === "local" ? "LOCAL" : "URL"}
                </span>
              </div>

              {captureInputKind === "search" && options.input.trim() ? (
                <p className="captureHintLine">{t("capture:search.unifiedHint")}</p>
              ) : null}
              <UrlPreviewCard state={urlPreviewState} preview={urlPreview} t={t} />
              {cachedPackageForInput ? (
                <div className="grid gap-2">
                  <p className="m-0 text-sm font-semibold text-accent-strong">
                    {t("capture:cache.hint", { title: reviewDisplayTitle(cachedPackageForInput) })}
                  </p>
                  <button
                    type="button"
                    className="captureKey self-start"
                    onClick={() => void runJob()}
                    disabled={isRunning}
                  >
                    {t("capture:cache.redownload")}
                  </button>
                </div>
              ) : null}

              <div className="captureKeyRow">
                <button type="button" className="captureKey" onClick={chooseInput}>
                  FILE
                </button>
                <button
                  type="button"
                  className="captureKey"
                  onClick={() => setCaptureOptionsOpen((open) => !open)}
                  aria-expanded={captureOptionsOpen}
                >
                  OPTION
                </button>
                <button
                  type="button"
                  className="captureKey"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                >
                  {advancedOpen ? "HIDE" : "ADV"}
                </button>
                <button
                  type="button"
                  className="captureKey captureKeyPrimary"
                  onClick={submitCaptureInput}
                  disabled={!options.input.trim() || isRunning || youtubeSearching}
                >
                  {cachedPackageForInput
                    ? t("capture:cache.openExisting")
                    : youtubeSearching
                      ? t("common:actions.searching")
                      : captureInputKind === "search"
                        ? t("common:actions.search")
                        : t("common:actions.addSong")}
                </button>
              </div>

              <details
                className="captureOptionsDrawer"
                open={captureOptionsOpen}
                onToggle={(event) => setCaptureOptionsOpen(event.currentTarget.open)}
              >
                <summary>
                  <span className="inline-flex items-center gap-2">
                    <Icon name="sliders" />
                    {t("capture:options.toggle")}
                    <span className="text-xs font-medium text-faint">{t("capture:options.hint")}</span>
                  </span>
                </summary>
                <div className="captureOptionsDrawerBody">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-[220px] max-w-full">
                      <SegmentedControl
                        value={options.workflowMode}
                        options={[
                          ["karaoke", t("capture:modes.karaoke")],
                          ["subtitle", t("capture:modes.subtitle")]
                        ]}
                        onChange={setWorkflowMode}
                      />
                    </div>
                    <label className="grid w-44 gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("common:language.label")}
                      </span>
                      <select
                        value={options.language}
                        onChange={(event) => updateOptions({ language: event.target.value })}
                        className="min-h-9 w-full rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]"
                      >
                        <option value="">{t("capture:languageOptions.auto")}</option>
                        <option value="en">{t("capture:languageOptions.english")}</option>
                        <option value="zh">{t("capture:languageOptions.chinese")}</option>
                        <option value="ja">{t("capture:languageOptions.japanese")}</option>
                        <option value="ko">{t("capture:languageOptions.korean")}</option>
                      </select>
                    </label>
                    <Checkbox
                      label={t("capture:simplifiedChinese")}
                      checked={options.simplifiedChinese}
                      onChange={(checked) => updateOptions({ simplifiedChinese: checked })}
                      className="self-end pb-1"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Checkbox
                      label={t("capture:search.appendKaraoke")}
                      checked={youtubeAppendKaraoke}
                      onChange={setYoutubeAppendKaraoke}
                    />
                    <Checkbox
                      label={t("capture:search.splitVocalsDefault")}
                      checked={options.separate}
                      disabled={options.workflowMode !== "karaoke"}
                      onChange={(checked) => updateOptions({ separate: checked })}
                    />
                  </div>
                  {youtubeAppendKaraoke && options.separate && options.workflowMode === "karaoke" ? (
                    <p className="mt-0 mb-0 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
                      {t("capture:search.karaokeSplitWarning")}
                    </p>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </section>
        ) : workspaceMode === "karaoke" ? (
        <section className="roomLobbyHero" data-workspace-mode="karaoke">
          <p className="roomInstrumentClock">
            {String(roomSetlistItems.length).padStart(2, "0")}
          </p>
          <p className="roomInstrumentNext">{t("common:room.kicker")}</p>
          <div className="roomInstrumentTuner" style={{ ["--needle-pos" as string]: "38%" }} aria-hidden="true">
            <span className="roomInstrumentNeedle" />
          </div>
          <h1 className="m-0 max-w-[720px] font-mono text-[clamp(1.4rem,3vw,2.1rem)] font-semibold uppercase leading-[1.1] tracking-[0.04em] text-foreground">
            {t("common:room.title")}
          </h1>
          <p className="m-0 mt-3 max-w-[560px] font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("common:room.subtitle")}
          </p>
          {roomSetlistItems.some((item) => item.ready) ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => enterKaraokeStage()}
                className="gap-2"
              >
                <Icon name="play" />
                {t("common:room.startSinging")}
              </Button>
            </div>
          ) : null}
        </section>
        ) : (
        <section className="brandHero grid items-center gap-8" data-workspace-mode={workspaceMode}>
          <div className="grid max-w-[760px] content-start gap-5">
            <div className="grid gap-4">
              <Eyebrow>
                {t("common:home.kicker")}
              </Eyebrow>
              <h1 className="m-0 max-w-[720px] text-[clamp(36px,5.5vw,56px)] font-semibold leading-[1.02] tracking-[-0.05em] text-foreground">
                {t("common:home.title")}
              </h1>
              <p className="m-0 max-w-[560px] text-base font-normal leading-relaxed text-muted-foreground">
                {t("common:home.subtitle")}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={navigateKaraokeLobby}
                    className="gap-2"
                  >
                    <Icon name="music" />
                    {t("common:nav.karaoke")}
                  </Button>
                  <Button size="lg" onClick={navigateAdd} className="gap-2">
                    <Icon name="plus" />
                    {t("common:nav.add")}
                  </Button>
                </div>
            </div>
          </div>
        </section>
        )}
          </div>
        </div>

      <div className="studioDeck">
        <div className="studioDeckInner grid gap-5">
        {workspaceMode === "add" ? (
          <>
          <section id="captureStatus" aria-label={t("capture:jobStream.headerLabel")} className="grid gap-3 scroll-mt-32">
            <LiveJobStatus job={liveJob} t={t} />
            <StageChain stages={progressStages} isRunning={isRunning} t={t} />
          </section>

          {youtubeError || youtubeSearching || youtubeResults.length > 0 ? (
          <div id="mediaSearchResults" className="captureResultsChassis scroll-mt-32">
            <div className="captureResultsHead">
              <div>
                <h2 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                  {t("capture:search.resultsTitle")}
                </h2>
                <p className="m-0 mt-1 text-xs font-medium text-muted-foreground">
                  {t("capture:search.resultsHint", { minutes: Math.floor(SHORT_CLIP_MAX_SEC / 60) })}
                </p>
              </div>
            </div>
            {youtubeError || youtubeSearching ? (
              <div className="grid gap-3 px-4 py-3">
                {youtubeError ? (
                  <p className="m-0 text-sm font-medium text-danger">{youtubeError}</p>
                ) : null}
                {youtubeSearching ? (
                  <p className="m-0 text-sm font-medium text-muted-foreground">{t("capture:search.searchingBoth")}</p>
                ) : null}
              </div>
            ) : null}
            {youtubeResults.length > 0 ? (
              <ul aria-label={t("capture:search.resultsTitle")} className="captureResultsList">
                {youtubeResults.map((row) => (
                  <li key={`${row.platform ?? "media"}-${row.videoId}`} className="captureResultRow">
                    <div className="captureResultThumb">
                      {searchResultThumbnail(row) ? (
                        <img
                          src={searchResultThumbnail(row)}
                          alt=""
                          loading="lazy"
                          width={160}
                          height={90}
                        />
                      ) : (
                        <span className="grid aspect-video place-items-center text-sm font-bold text-white/85">
                          {row.platform === "bilibili"
                            ? t("capture:search.bilibili")
                            : t("capture:search.youtube")}
                        </span>
                      )}
                    </div>
                    <div className="captureResultBody">
                      <div className="captureResultTitle">{row.title}</div>
                      <div className="captureResultMeta">
                        {(row.platform === "bilibili"
                          ? t("capture:search.bilibili")
                          : t("capture:search.youtube")) +
                          (row.channel ? ` · ${row.channel}` : "") +
                          ` · ${row.durationLabel || "—"}`}
                      </div>
                      <div className="captureResultActions">
                        <button
                          type="button"
                          className="captureKey captureKeyPrimary"
                          disabled={isRunning}
                          onClick={() => applyYoutubeResult(row, true)}
                        >
                          {t("capture:search.addAndProcess")}
                        </button>
                        <button
                          type="button"
                          className="captureKey"
                          onClick={() => applyYoutubeResult(row, false)}
                        >
                          {t("capture:search.useThisLink")}
                        </button>
                        <button
                          type="button"
                          className="captureKey"
                          onClick={() => void audioWorkflow.openExternalUrl(row.url)}
                        >
                          {t("capture:search.openInBrowser")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          ) : null}
          </>
        ) : (
          <section id="captureStatus" aria-label={t("capture:jobStream.headerLabel")} className="grid gap-3 scroll-mt-32">
            <LiveJobStatus job={liveJob} t={t} />
            <StageChain stages={progressStages} isRunning={isRunning} t={t} />
          </section>
        )}

        {workspaceMode === "home" ? (
          <section className="selectionGallery" aria-label={t("library:shelfHeader")}>
            {stats.featured ? (
              <FeaturedPackageEntry
                entry={stats.featured.entry}
                variant={featuredVariant}
                onEnter={() => enterKaraokeFromHistory(stats.featured!.entry.id)}
                onOpen={() => selectHistoryEntry(stats.featured!.entry.id)}
                onDelete={() => removeHistoryEntries(stats.featured!.duplicateIds)}
              />
            ) : null}

            {stats.shelfList.length > 0 ? (
              <Card surface="card" padding="lg" elevated className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <Eyebrow className="m-0">{t("library:shelfHeader")}</Eyebrow>
                  <span className="text-xs font-medium text-faint tabular-nums">
                    {stats.shelfList.length}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {stats.shelfList.map(({ entry, duplicateIds }) => (
                    <ProcessedResourceCardEntry
                      key={entry.id}
                      entry={entry}
                      onEnter={() => enterKaraokeFromHistory(entry.id)}
                      onReview={() => selectHistoryEntry(entry.id)}
                      onDelete={() => removeHistoryEntries(duplicateIds)}
                    />
                  ))}
                </div>
              </Card>
            ) : null}

            {!stats.featured && stats.shelfList.length === 0 ? (
              <Card
                surface="elevated"
                padding="lg"
                bordered
                aria-label={t("library:emptyTitle")}
                className="grid gap-3 border-dashed p-8 text-center"
              >
                <h2 className="m-0 text-lg font-semibold text-foreground">{t("library:emptyTitle")}</h2>
                <p className="m-0 text-sm font-medium text-muted-foreground">{t("library:emptyBody")}</p>
                <Button onClick={navigateAdd} className="mx-auto gap-2">
                  <Icon name="plus" />
                  {t("common:nav.add")}
                </Button>
              </Card>
            ) : null}
          </section>
        ) : null}

        {workspaceMode === "karaoke" ? (
          <RoomSetlistPanel
            items={roomSetlistItems}
            selectedId={selectedHistoryId}
            onSelect={(historyId) => {
              setSelectedHistoryId(historyId);
              setActiveJobId(null);
            }}
            onMove={moveSetlistItem}
            onStart={(historyId) => enterKaraokeStage(historyId)}
            onReview={(historyId) => selectHistoryEntry(historyId)}
            onAddSongs={navigateAdd}
          />
        ) : null}

      {showWorkspace ? (
        <section
          className={cn(
            "grid gap-4",
            showActivityPane && "lg:grid-cols-[minmax(0,1fr)_300px]"
          )}
        >
          <section className="grid gap-4">
            {activeReview ? (
              <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-muted p-4">
                <div className="grid min-w-0 gap-1">
                  <Eyebrow>{t("package:current")}</Eyebrow>
                  <h2 className="m-0 max-w-[720px] truncate text-lg font-semibold leading-snug text-foreground">
                    {activeReviewTitle}
                  </h2>
                  <p className="m-0 text-sm font-medium text-muted-foreground">
                    {playbackSummary(activeReview.playbackBundle)}
                  </p>
                  <PackageBadges
                    playbackBundle={activeReview.playbackBundle}
                    trackAssets={trackAssets}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeReview.workflowMode === "karaoke" ? (
                    <>
                      <Button onClick={() => setAppScene("lyrics-review")}>
                        {t("package:openPackage")}
                      </Button>
                      <Button
                        onClick={splitActiveReview}
                        disabled={isRunning || Boolean(trackAssets.backing)}
                      >
                        {t("package:splitVocals")}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => setAppScene("karaoke-room")}
                        disabled={
                          !selectedSubtitlePath || !activeReview.playbackBundle.controllable
                        }
                      >
                        {t("package:enterKaraoke")}
                      </Button>
                    </>
                  ) : null}
                  {activeReview.sourceUrl ? (
                    <Button
                      onClick={() => audioWorkflow.openExternalUrl(activeReview.sourceUrl!)}
                    >
                      {t("package:openOriginal")}
                    </Button>
                  ) : null}
                  <Button
                    disabled={!activeReview.outputDir}
                    onClick={() =>
                      activeReview.outputDir && audioWorkflow.openPath(activeReview.outputDir)
                    }
                  >
                    {t("package:openFolder")}
                  </Button>
                </div>
              </section>
            ) : null}

            {activeReview ? (
              <section className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  {(["karaoke", "script", "files"] as ReviewTab[]).map((tab) => (
                    <Button
                      key={tab}
                      data-selected={reviewTab === tab}
                      selected={reviewTab === tab}
                      onClick={() => setReviewTab(tab)}
                    >
                      {t(`package:tabs.${tab}`)}
                    </Button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {reviewTab === "karaoke" ? (
                    <motion.div key="karaoke" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: motionDuration.fast, ease: motionEase }}>
                      <KaraokeReview
                        activeCue={activeCue}
                        activeCueIndex={activeCueIndex}
                        cues={cues}
                        playbackBundle={activeReview.playbackBundle}
                        playbackController={playbackController}
                        playableAssets={playbackAssets}
                        selectedMediaPath={selectedMediaPath}
                        selectedSubtitlePath={selectedSubtitlePath}
                        isVideo={isVideoPath(selectedMediaPath)}
                        selectedSubtitleName={
                          selectedSubtitlePath
                            ? fileNameFromPath(selectedSubtitlePath)
                            : t("package:badges.noLyrics")
                        }
                        selectedMediaName={
                          selectedMediaPath
                            ? fileNameFromPath(selectedMediaPath)
                            : t("package:noPlayableMedia")
                        }
                        onSeek={seekToCue}
                      />
                    </motion.div>
                  ) : null}

                  {reviewTab === "script" ? (
                    <motion.div key="script" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: motionDuration.fast, ease: motionEase }}>
                      <ScriptReview
                        selectedSubtitlePath={selectedSubtitlePath}
                        subtitleAssets={subtitleAssets}
                        scriptText={scriptText}
                        scriptStatus={scriptStatus}
                        onScriptChange={setScriptText}
                        onSave={saveScript}
                      />
                    </motion.div>
                  ) : null}

                  {reviewTab === "files" ? (
                    <motion.div key="files" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: motionDuration.fast, ease: motionEase }}>
                      <FilesReview
                        assets={activeReview.assets}
                        onOpen={(path) => audioWorkflow.openPath(path)}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>
            ) : null}

          <AnimatePresence initial={false}>
            {advancedOpen ? (
              <motion.section
                className="-m-1 grid gap-3 overflow-hidden p-1"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: motionDuration.drawer, ease: motionEase }}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t("capture:advanced.fields.subtitleSource")}>
                    <SegmentedControl
                      value={options.subtitleSource}
                      options={[
                        ["auto", t("capture:advanced.options.auto")],
                        ["platform", t("capture:advanced.options.platform")],
                        ["local", t("capture:advanced.options.local")]
                      ]}
                      onChange={(value) => updateOptions({ subtitleSource: value })}
                    />
                  </Field>

                  <Field label={t("capture:advanced.fields.whisperModel")}>
                    <select
                      value={options.model}
                      onChange={(event) => updateOptions({ model: event.target.value })}
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <option value="small">small</option>
                      <option value="medium">medium</option>
                      <option value="large-v3-turbo">large-v3-turbo</option>
                      <option value="large-v3">large-v3</option>
                    </select>
                  </Field>

                  <Field label={t("capture:advanced.fields.platformLanguages")}>
                    <input
                      value={options.subLangs}
                      onChange={(event) => updateOptions({ subLangs: event.target.value })}
                      placeholder={t("capture:advanced.placeholders.subLangs")}
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>

                  <Field label={t("capture:advanced.fields.browserCookies")}>
                    <input
                      value={options.browser}
                      onChange={(event) => updateOptions({ browser: event.target.value })}
                      placeholder={t("capture:advanced.placeholders.browser")}
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>

                  <Field label={t("capture:advanced.fields.cookiesFile")}>
                    <input
                      value={options.cookies}
                      onChange={(event) => updateOptions({ cookies: event.target.value })}
                      placeholder={t("capture:advanced.placeholders.cookies")}
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <Checkbox
                    label={t("capture:advanced.fields.vocalSplit")}
                    checked={options.separate}
                    disabled={options.workflowMode !== "karaoke"}
                    onChange={(checked) => updateOptions({ separate: checked })}
                  />
                  <Checkbox label={t("capture:advanced.fields.localFallback")} checked={options.localFallback} onChange={(checked) => updateOptions({ localFallback: checked })} />
                  <Checkbox label={t("capture:advanced.fields.keepRawVtt")} checked={options.keepPlatformSubs} onChange={(checked) => updateOptions({ keepPlatformSubs: checked })} />
                  <Checkbox
                    label={autoSavesAudio ? t("capture:advanced.fields.playableAudioAuto") : t("capture:advanced.fields.keepExtractedAudio")}
                    checked={options.saveAudio || autoSavesAudio}
                    disabled={autoSavesAudio}
                    onChange={(checked) => updateOptions({ saveAudio: checked })}
                  />
                </div>

                {options.workflowMode === "subtitle" ? (
                  <div className="flex flex-wrap gap-2" aria-label={t("capture:advanced.fields.outputFormats")}>
                    {allFormats.map((format) => (
                      <Button
                        key={format}
                        size="sm"
                        selected={options.formats.includes(format)}
                        onClick={() => toggleFormat(format)}
                      >
                        {format.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2" aria-label={t("capture:advanced.fields.outputFormats")}>
                    <Button size="sm" selected disabled>
                      LRC
                    </Button>
                  </div>
                )}

                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <Field label={t("capture:advanced.fields.outputFolder")}>
                    <input
                      id="output"
                      value={options.outputDir}
                      onChange={(event) => updateOptions({ outputDir: event.target.value })}
                      placeholder={t("capture:advanced.placeholders.outputDir")}
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>
                  <Button onClick={chooseOutputDir}>
                    {t("capture:advanced.fields.choose")}
                  </Button>
                </div>

                <section className="grid gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="m-0 text-sm font-semibold text-foreground">{t("capture:advanced.command")}</h2>
                  </div>
                  <pre className="m-0 max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {preview?.display ?? t("capture:advanced.commandPlaceholder")}
                  </pre>
                </section>

                <section className="grid gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="m-0 text-sm font-semibold text-foreground">{t("capture:advanced.logs")}</h2>
                  </div>
                  <pre className="m-0 max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {logs || t("capture:advanced.logsPlaceholder")}
                  </pre>
                </section>
              </motion.section>
            ) : null}
          </AnimatePresence>
          </section>

          {showActivityPane ? (
            <aside className="grid max-h-[calc(100vh-168px)] gap-3 overflow-auto rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-sm font-semibold text-foreground">{t("capture:activity.title")}</h2>
                <span className="font-mono text-xs font-semibold text-faint tabular-nums">{jobs.length}</span>
              </div>
              <div className="grid gap-1.5">
                {jobs.length === 0 ? (
                  <p className="m-0 text-sm text-faint">{t("capture:activity.empty")}</p>
                ) : (
                  jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className={cn(
                        "grid gap-1 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]",
                        job.id === activeJobId && "border-primary bg-accent-soft"
                      )}
                      onClick={() => selectQueueJob(job.id)}
                    >
                      <span className="truncate text-sm font-semibold text-foreground">
                        {job.result?.historyEntry ? reviewDisplayTitle(job.result.historyEntry) : shortInputLabel(job.input)}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {job.status} - {job.startedAt}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <h2 className="m-0 text-sm font-semibold text-foreground">{t("capture:history.title")}</h2>
                <span className="font-mono text-xs font-semibold text-faint tabular-nums">{history.length}</span>
              </div>
              <div className="grid gap-1.5">
                {history.length === 0 ? (
                  <p className="m-0 text-sm text-faint">{t("capture:history.empty")}</p>
                ) : (
                  history.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "grid gap-2 rounded-md border border-border bg-background p-2",
                        entry.id === selectedHistoryId && "border-primary bg-accent-soft"
                      )}
                    >
                      <button type="button" className="grid min-w-0 gap-1 text-left" onClick={() => selectHistoryEntry(entry.id)}>
                        <span className="truncate text-sm font-semibold text-foreground">{reviewDisplayTitle(entry)}</span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {entry.workflowMode} - {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </button>
                      <Button variant="danger" size="sm" className="justify-self-start" onClick={() => removeHistoryEntry(entry.id)}>
                        {t("common:actions.remove")}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </aside>
          ) : null}
        </section>
      ) : null}
        </div>
      </div>
      </div>

      {studioOverlays}

      {floatingNav}
      <NotificationToaster />
    </motion.main>
    </>
  );
}

function usePlaybackController(mediaPath: string, previewPath: string | null): PlaybackController {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewSyncTimerRef = useRef<number | null>(null);
  const previewShouldPlayRef = useRef(false);
  const playIntentRef = useRef(false);
  const isPlayingRef = useRef(false);
  const lastSeekAtRef = useRef(0);
  const pendingSeekRef = useRef<{ time: number; shouldPlay: boolean } | null>(null);
  const previewSeekTokenRef = useRef(0);
  const timelineTimeRef = useRef(0);
  const [mediaUrl, setMediaUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [previewStatus, setPreviewStatus] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [endedCount, setEndedCount] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const volumeBeforeMuteRef = useRef(1);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);

  useEffect(() => {
    let ignore = false;
    const carryTime = timelineTimeRef.current;
    const carryPlayIntent = playIntentRef.current;
    setMediaUrl("");
    setMediaStatus("");
    setDuration(0);
    pendingSeekRef.current = mediaPath ? { time: carryTime, shouldPlay: carryPlayIntent } : null;
    if (!mediaPath) {
      timelineTimeRef.current = 0;
      setCurrentTime(0);
      playIntentRef.current = false;
      isPlayingRef.current = false;
      setIsPlaying(false);
    }

    if (!mediaPath) {
      return;
    }

    audioWorkflow
      .getMediaUrl(mediaPath)
      .then((url) => {
        if (!ignore) {
          setMediaUrl(url);
          setCurrentTime(carryTime);
        }
      })
      .catch((error: Error) => {
        if (!ignore) {
          setMediaStatus(error.message);
        }
      });

    return () => {
      ignore = true;
    };
  }, [mediaPath]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
    const media = mediaRef.current;
    if (media) {
      media.volume = muted ? 0 : volume;
    }
  }, [mediaUrl, muted, volume]);

  useEffect(() => {
    return () => {
      clearPendingPreviewSync();
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    setPreviewUrl("");
    setPreviewStatus("");

    if (!previewPath) {
      return;
    }

    // Remote stream URLs (online MV resolved via yt-dlp -g) are playable
    // directly; only local filesystem paths need the media-token IPC.
    if (/^https?:\/\//i.test(previewPath)) {
      setPreviewUrl(previewPath);
      return;
    }

    audioWorkflow
      .getMediaUrl(previewPath)
      .then((url) => {
        if (!ignore) {
          setPreviewUrl(url);
        }
      })
      .catch((error: Error) => {
        if (!ignore) {
          setPreviewStatus(error.message);
        }
      });

    return () => {
      ignore = true;
    };
  }, [previewPath]);

  function clearPendingPreviewSync() {
    if (previewSyncTimerRef.current !== null) {
      window.clearTimeout(previewSyncTimerRef.current);
      previewSyncTimerRef.current = null;
    }
    previewShouldPlayRef.current = false;
  }

  function syncPreviewTo(time: number, shouldPlay = false) {
    const preview = previewRef.current;
    if (!preview || !Number.isFinite(time)) {
      return;
    }
    try {
      if (preview.readyState === 0) {
        preview.addEventListener("loadedmetadata", () => syncPreviewTo(time, shouldPlay), { once: true });
        return;
      }
      const resumePreview = () => {
        if (!shouldPlay || !playIntentRef.current) {
          return;
        }
        preview.muted = true;
        void preview.play().catch(() => undefined);
      };
      if (Math.abs(preview.currentTime - time) > 0.12) {
        const seekToken = previewSeekTokenRef.current + 1;
        previewSeekTokenRef.current = seekToken;
        let resumed = false;
        const resumeOnce = () => {
          if (resumed || previewSeekTokenRef.current !== seekToken) {
            return;
          }
          resumed = true;
          resumePreview();
        };
        preview.addEventListener("seeked", resumeOnce, { once: true });
        preview.currentTime = time;
        window.setTimeout(resumeOnce, 260);
      } else {
        resumePreview();
      }
    } catch {
      // Media elements can reject early seeks before metadata is ready.
    }
  }

  function schedulePreviewSync(time: number, shouldPlay = false, delay = 80) {
    if (!Number.isFinite(time)) {
      return;
    }
    previewShouldPlayRef.current = previewShouldPlayRef.current || shouldPlay;
    if (previewSyncTimerRef.current !== null) {
      window.clearTimeout(previewSyncTimerRef.current);
    }
    previewSyncTimerRef.current = window.setTimeout(() => {
      previewSyncTimerRef.current = null;
      const playAfterSync = previewShouldPlayRef.current;
      previewShouldPlayRef.current = false;
      syncPreviewTo(time, playAfterSync);
    }, delay);
  }

  function keepPreviewNear(time: number) {
    const preview = previewRef.current;
    if (!preview || !Number.isFinite(time)) {
      return;
    }
    if (preview.seeking) {
      return;
    }
    if (playIntentRef.current && preview.paused) {
      preview.muted = true;
      void preview.play().catch(() => undefined);
    }
    if (Math.abs(preview.currentTime - time) > 1.75) {
      schedulePreviewSync(time, playIntentRef.current, 120);
    }
  }

  function playPreviewFrom(time: number) {
    schedulePreviewSync(time, true, 0);
  }

  function pausePreview() {
    clearPendingPreviewSync();
    previewSeekTokenRef.current += 1;
    previewRef.current?.pause();
  }

  function play() {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    playIntentRef.current = true;
    isPlayingRef.current = true;
    setIsPlaying(true);
    void media.play().catch(() => {
      playIntentRef.current = false;
      isPlayingRef.current = false;
      setIsPlaying(false);
    });
    playPreviewFrom(media.currentTime);
  }

  function pause() {
    playIntentRef.current = false;
    isPlayingRef.current = false;
    pendingSeekRef.current = null;
    mediaRef.current?.pause();
    pausePreview();
    setIsPlaying(false);
  }

  function applyMediaSeek(media: HTMLMediaElement, time: number, shouldPlay: boolean): boolean {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    try {
      if (media.readyState === 0) {
        pendingSeekRef.current = { time: safeTime, shouldPlay };
        media.load();
        return false;
      }
      if (Math.abs(media.currentTime - safeTime) > 0.05) {
        if ("fastSeek" in media && typeof media.fastSeek === "function") {
          media.fastSeek(safeTime);
        } else {
          media.currentTime = safeTime;
        }
      }
      if (shouldPlay && media.paused) {
        void media.play().catch(() => undefined);
      }
      return true;
    } catch {
      pendingSeekRef.current = { time: safeTime, shouldPlay };
      return false;
    }
  }

  function flushPendingSeek(media: HTMLMediaElement) {
    const pending = pendingSeekRef.current;
    if (!pending) {
      return;
    }
    pendingSeekRef.current = null;
    applyMediaSeek(media, pending.time, pending.shouldPlay);
    schedulePreviewSync(pending.time, pending.shouldPlay, 0);
  }

  function seek(time: number, shouldPlay = false) {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    const media = mediaRef.current;
    const shouldResume = shouldPlay || playIntentRef.current || Boolean(media && !media.paused);
    lastSeekAtRef.current = Date.now();
    if (shouldResume) {
      playIntentRef.current = true;
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
    if (media) {
      applyMediaSeek(media, safeTime, shouldResume);
    } else {
      pendingSeekRef.current = { time: safeTime, shouldPlay: shouldResume };
    }
    timelineTimeRef.current = safeTime;
    schedulePreviewSync(safeTime, shouldResume, 160);
    setCurrentTime(safeTime);
  }

  function restart() {
    seek(0, false);
  }

  function setKnownDuration(nextDuration: number) {
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration((current) => Math.max(current, nextDuration));
    }
  }

  function onLoadedMetadata(event: SyntheticEvent<HTMLMediaElement>) {
    event.currentTarget.volume = mutedRef.current ? 0 : volumeRef.current;
    setKnownDuration(event.currentTarget.duration);
    flushPendingSeek(event.currentTarget);
  }

  function onDurationChange(event: SyntheticEvent<HTMLMediaElement>) {
    setKnownDuration(event.currentTarget.duration);
  }

  function onCanPlay(event: SyntheticEvent<HTMLMediaElement>) {
    event.currentTarget.volume = mutedRef.current ? 0 : volumeRef.current;
    setKnownDuration(event.currentTarget.duration);
    flushPendingSeek(event.currentTarget);
  }

  function onTimeUpdate(event: SyntheticEvent<HTMLMediaElement>) {
    const time = event.currentTarget.currentTime;
    timelineTimeRef.current = time;
    setCurrentTime(time);
    if (!event.currentTarget.seeking) {
      keepPreviewNear(time);
    }
  }

  function onPlay(event: SyntheticEvent<HTMLMediaElement>) {
    playIntentRef.current = true;
    isPlayingRef.current = true;
    setIsPlaying(true);
    playPreviewFrom(event.currentTarget.currentTime);
  }

  function onPause(event: SyntheticEvent<HTMLMediaElement>) {
    const seekIsFresh = Date.now() - lastSeekAtRef.current < 700;
    if ((event.currentTarget.seeking || seekIsFresh) && playIntentRef.current && !event.currentTarget.ended) {
      window.setTimeout(() => {
        const media = mediaRef.current;
        if (!media || !playIntentRef.current || !media.paused) {
          return;
        }
        void media.play().catch(() => undefined);
        playPreviewFrom(media.currentTime);
      }, 80);
      return;
    }
    playIntentRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    pausePreview();
  }

  function onEnded() {
    playIntentRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    pausePreview();
    setEndedCount((count) => count + 1);
  }

  function onSeeking(event: SyntheticEvent<HTMLMediaElement>) {
    lastSeekAtRef.current = Date.now();
    timelineTimeRef.current = event.currentTarget.currentTime;
    schedulePreviewSync(event.currentTarget.currentTime, playIntentRef.current, 160);
  }

  function onSeeked(event: SyntheticEvent<HTMLMediaElement>) {
    timelineTimeRef.current = event.currentTarget.currentTime;
    const shouldResume = playIntentRef.current || !event.currentTarget.paused;
    schedulePreviewSync(event.currentTarget.currentTime, shouldResume, 0);
    if (shouldResume && event.currentTarget.paused) {
      void event.currentTarget.play().catch(() => undefined);
    }
  }

  function setVolume(next: number) {
    const clamped = Math.max(0, Math.min(1, next));
    setVolumeState(clamped);
    if (clamped > 0) {
      setMuted(false);
      volumeBeforeMuteRef.current = clamped;
    }
  }

  function toggleMute() {
    if (muted || volume <= 0) {
      const restored = volumeBeforeMuteRef.current > 0 ? volumeBeforeMuteRef.current : 1;
      setMuted(false);
      setVolumeState(restored);
      return;
    }
    volumeBeforeMuteRef.current = volume;
    setMuted(true);
  }

  return {
    mediaRef,
    previewRef,
    mediaUrl,
    previewUrl,
    mediaStatus,
    previewStatus,
    currentTime,
    duration,
    isPlaying,
    endedCount,
    canControl: Boolean(mediaUrl),
    volume,
    muted,
    setVolume,
    toggleMute,
    play,
    pause,
    restart,
    seek,
    onLoadedMetadata,
    onDurationChange,
    onCanPlay,
    onTimeUpdate,
    onPlay,
    onPause,
    onEnded,
    onSeeking,
    onSeeked
  };
}

function useMicrophoneMonitor(): MicrophoneMonitorController {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const selectedDeviceIdRef = useRef("");
  const monitorGainRef = useRef(0.35);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [monitorGain, setMonitorGainState] = useState(0.35);
  const [noiseReduction, setNoiseReduction] = useState(false);
  const [status, setStatus] = useState("Monitor off");

  const closeCurrentMonitor = useCallback(() => {
    try {
      sourceRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }

    sourceRef.current = null;
    gainNodeRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  const refreshDevices = useCallback(() => {
    void (async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setDevices([]);
        setStatus("Microphone API unavailable");
        return;
      }

      try {
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const inputDevices = mediaDevices
          .filter((device) => device.kind === "audioinput")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || (index === 0 ? "System default input" : `Microphone ${index + 1}`)
          }));

        setDevices(inputDevices);
        if (selectedDeviceIdRef.current && !inputDevices.some((device) => device.deviceId === selectedDeviceIdRef.current)) {
          setSelectedDeviceId(inputDevices[0]?.deviceId ?? "");
        }
        if (inputDevices.length === 0) {
          setStatus("No input devices found");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to list input devices");
      }
    })();
  }, []);

  const startMonitor = useCallback(async () => {
    closeCurrentMonitor();

    if (!navigator.mediaDevices?.getUserMedia) {
      setIsMonitoring(false);
      setStatus("Microphone API unavailable");
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      setIsMonitoring(false);
      setStatus("Audio monitor unavailable");
      return;
    }

    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: noiseReduction,
        noiseSuppression: noiseReduction,
        autoGainControl: noiseReduction
      };
      if (selectedDeviceIdRef.current) {
        audioConstraints.deviceId = { exact: selectedDeviceIdRef.current };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const audioContext = new AudioContextConstructor({ latencyHint: "interactive" });
      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = monitorGainRef.current;
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      await audioContext.resume();

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      gainNodeRef.current = gainNode;
      setStatus("Monitoring input. Use headphones to avoid feedback.");
      refreshDevices();
    } catch (error) {
      closeCurrentMonitor();
      setIsMonitoring(false);
      setStatus(error instanceof Error ? error.message : "Failed to start microphone monitor");
    }
  }, [closeCurrentMonitor, noiseReduction, refreshDevices]);

  const setMonitorGain = useCallback((gain: number) => {
    setMonitorGainState(Math.max(0, Math.min(1.5, gain)));
  }, []);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    monitorGainRef.current = monitorGain;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = monitorGain;
    }
  }, [monitorGain]);

  useEffect(() => {
    refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (isMonitoring) {
      void startMonitor();
      return undefined;
    }

    closeCurrentMonitor();
    setStatus("Monitor off");
    return undefined;
  }, [closeCurrentMonitor, isMonitoring, noiseReduction, selectedDeviceId, startMonitor]);

  useEffect(() => {
    return () => closeCurrentMonitor();
  }, [closeCurrentMonitor]);

  return {
    devices,
    selectedDeviceId,
    isMonitoring,
    monitorGain,
    noiseReduction,
    status,
    setSelectedDeviceId,
    setIsMonitoring,
    setMonitorGain,
    setNoiseReduction,
    refreshDevices
  };
}

function useMediaUrl(targetPath: string | null): string {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let ignore = false;
    setUrl("");

    if (!targetPath) {
      return;
    }

    audioWorkflow
      .getMediaUrl(targetPath)
      .then((nextUrl) => {
        if (!ignore) {
          setUrl(nextUrl);
        }
      })
      .catch(() => {
        if (!ignore) {
          setUrl("");
        }
      });

    return () => {
      ignore = true;
    };
  }, [targetPath]);

  return url;
}





function statusFromResult(result: JobResult): JobStatus {
  if (result.signal === "SIGTERM") {
    return "canceled";
  }
  return result.exitCode === 0 ? "complete" : "failed";
}

function localizeCliError(rawText: string, t: Translator): string | null {
  const text = rawText.toLowerCase();
  if (!text.trim()) {
    return null;
  }
  if (text.includes("missing dependency: yt-dlp") || text.includes("yt-dlp was not found")) {
    return t("common:errors.ytDlp");
  }
  if (text.includes("missing dependency: ffmpeg") || text.includes("ffmpeg")) {
    return t("common:errors.ffmpeg");
  }
  if (text.includes("missing python package: faster-whisper") || text.includes("faster_whisper")) {
    return t("common:errors.whisper");
  }
  if (text.includes("missing python package: whisper-timestamped") || text.includes("whisper_timestamped")) {
    return t("common:errors.whisperTimestamped");
  }
  if (text.includes("missing dependency: audio-separator") || text.includes("audio_separator")) {
    return t("common:errors.separator");
  }
  if (text.includes("no platform subtitles found")) {
    return t("common:errors.noPlatformSubtitles");
  }
  if (text.includes("sign in") || text.includes("cookies") || text.includes("confirm you")) {
    return t("common:errors.cookies");
  }
  if (text.includes("unsupported media file") || text.includes("no supported media files")) {
    return t("common:errors.unsupportedMedia");
  }
  return null;
}

function searchResultThumbnail(row: YoutubeSearchResult): string | undefined {
  if (row.thumbnailUrl) {
    return row.thumbnailUrl;
  }
  return row.platform === "bilibili" ? undefined : `https://i.ytimg.com/vi/${row.videoId}/mqdefault.jpg`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? filePath;
}

function bestWordTimingSubtitlePath(selectedSubtitlePath: string, subtitleAssets: GeneratedAsset[]): string {
  const jsonAssets = subtitleAssets.filter((asset) => asset.exists && asset.extension.toLowerCase() === "json");
  if (jsonAssets.length === 0) {
    return "";
  }

  if (selectedSubtitlePath && selectedSubtitlePath.toLowerCase().endsWith(".json")) {
    return selectedSubtitlePath;
  }

  const selectedStem = selectedSubtitlePath ? fileStemKey(selectedSubtitlePath) : "";
  return jsonAssets.find((asset) => selectedStem && fileStemKey(asset.path) === selectedStem)?.path ?? "";
}

function fileStemKey(filePath: string): string {
  return fileNameFromPath(filePath).replace(/\.[^.]+$/, "").toLowerCase();
}

function selectReviewSubtitlePath(activeReview: SavedJobHistory | null, subtitleAssets: GeneratedAsset[]): string {
  if (!activeReview || subtitleAssets.length === 0) {
    return "";
  }

  if (activeReview.primarySubtitle && subtitleAssets.some((asset) => asset.path === activeReview.primarySubtitle && asset.exists)) {
    return activeReview.primarySubtitle;
  }

  return (
    findSubtitleByExtension(subtitleAssets, "lrc") ??
    findSubtitleByExtension(subtitleAssets, "srt") ??
    findSubtitleByExtension(subtitleAssets, "vtt") ??
    findSubtitleByExtension(subtitleAssets, "json") ??
    findSubtitleByExtension(subtitleAssets, "txt") ??
    subtitleAssets.find((asset) => asset.exists)?.path ??
    ""
  );
}

function findSubtitleByExtension(subtitleAssets: GeneratedAsset[], extension: string): string | null {
  return subtitleAssets.find((asset) => asset.exists && asset.extension.toLowerCase() === extension)?.path ?? null;
}

function upsertHistoryEntry(current: SavedJobHistory[], entry: SavedJobHistory): SavedJobHistory[] {
  const entryKey = clientHistoryPackageKey(entry);
  return [
    entry,
    ...current.filter((item) => item.id !== entry.id && (!entryKey || clientHistoryPackageKey(item) !== entryKey))
  ];
}

function ensureKaraokeFormats(): OutputFormat[] {
  return ["lrc"];
}

function playbackSummary(bundle: PlaybackBundle): string {
  if (bundle.localAudioPath && bundle.videoPreviewPath) {
    return "Local audio with synced video preview";
  }
  if (bundle.localAudioPath) {
    return "Local audio playback package";
  }
  if (bundle.localVideoPath) {
    return "Local video playback package";
  }
  return bundle.unavailableReason ?? "Playback package unavailable";
}

function parseSubtitleFile(filePath: string, text: string): Cue[] {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (!text.trim()) {
    return [];
  }
  if (extension === "json") {
    return parseJsonCues(text);
  }
  if (extension === "lrc") {
    return parseLrcCues(text);
  }
  if (extension === "srt" || extension === "vtt" || extension === "txt") {
    return parseBlockCues(text);
  }
  return [];
}

function parseJsonCues(text: string): Cue[] {
  try {
    const payload = JSON.parse(text) as {
      cues?: Array<{
        start?: number;
        end?: number;
        text?: string;
        words?: Array<{
          id?: string;
          text?: string;
          word?: string;
          start?: number;
          end?: number;
          start_time?: number;
          end_time?: number;
          confidence?: number;
          probability?: number;
        }>;
      }>;
    };
    return (payload.cues ?? [])
      .map((cue, index) => ({
        start: Number(cue.start),
        end: Number(cue.end),
        text: String(cue.text ?? "").trim(),
        words: normalizeTimedWords(cue.words, String(cue.text ?? ""), `json-${index}`)
      }))
      .filter(isValidCue)
      .map((cue, index) => withTimedWords(cue, `json-${index}`));
  } catch {
    return [];
  }
}

function parseLrcCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    const lyric = line.replace(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g, "").trim();
    for (const match of matches) {
      cues.push({
        start: Number(match[1]) * 60 + Number(match[2]),
        end: Number(match[1]) * 60 + Number(match[2]) + 2.5,
        text: lyric
      });
    }
  }
  return cues
    .filter(isValidCue)
    .sort((a, b) => a.start - b.start)
    .map((cue, index, list) => ({
      ...cue,
      end: list[index + 1] ? Math.max(cue.start + 0.25, list[index + 1].start) : cue.end
    }))
    .map((cue, index) => withTimedWords(cue, `lrc-${index}`));
}

function parseBlockCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const normalized = text.replace(/^WEBVTT.*?(?:\r?\n){2}/s, "");
  const blocks = normalized.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) {
      continue;
    }
    const match = lines[timeIndex].match(/(?<start>\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{1,3})\s+-->\s+(?<end>\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{1,3})/);
    if (!match?.groups) {
      continue;
    }
    const cueText = lines
      .slice(timeIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    cues.push({
      start: timestampToSeconds(match.groups.start),
      end: timestampToSeconds(match.groups.end),
      text: cueText
    });
  }
  return cues.filter(isValidCue).map((cue, index) => withTimedWords(cue, `block-${index}`));
}

function normalizeTimedWords(rawWords: unknown, cueText: string, cueKey: string): TimedWord[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map<TimedWord | null>((word, index) => {
      if (!word || typeof word !== "object") {
        return null;
      }

      const rawWord = word as {
        id?: unknown;
        text?: unknown;
        word?: unknown;
        start?: unknown;
        end?: unknown;
        start_time?: unknown;
        end_time?: unknown;
        confidence?: unknown;
        probability?: unknown;
      };
      const text = String(rawWord.text ?? rawWord.word ?? "").trim();
      const start = Number(rawWord.start ?? rawWord.start_time);
      const end = Number(rawWord.end ?? rawWord.end_time);
      const confidenceValue = Number(rawWord.confidence ?? rawWord.probability);

      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      const normalizedWord: TimedWord = {
        id: String(rawWord.id ?? `${cueKey}-${index}`),
        text,
        start,
        end,
        compact: shouldUseCompactWordSpacing(text, cueText)
      };
      if (Number.isFinite(confidenceValue)) {
        normalizedWord.confidence = confidenceValue;
      }
      return normalizedWord;
    })
    .filter((word): word is TimedWord => Boolean(word));
}

function timestampToSeconds(value: string): number {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number.NaN;
}

function isValidCue(cue: Cue): boolean {
  return Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text.length > 0;
}

function findActiveCue(cues: Cue[], time: number): number {
  if (cues.length === 0) {
    return -1;
  }
  const activeIndex = cues.findIndex((cue) => time >= cue.start && time < cue.end);
  if (activeIndex >= 0) {
    return activeIndex;
  }
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (time >= cues[index].start) {
      return index;
    }
  }
  return -1;
}

function buildTrackAssets(assets: GeneratedAsset[]): TrackAssets {
  const mediaAssets = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path) && asset.role !== "transcribe" && asset.role !== "vocal");
  const audioAssets = mediaAssets.filter((asset) => isAudioPath(asset.path));
  const backing = audioAssets.find((asset) => asset.role === "backing") ?? audioAssets.find((asset) => /instrumental|no[_-]?vocals?|accompaniment|karaoke/i.test(asset.name)) ?? null;
  const original =
    audioAssets.find((asset) => asset.role === "original") ??
    audioAssets.find((asset) => asset.type === "media" && !/\.transcribe\.(wav|mp3|m4a|flac)$/i.test(asset.name)) ??
    audioAssets.find((asset) => asset.type === "media") ??
    mediaAssets.find((asset) => asset.type === "media") ??
    null;

  return {
    original,
    backing,
    vocal: null
  };
}

function scopePlayableAssetsToReview(activeReview: SavedJobHistory | null, assets: GeneratedAsset[]): GeneratedAsset[] {
  const playableAssets = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path) && asset.role !== "transcribe" && asset.role !== "vocal");
  if (!activeReview) {
    return playableAssets;
  }

  const reviewKey = reviewMediaFamilyKey(activeReview);
  if (!reviewKey) {
    return playableAssets;
  }

  const scopedAssets = playableAssets.filter((asset) => keysReferToSameMedia(mediaFamilyKeyFromName(asset.name), reviewKey));
  return scopedAssets.length > 0 ? scopedAssets : playableAssets;
}

function scopeSubtitleAssetsToReview(activeReview: SavedJobHistory | null, assets: GeneratedAsset[]): GeneratedAsset[] {
  const subtitleAssets = assets.filter((asset) => asset.exists && asset.type === "subtitle");
  if (!activeReview) {
    return subtitleAssets;
  }

  const reviewKey = reviewMediaFamilyKey(activeReview);
  if (!reviewKey) {
    return subtitleAssets;
  }

  const scopedAssets = subtitleAssets.filter((asset) => keysReferToSameMedia(mediaFamilyKeyFromName(asset.name), reviewKey));
  return scopedAssets.length > 0 ? scopedAssets : subtitleAssets;
}

function keysReferToSameMedia(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function isAudioPath(filePath: string): boolean {
  return /\.(wav|waw|mp3|m4a|flac|aac|ogg|opus|aiff|aif)$/i.test(filePath);
}

function isLikelySeparatedStemPath(filePath: string): boolean {
  const basename = filePath.split(/[\\/]/).pop() ?? filePath;
  return /(^|[_\s([.-])(vocals?|voice|acapella|instrumental|inst|no[_\s-]?vocals?|backing|karaoke)([_\s)\].-]|$)/i.test(basename);
}

function withPackageOutputDir(runOptions: JobOptions, jobId: string, overrides: Partial<JobOptions>): JobOptions {
  if (Object.prototype.hasOwnProperty.call(overrides, "outputDir")) {
    return runOptions;
  }

  const outputRoot = runOptions.outputDir.trim();
  if (!outputRoot) {
    return runOptions;
  }

  return {
    ...runOptions,
    outputDir: `${trimTrailingPathSeparator(outputRoot)}/${packageOutputFolderName(runOptions.input, jobId)}`
  };
}

function trimTrailingPathSeparator(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function packageOutputFolderName(input: string, jobId: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const label = sanitizeOutputFolderLabel(outputLabelFromInput(input));
  return `${label}-${timestamp}-${jobId.slice(0, 8)}`;
}

function outputLabelFromInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "package";
  }

  if (isHttpInput(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, "").split(".")[0] || "url";
      const id =
        url.searchParams.get("v") ??
        url.pathname.split("/").filter(Boolean).at(-1) ??
        "package";
      return `${host}-${id}`;
    } catch {
      return "url-package";
    }
  }

  const basename = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return basename.replace(/\.[^.]+$/, "");
}

function sanitizeOutputFolderLabel(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
    .replace(/\s/g, "-");
  return cleaned || "package";
}

function isSeparatedStemAsset(asset: GeneratedAsset | undefined): boolean {
  return Boolean(asset && (asset.role === "backing" || asset.role === "vocal" || isLikelySeparatedStemPath(asset.path)));
}

function splitSourceForReview(activeReview: SavedJobHistory): { input: string; separate: boolean } {
  const originalAsset = activeReview.assets.find((asset) => asset.exists && asset.role === "original" && isAudioPath(asset.path));
  if (originalAsset) {
    return { input: originalAsset.path, separate: true };
  }

  if (activeReview.sourceUrl) {
    return { input: activeReview.sourceUrl, separate: true };
  }

  if (isHttpInput(activeReview.input)) {
    return { input: activeReview.input, separate: true };
  }

  if (activeReview.input && isAudioPath(activeReview.input) && !isLikelySeparatedStemPath(activeReview.input)) {
    return { input: activeReview.input, separate: true };
  }

  const reusableMedia = activeReview.assets.find(
    (asset) => asset.exists && asset.type === "media" && isAudioPath(asset.path) && !isSeparatedStemAsset(asset)
  );
  if (reusableMedia) {
    return { input: reusableMedia.path, separate: true };
  }

  const fallbackStem = activeReview.assets.find(
    (asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioPath(asset.path)
  );
  const fallbackInput = fallbackStem?.path ?? activeReview.input;
  return { input: fallbackInput, separate: !isSeparatedStemAsset(fallbackStem) && !isLikelySeparatedStemPath(fallbackInput) };
}

function shouldAutoSaveAudio(options: JobOptions): boolean {
  if (options.workflowMode !== "karaoke") {
    return false;
  }
  return isHttpInput(options.input.trim()) || isVideoPath(options.input.trim());
}
