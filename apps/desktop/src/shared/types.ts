import type { JobEvent } from "./job-events.js";

/** Failure payload broadcast on the `job:failed` IPC channel. */
export type JobFailedEvent = Extract<JobEvent, { kind: "failed" }>;

export type SubtitleSource = "auto" | "platform" | "local";

export type WorkflowMode = "karaoke" | "subtitle";

export type OutputFormat = "lrc" | "srt" | "vtt" | "txt" | "json" | "ass";

export type GeneratedAssetType = "subtitle" | "media" | "stem" | "other";

export type GeneratedAssetRole = "subtitle" | "original" | "backing" | "vocal" | "preview" | "transcribe" | "other";

export interface JobOptions {
  input: string;
  workflowMode: WorkflowMode;
  outputDir: string;
  subtitleSource: SubtitleSource;
  localFallback: boolean;
  separate: boolean;
  saveAudio: boolean;
  keepPlatformSubs: boolean;
  /** Convert Traditional Chinese cue text to Simplified Chinese before writing outputs. */
  simplifiedChinese: boolean;
  model: string;
  language: string;
  subLangs: string;
  browser: string;
  cookies: string;
  formats: OutputFormat[];
}

export interface CommandPreview {
  command: string;
  args: string[];
  display: string;
}

export interface JobLog {
  jobId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface GeneratedAsset {
  path: string;
  name: string;
  extension: string;
  type: GeneratedAssetType;
  role?: GeneratedAssetRole;
  exists: boolean;
}

export interface PlaybackBundle {
  localAudioPath: string | null;
  localVideoPath: string | null;
  videoPreviewPath: string | null;
  sourceUrl: string | null;
  controllable: boolean;
  unavailableReason: string | null;
}

export interface SavedJobHistory {
  id: string;
  title?: string;
  input: string;
  workflowMode: WorkflowMode;
  createdAt: string;
  outputDir: string;
  generatedFiles: string[];
  assets: GeneratedAsset[];
  sourceUrl: string | null;
  primarySubtitle: string | null;
  primaryMedia: string | null;
  playbackBundle: PlaybackBundle;
}

export type PackageType = "songPackage" | "recordingPackage";

export type RecordingTakeStatus = "recording" | "complete" | "failed";

export type RecordingExportFormat = "wav" | "m4a" | "mp3";

export interface RecordingTake {
  id: string;
  recordingPackageId: string;
  sourceSongPackageId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  /** Absolute path to the raw vocal take file. */
  path: string;
  /** Browser-provided MIME type, e.g. `audio/webm` or `audio/wav`. */
  mimeType: string;
  duration: number | null;
  deviceId?: string | null;
  deviceLabel?: string | null;
  status: RecordingTakeStatus;
}

export interface RecordingMixSettings {
  activeTakeId: string | null;
  /** 0..2 gain applied to the recorded vocal take. */
  vocalGain: number;
  /** 0..2 gain applied to backing/original music track. */
  musicGain: number;
  /**
   * Signed vocal alignment correction in milliseconds.
   * Positive values advance a late vocal; negative values delay an early vocal.
   */
  vocalOffsetMs?: number;
  /** Prefer backing stem when present; otherwise fall back to original track. */
  preferBackingTrack: boolean;
  exportFormat: RecordingExportFormat;
}

export interface RecordingExport {
  id: string;
  recordingPackageId: string;
  takeId: string;
  createdAt: string;
  path: string;
  format: RecordingExportFormat;
  duration: number | null;
}

export interface RecordingPackage {
  id: string;
  packageType: "recordingPackage";
  sourceSongPackageId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  outputDir: string;
  takes: RecordingTake[];
  mix: RecordingMixSettings;
  exports: RecordingExport[];
}

export interface SaveRecordingTakeRequest {
  sourceSongPackageId: string;
  /** Renderer-resolved display title for legacy packages whose stored title is only a source key. */
  sourceTitle?: string;
  /** Encoded microphone capture from MediaRecorder. */
  data: Uint8Array;
  mimeType: string;
  duration: number;
  deviceId?: string | null;
  deviceLabel?: string | null;
  vocalGain: number;
  musicGain: number;
  /** Signed alignment correction; positive values advance the vocal. */
  vocalOffsetMs?: number;
  preferBackingTrack: boolean;
  exportFormat: RecordingExportFormat;
}

export interface RecordingCalibrationRequest {
  recordingPackageId: string;
  /** Signed alignment correction; positive values advance the vocal. */
  vocalOffsetMs: number;
}

export interface UpdateRecordingMixRequest {
  recordingPackageId: string;
  vocalGain: number;
  musicGain: number;
  /** Signed alignment correction; positive values advance the vocal. */
  vocalOffsetMs: number;
  preferBackingTrack: boolean;
  exportFormat: RecordingExportFormat;
}

export interface RenameRecordingRequest {
  recordingPackageId: string;
  title: string;
}

export interface RecordingSaveResult {
  recordingPackage: RecordingPackage;
  take: RecordingTake;
  mixExport: RecordingExport | null;
  warning: string | null;
}

export interface SongPackageReference {
  id: string;
  packageType: "songPackage";
  title: string;
  historyEntry: SavedJobHistory;
}

export interface JobResult {
  jobId: string;
  exitCode: number | null;
  signal: string | null;
  outputDir: string;
  generatedFiles: string[];
  assets: GeneratedAsset[];
  sourceUrl: string | null;
  primarySubtitle: string | null;
  primaryMedia: string | null;
  playbackBundle: PlaybackBundle;
  historyEntry: SavedJobHistory | null;
}

/** One row from `yt-dlp` YouTube search (`ytsearchN:`), aligned with PiKaraoke-style discovery. */
export interface YoutubeSearchResult {
  videoId: string;
  title: string;
  url: string;
  channel: string;
  durationLabel: string;
  /** Duration in seconds when known; used to prefer clips under 15 minutes. */
  durationSec?: number | null;
  platform?: "youtube" | "bilibili";
  thumbnailUrl?: string;
}

/**
 * Lightweight metadata snapshot returned by `prefetchUrlMetadata`. Used to
 * render an inline preview card under the capture input so the user sees the
 * resolved title / duration / uploader before they click Run.
 */
export interface UrlMetadataPreview {
  /** Canonical source URL (e.g. https://www.youtube.com/watch?v=...). */
  sourceUrl: string;
  /** Inferred origin for badge display. */
  origin: "youtube" | "bilibili" | "url";
  title: string | null;
  uploader: string | null;
  durationSec: number | null;
  /** Original thumbnail URL from yt-dlp. Renderer fetches directly. */
  thumbnailUrl: string | null;
  /** ISO timestamp when this entry was cached. */
  fetchedAt: string;
}

export type RoomQueueItemStatus = "queued" | "running" | "complete" | "failed" | "canceled";

export interface RoomQueueItem {
  id: string;
  input: string;
  title: string;
  requestedBy: string;
  createdAt: string;
  status: RoomQueueItemStatus;
  resultHistoryId?: string | null;
  error?: string | null;
}

export interface RoomStatus {
  token: string;
  remoteUrl: string;
  localUrl: string;
  queue: RoomQueueItem[];
  nowPlaying: RoomQueueItem | null;
}

export type AppLocale = "en" | "zh";

export type ThemeMode = "system" | "light" | "dark";

/** Four full studio palettes (settings “color theme”). Legacy green/lime/mint/teal map to these. */
export type AccentColor = "sage" | "slate" | "ink" | "clay";

export interface UserSettings {
  locale: AppLocale | null;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  /**
   * Optional HuggingFace Hub token. When set, the main process injects it as
   * `HF_TOKEN` + `HUGGING_FACE_HUB_TOKEN` into the CLI subprocess env so
   * audio-separator (and any other tool that reads from HF Hub) downloads
   * models with authenticated rate limits instead of getting throttled or
   * 429'd. `null` keeps the existing anonymous behaviour.
   */
  hfToken: string | null;
  /**
   * Optional HuggingFace Hub endpoint. Injected as `HF_ENDPOINT` so every
   * HuggingFace client library routes its downloads through the chosen
   * host. Critical for users behind networks where `huggingface.co` is
   * unreachable — set it to a mirror such as `https://hf-mirror.com` to
   * keep the desktop app fully functional without a VPN. `null` keeps
   * the default `huggingface.co` host.
   */
  hfEndpoint: string | null;
  /**
   * Optional absolute path to a folder containing pre-downloaded vocal
   * separator model files (`.onnx` / `.pth` / `.ckpt`). When set, the main
   * process passes it to `audio-separator --model_file_dir <dir>` so the
   * CLI reuses local models instead of re-downloading from HuggingFace —
   * especially useful for users who already have an Ultimate Vocal
   * Remover (UVR) install and want the desktop app to share the same
   * model pool. `null` keeps audio-separator's default cache directory.
   */
  separatorModelDir: string | null;
}

export interface JobProgressStage {
  jobId: string;
  /** Logical pipeline stage produced by the CLI. */
  name: string;
  /** 0..1 fraction; -1 when unknown. */
  progress: number;
  /** Optional human-readable status message. */
  message?: string;
  /** Optional ETA in seconds; null when unknown. */
  etaSec?: number | null;
  /** Whether the stage has finished (success or failure). */
  done?: boolean;
  /** Whether the stage failed. */
  failed?: boolean;
}

export interface AudioWorkflowApi {
  selectInput: () => Promise<string | null>;
  selectOutputDir: () => Promise<string | null>;
  /**
   * Generic folder picker used by Settings (e.g. "choose UVR models
   * folder"). Returns the absolute path or `null` when the user cancels.
   */
  selectFolder?: () => Promise<string | null>;
  previewCommand: (options: JobOptions) => Promise<CommandPreview>;
  runJob: (jobId: string, options: JobOptions) => Promise<JobResult>;
  cancelJob: (jobId: string) => Promise<boolean>;
  openPath: (targetPath: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  readTextFile: (targetPath: string) => Promise<string>;
  writeTextFile: (targetPath: string, content: string) => Promise<void>;
  getMediaUrl: (targetPath: string) => Promise<string>;
  listHistory: () => Promise<SavedJobHistory[]>;
  removeHistory: (historyId: string) => Promise<SavedJobHistory[]>;
  /** Persist a microphone take, convert it to WAV, and render a music mix when possible. */
  saveRecordingTake?: (request: SaveRecordingTakeRequest) => Promise<RecordingSaveResult>;
  /** Re-render a saved recording mix with a new signed vocal alignment correction. */
  calibrateRecording?: (request: RecordingCalibrationRequest) => Promise<RecordingPackage>;
  /** Re-render a saved take with non-destructive mix and export settings. */
  updateRecordingMix?: (request: UpdateRecordingMixRequest) => Promise<RecordingPackage>;
  /** Rename a saved recording without changing its files on disk. */
  renameRecording?: (request: RenameRecordingRequest) => Promise<RecordingPackage>;
  /** Permanently remove one recording package and its generated files. */
  deleteRecording?: (recordingPackageId: string) => Promise<RecordingPackage[]>;
  /** Return persisted recording packages, optionally filtered to one source song package. */
  listRecordings?: (sourceSongPackageId?: string) => Promise<RecordingPackage[]>;
  /** Return a secure app-local media URL for a persisted recording file. */
  getRecordingMediaUrl?: (targetPath: string) => Promise<string>;
  /** Reveal the top-level VocalFlow recordings folder in Finder. */
  openRecordingRoot?: () => Promise<void>;
  onJobLog: (callback: (log: JobLog) => void) => () => void;
  /** Subscribe to structured pipeline progress events from the CLI. */
  onJobProgress?: (callback: (event: JobProgressStage) => void) => () => void;
  /**
   * Subscribe to terminal failure events. Emitted alongside the existing
   * `runJob` Promise resolution so renderers can surface localized error copy
   * and recovery actions without parsing raw stderr.
   */
  onJobFailed?: (callback: (event: JobFailedEvent) => void) => () => void;
  /**
   * Subscribe to the unified job event stream (`queued | stage | log |
   * succeeded | failed`). Prefer this over `onJobProgress` / `onJobFailed`
   * for new code; the granular channels remain for backward compatibility.
   */
  onJobEvent?: (callback: (event: JobEvent) => void) => () => void;
  /**
   * Pre-fetch metadata (title / duration / uploader / thumbnail URL) for a
   * YouTube or Bilibili link without downloading the media. Returns `null`
   * when the input isn't a URL, when the URL can't be reached, or when the
   * upstream takes longer than the timeout. Safe to call on every keystroke
   * in the renderer — the main process applies an LRU cache + dedupes
   * concurrent requests for the same URL.
   */
  prefetchUrlMetadata?: (input: string) => Promise<UrlMetadataPreview | null>;
  /**
   * Resolve a media page URL into a direct stream URL playable by a
   * `<video>` element (yt-dlp `-g`, progressive mp4 preferred). Returns
   * `null` when resolution fails. Stream URLs expire; resolve at playback
   * time and do not persist.
   */
  resolveStreamUrl?: (input: string) => Promise<string | null>;
  youtubeSearch: (query: string, opts?: { appendKaraoke?: boolean }) => Promise<YoutubeSearchResult[]>;
  bilibiliSearch: (query: string, opts?: { appendKaraoke?: boolean }) => Promise<YoutubeSearchResult[]>;
  getRoomStatus: () => Promise<RoomStatus>;
  enqueueRoomSong: (input: string, title: string, requestedBy: string) => Promise<RoomStatus>;
  startRoomQueueItem: (itemId: string) => Promise<RoomStatus>;
  finishRoomQueueItem: (itemId: string, status: RoomQueueItemStatus, resultHistoryId?: string | null, error?: string | null) => Promise<RoomStatus>;
  removeRoomQueueItem: (itemId: string) => Promise<RoomStatus>;
  clearRoomQueue: () => Promise<RoomStatus>;
  /** Returns the Electron app locale (`en-US`, `zh-CN`, etc). */
  getSystemLocale?: () => Promise<string>;
  /** Read persisted user settings (locale, future: theme). */
  getSettings?: () => Promise<UserSettings>;
  /** Persist a partial settings update; returns the merged settings. */
  setSettings?: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  /**
   * Re-run Ultimate Vocal Remover (UVR) detection. When UVR is
   * installed, the main process materialises a flat shadow folder of
   * its weight files so `audio-separator --model_file_dir` can consume
   * them directly, and (when the user hasn't picked their own folder)
   * sets `separatorModelDir` to that shadow folder. Safe to call
   * repeatedly; idempotent.
   */
  detectUvr?: () => Promise<UvrDetectionResult>;
}

/**
 * Renderer-facing result of `audio:detect-uvr`. Mirrors the main
 * process `UvrDetectionPayload` so the renderer can render an
 * "auto-linked from UVR" badge and surface a one-shot info notification
 * on first launch.
 */
export interface UvrDetectionResult {
  /** Absolute path to the detected UVR `models/` root, or `null`. */
  uvrRoot: string | null;
  /** Absolute path to the flat shadow folder we manage, or `null`. */
  linkedDir: string | null;
  /** Number of model files now reachable via the flat shadow folder. */
  modelCount: number;
  /** Files newly linked during this detection call. */
  newlyLinked: number;
  /** Whether this call updated `userSettings.separatorModelDir`. */
  appliedToSettings: boolean;
  /** Path the desktop app currently passes to `--separator-model-dir`. */
  currentSeparatorModelDir: string | null;
  /** Best-available model the CLI will pass to `--separator-model`. */
  preferredModel: string | null;
}
