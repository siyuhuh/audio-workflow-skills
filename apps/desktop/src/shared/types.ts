export type SubtitleSource = "auto" | "platform" | "local";

export type WorkflowMode = "karaoke" | "subtitle";

export type OutputFormat = "lrc" | "srt" | "vtt" | "txt" | "json";

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
}
