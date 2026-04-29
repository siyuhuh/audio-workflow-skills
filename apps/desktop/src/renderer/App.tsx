import { type CSSProperties, type DragEvent, type ReactNode, type RefObject, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  UserSettings,
  WorkflowMode,
  YoutubeSearchResult
} from "../shared/types";
import type { JobProgressStage } from "../shared/types";
import { hydrateLocaleFromHost, setAppLocale } from "./i18n";
import { motionDuration, motionEase } from "./lib/motion";
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
import { FloatingBottomNav, type AppNavTarget } from "./components/FloatingBottomNav";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { RoomRemoteDrawer } from "./components/RoomRemoteDrawer";
import { SettingsPanel } from "./components/SettingsPanel";
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
import { Eyebrow } from "./components/ui/Eyebrow";
import { Field } from "./components/ui/Field";
import { Checkbox } from "./components/ui/Checkbox";
import { SegmentedControl } from "./components/ui/SegmentedControl";

function isSampleHistoryEntry(entry: SavedJobHistory): boolean {
  return entry.input.startsWith("sample:") || entry.id.startsWith("sample:");
}

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
    (asset) => asset.exists && (asset.role === "backing" || asset.role === "vocal")
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
}

function FeaturedPackageEntry({ entry, variant, onEnter, onOpen }: FeaturedPackageEntryProps) {
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

interface StatusPillProps {
  state: JobStatus;
  children: ReactNode;
}

function StatusPill({ state, children }: StatusPillProps) {
  const stateClass =
    state === "running"
      ? "border-primary/45 bg-accent-soft text-accent-strong"
      : state === "complete"
        ? "border-success/45 bg-success-soft text-success"
        : state === "failed" || state === "canceled"
          ? "border-danger/45 bg-danger-soft text-danger"
          : "border-border bg-card text-muted-foreground";

  return (
    <div
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium",
        stateClass
      )}
    >
      {children}
    </div>
  );
}
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

interface ResourcePackage {
  entry: SavedJobHistory;
  duplicateIds: string[];
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
  model: "medium",
  language: "",
  subLangs: "",
  browser: "",
  cookies: "",
  formats: ["lrc", "json", "ass"]
};

