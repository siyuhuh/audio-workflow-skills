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

export type RecordingExportFormat = "wav" | "mp3";

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
  platform?: "youtube" | "bilibili";
  thumbnailUrl?: string;
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

export type AccentColor = "green" | "lime" | "mint" | "teal";

export interface UserSettings {
  locale: AppLocale | null;
  themeMode: ThemeMode;
  accentColor: AccentColor;
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
  onJobLog: (callback: (log: JobLog) => void) => () => void;
  /** Subscribe to structured pipeline progress events from the CLI. */
  onJobProgress?: (callback: (event: JobProgressStage) => void) => () => void;
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
}
