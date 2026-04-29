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
import { hydrateLocaleFromHost, setAppLocale, SUPPORTED_LOCALES } from "./i18n";

interface StageProgress {
  name: string;
  progress: number;
  message?: string;
  done: boolean;
  failed: boolean;
}

const PIPELINE_STAGES: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: "prepare", labelKey: "capture:stages.prepare" },
  { id: "download", labelKey: "capture:stages.download" },
  { id: "separate", labelKey: "capture:stages.separate" },
  { id: "convert", labelKey: "capture:stages.convert" },
  { id: "transcribe", labelKey: "capture:stages.transcribe" },
  { id: "write", labelKey: "capture:stages.write" },
  { id: "preview", labelKey: "capture:stages.preview" }
];

function isSampleHistoryEntry(entry: SavedJobHistory): boolean {
  return entry.input.startsWith("sample:") || entry.id.startsWith("sample:");
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

interface StageChainProps {
  stages: Map<string, StageProgress>;
  isRunning: boolean;
  t: Translator;
}

function StageChain({ stages, isRunning, t }: StageChainProps) {
  const visible = PIPELINE_STAGES.filter((stage) => stages.has(stage.id));
  if (visible.length === 0) {
    return null;
  }
  return (
    <div className="stageChain" role="status" aria-live="polite" data-running={isRunning ? "true" : "false"}>
      {visible.map((stage) => {
        const progress = stages.get(stage.id);
        if (!progress) {
          return null;
        }
        const fraction = clampProgress(progress.progress);
        const state = progress.failed ? "failed" : progress.done ? "done" : fraction > 0 ? "active" : "pending";
        return (
          <div key={stage.id} className="stageChainItem" data-state={state}>
            <div className="stageChainLabel">{t(stage.labelKey)}</div>
            <div className="stageChainBar">
              <span className="stageChainFill" style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
            {progress.message ? <div className="stageChainMessage">{progress.message}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

type AppNavTarget = "home" | "add" | "karaoke";

interface FloatingBottomNavProps {
  active: AppNavTarget;
  karaokeDisabled: boolean;
  contextTitle: string;
  contextSubtitle: string;
  contextAction?: string;
  onHome: () => void;
  onAdd: () => void;
  onKaraoke: () => void;
  t: Translator;
}

function FloatingBottomNav({ active, karaokeDisabled, contextTitle, contextSubtitle, contextAction, onHome, onAdd, onKaraoke, t }: FloatingBottomNavProps) {
  return (
    <aside className="floatingBottomDock" data-active-view={active} aria-label={t("common:nav.label")}>
      <div className="floatingDockContext">
        <div>
          <p>{contextTitle}</p>
          <span>{contextSubtitle}</span>
        </div>
        {contextAction ? <strong>{contextAction}</strong> : null}
      </div>
      <nav className="floatingBottomNav" aria-label={t("common:nav.label")}>
        <button type="button" data-active={active === "home"} onClick={onHome}>
          {t("common:nav.home")}
        </button>
        <button type="button" data-active={active === "add"} onClick={onAdd}>
          {t("common:nav.add")}
        </button>
        <button type="button" data-active={active === "karaoke"} onClick={onKaraoke} disabled={karaokeDisabled}>
          {t("common:nav.karaoke")}
        </button>
      </nav>
    </aside>
  );
}

interface SdfCircle {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

const SDF_CIRCLES: SdfCircle[] = [
  { x: 0.22, y: 0.38, r: 0.24, speed: 0.32, phase: 0.4 },
  { x: 0.52, y: 0.28, r: 0.18, speed: 0.24, phase: 2.1 },
  { x: 0.78, y: 0.5, r: 0.26, speed: 0.28, phase: 3.2 },
  { x: 0.36, y: 0.78, r: 0.2, speed: 0.36, phase: 4.6 },
  { x: 0.68, y: 0.76, r: 0.15, speed: 0.42, phase: 5.3 }
];

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function parseCssColor(value: string): [number, number, number] {
  const trimmed = value.trim();
  const hex = trimmed.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
  }
  const rgb = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return [22, 138, 74];
}

function SdfHomeScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    let frame = 0;
    let raf = 0;
    let disposed = false;

    const render = () => {
      if (disposed) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(180, Math.floor(rect.width * scale));
      const height = Math.max(100, Math.floor(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const sampleWidth = 220;
      const sampleHeight = Math.max(90, Math.floor(sampleWidth * (height / width)));
      const image = context.createImageData(sampleWidth, sampleHeight);
      const styles = getComputedStyle(canvas);
      const accent = parseCssColor(styles.getPropertyValue("--color-accent"));
      const accentStrong = parseCssColor(styles.getPropertyValue("--color-accent-strong"));
      const t = reduceMotion ? 0.8 : frame * 0.016;
      const aspect = sampleWidth / sampleHeight;

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const uvx = (x / sampleWidth - 0.5) * aspect;
          const uvy = y / sampleHeight - 0.5;
          let d = 10;
          for (const circle of SDF_CIRCLES) {
            const wobbleX = Math.sin(t * circle.speed + circle.phase) * 0.04;
            const wobbleY = Math.cos(t * (circle.speed * 0.8) + circle.phase) * 0.035;
            const cx = (circle.x - 0.5) * aspect + wobbleX;
            const cy = circle.y - 0.5 + wobbleY;
            const dist = Math.hypot(uvx - cx, uvy - cy) - circle.r;
            d = smoothMin(d, dist, 0.08);
          }

          const edge = Math.max(0, Math.min(1, (0.018 - d) / 0.036));
          const glow = Math.max(0, Math.min(1, (0.18 - d) / 0.18));
          const shade = Math.max(0, Math.min(1, 0.55 + (uvx + uvy) * 0.28));
          const alpha = Math.max(edge, glow * 0.28);
          const idx = (y * sampleWidth + x) * 4;
          image.data[idx] = Math.round(accentStrong[0] * (1 - shade) + accent[0] * shade);
          image.data[idx + 1] = Math.round(accentStrong[1] * (1 - shade) + accent[1] * shade);
          image.data[idx + 2] = Math.round(accentStrong[2] * (1 - shade) + accent[2] * shade);
          image.data[idx + 3] = Math.round(alpha * 220);
        }
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = sampleWidth;
      offscreen.height = sampleHeight;
      offscreen.getContext("2d")?.putImageData(image, 0, 0);
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.drawImage(offscreen, 0, 0, width, height);

      frame += 1;
      if (!reduceMotion) {
        raf = window.requestAnimationFrame(render);
      }
    };

    render();
    return () => {
      disposed = true;
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="homeSdfCanvas" aria-hidden="true" />;
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
type LyricEffect = "outline" | "sweep" | "neon" | "impact";
type LyricFont = "rounded" | "poster" | "serif" | "mono";

interface JobRecord {
  id: string;
  input: string;
  status: JobStatus;
  startedAt: string;
  result?: JobResult;
}

interface Cue {
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
}

interface TimedWord {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  compact?: boolean;
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

interface AudioInputDevice {
  deviceId: string;
  label: string;
}

interface MicrophoneMonitorController {
  devices: AudioInputDevice[];
  selectedDeviceId: string;
  isMonitoring: boolean;
  monitorGain: number;
  noiseReduction: boolean;
  status: string;
  setSelectedDeviceId: (deviceId: string) => void;
  setIsMonitoring: (enabled: boolean) => void;
  setMonitorGain: (gain: number) => void;
  setNoiseReduction: (enabled: boolean) => void;
  refreshDevices: () => void;
}

interface ResourcePackage {
  entry: SavedJobHistory;
  duplicateIds: string[];
}

interface HoverFillOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface HoverFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const allFormats: OutputFormat[] = ["lrc", "srt", "vtt", "txt", "json", "ass"];
const motionEase = [0.23, 1, 0.32, 1] as const;
const motionDuration = {
  instant: 0.01,
  fast: 0.14,
  base: 0.18,
  panel: 0.2,
  drawer: 0.22
} as const;
const lyricEffectOptions: Array<[LyricEffect, string]> = [
  ["sweep", "Blue sweep"],
  ["outline", "Outline"],
  ["neon", "Neon"],
  ["impact", "Impact"]
];
const lyricFontOptions: Array<[LyricFont, string]> = [
  ["rounded", "Rounded"],
  ["poster", "Poster"],
  ["serif", "Serif"],
  ["mono", "Mono"]
];
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
        themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" || parsed.themeMode === "system" ? parsed.themeMode : "system",
        accentColor:
          parsed.accentColor === "amber" ||
          parsed.accentColor === "blue" ||
          parsed.accentColor === "green" ||
          parsed.accentColor === "pink" ||
          parsed.accentColor === "purple"
            ? parsed.accentColor
            : "amber"
      };
    } catch {
      return { locale: null, themeMode: "system", accentColor: "green" };
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

type Translator = (key: string, options?: Record<string, unknown>) => string;

interface RoomRemoteDrawerProps {
  open: boolean;
  onClose: () => void;
  roomStatus: RoomStatus | null;
  roomQrDataUrl: string;
  roomMessage: string;
  roomQueue: RoomQueueItem[];
  nextRoomRequest: RoomQueueItem | null;
  isRunning: boolean;
  onCopyLink: () => void | Promise<void>;
  onProcessItem: (item: RoomQueueItem) => void | Promise<void>;
  onRemoveItem: (itemId: string) => void | Promise<void>;
  onClearQueue: () => void | Promise<void>;
  t: Translator;
}

function RoomRemoteDrawer({
  open,
  onClose,
  roomStatus,
  roomQrDataUrl,
  roomMessage,
  roomQueue,
  nextRoomRequest,
  isRunning,
  onCopyLink,
  onProcessItem,
  onRemoveItem,
  onClearQueue,
  t
}: RoomRemoteDrawerProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="roomDrawer"
          id="vocalflow-room-drawer"
          className="roomDrawer"
          role="dialog"
          aria-label={t("room:panelTitle")}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: motionDuration.panel, ease: motionEase }}
        >
          <div className="roomDrawerScrim" onClick={onClose} aria-hidden="true" />
          <div className="roomDrawerPanel">
            <div className="roomDrawerHeader">
              <div>
                <p className="eyebrow">{t("room:drawerToggle")}</p>
                <h2>{t("room:panelTitle")}</h2>
                <p className="roomHint">{t("room:panelHint")}</p>
              </div>
              <button type="button" className="secondaryButton" onClick={onClose} aria-label={t("common:actions.cancel")}>
                {t("room:drawerToggleOpen")}
              </button>
            </div>
            <div className="roomDrawerBody">
              <div className="roomQrCard">
                {roomQrDataUrl ? <img src={roomQrDataUrl} alt={t("room:drawerToggle")} /> : <div className="roomQrPlaceholder">QR</div>}
                <button type="button" className="secondaryButton" onClick={() => void onCopyLink()} disabled={!roomStatus?.remoteUrl}>
                  {t("room:copyLink")}
                </button>
              </div>
              <div className="roomQueueCard">
                <div className="roomLinkLine">{roomStatus?.remoteUrl ?? t("room:starting")}</div>
                {roomMessage ? <p className="roomMessage">{roomMessage}</p> : null}
                <div className="roomQueueActions">
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={() => nextRoomRequest && void onProcessItem(nextRoomRequest)}
                    disabled={!nextRoomRequest || isRunning}
                  >
                    {t("room:runNext")}
                  </button>
                  <button type="button" className="secondaryButton" onClick={() => void onClearQueue()} disabled={roomQueue.length === 0}>
                    {t("room:clearQueue")}
                  </button>
                </div>
                <ul className="roomQueueList" aria-label={t("room:panelTitle")}>
                  {roomQueue.length > 0 ? (
                    roomQueue.map((item, index) => (
                      <li key={item.id} className="roomQueueItem" data-status={item.status}>
                        <div>
                          <div className="roomQueueTitle">
                            {index + 1}. {item.title}
                          </div>
                          <div className="roomQueueMeta">
                            {item.requestedBy} · {item.status}
                          </div>
                        </div>
                        <div className="roomQueueItemActions">
                          {item.status === "queued" ? (
                            <button type="button" className="secondaryButton" onClick={() => void onProcessItem(item)} disabled={isRunning}>
                              {t("room:queueRun")}
                            </button>
                          ) : null}
                          <button type="button" className="secondaryButton" onClick={() => void onRemoveItem(item.id)} disabled={item.status === "running"}>
                            {t("room:queueRemove")}
                          </button>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="roomQueueEmpty">{t("room:queueEmpty")}</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

interface LanguageSwitcherProps {
  value: AppLocale;
  onChange: (next: AppLocale) => void | Promise<void>;
  t: Translator;
}

function LanguageSwitcher({ value, onChange, t }: LanguageSwitcherProps) {
  return (
    <div className="languageSwitcher" role="group" aria-label={t("common:language.label")}>
      {SUPPORTED_LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          className="languageSwitcherButton"
          data-selected={locale === value}
          onClick={() => void onChange(locale)}
          aria-pressed={locale === value}
        >
          {locale === "en" ? t("common:language.english") : t("common:language.chinese")}
        </button>
      ))}
    </div>
  );
}

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;
const ACCENT_COLORS: readonly AccentColor[] = ["amber", "blue", "green", "pink", "purple"] as const;

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  locale: AppLocale;
  onThemeModeChange: (themeMode: ThemeMode) => void | Promise<void>;
  onAccentColorChange: (accentColor: AccentColor) => void | Promise<void>;
  onLocaleChange: (locale: AppLocale) => void | Promise<void>;
  t: Translator;
}

function SettingsPanel({
  open,
  onClose,
  themeMode,
  accentColor,
  locale,
  onThemeModeChange,
  onAccentColorChange,
  onLocaleChange,
  t
}: SettingsPanelProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="settingsPanel"
          className="settingsPanel"
          role="dialog"
          aria-label={t("settings:title")}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: motionDuration.panel, ease: motionEase }}
        >
          <div className="settingsScrim" onClick={onClose} aria-hidden="true" />
          <div className="settingsSurface">
            <div className="settingsHeader">
              <div>
                <p className="eyebrow">{t("settings:eyebrow")}</p>
                <h2>{t("settings:title")}</h2>
              </div>
              <button type="button" className="secondaryButton" onClick={onClose}>
                {t("common:actions.cancel")}
              </button>
            </div>

            <section className="settingsSection">
              <div>
                <h3>{t("settings:appearance.title")}</h3>
                <p>{t("settings:appearance.description")}</p>
              </div>
              <div className="settingsButtonGrid" role="group" aria-label={t("settings:appearance.modeLabel")}>
                {THEME_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="settingsChoiceButton"
                    data-selected={mode === themeMode}
                    onClick={() => void onThemeModeChange(mode)}
                  >
                    {t(`settings:appearance.modes.${mode}`)}
                  </button>
                ))}
              </div>
              <div className="accentGrid" role="group" aria-label={t("settings:appearance.accentLabel")}>
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="accentChoice"
                    data-accent={color}
                    data-selected={color === accentColor}
                    onClick={() => void onAccentColorChange(color)}
                  >
                    <span className="accentSwatch" />
                    {t(`settings:appearance.accents.${color}`)}
                  </button>
                ))}
              </div>
            </section>

            <section className="settingsSection">
              <div>
                <h3>{t("settings:language.title")}</h3>
                <p>{t("settings:language.description")}</p>
              </div>
              <LanguageSwitcher value={locale} onChange={onLocaleChange} t={t} />
            </section>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const currentLocale = (i18n.resolvedLanguage ?? i18n.language ?? "en") as AppLocale;
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
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
        setThemeMode(settings?.themeMode ?? "system");
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
          karaokePackages={karaokePackages}
          playableAssets={playbackAssets}
          selectedMediaPath={selectedMediaPath}
          selectedSubtitlePath={selectedSubtitlePath}
          trackAssets={trackAssets}
          trackRole={trackRole}
          lyricEffect={lyricEffect}
          lyricFont={lyricFont}
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
      className="appShell"
      data-has-workspace={showWorkspace}
      data-theme={effectiveTheme}
      data-accent={accentColor}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
    >
      <section className="startHero libraryShell" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
        <div className="libraryTopBar">
          <div className="brandLockup" aria-label={t("common:appName")}>
            <span className="brandMark" aria-hidden="true">
              VF
            </span>
            <span className="brandWordmark">{t("common:appName")}</span>
          </div>
          <div className="libraryTopBarActions">
            <button type="button" className="settingsButton" onClick={() => setSettingsOpen(true)}>
              {t("settings:button")}
            </button>
            <button
              type="button"
              className="roomDrawerToggle"
              data-active={roomDrawerOpen}
              onClick={() => setRoomDrawerOpen((open) => !open)}
              aria-expanded={roomDrawerOpen}
              aria-controls="vocalflow-room-drawer"
            >
              <span>{t("room:drawerToggle")}</span>
              {(roomQueue.length > 0 || roomStatus?.nowPlaying) ? (
                <span className="roomDrawerStatusDot" aria-label={t("room:statusDot")} />
              ) : null}
            </button>
            <div className="statusPill" data-state={activeJob?.status ?? "idle"}>
              {statusMessage}
            </div>
          </div>
        </div>

        <div className="homeHeroScene" aria-hidden="true">
          <SdfHomeScene />
          <span className="homeShaderGrid" />
          <span className="homeShaderWave" />
        </div>

        <div className="homeIntro">
          <p className="eyebrow">{t("capture:heroSubtitle")}</p>
          <h1>{t("home:title")}</h1>
          <p>{t("home:subtitle")}</p>
        </div>

        <div className="captureBar homeCaptureBar">
          <p className="captureTagline">{t("home:captureHint")}</p>
          <div className="heroComposer">
            <label className="inputLabel" htmlFor="input">
              {t("capture:inputLabel")}
            </label>
            <div className="heroInputRow">
              <input
                id="input"
                ref={captureInputRef}
                value={options.input}
                onChange={(event) => updateOptions({ input: event.target.value })}
                placeholder={t("capture:inputPlaceholder")}
              />
              <button
                type="button"
                className="primaryButton"
                onClick={() => (cachedPackageForInput ? openCachedInputPackage() : void runJob())}
                disabled={!options.input.trim() || isRunning}
              >
                {cachedPackageForInput ? t("capture:cache.openExisting") : t("common:actions.run")}
              </button>
              {cachedPackageForInput ? (
                <button type="button" className="secondaryButton" onClick={() => void runJob()} disabled={isRunning}>
                  {t("capture:cache.redownload")}
                </button>
              ) : null}
              <button type="button" className="secondaryButton" onClick={cancelJob} disabled={!isRunning}>
                {t("common:actions.stop")}
              </button>
            </div>
            {cachedPackageForInput ? <p className="cacheHint">{t("capture:cache.hint", { title: reviewDisplayTitle(cachedPackageForInput) })}</p> : null}

            <div className="youtubeSearchHeader">
              <button
                type="button"
                className="splitToggleButton"
                data-selected={youtubePanelOpen}
                onClick={() => setYoutubePanelOpen((open) => !open)}
                aria-expanded={youtubePanelOpen}
              >
                {t("capture:search.toggle")}
              </button>
              <span className="youtubeSearchHint">{t("capture:search.hint")}</span>
            </div>
            {youtubePanelOpen ? (
              <div className="youtubeSearchPanel">
                <SegmentedControl
                  value={mediaSearchPlatform}
                  options={[
                    ["youtube", t("capture:search.youtube")],
                    ["bilibili", t("capture:search.bilibili")]
                  ]}
                  onChange={setMediaSearchPlatform}
                />
                <div className="youtubeSearchControls">
                  <input
                    className="youtubeSearchField"
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
                  />
                  <label className="youtubeKaraokeBias">
                    <input
                      type="checkbox"
                      checked={youtubeAppendKaraoke}
                      onChange={(event) => setYoutubeAppendKaraoke(event.target.checked)}
                    />
                    <span>{t("capture:search.appendKaraoke")}</span>
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={() => void runYoutubeDiscovery()}
                    disabled={youtubeSearching || !youtubeQuery.trim()}
                  >
                    {youtubeSearching ? t("common:actions.searching") : t("common:actions.search")}
                  </button>
                </div>
                {youtubeError ? <p className="youtubeSearchError">{youtubeError}</p> : null}
                {youtubeResults.length > 0 ? (
                  <ul className="youtubeResultList" aria-label={t("capture:search.toggle")}>
                    {youtubeResults.map((row) => (
                      <li key={row.videoId} className="youtubeResultRow">
                        <div className="youtubeResultThumb">
                          {searchResultThumbnail(row) ? (
                            <img src={searchResultThumbnail(row)} alt="" loading="lazy" width={160} height={90} />
                          ) : (
                            <span>{row.platform === "bilibili" ? t("capture:search.bilibili") : t("capture:search.youtube")}</span>
                          )}
                        </div>
                        <div className="youtubeResultMeta">
                          <div className="youtubeResultTitle">{row.title}</div>
                          <div className="youtubeResultSub">
                            {row.channel ? `${row.channel} · ` : ""}
                            {row.durationLabel || "—"}
                          </div>
                          <div className="youtubeResultActions">
                            <button type="button" className="secondaryButton" onClick={() => applyYoutubeResult(row)}>
                              {t("capture:search.useThisLink")}
                            </button>
                            <button
                              type="button"
                              className="secondaryButton"
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

            <div className="heroControlRow">
              <div className="heroModeControl">
                <SegmentedControl
                  value={options.workflowMode}
                  options={[
                    ["karaoke", t("capture:modes.karaoke")],
                    ["subtitle", t("capture:modes.subtitle")]
                  ]}
                  onChange={setWorkflowMode}
                />
              </div>
              <label className="languageControl">
                <span>{t("common:language.label")}</span>
                <input value={options.language} onChange={(event) => updateOptions({ language: event.target.value })} placeholder={t("capture:languageHint")} />
              </label>
              <button type="button" className="secondaryButton" onClick={chooseInput}>
                {t("capture:selectFile")}
              </button>
              <button type="button" className="secondaryButton" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                {advancedOpen ? t("capture:advanced.hide") : t("capture:advanced.show")}
              </button>
            </div>
          </div>
        </div>

        <StageChain stages={progressStages} isRunning={isRunning} t={t} />

        {featuredPackage ? (
          <FeaturedPackageCard
            entry={featuredPackage.entry}
            variant={featuredVariant}
            onEnter={() => enterKaraokeFromHistory(featuredPackage.entry.id)}
            onOpen={() => selectHistoryEntry(featuredPackage.entry.id)}
            t={t}
          />
        ) : null}

        {shelfPackages.length > 0 ? (
          <section className="resourceShelf libraryShelf" aria-label={t("library:shelfHeader")}>
            <div className="resourceShelfHeader">
              <p className="eyebrow">{t("library:shelfHeader")}</p>
              <span>{shelfPackages.length}</span>
            </div>
            <div className="resourceGrid">
              {shelfPackages.map(({ entry, duplicateIds }) => (
                <ProcessedResourceCard
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
          <section className="libraryEmpty" aria-label={t("library:emptyTitle")}>
            <h2>{t("library:emptyTitle")}</h2>
            <p>{t("library:emptyBody")}</p>
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
        <section className={`workspace guidedWorkspace ${showActivityPane ? "" : "workspaceSolo"}`}>
          <section className="detailPane guidedDetail" data-empty={!activeReview}>
            {activeReview ? (
              <section className="resultOverview">
                <div>
                  <p className="eyebrow">{t("package:current")}</p>
                  <h2>{activeReviewTitle}</h2>
                  <p className="reviewMeta">{playbackSummary(activeReview.playbackBundle)}</p>
                  <PackageBadges playbackBundle={activeReview.playbackBundle} trackAssets={trackAssets} />
                </div>
                <div className="resultActions">
                  {activeReview.workflowMode === "karaoke" ? (
                    <>
                      <button type="button" className="secondaryButton" onClick={() => setAppScene("lyrics-review")}>
                        {t("package:openPackage")}
                      </button>
                      <button type="button" className="secondaryButton" onClick={splitActiveReview} disabled={isRunning || Boolean(trackAssets.backing && trackAssets.vocal)}>
                        {t("package:splitVocals")}
                      </button>
                      <button
                        type="button"
                        className="primaryButton"
                        onClick={() => setAppScene("karaoke-room")}
                        disabled={!selectedSubtitlePath || !activeReview.playbackBundle.controllable}
                      >
                        {t("package:enterKaraoke")}
                      </button>
                    </>
                  ) : null}
                  {activeReview.sourceUrl ? (
                    <button type="button" className="secondaryButton" onClick={() => audioWorkflow.openExternalUrl(activeReview.sourceUrl!)}>
                      {t("package:openOriginal")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={!activeReview.outputDir}
                    onClick={() => activeReview.outputDir && audioWorkflow.openPath(activeReview.outputDir)}
                  >
                    {t("package:openFolder")}
                  </button>
                </div>
              </section>
            ) : null}

            {activeReview ? (
              <section className="reviewPane guidedReview">
                <div className="tabRow">
                  {(["karaoke", "script", "files"] as ReviewTab[]).map((tab) => (
                    <button key={tab} type="button" data-selected={reviewTab === tab} onClick={() => setReviewTab(tab)}>
                      {t(`package:tabs.${tab}`)}
                    </button>
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
                      <FilesReview assets={activeReview.assets} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>
            ) : null}

          <AnimatePresence initial={false}>
            {advancedOpen ? (
              <motion.section
                className="advancedDrawer"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: motionDuration.drawer, ease: motionEase }}
              >
                <div className="settingsGrid">
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
                    <select value={options.model} onChange={(event) => updateOptions({ model: event.target.value })}>
                      <option value="small">small</option>
                      <option value="medium">medium</option>
                      <option value="large-v3-turbo">large-v3-turbo</option>
                      <option value="large-v3">large-v3</option>
                    </select>
                  </Field>

                  <Field label="Platform subtitle languages">
                    <input value={options.subLangs} onChange={(event) => updateOptions({ subLangs: event.target.value })} placeholder="Auto, zh.*,en.*,ja.*" />
                  </Field>

                  <Field label="Browser cookies">
                    <input value={options.browser} onChange={(event) => updateOptions({ browser: event.target.value })} placeholder="chrome or safari" />
                  </Field>

                  <Field label="cookies.txt">
                    <input value={options.cookies} onChange={(event) => updateOptions({ cookies: event.target.value })} placeholder="/path/to/cookies.txt" />
                  </Field>
                </div>

                <div className="switchGrid">
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

                <div className="formatRow" aria-label="Output formats">
                  {allFormats.map((format) => (
                    <button
                      key={format}
                      type="button"
                      className="formatButton"
                      data-selected={options.formats.includes(format)}
                      onClick={() => toggleFormat(format)}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="outputRow">
                  <label htmlFor="output">Output folder</label>
                  <input id="output" value={options.outputDir} onChange={(event) => updateOptions({ outputDir: event.target.value })} placeholder="Default output folder" />
                  <button type="button" className="secondaryButton" onClick={chooseOutputDir}>
                    Choose
                  </button>
                </div>

                <section className="commandPane">
                  <div className="paneHeader">
                    <h2>{t("capture:advanced.command")}</h2>
                  </div>
                  <pre>{preview?.display ?? t("capture:advanced.commandPlaceholder")}</pre>
                </section>

                <section className="logPane">
                  <div className="paneHeader">
                    <h2>{t("capture:advanced.logs")}</h2>
                  </div>
                  <pre>{logs || t("capture:advanced.logsPlaceholder")}</pre>
                </section>
              </motion.section>
            ) : null}
          </AnimatePresence>
          </section>

          {showActivityPane ? (
            <aside className="queuePane activityPane">
              <div className="paneHeader">
                <h2>{t("capture:activity.title")}</h2>
                <span>{jobs.length}</span>
              </div>
              <div className="queueList compactList">
                {jobs.length === 0 ? (
                  <p className="emptyText">{t("capture:activity.empty")}</p>
                ) : (
                  jobs.map((job) => (
                    <button key={job.id} type="button" className="queueItem" data-active={job.id === activeJobId} onClick={() => selectQueueJob(job.id)}>
                      <span className="queueTitle">{job.result?.historyEntry ? reviewDisplayTitle(job.result.historyEntry) : shortInputLabel(job.input)}</span>
                      <span className="queueMeta">
                        {job.status} - {job.startedAt}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="historyHeader">
                <h2>{t("capture:history.title")}</h2>
                <span>{history.length}</span>
              </div>
              <div className="queueList compactList">
                {history.length === 0 ? (
                  <p className="emptyText">{t("capture:history.empty")}</p>
                ) : (
                  history.map((entry) => (
                    <div key={entry.id} className="historyItem" data-active={entry.id === selectedHistoryId}>
                      <button type="button" onClick={() => selectHistoryEntry(entry.id)}>
                        <span className="queueTitle">{reviewDisplayTitle(entry)}</span>
                        <span className="queueMeta">
                          {entry.workflowMode} - {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </button>
                      <button type="button" className="removeButton" onClick={() => removeHistoryEntry(entry.id)}>
                        {t("common:actions.remove")}
                      </button>
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

function PackageBadges({ playbackBundle, trackAssets }: { playbackBundle: PlaybackBundle; trackAssets: TrackAssets }) {
  const { t } = useTranslation();
  const badges = [
    playbackBundle.controllable ? t("package:badges.localPlayback") : t("package:badges.playbackMissing"),
    trackAssets.backing ? t("package:badges.backingStem") : null,
    trackAssets.vocal ? t("package:badges.vocalStem") : null,
    playbackBundle.videoPreviewPath ? t("package:badges.videoPreview") : null
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <div className="packageBadges" aria-label={t("package:contents")}>
      {badges.map((badge) => (
        <span key={badge}>{badge}</span>
      ))}
    </div>
  );
}

function ProcessedResourceCard({
  entry,
  onEnter,
  onReview,
  onDelete
}: {
  entry: SavedJobHistory;
  onEnter: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const title = reviewDisplayTitle(entry);
  const canEnter = Boolean(entry.playbackBundle.controllable && entry.primarySubtitle);
  const hasStems = entry.assets.some((asset) => asset.exists && (asset.role === "backing" || asset.role === "vocal"));
  const isSample = entry.input.startsWith("sample:") || entry.id.startsWith("sample:");
  const coverPath =
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath) ? entry.playbackBundle.localVideoPath : null);
  const coverUrl = useMediaUrl(coverPath);

  return (
    <article className="resourceCard" data-disabled={!canEnter} data-variant={isSample ? "sample" : "user"}>
      {isSample ? <span className="resourceCardBadge">{t("library:tagSample")}</span> : null}
      <button type="button" className="resourceCoverButton" disabled={!canEnter} onClick={onEnter}>
        <div className="resourceCover" aria-hidden="true">
          {coverUrl ? <video src={coverUrl} muted playsInline preload="metadata" /> : <div className="resourceCoverFallback">{title.slice(0, 2).toUpperCase()}</div>}
        </div>
        <div className="resourceCoverOverlay">
          <strong>{title}</strong>
          <span>{isSample ? t("library:tagSample") : playbackSummary(entry.playbackBundle)}</span>
          <div className="resourceMeta">
            <span>{hasStems ? t("package:badges.stems") : t("package:badges.original")}</span>
            <span>{entry.primarySubtitle ? t("package:badges.lyrics") : t("package:badges.noLyrics")}</span>
          </div>
        </div>
      </button>
      <div className="resourceActions">
        <button type="button" className="primaryButton" disabled={!canEnter} onClick={onEnter}>
          {canEnter ? t("package:enterKaraoke") : t("package:badges.needsMedia")}
        </button>
        <button type="button" className="secondaryButton" onClick={onReview}>
          {t("package:openPackage")}
        </button>
        <button type="button" className="secondaryButton resourceDeleteButton" onClick={onDelete}>
          {t("common:actions.remove")}
        </button>
      </div>
    </article>
  );
}

interface FeaturedPackageCardProps {
  entry: SavedJobHistory;
  variant: "continue" | "sample";
  onEnter: () => void;
  onOpen: () => void;
  t: Translator;
}

function FeaturedPackageCard({ entry, variant, onEnter, onOpen, t }: FeaturedPackageCardProps) {
  const title = reviewDisplayTitle(entry);
  const canEnter = Boolean(entry.playbackBundle.controllable && entry.primarySubtitle);
  const coverPath =
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath) ? entry.playbackBundle.localVideoPath : null);
  const coverUrl = useMediaUrl(coverPath);
  const eyebrowKey = variant === "continue" ? "library:continueHeader" : "library:sampleHeader";
  const enterLabel = variant === "continue" ? t("common:actions.enterKaraoke") : t("common:actions.tryInKaraoke");
  return (
    <article className="featuredCard" data-variant={variant} data-enabled={canEnter}>
      <div className="featuredCover" aria-hidden="true">
        {coverUrl ? (
          <video src={coverUrl} muted playsInline preload="metadata" />
        ) : (
          <div className="resourceCoverFallback">{title.slice(0, 2).toUpperCase()}</div>
        )}
      </div>
      <div className="featuredBody">
        <p className="eyebrow">{t(eyebrowKey)}</p>
        <h2>{title}</h2>
        <p className="featuredMeta">{playbackSummary(entry.playbackBundle)}</p>
        <div className="featuredActions">
          <button type="button" className="primaryButton" onClick={onEnter} disabled={!canEnter}>
            {enterLabel}
          </button>
          <button type="button" className="secondaryButton" onClick={onOpen}>
            {t("library:openPackage")}
          </button>
        </div>
      </div>
    </article>
  );
}

function KaraokeReview({
  activeCue,
  activeCueIndex,
  cues,
  playbackBundle,
  playbackController,
  playableAssets,
  selectedMediaPath,
  selectedSubtitlePath,
  onSeek
}: {
  activeCue: Cue | null;
  activeCueIndex: number;
  cues: Cue[];
  playbackBundle: PlaybackBundle;
  playbackController: PlaybackController;
  playableAssets: GeneratedAsset[];
  selectedMediaPath: string;
  selectedSubtitlePath: string;
  onSeek: (cue: Cue) => void;
}) {
  const { t } = useTranslation();
  const previousCue = activeCueIndex > 0 ? cues[activeCueIndex - 1] : null;
  const nextCue = activeCueIndex >= 0 ? cues[activeCueIndex + 1] : cues[0] ?? null;
  const isVideo = isVideoPath(selectedMediaPath);
  const hasBacking = playableAssets.some((asset) => asset.role === "backing");
  const hasVocal = playableAssets.some((asset) => asset.role === "vocal");
  const selectedSubtitleName = selectedSubtitlePath ? fileNameFromPath(selectedSubtitlePath) : t("package:badges.noLyrics");

  return (
    <div className="karaokeGrid">
      <div className="playerPane">
        <div className="stemStatus" data-ready={hasBacking && hasVocal}>
          <strong>{hasBacking && hasVocal ? t("package:split.ready") : t("package:split.missing")}</strong>
          <span>{hasBacking && hasVocal ? t("package:split.readyHint") : t("package:split.missingHint")}</span>
        </div>
        <div className="reviewControls">
          <div className="packageBindingField">
            <span>{t("package:playbackTrack")}</span>
            <strong>{selectedMediaPath ? fileNameFromPath(selectedMediaPath) : t("package:noPlayableMedia")}</strong>
          </div>
          <div className="packageBindingField">
            <span>{t("package:lyricsBound")}</span>
            <strong>{selectedSubtitleName}</strong>
          </div>
        </div>

        {playbackController.mediaUrl ? (
          isVideo ? (
            <video
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLVideoElement>}
              className="mediaPlayer"
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
              className="mediaPlayer"
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
          <p className="emptyText">{playbackController.mediaStatus || playbackBundle.unavailableReason || t("package:noLocalMedia")}</p>
        )}

        <div className="karaokeStage">
          <p className="surroundingLyric">{previousCue?.text ?? ""}</p>
          <p className="currentLyric">{activeCue?.text ?? t("package:playToFollow")}</p>
          <p className="surroundingLyric">{nextCue?.text ?? ""}</p>
        </div>
      </div>

      <div className="cueList" aria-label={t("package:timedLines")}>
        {cues.length === 0 ? (
          <p className="emptyText">{t("package:noTimedSubtitles")}</p>
        ) : (
          cues.map((cue, index) => (
            <button key={`${cue.start}-${index}`} type="button" data-active={index === activeCueIndex} onClick={() => onSeek(cue)}>
              <span>{formatClock(cue.start)}</span>
              <strong>{cue.text}</strong>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function LyricsReviewScene({
  activeReview,
  cues,
  scriptStatus,
  scriptText,
  selectedSubtitlePath,
  subtitleAssets,
  onBack,
  onEnterKaraoke,
  onOpenFolder,
  onScriptChange,
  onSave
}: {
  activeReview: SavedJobHistory;
  cues: Cue[];
  scriptStatus: string;
  scriptText: string;
  selectedSubtitlePath: string;
  subtitleAssets: GeneratedAsset[];
  onBack: () => void;
  onEnterKaraoke: () => void;
  onOpenFolder: () => void;
  onScriptChange: (content: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const title = reviewDisplayTitle(activeReview);

  return (
    <main className="sceneShell">
      <header className="sceneHeader">
        <div>
          <p className="eyebrow">{t("package:detail")}</p>
          <h1>{title}</h1>
          <p className="reviewMeta">{t("package:detailHint")}</p>
        </div>
        <div className="resultActions">
          <button type="button" className="secondaryButton" onClick={onBack}>
            {t("common:actions.back")}
          </button>
          <button type="button" className="secondaryButton" onClick={onOpenFolder}>
            {t("package:openFolder")}
          </button>
          <button type="button" className="primaryButton" onClick={onEnterKaraoke} disabled={!selectedSubtitlePath}>
            {t("package:saveAndEnter")}
          </button>
        </div>
      </header>

      <section className="lyricsReviewGrid">
        <ScriptReview
          selectedSubtitlePath={selectedSubtitlePath}
          subtitleAssets={subtitleAssets}
          scriptText={scriptText}
          scriptStatus={scriptStatus}
          onScriptChange={onScriptChange}
          onSave={onSave}
        />
        <div className="lyricsPreviewPane">
          <div className="paneHeader">
            <h2>{t("package:timedLines")}</h2>
            <span>{cues.length}</span>
          </div>
          <div className="cueList reviewCueList">
            {cues.length === 0 ? (
              <p className="emptyText">{t("package:noTimedLines")}</p>
            ) : (
              cues.map((cue, index) => (
                <button key={`${cue.start}-${index}`} type="button">
                  <span>{formatClock(cue.start)}</span>
                  <strong>{cue.text}</strong>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function KaraokeRoomScene({
  activeCue,
  activeCueIndex,
  activeReview,
  cues,
  playbackBundle,
  playbackController,
  karaokePackages,
  playableAssets,
  selectedMediaPath,
  selectedSubtitlePath,
  trackAssets,
  trackRole,
  lyricEffect,
  lyricFont,
  onBackHome,
  onBackToLyrics,
  onLyricEffectChange,
  onLyricFontChange,
  onOpenOriginalVideo,
  onPackageChange,
  onSplitVocals,
  onTrackRoleChange,
  isRunning
}: {
  activeCue: Cue | null;
  activeCueIndex: number;
  activeReview: SavedJobHistory;
  cues: Cue[];
  playbackBundle: PlaybackBundle;
  playbackController: PlaybackController;
  karaokePackages: SavedJobHistory[];
  playableAssets: GeneratedAsset[];
  selectedMediaPath: string;
  selectedSubtitlePath: string;
  trackAssets: TrackAssets;
  trackRole: TrackRole;
  lyricEffect: LyricEffect;
  lyricFont: LyricFont;
  onBackHome: () => void;
  onBackToLyrics: () => void;
  onLyricEffectChange: (effect: LyricEffect) => void;
  onLyricFontChange: (font: LyricFont) => void;
  onOpenOriginalVideo: () => void;
  onPackageChange: (historyId: string) => void;
  onSplitVocals: () => void;
  onTrackRoleChange: (role: TrackRole) => void;
  isRunning: boolean;
}) {
  const { t } = useTranslation();
  const previousCue = activeCueIndex > 0 ? cues[activeCueIndex - 1] : null;
  const nextCue = activeCueIndex >= 0 ? cues[activeCueIndex + 1] : cues[0] ?? null;
  const showVisualPreview = Boolean(playbackController.previewUrl);
  const showLocalVideo = !showVisualPreview && playbackController.mediaUrl && isVideoPath(selectedMediaPath);
  const selectedMediaName = playableAssets.find((asset) => asset.path === selectedMediaPath)?.name ?? t("room:noLocalTrack");
  const cueDuration = cues.at(-1)?.end ?? 0;
  const progressMax = Math.max(playbackController.duration, cueDuration, playbackController.currentTime, 0);
  const progressValue = progressMax > 0 ? Math.min(playbackController.currentTime, progressMax) : 0;
  const hasPlayableMedia = Boolean(selectedMediaPath && playbackController.canControl);
  const hasStems = Boolean(trackAssets.backing && trackAssets.vocal);
  const displayTitle = reviewDisplayTitle(activeReview);
  const trackRoleLabel =
    trackRole === "backing"
      ? t("room:trackLabels.backingTrack")
      : trackRole === "vocal"
        ? t("room:trackLabels.vocalOnly")
        : trackRole === "custom"
          ? t("room:trackLabels.customTrack")
          : t("room:trackLabels.originalMix");
  const mainTrackRole = trackRole === "vocal" || trackRole === "custom" ? (trackAssets.backing ? "backing" : "original") : trackRole;
  const cueKey = activeCue ? `${activeCue.start}-${activeCue.end}-${activeCue.text}` : "empty-cue";
  const microphoneMonitor = useMicrophoneMonitor();
  const selectedSubtitleName = selectedSubtitlePath ? fileNameFromPath(selectedSubtitlePath) : t("package:badges.noLyrics");
  const songOptions = karaokePackages.some((entry) => entry.id === activeReview.id) ? karaokePackages : [activeReview, ...karaokePackages];
  const visualizerBars = useMemo(
    () =>
      Array.from({ length: 18 }, (_, index) => {
        const phase = playbackController.currentTime * (1.05 + index * 0.035) + index * 0.68;
        const wave = Math.sin(phase) * 0.5 + Math.cos(phase * 0.72 + index) * 0.5;
        return Math.max(0.18, Math.min(1, 0.52 + wave * 0.42));
      }),
    [playbackController.currentTime]
  );

  return (
    <motion.main className="karaokeRoom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: motionDuration.base, ease: motionEase }}>
      <header className="sceneHeader karaokeHeader">
        <div>
          <p className="eyebrow">{t("room:title")}</p>
          <h1>{displayTitle}</h1>
        </div>
        <div className="resultActions">
          <button type="button" className="secondaryButton" onClick={onBackHome}>
            {t("common:nav.home")}
          </button>
          {activeReview.sourceUrl ? (
            <button type="button" className="secondaryButton" onClick={onOpenOriginalVideo}>
              {t("package:openOriginal")}
            </button>
          ) : null}
          <button type="button" className="secondaryButton" onClick={onBackToLyrics}>
            {t("room:editLyrics")}
          </button>
        </div>
      </header>

      <section className="karaokeRoomGrid">
        <div className="karaokeVisualPane">
          {showVisualPreview ? (
            <video
              ref={playbackController.previewRef}
              className="roomVideo visualPreviewVideo"
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
              className="roomVideo"
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
            <div className="audioOnlyVisual" data-playing={playbackController.isPlaying}>
              <div className="audioVisualCore" aria-hidden="true">
                <div className="audioVisualRing" />
                <div className="audioVisualBars">
                  {visualizerBars.map((scale, index) => (
                    <span key={index} style={{ "--bar-scale": scale.toFixed(3) } as CSSProperties} />
                  ))}
                </div>
              </div>
              <div className="audioVisualMeta">
                <strong>{displayTitle}</strong>
                <span>{playbackController.previewStatus || playbackBundle?.unavailableReason || trackRoleLabel}</span>
              </div>
            </div>
          ) : null}
          <div className="roomLyrics" data-effect={lyricEffect} data-font={lyricFont}>
            <p className="roomLyricContext">{previousCue?.text ?? ""}</p>
            <KaraokeLyricLine key={cueKey} cue={activeCue} currentTime={playbackController.currentTime} effect={lyricEffect} />
            <p className="roomLyricContext">{nextCue?.text ?? ""}</p>
          </div>
        </div>

        <aside className="karaokeControlPane">
          <div className="ktvMetaPanel">
            <div className="ktvCover" aria-hidden="true">
              <span>{displayTitle.slice(0, 2).toUpperCase()}</span>
            </div>
            <div className="ktvTrackMeta">
              <strong>{displayTitle}</strong>
              <span>{trackRoleLabel}</span>
              <span>{selectedMediaName}</span>
            </div>
          </div>

          <div className="ktvTransportDock">
            <div className="transportPanel">
              <input
                aria-label="Playback position"
                type="range"
                min="0"
                max={progressMax || 0}
                step="0.1"
                value={progressValue}
                disabled={!hasPlayableMedia}
                onInput={(event) => playbackController.seek(Number(event.currentTarget.value), playbackController.isPlaying)}
                onChange={(event) => playbackController.seek(Number(event.currentTarget.value), playbackController.isPlaying)}
              />
              <div className="transportTime">
                <span>{formatClock(progressValue)}</span>
                <span>{progressMax > 0 ? formatClock(progressMax) : "--:--"}</span>
              </div>
              <div className="transportButtons">
                <button type="button" disabled={!hasPlayableMedia} onClick={playbackController.restart}>
                  {t("room:transport.restart")}
                </button>
                <button type="button" disabled={!hasPlayableMedia} onClick={playbackController.isPlaying ? playbackController.pause : playbackController.play}>
                  {playbackController.isPlaying ? t("room:transport.pause") : t("room:transport.play")}
                </button>
                <button type="button" disabled={!hasPlayableMedia} onClick={() => playbackController.seek(Math.max(0, playbackController.currentTime - 5), playbackController.isPlaying)}>
                  -5s
                </button>
              </div>
            </div>
            <div className="dockUtilityRow">
              <HoverFillGroup<TrackRole>
                ariaLabel={t("room:trackRole")}
                className="trackSelector"
                value={mainTrackRole}
                onChange={onTrackRoleChange}
                items={[
                  { value: "original", label: t("room:tracks.original"), disabled: !trackAssets.original },
                  { value: "backing", label: t("room:tracks.backing"), disabled: !trackAssets.backing }
                ]}
              />
              <details className="dockMenu">
                <summary>{t("room:style")}</summary>
                <div className="dockMenuContent lyricStyleControls">
                  <HoverFillGroup<LyricEffect>
                    ariaLabel={t("room:effect")}
                    className="lyricEffectSelector"
                    value={lyricEffect}
                    onChange={onLyricEffectChange}
                    items={lyricEffectOptions.map(([value]) => ({ value, label: t(`room:effects.${value}`) }))}
                  />
                  <HoverFillGroup<LyricFont>
                    ariaLabel={t("room:font")}
                    className="lyricFontSelector"
                    value={lyricFont}
                    onChange={onLyricFontChange}
                    items={lyricFontOptions.map(([value]) => ({ value, label: t(`room:fonts.${value}`) }))}
                  />
                </div>
              </details>
              {!hasStems ? (
                <button type="button" className="splitInlineButton" onClick={onSplitVocals} disabled={isRunning}>
                  {isRunning ? t("package:splitRunning") : t("package:splitVocals")}
                </button>
              ) : null}
            </div>
          </div>

          {playbackController.mediaUrl && !showLocalVideo ? (
            <audio
              key={playbackController.mediaUrl}
              ref={playbackController.mediaRef as RefObject<HTMLAudioElement>}
              className="hiddenMedia"
              src={playbackController.mediaUrl}
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

          <details className="ktvSidePanel">
            <summary>{t("room:settings")}</summary>
            <div className="ktvSideContent">
              <MicrophoneMonitorPanel monitor={microphoneMonitor} />

              <label className="songPackageSelector">
                <span>{t("room:song")}</span>
                <select value={activeReview.id} onChange={(event) => onPackageChange(event.target.value)} disabled={songOptions.length <= 1}>
                  {songOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {reviewDisplayTitle(entry)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="packageBindingField roomBindingField">
                <span>{t("room:lyrics")}</span>
                <strong>{selectedSubtitleName}</strong>
              </div>

              {trackAssets.vocal ? (
                <div className="hiddenVocalControl">
                  <div>
                    <span>{t("room:optionalStem")}</span>
                    <strong>{t("room:vocalOnly")}</strong>
                  </div>
                  <button type="button" data-selected={trackRole === "vocal"} onClick={() => onTrackRoleChange(trackRole === "vocal" ? (trackAssets.backing ? "backing" : "original") : "vocal")}>
                    {trackRole === "vocal" ? t("room:returnTrack") : t("room:useTrack")}
                  </button>
                </div>
              ) : null}

              {!playbackController.mediaUrl ? <p className="emptyText">{playbackController.mediaStatus || playbackBundle?.unavailableReason || t("room:noLocalAudio")}</p> : null}

              <div className="cueList roomCueList">
                {cues.map((cue, index) => (
                  <motion.button
                    key={`${cue.start}-${index}`}
                    type="button"
                    data-active={index === activeCueIndex}
                    onClick={() => playbackController.seek(cue.start, true)}
                    animate={index === activeCueIndex ? { x: 2 } : { x: 0 }}
                    transition={{ duration: motionDuration.fast, ease: motionEase }}
                  >
                    <span>{formatClock(cue.start)}</span>
                    <strong>{cue.text}</strong>
                  </motion.button>
                ))}
              </div>
            </div>
          </details>
        </aside>
      </section>
    </motion.main>
  );
}

function HoverFillGroup<T extends string>({
  ariaLabel,
  className,
  items,
  value,
  onChange
}: {
  ariaLabel: string;
  className?: string;
  items: Array<HoverFillOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fillRect, setFillRect] = useState<HoverFillRect | null>(null);
  const itemSignature = items.map((item) => `${item.value}:${item.disabled ? "1" : "0"}`).join("|");

  const setFillForTarget = useCallback((target: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !target) {
      setFillRect(null);
      return;
    }

    const parentRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setFillRect({
      x: targetRect.left - parentRect.left,
      y: targetRect.top - parentRect.top,
      width: targetRect.width,
      height: targetRect.height
    });
  }, []);

  const setFillForSelected = useCallback(() => {
    const container = containerRef.current;
    const selectedButton = container?.querySelector<HTMLButtonElement>('button[data-selected="true"]:not(:disabled)') ?? null;
    setFillForTarget(selectedButton);
  }, [setFillForTarget]);

  useEffect(() => {
    setFillForSelected();
  }, [itemSignature, setFillForSelected, value]);

  return (
    <div
      ref={containerRef}
      className={`hoverFillGroup ${className ?? ""}`}
      role="group"
      aria-label={ariaLabel}
      onMouseLeave={() => {
        if (!containerRef.current?.matches(":focus-within")) {
          setFillForSelected();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFillForSelected();
        }
      }}
      style={
        {
          "--hover-x": `${fillRect?.x ?? 0}px`,
          "--hover-y": `${fillRect?.y ?? 0}px`,
          "--hover-width": `${fillRect?.width ?? 0}px`,
          "--hover-height": `${fillRect?.height ?? 0}px`
        } as CSSProperties
      }
    >
      <span className="hoverFillSurface" data-visible={Boolean(fillRect)} aria-hidden="true" />
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={item.disabled}
          aria-pressed={item.value === value}
          data-selected={item.value === value}
          onMouseEnter={(event) => setFillForTarget(event.currentTarget)}
          onFocus={(event) => setFillForTarget(event.currentTarget)}
          onClick={() => onChange(item.value)}
        >
          <span className="hoverFillLabel hoverFillLabelBase">{item.label}</span>
          <span className="hoverFillLabel hoverFillLabelActive" aria-hidden="true">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function MicrophoneMonitorPanel({ monitor }: { monitor: MicrophoneMonitorController }) {
  const { t } = useTranslation();
  const displayStatus = monitor.status === "Monitoring input. Use headphones to avoid feedback." ? t("room:mic.headphones") : monitor.status;
  return (
    <section className="micMonitorPanel" data-monitoring={monitor.isMonitoring}>
      <div className="micMonitorHeader">
        <div>
          <strong>{t("room:mic.title")}</strong>
          <span>{displayStatus}</span>
        </div>
        <button type="button" data-selected={monitor.isMonitoring} onClick={() => monitor.setIsMonitoring(!monitor.isMonitoring)}>
          {monitor.isMonitoring ? t("room:mic.monitorOn") : t("room:mic.monitor")}
        </button>
      </div>

      <select value={monitor.selectedDeviceId} onChange={(event) => monitor.setSelectedDeviceId(event.target.value)}>
        <option value="">{t("room:mic.systemDefault")}</option>
        {monitor.devices.map((device) => (
          <option key={device.deviceId || device.label} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>

      <label className="micGainControl">
        <span>{t("room:mic.level")}</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={monitor.monitorGain}
          disabled={!monitor.isMonitoring}
          onChange={(event) => monitor.setMonitorGain(Number(event.currentTarget.value))}
        />
      </label>
      <label className="micReductionToggle">
        <input
          type="checkbox"
          checked={monitor.noiseReduction}
          onChange={(event) => monitor.setNoiseReduction(event.currentTarget.checked)}
        />
        <span>
          <strong>{t("room:mic.noiseReduction")}</strong>
          <em>{t("room:mic.noiseReductionHint")}</em>
        </span>
      </label>
    </section>
  );
}

function KaraokeLyricLine({ cue, currentTime, effect }: { cue: Cue | null; currentTime: number; effect: LyricEffect }) {
  const words = useMemo(
    () =>
      cue
        ? cue.words?.length
          ? cue.words
          : inferTimedWords(cue, "active")
        : [
            {
              id: "empty-cue",
              text: "Play to start lyrics.",
              start: 0,
              end: 0
            }
          ],
    [cue]
  );

  return (
    <motion.strong
      className="karaokeLyricLine"
      data-effect={effect}
      data-empty={!cue}
      initial={{ opacity: 0, y: 18, scale: effect === "impact" ? 0.92 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
    >
      {words.map((word) => {
        const progressPercent = `${Math.round(wordProgressForTime(word, currentTime) * 1000) / 10}%`;
        const style = { "--word-progress": progressPercent } as CSSProperties;
        const isActive = currentTime >= word.start && currentTime < word.end;

        return (
          <span key={word.id} className="karaokeWord" data-active={isActive} data-compact={word.compact} style={style}>
            <span className="karaokeWordBase">{word.text}</span>
            <span className="karaokeWordFill" aria-hidden="true">
              {word.text}
            </span>
          </span>
        );
      })}
    </motion.strong>
  );
}

function ScriptReview({
  selectedSubtitlePath,
  subtitleAssets,
  scriptText,
  scriptStatus,
  onScriptChange,
  onSave
}: {
  selectedSubtitlePath: string;
  subtitleAssets: GeneratedAsset[];
  scriptText: string;
  scriptStatus: string;
  onScriptChange: (content: string) => void;
  onSave: () => void;
}) {
  const selectedSubtitle = subtitleAssets.find((asset) => asset.path === selectedSubtitlePath);
  const subtitleName = selectedSubtitle?.name ?? (selectedSubtitlePath ? fileNameFromPath(selectedSubtitlePath) : "No lyrics in package");

  return (
    <div className="scriptPane">
      <div className="scriptToolbar">
        <div className="packageBindingField">
          <span>Package lyrics</span>
          <strong>{subtitleName}</strong>
        </div>
        <button type="button" className="primaryButton" onClick={onSave} disabled={!selectedSubtitlePath}>
          Save
        </button>
        <span>{scriptStatus}</span>
      </div>
      <textarea
        value={scriptText}
        onChange={(event) => onScriptChange(event.target.value)}
        placeholder="This package does not have an editable lyrics file yet."
        spellCheck={false}
      />
    </div>
  );
}

function FilesReview({ assets }: { assets: GeneratedAsset[] }) {
  const { t } = useTranslation();
  if (assets.length === 0) {
    return <p className="emptyText">{t("package:filesEmpty")}</p>;
  }

  return (
    <ul className="fileList">
      {assets.map((asset) => (
        <li key={asset.path}>
          <button type="button" disabled={!asset.exists} onClick={() => audioWorkflow.openPath(asset.path)}>
            <span>{asset.name}</span>
            <em>
              {asset.role ?? asset.type}
              {asset.exists ? "" : " - missing"}
            </em>
          </button>
        </li>
      ))}
    </ul>
  );
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Checkbox({
  label,
  checked,
  disabled = false,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkboxLabel">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmentedControl" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          data-selected={value === optionValue}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
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

function withTimedWords(cue: Cue, cueKey: string): Cue {
  const words = cue.words?.length ? cue.words : inferTimedWords(cue, cueKey);
  return { ...cue, words };
}

function inferTimedWords(cue: Cue, cueKey: string): TimedWord[] {
  const tokens = tokenizeLyricText(cue.text);
  const lyricTokens = tokens.length > 0 ? tokens : [cue.text.trim()].filter(Boolean);
  if (lyricTokens.length === 0) {
    return [];
  }

  const duration = Math.max(0.05, cue.end - cue.start);
  const weights = lyricTokens.map(estimatedTokenWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || lyricTokens.length;
  let cursor = cue.start;

  return lyricTokens.map((token, index) => {
    const start = index === 0 ? cue.start : cursor;
    const end = index === lyricTokens.length - 1 ? cue.end : Math.min(cue.end, start + duration * (weights[index] / totalWeight));
    cursor = end;
    return {
      id: `${cueKey}-${index}`,
      text: token,
      start,
      end: Math.max(end, start + 0.01),
      compact: shouldUseCompactWordSpacing(token, cue.text)
    };
  });
}

function tokenizeLyricText(text: string): string[] {
  return [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?|[^\s]/gu)].map((match) => match[0]);
}

function estimatedTokenWeight(token: string): number {
  if (/^[^\p{L}\p{N}]+$/u.test(token)) {
    return 0.35;
  }
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(token)) {
    return 1;
  }
  return Math.max(0.8, Math.min(3.6, token.length / 3));
}

function shouldUseCompactWordSpacing(token: string, cueText: string): boolean {
  return !/\s/.test(cueText) || /^[^\p{L}\p{N}]+$/u.test(token) || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(token);
}

function wordProgressForTime(word: TimedWord, time: number): number {
  if (word.end <= word.start) {
    return time >= word.start ? 1 : 0;
  }
  return clamp01((time - word.start) / (word.end - word.start));
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

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
