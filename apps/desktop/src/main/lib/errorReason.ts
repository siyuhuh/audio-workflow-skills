import type { JobErrorReason, JobErrorHint } from "../../shared/job-events.js";

export interface ClassifiedError {
  reason: JobErrorReason;
  hint?: JobErrorHint;
}

/**
 * Recognises raw stderr lines emitted by yt-dlp / ffmpeg / faster-whisper /
 * audio-separator and maps them to a structured reason + hint.
 *
 * Patterns are intentionally permissive — yt-dlp localises some error strings
 * and tools change their wording across versions, so we match the most stable
 * substrings rather than exact lines. The first matching rule wins; rule order
 * roughly reflects how distinctive each pattern is.
 */
interface ReasonRule {
  reason: JobErrorReason;
  patterns: RegExp[];
  actionId?: string;
}

const REASON_RULES: ReasonRule[] = [
  {
    reason: "auth_required",
    actionId: "openAdvancedCookies",
    patterns: [
      /sign in to confirm/i,
      /cookies are required/i,
      /http error 403\b/i,
      /login required/i
    ]
  },
  {
    reason: "no_captions",
    actionId: "enableLocalFallback",
    patterns: [
      /no subtitles/i,
      /requested subtitles not available/i,
      /unable to download subtitles/i,
      /no automatic captions/i
    ]
  },
  {
    // HuggingFace Hub anonymous rate-limit. Distinct from generic 429 because
    // the recovery path is different (paste an HF token into Settings, not
    // "wait and retry"). Anonymous downloads cap at ~10 req/min/IP, so this
    // hits hard during first-run separator/whisper model downloads.
    reason: "hf_rate_limited",
    actionId: "openHfTokenSettings",
    patterns: [
      /huggingface[_.-]?hub[^\n]*(?:rate.?limit|429|too many requests)/i,
      /hf[_-]?hub[^\n]*(?:rate.?limit|429|too many requests)/i,
      /huggingface\.co[^\n]*\b429\b/i,
      /unauthenticated requests to the hf hub/i,
      /please set a hf_token/i,
      /please log in to load private and gated models/i
    ]
  },
  {
    reason: "rate_limited",
    actionId: "waitAndRetry",
    patterns: [
      /http error 429\b/i,
      /rate-?limit(?:ed|ing)?/i,
      /too many requests/i
    ]
  },
  {
    reason: "network",
    actionId: "retry",
    patterns: [
      /getaddrinfo enotfound/i,
      /\benetunreach\b/i,
      /\beconnreset\b/i,
      /unable to download webpage/i,
      /name or service not known/i,
      /no route to host/i
    ]
  },
  {
    reason: "model_missing",
    actionId: "copySetupCommand",
    patterns: [
      /no module named ['"]?whisper['"]?/i,
      /no module named ['"]?faster_whisper['"]?/i,
      /failed to download model/i,
      /model[^\n]*not found/i
    ]
  },
  {
    reason: "separator_missing",
    actionId: "disableSeparation",
    patterns: [
      /no module named ['"]?audio_separator['"]?/i,
      /audio-separator: command not found/i,
      /audio-separator not installed/i,
      /missing dependency: audio-separator/i,
      /audio-separator produced no supported stem files/i
    ]
  },
  {
    // audio-separator runtime failure (model download, ONNX runtime, etc.).
    // Reuses the `separator_missing` reason intentionally so the renderer
    // already has a localized story for it; the actionId points at the
    // separator-model-dir setting because the most reliable fix is to
    // reuse a local UVR install (or any pre-downloaded model pool)
    // instead of fighting a flaky HuggingFace download. "Disable
    // separation" is offered as a secondary action by the renderer.
    //
    // PytorchStreamReader / "checkpoint file is corrupted" matches the
    // exact failure mode where audio-separator's previous run downloaded
    // a partial weight file; re-detecting UVR from the renderer
    // re-prunes those files (see `cleanupCorruptDownloads` in main.ts).
    reason: "separator_missing",
    actionId: "openSeparatorModelDirSettings",
    patterns: [
      /vocal separation failed \(audio-separator exit/i,
      /onnxruntime[^\n]*(?:error|failed|missing)/i,
      /failed to load model[^\n]*\.onnx/i,
      /huggingface_hub[^\n]*(?:connection|timeout|read timed out)/i,
      /requests\.exceptions\.(?:connection|read)?timeout/i,
      /could not download.*audio.separator/i,
      /pytorchstreamreader[^\n]*failed reading zip archive/i,
      /checkpoint file is corrupted/i,
      /failed to load roformer model/i
    ]
  },
  {
    reason: "ffmpeg_missing",
    actionId: "copySetupCommand",
    patterns: [
      /ffmpeg: command not found/i,
      /ffmpeg not installed/i,
      /ffmpeg[^\n]*not found in path/i
    ]
  },
  {
    reason: "ytdlp_missing",
    actionId: "copySetupCommand",
    patterns: [
      /yt-dlp: command not found/i,
      /no module named ['"]?yt_dlp['"]?/i
    ]
  },
  {
    reason: "disk_full",
    actionId: "openOutputFolder",
    patterns: [
      /no space left on device/i,
      /\benospc\b/i
    ]
  }
];

const CANCEL_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT"]);

/**
 * Map raw stderr / exit code into a structured error reason and a hint
 * payload the renderer can localize and act on.
 *
 * Heuristics are case-insensitive and scan the most recent stderr lines.
 */
export function classifyError(
  stderrTail: string,
  exitCode?: number | null,
  signal?: string | null
): ClassifiedError {
  if (signal && CANCEL_SIGNALS.has(signal)) {
    return { reason: "canceled", hint: hintFor("canceled") };
  }

  const haystack = stderrTail ?? "";
  for (const rule of REASON_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { reason: rule.reason, hint: hintFor(rule.reason, rule.actionId) };
    }
  }

  void exitCode;
  return { reason: "unknown", hint: hintFor("unknown", "copyLog") };
}

function hintFor(reason: JobErrorReason, actionId?: string): JobErrorHint {
  const hint: JobErrorHint = {
    messageKey: `capture:error.${reasonToCamelCase(reason)}.body`
  };
  if (actionId) {
    hint.actions = [
      {
        id: actionId,
        labelKey: `capture:error.action.${actionId}`
      }
    ];
  }
  return hint;
}

function reasonToCamelCase(reason: JobErrorReason): string {
  return reason.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
