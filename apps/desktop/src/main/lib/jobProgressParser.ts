import type { JobStage } from "../../shared/job-events.js";

/**
 * Maps the Python CLI stage names (emitted by `generate_subtitles.py`'s
 * `emit_progress` envelope) to the canonical {@link JobStage} union exposed
 * to the renderer. Unknown stage names return `null` so the caller can
 * decide whether to ignore them or fall back to a generic bucket.
 *
 * The mapping intentionally collapses several CLI sub-stages onto a smaller
 * set of presentation buckets so the renderer's progress UI stays stable
 * even as the underlying tools evolve.
 */
export const SCRIPT_STAGE_TO_JOB_STAGE: Record<string, JobStage> = {
  prepare: "metadata",
  download: "audio",
  preview: "audio",
  captions: "captions",
  separate: "separation",
  convert: "audio",
  transcribe: "transcribe",
  write: "writeOutputs",
  manifest: "manifest"
};

export function mapScriptStage(name: string | null | undefined): JobStage | null {
  if (!name) {
    return null;
  }
  return SCRIPT_STAGE_TO_JOB_STAGE[name] ?? null;
}

/**
 * Parser state shared across stderr chunks for a single running job.
 * Tracks the most-recent canonical stage so raw progress lines from
 * yt-dlp / ffmpeg can be attributed to the correct bucket, plus partial
 * ffmpeg `-progress pipe:2` key/value blocks awaiting their flush trigger
 * (`progress=continue` or `progress=end`).
 */
export interface RawParseState {
  currentStage: JobStage | null;
  currentScriptStage: string | null;
  ffmpeg: { lastOutTimeMs?: number; lastSpeed?: string };
  lastEmitMs: number;
  lastEmitProgress: number;
}

export function createParseState(): RawParseState {
  return {
    currentStage: null,
    currentScriptStage: null,
    ffmpeg: {},
    lastEmitMs: 0,
    lastEmitProgress: -2
  };
}

export interface ParsedRawProgress {
  stage: JobStage;
  /** 0..1 fraction. `-1` when the underlying tool offers no measurable progress. */
  progress: number;
  etaSec?: number | null;
  message?: string;
}

export type RawLineResult =
  | { type: "emit"; data: ParsedRawProgress }
  /** Recognised CLI noise (e.g. ffmpeg `-progress` fragment) — drop silently. */
  | { type: "consumed" }
  /** Not a progress signal at all — forward to the log stream as before. */
  | { type: "passthrough" };

const FFMPEG_PROGRESS_KEYS = new Set([
  "bitrate",
  "total_size",
  "out_time_us",
  "out_time_ms",
  "out_time",
  "dup_frames",
  "drop_frames",
  "speed",
  "fps",
  "frame",
  "stream_0_0_q"
]);

function parseFfmpegTimestamp(value: string, unitsPerMillisecond: number): number | undefined {
  const raw = Number(value);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw) || raw < 0) {
    return undefined;
  }
  const milliseconds = Math.round(raw / unitsPerMillisecond);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

const YTDLP_DOWNLOAD_RE =
  /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([\d.]+\s*\w+\/s))?(?:\s+ETA\s+([\d:]+))?/;
const YTDLP_DOWNLOAD_DONE_RE =
  /^\[download\]\s+100(?:\.0+)?%\s+of\s+([\d.]+\s*\w+)\s+in\s+([\d:]+)(?:\s+at\s+([\d.]+\s*\w+\/s))?/;
const YTDLP_DESTINATION_RE = /^\[download\]\s+Destination:/;

/**
 * Convert a `[H:]MM:SS` (or `SS`) clock string into seconds, returning
 * `null` for malformed input so the caller can leave ETA undefined.
 */