function createHttpAudioWorkflowApi(): AudioWorkflowApi {
  const baseUrl = "http://127.0.0.1:5175";
  const readFallbackSettings = (): UserSettings => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem("vocalflow.settings") ?? "{}") as Partial<UserSettings>;
      return {
        locale: parsed.locale === "en" || parsed.locale === "zh" ? parsed.locale : null,
        themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" || parsed.themeMode === "system" ? parsed.themeMode : "dark",
        accentColor: parsed.accentColor === "green" ? parsed.accentColor : "green"
      };
    } catch {
      return { locale: null, themeMode: "dark", accentColor: "green" };
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
  const currentLocale = (i18n.resolvedLanguage ?? i18n.language ?? "en") as AppLocale;
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [accentColor, setAccentColor] = useState<AccentColor>("green");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [mediaSearchPlatform, setMediaSearchPlatform] = useState<"youtube" | "bilibili">("youtube");
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeAppendKaraoke, setYoutubeAppendKaraoke] = useState(true);
  const [youtubeResults, setYoutubeResults] = useState<YoutubeSearchResult[]>([]);
  const [youtubeSearching, setYoutubeSearching] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomMessage, setRoomMessage] = useState("");
  const [roomQrDataUrl, setRoomQrDataUrl] = useState("");
  const [progressStages, setProgressStages] = useState<Map<string, StageProgress>>(() => new Map());
  const [roomDrawerOpen, setRoomDrawerOpen] = useState(false);
  const captureInputRef = useRef<HTMLInputElement | null>(null);

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
  const resourcePackages = useMemo(() => groupResourcePackages(history.filter((entry) => entry.workflowMode === "karaoke")), [history]);
  const karaokePackages = useMemo(() => resourcePackages.map((resource) => resource.entry), [resourcePackages]);
  const processedResources = useMemo(() => resourcePackages.slice(0, 6), [resourcePackages]);
  const userPackages = useMemo(
    () => processedResources.filter((resource) => !isSampleHistoryEntry(resource.entry)),
    [processedResources]
  );
  const samplePackages = useMemo(
    () => processedResources.filter((resource) => isSampleHistoryEntry(resource.entry)),
    [processedResources]
  );
  const featuredVariant: "continue" | "sample" = userPackages[0] ? "continue" : "sample";
  const featuredPackage = userPackages[0] ?? samplePackages[0] ?? null;
  const shelfPackages = useMemo(
    () => processedResources.filter((resource) => resource !== featuredPackage),
    [processedResources, featuredPackage]
  );
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
  const showWorkspace = Boolean(activeReview || jobs.length > 0 || advancedOpen);
  const showActivityPane = Boolean(jobs.length > 0 || advancedOpen);
  const effectiveTheme = themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  const currentNavTarget: AppNavTarget = appScene === "karaoke-room" ? "karaoke" : youtubePanelOpen || document.activeElement === captureInputRef.current ? "add" : "home";
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
    const nextRole: TrackRole = trackAssets.backing ? "backing" : trackAssets.original ? "original" : trackAssets.vocal ? "vocal" : "custom";
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
          setScriptStatus("Loaded");
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

  function updateOptions(update: Partial<JobOptions>) {
    setOptions((current) => ({ ...current, ...update }));
  }

  function setWorkflowMode(workflowMode: WorkflowMode) {
    updateOptions({
      workflowMode,
      localFallback: workflowMode === "karaoke",
      separate: workflowMode === "karaoke" ? options.separate : false,
      saveAudio: false,
      formats: workflowMode === "karaoke" ? ["lrc", "json", "ass"] : ["srt"]
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
  }

  function openCachedInputPackage() {
    if (!cachedPackageForInput) {
      return;
    }
    setSelectedHistoryId(cachedPackageForInput.id);
    setActiveJobId(null);
    setReviewTab("karaoke");
    setAppScene(cachedPackageForInput.workflowMode === "karaoke" ? "lyrics-review" : "workspace");
    setStatusMessage(t("capture:cache.openedExisting"));
  }

  function navigateHome() {
    setAppScene("workspace");
    setYoutubePanelOpen(false);
  }

  function navigateAdd() {
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
    }
  }

  async function runJob(overrides: Partial<JobOptions> = {}): Promise<JobResult | null> {
    const runOptions = { ...options, ...overrides };
    if (!runOptions.input.trim() || isRunning) {
      return null;
    }

    const jobId = crypto.randomUUID();
    const nextJob: JobRecord = {
      id: jobId,
      input: runOptions.input,
      status: "running",
      startedAt: new Date().toLocaleTimeString()
    };

    setJobs((current) => [nextJob, ...current]);
    setActiveJobId(jobId);
    setSelectedHistoryId(null);
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
      return null;
    }
  }

  async function processRoomQueueItem(item: RoomQueueItem) {
    if (isRunning || item.status !== "queued") {
      return;
    }
    try {
      setRoomMessage(t("capture:room.processing", { title: item.title }));
      setRoomStatus(await audioWorkflow.startRoomQueueItem(item.id));
      const result = await runJob({
        input: item.input,
        workflowMode: "karaoke",
        localFallback: true,
        formats: ["lrc", "json", "ass"]
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
    } catch (error) {
      setRoomStatus(await audioWorkflow.finishRoomQueueItem(item.id, "failed", null, error instanceof Error ? error.message : t("capture:room.failed")));
      setRoomMessage(error instanceof Error ? error.message : t("capture:room.failed"));
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
    setScriptStatus("Saving");
    try {
      await audioWorkflow.writeTextFile(selectedSubtitlePath, scriptText);
      setScriptStatus("Saved");
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
    const reusableAudio =
      activeReview.assets.find((asset) => asset.exists && asset.role === "original" && isAudioPath(asset.path))?.path ??
      activeReview.playbackBundle.localAudioPath ??
      activeReview.primaryMedia ??
      activeReview.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioPath(asset.path))?.path ??
      activeReview.input;
    void runJob({
      input: reusableAudio,
      workflowMode: "karaoke",
      separate: true,
      localFallback: true,
      saveAudio: true,
      outputDir: activeReview.outputDir,
      formats: ensureKaraokeFormats(options.formats)
    });
  }

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
          onEnterKaraoke={saveAndEnterKaraoke}
          onOpenFolder={() => activeReview.outputDir && audioWorkflow.openPath(activeReview.outputDir)}
          onScriptChange={setScriptText}
          onSave={saveScript}
        />
        {floatingNav}
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
          onBackHome={() => setAppScene("workspace")}
          onBackToLyrics={() => setAppScene("lyrics-review")}
          onLyricEffectChange={setLyricEffect}
          onLyricFontChange={setLyricFont}
          onOpenOriginalVideo={() => activeReview.sourceUrl && audioWorkflow.openExternalUrl(activeReview.sourceUrl)}
          onPackageChange={enterKaraokeFromHistory}
          onSplitVocals={splitActiveReview}
          onTrackRoleChange={setTrackRole}
          isRunning={isRunning}
        />
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
      <section
        className="grid gap-6"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5" aria-label={t("common:appName")}>
            <span
              className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-xs"
              aria-hidden="true"
            >
              VF
            </span>
            <span className="text-sm font-semibold text-foreground">{t("common:appName")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setSettingsOpen(true)}>{t("settings:button")}</Button>
            <Button
              data-active={roomDrawerOpen}
              onClick={() => setRoomDrawerOpen((open) => !open)}
              aria-expanded={roomDrawerOpen}
              aria-controls="vocalflow-room-drawer"
              className={cn(
                roomDrawerOpen && "border-line-strong bg-muted text-foreground"
              )}
            >
              <span>{t("room:drawerToggle")}</span>
              {(roomQueue.length > 0 || roomStatus?.nowPlaying) ? (
                <span
                  className="ml-1 inline-block size-2 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]"
                  aria-label={t("room:statusDot")}
                />
              ) : null}
            </Button>
            <StatusPill state={activeJob?.status ?? "idle"}>{statusMessage}</StatusPill>
          </div>
        </div>

        {/* Hero */}
        <div className="grid gap-2">
          <Eyebrow>{t("capture:heroSubtitle")}</Eyebrow>
          <h1 className="m-0 max-w-[720px] text-[clamp(36px,5vw,48px)] font-semibold leading-none tracking-tight text-foreground">
            {t("home:title")}
          </h1>
          <p className="m-0 max-w-[620px] text-base font-normal leading-normal text-muted-foreground">
            {t("home:subtitle")}
          </p>
        </div>

        {/* Capture composer */}
        <div className="grid gap-3">
          <p className="m-0 text-sm font-medium text-faint">{t("home:captureHint")}</p>
          <div className="grid gap-3 rounded-lg border border-border bg-elevated p-4 shadow-sm backdrop-blur-md">
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
                {cachedPackageForInput ? t("capture:cache.openExisting") : t("common:actions.run")}
              </Button>
              <Button size="lg" onClick={cancelJob} disabled={!isRunning}>
                {t("common:actions.stop")}
              </Button>
            </div>
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

            <div className="flex flex-wrap items-center gap-3">
              <Button
                selected={youtubePanelOpen}
                onClick={() => setYoutubePanelOpen((open) => !open)}
                aria-expanded={youtubePanelOpen}
              >
                {t("capture:search.toggle")}
              </Button>
              <span className="text-sm font-medium text-faint">{t("capture:search.hint")}</span>
            </div>

            {youtubePanelOpen ? (
              <div className="grid gap-3 rounded-md border border-border bg-card p-3">
                <SegmentedControl
                  value={mediaSearchPlatform}
                  options={[
                    ["youtube", t("capture:search.youtube")],
                    ["bilibili", t("capture:search.bilibili")]
                  ]}
                  onChange={setMediaSearchPlatform}
                />
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={youtubeAppendKaraoke}
                      onChange={(event) => setYoutubeAppendKaraoke(event.target.checked)}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <span>{t("capture:search.appendKaraoke")}</span>
                  </label>
                  <Button
                    onClick={() => void runYoutubeDiscovery()}
                    disabled={youtubeSearching || !youtubeQuery.trim()}
                  >
                    {youtubeSearching ? t("common:actions.searching") : t("common:actions.search")}
                  </Button>
                </div>
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
              </div>
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
              <label className="grid w-40 gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("common:language.label")}
                </span>
                <input
                  value={options.language}
                  onChange={(event) => updateOptions({ language: event.target.value })}
                  placeholder={t("capture:languageHint")}
                  className="min-h-9 w-full rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
              <Button onClick={chooseInput}>{t("capture:selectFile")}</Button>
              <Button onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                {advancedOpen ? t("capture:advanced.hide") : t("capture:advanced.show")}
              </Button>
            </div>
          </div>
        </div>

        <StageChain stages={progressStages} isRunning={isRunning} t={t} />

        {featuredPackage ? (
          <FeaturedPackageEntry
            entry={featuredPackage.entry}
            variant={featuredVariant}
            onEnter={() => enterKaraokeFromHistory(featuredPackage.entry.id)}
            onOpen={() => selectHistoryEntry(featuredPackage.entry.id)}
          />
        ) : null}

        {shelfPackages.length > 0 ? (
          <section
            aria-label={t("library:shelfHeader")}
            className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <Eyebrow className="m-0">{t("library:shelfHeader")}</Eyebrow>
              <span className="text-xs font-medium text-faint tabular-nums">
                {shelfPackages.length}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shelfPackages.map(({ entry, duplicateIds }) => (
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

        {!featuredPackage && shelfPackages.length === 0 ? (
          <section
            aria-label={t("library:emptyTitle")}
            className="grid gap-2 rounded-lg border border-dashed border-border bg-elevated p-8 text-center"
          >
            <h2 className="m-0 text-lg font-semibold text-foreground">{t("library:emptyTitle")}</h2>
            <p className="m-0 text-sm font-medium text-muted-foreground">{t("library:emptyBody")}</p>
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
        onProcessItem={processRoomQueueItem}
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
        onThemeModeChange={handleThemeModeChange}
        onAccentColorChange={handleAccentColorChange}
        onLocaleChange={handleLanguageChange}
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
                        disabled={isRunning || Boolean(trackAssets.backing && trackAssets.vocal)}
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
                className="grid gap-3 overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: motionDuration.drawer, ease: motionEase }}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Subtitle source">
                    <SegmentedControl
                      value={options.subtitleSource}
                      options={[
                        ["auto", "Auto"],
                        ["platform", "Platform"],
                        ["local", "Local"]
                      ]}
                      onChange={(value) => updateOptions({ subtitleSource: value })}
                    />
                  </Field>

                  <Field label="Whisper model">
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

                  <Field label="Platform subtitle languages">
                    <input
                      value={options.subLangs}
                      onChange={(event) => updateOptions({ subLangs: event.target.value })}
                      placeholder="Auto, zh.*,en.*,ja.*"
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>

                  <Field label="Browser cookies">
                    <input
                      value={options.browser}
                      onChange={(event) => updateOptions({ browser: event.target.value })}
                      placeholder="chrome or safari"
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>

                  <Field label="cookies.txt">
                    <input
                      value={options.cookies}
                      onChange={(event) => updateOptions({ cookies: event.target.value })}
                      placeholder="/path/to/cookies.txt"
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <Checkbox
                    label="Vocal split"
                    checked={options.separate}
                    disabled={options.workflowMode !== "karaoke"}
                    onChange={(checked) => updateOptions({ separate: checked })}
                  />
                  <Checkbox label="Local fallback" checked={options.localFallback} onChange={(checked) => updateOptions({ localFallback: checked })} />
                  <Checkbox label="Keep raw VTT" checked={options.keepPlatformSubs} onChange={(checked) => updateOptions({ keepPlatformSubs: checked })} />
                  <Checkbox
                    label={autoSavesAudio ? "Playable audio auto" : "Keep extracted audio"}
                    checked={options.saveAudio || autoSavesAudio}
                    disabled={autoSavesAudio}
                    onChange={(checked) => updateOptions({ saveAudio: checked })}
                  />
                </div>

                <div className="flex flex-wrap gap-2" aria-label="Output formats">
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

                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <Field label="Output folder">
                    <input
                      id="output"
                      value={options.outputDir}
                      onChange={(event) => updateOptions({ outputDir: event.target.value })}
                      placeholder="Default output folder"
                      className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                    />
                  </Field>
                  <Button onClick={chooseOutputDir}>
                    Choose
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

function shortInputLabel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "Untitled";
  }
  try {
    const url = new URL(trimmed);
    return url.hostname.replace(/^www\./, "") + url.pathname;
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).at(-1) ?? trimmed;
  }
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

function packageVideoPathForReview(entry: SavedJobHistory | null): string | null {
  if (!entry) {
    return null;
  }

  return (
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath) ? entry.playbackBundle.localVideoPath : null) ??
    entry.assets.find((asset) => asset.exists && asset.role === "preview" && isVideoPath(asset.path))?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && asset.role === "original" && isVideoPath(asset.path))?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && asset.role !== "preview" && isVideoPath(asset.path))?.path ??
    null
  );
}

function reviewDisplayTitle(entry: SavedJobHistory): string {
  if (entry.title?.trim()) {
    return entry.title.trim();
  }

  const assetTitle = titleFromAssets(entry.assets);
  if (assetTitle) {
    return assetTitle;
  }

  const mediaPath =
    entry.playbackBundle.localAudioPath ??
    entry.playbackBundle.localVideoPath ??
    entry.primaryMedia ??
    entry.assets.find((asset) => asset.type === "media" || asset.type === "stem")?.path ??
    "";
  const mediaTitle = titleFromPath(mediaPath);
  if (mediaTitle) {
    return mediaTitle;
  }

  const sourceLabel = sourceHostLabel(entry.sourceUrl || entry.input);
  return sourceLabel ?? shortInputLabel(entry.input);
}

function groupResourcePackages(entries: SavedJobHistory[]): ResourcePackage[] {
  const groups = new Map<string, SavedJobHistory[]>();
  for (const entry of entries) {
    const key = resourcePackageKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.values()]
    .map((group) => ({
      entry: mergeClientHistoryEntries(group),
      duplicateIds: group.map((entry) => entry.id)
    }))
    .sort(compareResourcePackages);
}

function resourcePackageKey(entry: SavedJobHistory): string {
  const sourceUrl = entry.sourceUrl || sourceUrlForKey(entry.input);
  if (sourceUrl) {
    return `url:${normalizeSourceUrlForKey(sourceUrl)}`;
  }

  const input = entry.input.trim();
  if (input.startsWith("sample:")) {
    return input.toLowerCase();
  }

  const mediaKey = reviewMediaFamilyKey(entry);
  if (mediaKey) {
    return `media:${mediaKey}`;
  }

  const titleKey = mediaFamilyKeyFromName(reviewDisplayTitle(entry));
  return titleKey ? `title:${titleKey}` : clientHistoryPackageKey(entry);
}

function mergeClientHistoryEntries(entries: SavedJobHistory[]): SavedJobHistory {
  const best = entries.reduce((current, entry) => (resourceEntryScore(entry) > resourceEntryScore(current) ? entry : current));
  const assets = uniqueClientAssets(entries.flatMap((entry) => entry.assets));
  const generatedFiles = uniqueStrings(entries.flatMap((entry) => entry.generatedFiles));
  const bestPlaybackBundle = entries.map((entry) => entry.playbackBundle).sort((left, right) => playbackBundleScore(right) - playbackBundleScore(left))[0] ?? best.playbackBundle;

  return {
    ...best,
    assets,
    generatedFiles,
    title: best.title ?? entries.find((entry) => entry.title)?.title,
    sourceUrl: best.sourceUrl ?? entries.find((entry) => entry.sourceUrl)?.sourceUrl ?? null,
    primarySubtitle: best.primarySubtitle ?? assets.find((asset) => asset.exists && asset.type === "subtitle")?.path ?? null,
    primaryMedia: best.primaryMedia ?? assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path))?.path ?? null,
    playbackBundle: bestPlaybackBundle
  };
}

function uniqueClientAssets(assets: GeneratedAsset[]): GeneratedAsset[] {
  const byPath = new Map<string, GeneratedAsset>();
  for (const asset of assets) {
    const key = asset.path.replace(/\\/g, "/").toLowerCase();
    byPath.set(key, { ...byPath.get(key), ...asset });
  }
  return [...byPath.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function resourceEntryScore(entry: SavedJobHistory): number {
  const hasPlayableLyrics = entry.playbackBundle.controllable && Boolean(entry.primarySubtitle);
  const hasVideo = Boolean(packageVideoPathForReview(entry));
  const hasStems = entry.assets.some((asset) => asset.exists && (asset.role === "backing" || asset.role === "vocal"));
  return Number(hasPlayableLyrics) * 100 + Number(entry.playbackBundle.controllable) * 60 + Number(entry.primarySubtitle) * 20 + Number(hasStems) * 10 + Number(hasVideo) * 5 + Date.parse(entry.createdAt) / 1000000000000;
}

function playbackBundleScore(bundle: PlaybackBundle): number {
  return Number(Boolean(bundle.localAudioPath)) * 100 + Number(Boolean(bundle.videoPreviewPath)) * 20 + Number(Boolean(bundle.localVideoPath)) * 50 + Number(bundle.controllable) * 10;
}

function compareResourcePackages(left: ResourcePackage, right: ResourcePackage): number {
  const yesterdayDelta = Number(isYesterdayPackage(right.entry)) - Number(isYesterdayPackage(left.entry));
  if (yesterdayDelta !== 0) {
    return yesterdayDelta;
  }

  const sampleDelta = Number(right.entry.input.startsWith("sample:")) - Number(left.entry.input.startsWith("sample:"));
  if (sampleDelta !== 0) {
    return sampleDelta;
  }

  return Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt);
}

function isYesterdayPackage(entry: SavedJobHistory): boolean {
  return entry.input.toLowerCase() === "sample:yesterday" || mediaFamilyKeyFromName(reviewDisplayTitle(entry)) === "yesterday";
}

function upsertHistoryEntry(current: SavedJobHistory[], entry: SavedJobHistory): SavedJobHistory[] {
  const entryKey = clientHistoryPackageKey(entry);
  return [
    entry,
    ...current.filter((item) => item.id !== entry.id && (!entryKey || clientHistoryPackageKey(item) !== entryKey))
  ];
}

function ensureKaraokeFormats(formats: OutputFormat[]): OutputFormat[] {
  const nextFormats = [...formats];
  for (const format of ["lrc", "json", "ass"] as OutputFormat[]) {
    if (!nextFormats.includes(format)) {
      nextFormats.push(format);
    }
  }
  return nextFormats;
}

function clientHistoryPackageKey(entry: SavedJobHistory): string {
  const sourceUrl = entry.sourceUrl || sourceUrlForKey(entry.input);
  if (sourceUrl) {
    return `url:${normalizeSourceUrlForKey(sourceUrl)}`;
  }

  const input = entry.input.trim();
  if (input.startsWith("sample:")) {
    return input.toLowerCase();
  }
  if (input && !sourceUrlForKey(input)) {
    return `file:${input.replace(/\\/g, "/").toLowerCase()}`;
  }

  const mediaCandidate =
    entry.playbackBundle.localAudioPath ??
    entry.playbackBundle.localVideoPath ??
    entry.primaryMedia ??
    entry.primarySubtitle ??
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem"))?.path ??
    "";
  const mediaKey = mediaCandidate ? mediaFamilyKeyFromName(mediaCandidate) : "";
  return mediaKey ? `media:${mediaKey}` : `input:${input.toLowerCase()}`;
}

function sourceUrlForKey(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeSourceUrlForKey(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "youtu.be") {
      return `youtube:${url.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    }
    if (hostname.endsWith("youtube.com")) {
      const videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ??
        "";
      return videoId ? `youtube:${videoId}` : `${hostname}${url.pathname}`;
    }
    if (hostname.endsWith("bilibili.com") || hostname === "b23.tv") {
      const biliId = url.pathname.match(/\/video\/([^/?#]+)/)?.[1] ?? url.pathname.split("/").filter(Boolean)[0] ?? "";
      return biliId ? `bilibili:${biliId.toLowerCase()}` : `${hostname}${url.pathname}`;
    }
    return `${hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function titleFromAssets(assets: GeneratedAsset[]): string | null {
  const rankedAssets = [
    assets.find((asset) => asset.role === "original" && asset.exists),
    assets.find((asset) => asset.type === "media" && asset.role !== "preview" && asset.exists),
    assets.find((asset) => asset.type === "stem" && asset.role === "backing" && asset.exists),
    assets.find((asset) => asset.type === "stem" && asset.exists),
    assets.find((asset) => asset.type === "subtitle" && asset.role !== "transcribe" && asset.exists),
    assets.find((asset) => asset.type === "subtitle" && asset.exists)
  ].filter((asset): asset is GeneratedAsset => Boolean(asset));

  for (const asset of rankedAssets) {
    const title = cleanMediaTitle(asset.name);
    if (title) {
      return title;
    }
  }

  return null;
}

function titleFromPath(filePath: string): string | null {
  if (!filePath) {
    return null;
  }
  const filename = filePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? filePath;
  return cleanMediaTitle(filename);
}

function cleanMediaTitle(name: string): string | null {
  const withoutExtension = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  const withoutModelSuffix = withoutExtension.replace(/[_\s-]+model[_-].*$/i, "");
  const withoutRoleSuffix = withoutModelSuffix
    .replace(/[_\s-]*\((?:instrumental|vocals?|voice|acapella|no vocals)[^)]*\)\s*$/i, "")
    .replace(/[_\s-]+(?:instrumental|vocals?|voice|acapella|preview|transcribe|subtitle|audio|video)$/i, "");
  const withoutPlatformId = withoutRoleSuffix.replace(/\s*\[[^\]]{6,}\]\s*$/i, "");
  const normalized = withoutPlatformId.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function sourceHostLabel(input: string): string | null {
  if (!input.trim()) {
    return null;
  }
  try {
    const hostname = new URL(input).hostname.replace(/^www\./, "");
    if (/youtu\.be|youtube\.com/i.test(hostname)) {
      return "YouTube";
    }
    if (/bilibili\.com|b23\.tv/i.test(hostname)) {
      return "Bilibili";
    }
    return hostname;
  } catch {
    return null;
  }
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
  const mediaAssets = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path));
  const audioAssets = mediaAssets.filter((asset) => isAudioPath(asset.path));
  const backing = audioAssets.find((asset) => asset.role === "backing") ?? audioAssets.find((asset) => /instrumental|no[_-]?vocals?|accompaniment|karaoke/i.test(asset.name)) ?? null;
  const vocal = audioAssets.find((asset) => asset.role === "vocal") ?? audioAssets.find((asset) => /(^|[^a-z])(vocals?|voice|acapella)([^a-z]|$)/i.test(asset.name)) ?? null;
  const original =
    audioAssets.find((asset) => asset.role === "original") ??
    audioAssets.find((asset) => asset.type === "media" && !/\.transcribe\.(wav|mp3|m4a|flac)$/i.test(asset.name)) ??
    audioAssets.find((asset) => asset.type === "media") ??
    mediaAssets.find((asset) => asset.type === "media") ??
    null;

  return {
    original,
    backing,
    vocal
  };
}

function scopePlayableAssetsToReview(activeReview: SavedJobHistory | null, assets: GeneratedAsset[]): GeneratedAsset[] {
  const playableAssets = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path));
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

function reviewMediaFamilyKey(entry: SavedJobHistory): string {
  const candidates = [
    entry.playbackBundle.localAudioPath,
    entry.primaryMedia,
    entry.primarySubtitle,
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.name,
    entry.assets.find((asset) => asset.exists && asset.type === "media" && asset.role !== "preview")?.name
  ];

  for (const candidate of candidates) {
    const key = candidate ? mediaFamilyKeyFromName(candidate) : "";
    if (key) {
      return key;
    }
  }

  return "";
}

function mediaFamilyKeyFromName(nameOrPath: string): string {
  const filename = nameOrPath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? nameOrPath;
  const title = cleanMediaTitle(filename);
  return title
    ? title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
        .trim()
    : "";
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

function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
}

function isPreviewVideoPath(filePath: string): boolean {
  return isVideoPath(filePath) && /\.preview\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
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

