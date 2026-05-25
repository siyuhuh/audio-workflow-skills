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
import { TopologyBackgroundCanvas } from "./components/visual/TopologyBackgroundCanvas";
import { cn } from "./lib/cn";
import { Button } from "./components/ui/Button";
import { Eyebrow } from "./components/ui/Eyebrow";
import { Field } from "./components/ui/Field";
import { Checkbox } from "./components/ui/Checkbox";
import { SegmentedControl } from "./components/ui/SegmentedControl";
import { Icon } from "./components/ui/Icon";

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
  model: "small",
  language: "",
  subLangs: "",
  browser: "",
  cookies: "",
  formats: ["lrc"]
};

function isAccentColor(value: unknown): value is AccentColor {
  return value === "green" || value === "lime" || value === "mint" || value === "teal";
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
        themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" || parsed.themeMode === "system" ? parsed.themeMode : "dark",
        accentColor: isAccentColor(parsed.accentColor) ? parsed.accentColor : "green",
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
        themeMode: "dark",
        accentColor: "green",
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
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [accentColor, setAccentColor] = useState<AccentColor>("green");
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
  const [youtubePanelOpen, setYoutubePanelOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"home" | "add">("home");
  const [mediaSearchPlatform, setMediaSearchPlatform] = useState<"youtube" | "bilibili">("youtube");
  const [youtubeQuery, setYoutubeQuery] = useState("");
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
  const previewVideoPath = packageVideoPath && packageVideoPath !== selectedMediaPath ? packageVideoPath : null;
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
  const showWorkspace = Boolean(activeReview || jobs.length > 0 || advancedOpen || workspaceMode === "add");
  const showActivityPane = Boolean(jobs.length > 0 || advancedOpen);
  const effectiveTheme = themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  const currentNavTarget: AppNavTarget = appScene === "karaoke-room" ? "karaoke" : workspaceMode;
  const canNavigateToKaraoke = Boolean(activeReview?.workflowMode === "karaoke" && activeReview.playbackBundle.controllable && selectedSubtitlePath);

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
        setThemeMode(settings?.themeMode ?? "dark");
        setAccentColor(settings?.accentColor ?? "green");
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

  useEffect(() => {
    const trimmed = options.input.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
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
        .prefetchUrlMetadata?.(trimmed)
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

  async function runYoutubeDiscovery() {
    setYoutubeError("");
    setYoutubeSearching(true);
    setYoutubeResults([]);
    try {
      const search = mediaSearchPlatform === "bilibili" ? audioWorkflow.bilibiliSearch : audioWorkflow.youtubeSearch;
      const rows = await search(youtubeQuery, { appendKaraoke: youtubeAppendKaraoke });
      setYoutubeResults(rows);
      if (!rows.length) {
        setYoutubeError(t("capture:search.noResults"));
      }
    } catch (error) {
      setYoutubeResults([]);
      setYoutubeError(
        error instanceof Error
          ? error.message
          : t("capture:search.failed", { platform: mediaSearchPlatform === "bilibili" ? t("capture:search.bilibili") : t("capture:search.youtube") })
      );
    } finally {
      setYoutubeSearching(false);
    }
  }

  function applyYoutubeResult(row: YoutubeSearchResult) {
    updateOptions({ input: row.url });
    setYoutubeError("");
    setWorkspaceMode("add");
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
    setYoutubePanelOpen(false);
  }

  function navigateAdd() {
    setWorkspaceMode("add");
    setAppScene("workspace");
    setYoutubePanelOpen(true);
    window.setTimeout(() => captureInputRef.current?.focus(), 0);
  }

  function navigateKaraoke() {
    if (!canNavigateToKaraoke) {
      return;
    }
    setReviewTab("karaoke");
    setAppScene("karaoke-room");
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
      ? canNavigateToKaraoke
        ? t("common:dock.ready")
        : t("common:dock.needsPackage")
      : currentNavTarget === "add" && cachedPackageForInput
        ? t("common:dock.cached")
        : undefined;

  const floatingNav = (
    <FloatingBottomNav
      active={currentNavTarget}
      karaokeDisabled={!canNavigateToKaraoke}
      contextTitle={dockTitle}
      contextSubtitle={dockSubtitle}
      contextAction={dockAction}
      onHome={navigateHome}
      onAdd={navigateAdd}
      onKaraoke={navigateKaraoke}
      t={t}
    />
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
        if (result.historyEntry.workflowMode === "karaoke") {
          setAppScene("lyrics-review");
          setReviewTab("script");
        } else {
          setAppScene("workspace");
          setReviewTab("script");
        }
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
        actions.push({
          id: "view",
          label: t("capture:notify.viewAction"),
          onClick: () => {
            setSelectedHistoryId(historyEntryId);
            setWorkspaceMode("home");
          }
        });
        if (result.historyEntry.workflowMode === "karaoke") {
          actions.push({
            id: "enterKaraoke",
            label: t("capture:notify.enterKaraokeAction"),
            onClick: () => {
              setSelectedHistoryId(historyEntryId);
              setAppScene("karaoke-room");
            }
          });
        }
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
    const currentIndex = karaokePackages.findIndex((entry) => entry.id === activeReview.id);
    const nextPackage = currentIndex >= 0 ? karaokePackages[currentIndex + 1] : karaokePackages[0];
    if (nextPackage) {
      enterKaraokeFromHistoryAndPlay(nextPackage.id);
    }
  }

  function playPreviousInRoom() {
    if (!activeReview) {
      return;
    }
    const currentIndex = karaokePackages.findIndex((entry) => entry.id === activeReview.id);
    const previousPackage =
      currentIndex > 0
        ? karaokePackages[currentIndex - 1]
        : currentIndex === 0
          ? karaokePackages.at(-1)
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
      <div className="appSceneFrame" data-theme={effectiveTheme} data-accent={accentColor}>
        <LyricsReviewScene
          activeReview={activeReview}
          cues={cues}
          scriptStatus={scriptStatus}
          scriptText={scriptText}
          selectedSubtitlePath={selectedSubtitlePath}
          subtitleAssets={subtitleAssets}
          reviewTitle={reviewDisplayTitle(activeReview)}
          onBack={() => setAppScene("workspace")}
          onCueSeek={(cue) => playbackController.seek(cue.start, true)}
          onEnterKaraoke={saveAndEnterKaraoke}
          onOpenFolder={() => activeReview.outputDir && audioWorkflow.openPath(activeReview.outputDir)}
          onScriptChange={setScriptText}
          onSave={saveScript}
        />
        {floatingNav}
        <NotificationToaster />
      </div>
    );
  }

  if (appScene === "karaoke-room" && activeReview) {
    return (
      <div className="appSceneFrame" data-theme="dark" data-accent={accentColor}>
        <KaraokeRoomScene
          activeCue={activeCue}
          activeCueIndex={activeCueIndex}
          activeReview={activeReview}
          cues={cues}
          playbackBundle={activeReview.playbackBundle}
          playbackController={playbackController}
          roomQueue={roomQueue}
          songOptions={
            karaokePackages.some((entry) => entry.id === activeReview.id)
              ? karaokePackages.map((entry) => ({ id: entry.id, title: reviewDisplayTitle(entry) }))
              : [
                  { id: activeReview.id, title: reviewDisplayTitle(activeReview) },
                  ...karaokePackages.map((entry) => ({ id: entry.id, title: reviewDisplayTitle(entry) }))
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
          onBackHome={() => setAppScene("workspace")}
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
        {floatingNav}
        <NotificationToaster />
      </div>
    );
  }

  return (
    <motion.main
      className="appShell grid min-h-screen w-full gap-6"
      data-has-workspace={showWorkspace}
      data-theme={effectiveTheme}
      data-accent={accentColor}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
    >
      <TopologyBackgroundCanvas />
      <section
        className="grid gap-6"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        {/* Top bar */}
        <header className="brandHeader">
          <div className="brandLogo" aria-label={t("common:appName")}>
            <span className="brandLogoLine">
              <span className="brandLogoStrong">Vocal</span>
              <span className="brandLogoLight">Flow</span>
            </span>
            <span className="brandLogoMeta">{t("common:home.established")}</span>
          </div>

          <HeaderJobStatusPill
            job={liveJob}
            t={t}
            onActivate={() => {
              const target = document.getElementById("captureStatus");
              if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
          />

          <div className="brandHeaderActions">
            <button
              className="brandIconButton"
              type="button"
              onClick={() => setRoomDrawerOpen((open) => !open)}
              aria-label={t("room:drawerToggle")}
              aria-expanded={roomDrawerOpen}
              aria-controls="vocalflow-room-drawer"
            >
              <Icon name="qr" />
              {(roomQueue.length > 0 || roomStatus?.nowPlaying) ? (
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

        {/* Brand hero */}
        <section className="brandHero grid items-center gap-8" data-workspace-mode={workspaceMode}>
          <div className="grid max-w-[820px] content-start gap-5">
            <div className="grid gap-4">
              <Eyebrow>{workspaceMode === "add" ? t("common:home.addKicker") : t("common:home.kicker")}</Eyebrow>
              <h1 className="m-0 max-w-[780px] text-[clamp(44px,7vw,76px)] font-semibold leading-[0.95] tracking-[-0.06em] text-foreground">
                {workspaceMode === "add" ? t("common:home.addTitle") : t("common:home.title")}
              </h1>
              <p className="m-0 max-w-[660px] text-[clamp(16px,2vw,20px)] font-normal leading-relaxed text-muted-foreground">
                {workspaceMode === "add" ? t("common:home.addSubtitle") : t("common:home.subtitle")}
              </p>
              {workspaceMode === "home" ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={navigateKaraoke}
                    disabled={!canNavigateToKaraoke}
                    className="gap-2"
                  >
                    <Icon name="play" />
                    {t("common:actions.enterKaraoke")}
                  </Button>
                  <Button size="lg" onClick={navigateAdd} className="gap-2">
                    <Icon name="plus" />
                    {t("common:nav.add")}
                  </Button>
                </div>
              ) : null}
            </div>

        {/* Capture composer */}
        {workspaceMode === "add" ? (
        <div className="grid gap-3">
          <p className="m-0 text-sm font-medium text-faint">{t("common:home.captureHint")}</p>
          <div className="brandCaptureCard grid gap-3 rounded-lg border border-border bg-elevated p-4 shadow-sm backdrop-blur-md">
            <label className="block text-sm font-medium text-muted-foreground" htmlFor="input">
              {t("capture:inputLabel")}
            </label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                id="input"
                ref={captureInputRef}
                value={options.input}
                onChange={(event) => updateOptions({ input: event.target.value })}
                placeholder={t("capture:inputPlaceholder")}
                className="min-h-14 w-full rounded-md border border-line-strong bg-card px-4 text-lg font-medium text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]"
              />
              <Button
                variant="primary"
                size="lg"
                onClick={() => (cachedPackageForInput ? openCachedInputPackage() : void runJob())}
                disabled={!options.input.trim() || isRunning}
                className="min-w-[120px]"
              >
                <Icon name={cachedPackageForInput ? "folder" : "spark"} />
                {cachedPackageForInput ? t("capture:cache.openExisting") : t("common:actions.run")}
              </Button>
              <Button size="lg" onClick={cancelJob} disabled={!isRunning}>
                {t("common:actions.stop")}
              </Button>
            </div>
            <UrlPreviewCard state={urlPreviewState} preview={urlPreview} t={t} />
            {cachedPackageForInput ? (
              <>
                <p className="m-0 text-sm font-semibold text-accent-strong">
                  {t("capture:cache.hint", { title: reviewDisplayTitle(cachedPackageForInput) })}
                </p>
                <Button onClick={() => void runJob()} disabled={isRunning} className="self-start">
                  {t("capture:cache.redownload")}
                </Button>
              </>
            ) : null}

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
              <Button onClick={chooseInput} className="gap-2">
                <Icon name="folder" />
                {t("capture:selectFile")}
              </Button>
              <Button onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen} className="gap-2">
                <Icon name="settings" />
                {advancedOpen ? t("capture:advanced.hide") : t("capture:advanced.show")}
              </Button>
            </div>
          </div>
          <section className="mediaSearchCard grid gap-3 rounded-lg border border-border bg-card/80 p-4 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-full border border-line-soft bg-muted text-muted-foreground">
                  <Icon name="search" />
                </span>
                <div>
                  <h2 className="m-0 text-base font-semibold text-foreground">{t("capture:search.toggle")}</h2>
                  <p className="m-0 text-sm font-medium text-faint">{t("capture:search.hint")}</p>
                </div>
              </div>
            </div>
            <SegmentedControl
              value={mediaSearchPlatform}
              options={[
                ["youtube", t("capture:search.youtube")],
                ["bilibili", t("capture:search.bilibili")]
              ]}
              onChange={setMediaSearchPlatform}
            />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={youtubeQuery}
                onChange={(event) => setYoutubeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runYoutubeDiscovery();
                  }
                }}
                placeholder={t("capture:search.placeholder")}
                aria-label={t("capture:search.toggle")}
                className="min-h-10 w-full rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]"
              />
              <Button
                onClick={() => void runYoutubeDiscovery()}
                disabled={youtubeSearching || !youtubeQuery.trim()}
                className="gap-2"
              >
                <Icon name="search" />
                {youtubeSearching ? t("common:actions.searching") : t("common:actions.search")}
              </Button>
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
              <p className="m-0 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
                {t("capture:search.karaokeSplitWarning")}
              </p>
            ) : null}
            {youtubeError ? (
              <p className="m-0 text-sm font-medium text-danger">{youtubeError}</p>
            ) : null}
            {youtubeResults.length > 0 ? (
              <ul
                aria-label={t("capture:search.toggle")}
                className="m-0 grid max-h-[52vh] list-none gap-0 overflow-y-auto overflow-x-hidden rounded-md border border-border p-0"
              >
                {youtubeResults.map((row) => (
                  <li
                    key={row.videoId}
                    className="flex gap-3 border-b border-border bg-card p-2.5 last:border-b-0"
                  >
                    <div className="aspect-video w-40 max-w-[38vw] flex-none self-center overflow-hidden rounded-md bg-black">
                      {searchResultThumbnail(row) ? (
                        <img
                          src={searchResultThumbnail(row)}
                          alt=""
                          loading="lazy"
                          width={160}
                          height={90}
                          className="block h-auto w-full object-cover"
                        />
                      ) : (
                        <span className="grid aspect-video place-items-center text-sm font-bold text-white/85">
                          {row.platform === "bilibili"
                            ? t("capture:search.bilibili")
                            : t("capture:search.youtube")}
                        </span>
                      )}
                    </div>
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <div className="overflow-hidden text-ellipsis text-base font-semibold leading-snug text-foreground">
                        {row.title}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground">
                        {row.channel ? `${row.channel} · ` : ""}
                        {row.durationLabel || "—"}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => applyYoutubeResult(row)}>
                          {t("capture:search.useThisLink")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void audioWorkflow.openExternalUrl(row.url)}
                        >
                          {t("capture:search.openInBrowser")}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
        ) : null}
          </div>
        </section>

        <section id="captureStatus" aria-label={t("capture:jobStream.headerLabel")} className="grid gap-3 scroll-mt-32">
          <LiveJobStatus job={liveJob} t={t} />

          <StageChain stages={progressStages} isRunning={isRunning} t={t} />
        </section>

        {workspaceMode === "home" ? (
          <section className="selectionGallery grid gap-4" aria-label={t("library:shelfHeader")}>
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
              <section className="grid gap-3 rounded-lg border border-border bg-card/72 p-4 shadow-sm backdrop-blur-md">
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
              </section>
            ) : null}

            {!stats.featured && stats.shelfList.length === 0 ? (
              <section
                aria-label={t("library:emptyTitle")}
                className="grid gap-3 rounded-lg border border-dashed border-border bg-elevated p-8 text-center"
              >
                <h2 className="m-0 text-lg font-semibold text-foreground">{t("library:emptyTitle")}</h2>
                <p className="m-0 text-sm font-medium text-muted-foreground">{t("library:emptyBody")}</p>
                <Button onClick={navigateAdd} className="mx-auto gap-2">
                  <Icon name="plus" />
                  {t("common:nav.add")}
                </Button>
              </section>
            ) : null}
          </section>
        ) : null}
      </section>

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
      {floatingNav}
      <NotificationToaster />
    </motion.main>
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
    setKnownDuration(event.currentTarget.duration);
    flushPendingSeek(event.currentTarget);
  }

  function onDurationChange(event: SyntheticEvent<HTMLMediaElement>) {
    setKnownDuration(event.currentTarget.duration);
  }

  function onCanPlay(event: SyntheticEvent<HTMLMediaElement>) {
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

function isHttpInput(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function shouldAutoSaveAudio(options: JobOptions): boolean {
  if (options.workflowMode !== "karaoke") {
    return false;
  }
  return isHttpInput(options.input.trim()) || isVideoPath(options.input.trim());
}