export function parseEtaToSeconds(text: string): number | null {
  const parts = text.split(":").map((s) => Number(s.trim()));
  if (parts.some((n) => Number.isNaN(n))) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

/**
 * Try to parse a single line of CLI stderr into a structured stage progress
 * event. Returns one of:
 *
 * - `{ type: "emit", data }` — flush this stage update through the IPC bus.
 * - `{ type: "consumed" }` — recognised CLI fragment that should be dropped
 *   without showing up in the renderer log (e.g. ffmpeg `-progress` keys
 *   before the `progress=continue` flush trigger).
 * - `{ type: "passthrough" }` — not a progress signal; caller should forward
 *   the line to the log stream as before.
 *
 * Recognised shapes:
 * - `[download] X% of SIZE at SPEED ETA H:MM` → fractional progress with ETA
 * - `[download] 100% of SIZE in TIME at SPEED` → done (progress = 1.0)
 * - `out_time_us=` / `speed=` / `progress=continue|end` → ffmpeg key/value
 *   stream (`-progress pipe:2`). We accumulate fields and flush on
 *   `progress=...` so the renderer sees one event per ffmpeg update window;
 *   non-progress ffmpeg keys (`bitrate=`, `dup_frames=`, …) are consumed
 *   silently to keep the log pane clean.
 */
export function parseRawProgressLine(line: string, state: RawParseState): RawLineResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "passthrough" };
  }

  if (state.currentStage) {
    if (YTDLP_DESTINATION_RE.test(trimmed)) {
      return {
        type: "emit",
        data: {
          stage: state.currentStage,
          progress: -1,
          message: trimmed.replace(/^\[download\]\s+/, "")
        }
      };
    }

    const doneMatch = YTDLP_DOWNLOAD_DONE_RE.exec(trimmed);
    if (doneMatch) {
      const size = doneMatch[1].replace(/\s+/g, "");
      const elapsed = doneMatch[2];
      const speed = doneMatch[3]?.replace(/\s+/g, "");
      const message = `100% · ${size} · ${elapsed}` + (speed ? ` · ${speed}` : "");
      return {
        type: "emit",
        data: { stage: state.currentStage, progress: 1, etaSec: 0, message }
      };
    }

    const dlMatch = YTDLP_DOWNLOAD_RE.exec(trimmed);
    if (dlMatch) {
      const pct = Number(dlMatch[1]);
      if (!Number.isNaN(pct)) {
        const size = dlMatch[2].replace(/\s+/g, "");
        const speed = dlMatch[3]?.replace(/\s+/g, "");
        const etaText = dlMatch[4];
        const etaSec = etaText ? parseEtaToSeconds(etaText) : null;
        const message =
          `${pct.toFixed(1)}% · ${size}` +
          (speed ? ` · ${speed}` : "") +
          (etaText ? ` · ETA ${etaText}` : "");
        return {
          type: "emit",
          data: {
            stage: state.currentStage,
            progress: Math.min(Math.max(pct / 100, 0), 1),
            etaSec,
            message
          }
        };
      }
    }
  }

  if (trimmed === "progress=continue" || trimmed === "progress=end") {
    if (!state.currentStage) {
      return { type: "consumed" };
    }
    const isEnd = trimmed === "progress=end";
    const outMs = state.ffmpeg.lastOutTimeMs;
    const speed = state.ffmpeg.lastSpeed;
    const segments: string[] = [];
    if (typeof outMs === "number" && Number.isSafeInteger(outMs) && outMs >= 0) {
      segments.push(`${Math.floor(outMs / 1000)}s`);
    }
    if (speed) {
      segments.push(speed);
    }
    return {
      type: "emit",
      data: {
        stage: state.currentStage,
        progress: isEnd ? 1 : -1,
        etaSec: isEnd ? 0 : null,
        message: segments.length > 0 ? segments.join(" · ") : undefined
      }
    };
  }

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx);
    if (FFMPEG_PROGRESS_KEYS.has(key)) {
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key === "out_time_us") {
        state.ffmpeg.lastOutTimeMs = parseFfmpegTimestamp(value, 1000);
      } else if (key === "out_time_ms") {
        // Despite the legacy key name, ffmpeg reports this value in
        // microseconds as well (the same unit as out_time_us).
        state.ffmpeg.lastOutTimeMs = parseFfmpegTimestamp(value, 1000);
      } else if (key === "speed" && value && value !== "N/A") {
        state.ffmpeg.lastSpeed = value;
      }
      return { type: "consumed" };
    }
  }

  return { type: "passthrough" };
}

/**
 * Default throttle window for raw-line emissions. yt-dlp can fire many
 * progress lines per second; we coalesce them so the renderer receives at
 * most one update per window unless progress jumps materially or the
 * stage finishes.
 */
export const RAW_EMIT_THROTTLE_MS = 200;
export const RAW_EMIT_PROGRESS_DELTA = 0.01;

/**
 * Returns `true` when the parsed event should be emitted right now,
 * mutating `state` to record the emission. Always allows `progress >= 1`
 * (stage completion) and `progress < 0` (unknown — message-only updates)
 * through; intermediate fractional progress is throttled by both time
 * window and minimum delta.
 */
export function shouldEmitRaw(parsed: ParsedRawProgress, state: RawParseState, now: number): boolean {
  if (parsed.progress >= 1 || parsed.progress < 0) {
    state.lastEmitMs = now;
    state.lastEmitProgress = parsed.progress;
    return true;
  }
  const elapsed = now - state.lastEmitMs;
  const delta = Math.abs(parsed.progress - state.lastEmitProgress);
  if (elapsed >= RAW_EMIT_THROTTLE_MS || delta >= RAW_EMIT_PROGRESS_DELTA) {
    state.lastEmitMs = now;
    state.lastEmitProgress = parsed.progress;
    return true;
  }
  return false;
}
