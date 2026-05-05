import { spawn } from "node:child_process";
import type { UrlMetadataPreview } from "../../shared/types.js";

/**
 * Minimal runtime contract this lib needs from `prepareAudioRuntime`. We
 * intentionally pick only the fields used here so the lib stays loosely
 * coupled to main.ts (avoids circular import risk and keeps the main module
 * free to evolve without breaking prefetch).
 *
 * yt-dlp is invoked via `python -m yt_dlp` (not as a standalone binary)
 * because the desktop app installs yt-dlp into the bundled venv. The same
 * pattern is used by `runMediaSearch` in main.ts.
 */
export interface AudioRuntime {
  env: NodeJS.ProcessEnv;
  python: {
    command: string;
    argsPrefix: readonly string[];
  };
}

interface CacheEntry {
  value: UrlMetadataPreview;
  insertedAt: number;
}

interface YtDlpInfo {
  webpage_url?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
}

interface ThumbnailEntry {
  url?: unknown;
  width?: unknown;
}

const CACHE_MAX = 50;
// 30 min — long enough for a session, short enough to refresh stale titles.
const CACHE_TTL_MS = 30 * 60 * 1000;
// 4.5s — covers the median yt-dlp metadata fetch with a small headroom over
// the 4s socket timeout we pass to yt-dlp itself, while still feeling snappy.
const PREFETCH_TIMEOUT_MS = 4500;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<UrlMetadataPreview | null>>();

/**
 * Returns a cached preview if one exists and is non-stale; evicts and returns
 * `null` when the entry is past its TTL.
 */
export function getCachedMetadata(canonicalKey: string): UrlMetadataPreview | null {
  const entry = cache.get(canonicalKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.insertedAt > CACHE_TTL_MS) {
    cache.delete(canonicalKey);
    return null;
  }
  return entry.value;
}

/** Test / debug helper. */
export function clearMetadataCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Pre-fetch lightweight metadata for a URL using yt-dlp's `--dump-single-json`
 * mode. Resolves with `null` when the input isn't a URL, when yt-dlp fails,
 * or when the request exceeds {@link PREFETCH_TIMEOUT_MS}.
 *
 * Behavior:
 *  - Cached results are returned immediately.
 *  - Concurrent calls for the same canonical URL share a single in-flight
 *    spawn (no duplicate yt-dlp processes per keystroke).
 *  - Failures are NOT cached so a subsequent keystroke can retry.
 */
export async function prefetchUrlMetadata(
  rawInput: string,
  runtime: AudioRuntime
): Promise<UrlMetadataPreview | null> {
  const trimmed = (rawInput ?? "").trim();
  if (!trimmed || !isHttpUrl(trimmed)) {
    return null;
  }

  const canonicalKey = canonicalize(trimmed);

  const cached = getCachedMetadata(canonicalKey);
  if (cached) {
    return cached;
  }

  const existing = inflight.get(canonicalKey);
  if (existing) {
    return existing;
  }

  const promise = runYtdlpMetadata(trimmed, canonicalKey, runtime).finally(() => {
    inflight.delete(canonicalKey);
  });
  inflight.set(canonicalKey, promise);
  return promise;
}

async function runYtdlpMetadata(
  url: string,
  canonicalKey: string,
  runtime: AudioRuntime
): Promise<UrlMetadataPreview | null> {
  const args = [
    ...runtime.python.argsPrefix,
    "-m",
    "yt_dlp",
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--no-progress",
    "--extractor-retries",
    "1",
    "--socket-timeout",
    "4",
    url
  ];

  const stdout = await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(runtime.python.command, args, {
        env: runtime.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      resolve(null);
      return;
    }

    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    // Discard stderr — this is a silent prefetch; failures resolve to null.
    child.stderr.on("data", () => {
      /* noop */
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already exited */
      }
      finish(null);
    }, PREFETCH_TIMEOUT_MS);

    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (code === 0 && out.trim().length > 0) {
        finish(out);
      } else {
        finish(null);
      }
    });
  });

  if (stdout === null) {
    return null;
  }

  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    return null;
  }

  const value: UrlMetadataPreview = {
    sourceUrl: typeof info.webpage_url === "string" ? info.webpage_url : url,
    origin: deriveOrigin(canonicalKey),
    title: typeof info.title === "string" ? info.title : null,
    uploader:
      typeof info.uploader === "string"
        ? info.uploader
        : typeof info.channel === "string"
          ? info.channel
          : null,
    durationSec:
      typeof info.duration === "number" && Number.isFinite(info.duration)
        ? Math.round(info.duration)
        : null,
    thumbnailUrl: pickBestThumbnail(info),
    fetchedAt: new Date().toISOString()
  };

  insertIntoCache(canonicalKey, value);
  return value;
}

function insertIntoCache(canonicalKey: string, value: UrlMetadataPreview): void {
  if (cache.has(canonicalKey)) {
    cache.delete(canonicalKey);
  } else if (cache.size >= CACHE_MAX) {
    // Map preserves insertion order; the first key is the oldest entry.
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === "string") {
      cache.delete(oldestKey);
    }
  }
  cache.set(canonicalKey, { value, insertedAt: Date.now() });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Inline copy of the canonicalization shape from main.ts `normalizeSourceUrl`.
 * Kept local to avoid a circular import; only needs to map equivalent URLs to
 * the same cache key (e.g. youtu.be/ID and youtube.com/watch?v=ID).
 */
function canonicalize(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return id ? `youtube:${id}` : value.toLowerCase();
    }
    if (hostname.endsWith("youtube.com")) {
      const videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ??
        "";
      return videoId ? `youtube:${videoId}` : `${hostname}${url.pathname}`.toLowerCase();
    }
    if (hostname.endsWith("bilibili.com") || hostname === "b23.tv") {
      const biliId =
        url.pathname.match(/\/video\/([^/?#]+)/)?.[1] ??
        url.pathname.split("/").filter(Boolean)[0] ??
        "";
      return biliId ? `bilibili:${biliId.toLowerCase()}` : `${hostname}${url.pathname}`.toLowerCase();
    }
    return `${hostname}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function deriveOrigin(canonicalKey: string): UrlMetadataPreview["origin"] {
  if (canonicalKey.startsWith("youtube:")) {
    return "youtube";
  }
  if (canonicalKey.startsWith("bilibili:")) {
    return "bilibili";
  }
  return "url";
}

/**
 * Prefer the smallest thumbnail with width >= 240 (typically the 4:3 mqdefault
 * for YouTube — small enough to load instantly, large enough to render crisp
 * at 80×45). Falls back to `info.thumbnail` (a single string), then `null`.
 */
function pickBestThumbnail(info: YtDlpInfo): string | null {
  if (Array.isArray(info.thumbnails)) {
    const candidates: Array<{ url: string; width: number }> = [];
    for (const raw of info.thumbnails as ThumbnailEntry[]) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const url = typeof raw.url === "string" ? raw.url : null;
      if (!url) {
        continue;
      }
      const width = typeof raw.width === "number" && Number.isFinite(raw.width) ? raw.width : 0;
      if (width >= 240) {
        candidates.push({ url, width });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.width - b.width);
      return candidates[0].url;
    }
  }
  if (typeof info.thumbnail === "string" && info.thumbnail.length > 0) {
    return info.thumbnail;
  }
  return null;
}
