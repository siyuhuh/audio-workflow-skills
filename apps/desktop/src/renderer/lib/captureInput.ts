import type { YoutubeSearchResult } from "../../shared/types";

/** Prefer song-length clips under this duration when ranking search hits. */
export const SHORT_CLIP_MAX_SEC = 15 * 60;

export type CaptureInputKind = "url" | "local" | "search";

export function isHttpInput(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Prepend https:// for bare YouTube / Bilibili watch hosts. */
export function normalizeCaptureInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)([/?#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (/^(www\.)?(bilibili\.com|b23\.tv|m\.bilibili\.com)([/?#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function looksLikeLocalMediaPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("file://")) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("~/")) {
    return true;
  }
  return /\.(mp3|wav|m4a|flac|aac|ogg|opus|aiff|mp4|mkv|webm|mov|m4v|avi)$/i.test(trimmed);
}

/**
 * Plain text or an invalid-looking URL become a media search query.
 * Valid http(s) links and local paths stay in capture/process mode.
 */
export function classifyCaptureInput(value: string): CaptureInputKind {
  const trimmed = value.trim();
  if (!trimmed) {
    return "search";
  }
  const normalized = normalizeCaptureInput(trimmed);
  if (isHttpInput(normalized)) {
    return "url";
  }
  if (looksLikeLocalMediaPath(trimmed)) {
    return "local";
  }
  return "search";
}

export function parseDurationLabel(label: string | undefined): number | null {
  if (!label?.trim()) {
    return null;
  }
  const parts = label
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  if (parts.length === 2) {
    return Math.floor(parts[0]! * 60 + parts[1]!);
  }
  return Math.floor(parts[0]! * 3600 + parts[1]! * 60 + parts[2]!);
}

export function durationSecondsOf(row: YoutubeSearchResult): number | null {
  if (typeof row.durationSec === "number" && Number.isFinite(row.durationSec) && row.durationSec >= 0) {
    return Math.floor(row.durationSec);
  }
  return parseDurationLabel(row.durationLabel);
}

/** Short clips first (<15min), then shorter known durations, unknowns last among that band. */
export function rankMediaSearchResults(rows: YoutubeSearchResult[]): YoutubeSearchResult[] {
  return [...rows].sort((a, b) => {
    const da = durationSecondsOf(a);
    const db = durationSecondsOf(b);
    const aShort = da != null && da > 0 && da < SHORT_CLIP_MAX_SEC;
    const bShort = db != null && db > 0 && db < SHORT_CLIP_MAX_SEC;
    if (aShort !== bShort) {
      return aShort ? -1 : 1;
    }
    if ((da == null) !== (db == null)) {
      return da == null ? 1 : -1;
    }
    if (da != null && db != null && da !== db) {
      return da - db;
    }
    const platformRank = (platform?: YoutubeSearchResult["platform"]) =>
      platform === "youtube" ? 0 : platform === "bilibili" ? 1 : 2;
    const platformDiff = platformRank(a.platform) - platformRank(b.platform);
    if (platformDiff !== 0) {
      return platformDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

export function mergeMediaSearchResults(
  batches: Array<YoutubeSearchResult[] | null | undefined>
): YoutubeSearchResult[] {
  const seen = new Set<string>();
  const merged: YoutubeSearchResult[] = [];
  for (const batch of batches) {
    for (const row of batch ?? []) {
      const key = row.url || `${row.platform ?? "unknown"}:${row.videoId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(row);
    }
  }
  return rankMediaSearchResults(merged);
}
