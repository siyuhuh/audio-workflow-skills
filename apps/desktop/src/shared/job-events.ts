import type { JobOptions, SavedJobHistory } from "./types.js";

/**
 * Logical pipeline stages produced by the main process.
 *
 * The CLI internally uses many tools (yt-dlp, ffmpeg, faster-whisper,
 * audio-separator). The renderer should only ever see the normalized stage
 * names below so progress UI stays stable as the underlying tooling changes.
 */
export type JobStage =
  | "queued"
  | "metadata"
  | "captions"
  | "audio"
  | "separation"
  | "transcribe"
  | "writeOutputs"
  | "manifest";

/**
 * Categorised failure reasons. The renderer maps each reason to a localized
 * message and an optional recovery action (e.g. "use cookies", "switch to
 * local fallback"). Unknown failures fall back to a generic copy log dialog.
 */
export type JobErrorReason =
  | "auth_required"
  | "no_captions"
  | "rate_limited"
  | "hf_rate_limited"
  | "network"
  | "model_missing"
  | "separator_missing"
  | "ffmpeg_missing"
  | "ytdlp_missing"
  | "disk_full"
  | "canceled"
  | "unknown";

export interface JobErrorHint {
  /** i18n key such as `"error.authRequired"`. */
  messageKey: string;
  /** Template values for the localized string. */
  values?: Record<string, string | number>;
  /**
   * Suggested recovery actions. Handlers live in the renderer; this payload
   * carries only the action `id` and a labelKey for i18n lookup.
   */
  actions?: { id: string; labelKey: string }[];
}

export type JobEvent =
  | {
      kind: "queued";
      jobId: string;
      input: string;
      createdAt: number;
      options: JobOptions;
    }
  | {
      kind: "stage";
      jobId: string;
      stage: JobStage;
      /** 0..1 fraction. Use `-1` when progress is genuinely unknown. */
      progress: number;
      etaSec?: number | null;
      /** Human-readable status, e.g. `"downloading audio · 4.2 MiB / 7.1 MiB"`. */
      message?: string;
      /**
       * `true` when this stage encountered a non-fatal failure that the CLI
       * recovered from (e.g. vocal separation crashed and the pipeline
       * continued with the original audio). Renderer should surface this as
       * a warning toast immediately rather than waiting for job completion.
       */
      failed?: boolean;
    }
  | {
      kind: "log";
      jobId: string;
      stream: "stdout" | "stderr";
      line: string;
      level?: "info" | "warn" | "error";
    }
  | {
      kind: "succeeded";
      jobId: string;
      packageId: string;
      durationMs: number;
      historyEntry: SavedJobHistory;
    }
  | {
      kind: "failed";
      jobId: string;
      reason: JobErrorReason;
      hint?: JobErrorHint;
      durationMs: number;
      /** Last ~40 stderr/stdout lines, useful for "Copy log" actions. */
      logsTail: string[];
    };

export type JobEventListener = (event: JobEvent) => void;
