import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, session, shell } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
  CommandPreview,
  GeneratedAsset,
  GeneratedAssetRole,
  JobOptions,
  JobProgressStage,
  JobResult,
  OutputFormat,
  PlaybackBundle,
  RoomQueueItem,
  RoomStatus,
  SavedJobHistory,
  UrlMetadataPreview,
  UserSettings,
  YoutubeSearchResult
} from "../shared/types.js";
import type { JobEvent } from "../shared/job-events.js";
import { classifyError } from "./lib/errorReason.js";
import { prefetchUrlMetadata } from "./lib/urlMetadata.js";
import {
  createParseState,
  mapScriptStage,
  parseRawProgressLine,
  shouldEmitRaw,
  type RawParseState
} from "./lib/jobProgressParser.js";
import {
  buildPackageManifest,
  hydrateHistoryFromManifest,
  readPackageManifest,
  writePackageManifest
} from "./lib/packageManifest.js";
import type { PackageSourceKey } from "../shared/package-manifest.js";
import {
  cleanupCorruptDownloads,
  detectUvrModelsRoot,
  pickPreferredSeparatorModel,
  syncUvrShadowFolder,
  vocalflowManagedSeparatorDir,
  type UvrDetectionPayload
} from "./lib/uvrDetect.js";
import {
  bundledSeparatorModelsDir,
  bundledWhisperHfHomeDir,
  dirSizeBytes,
  seedBundledSeparator,
  seedBundledWhisperCache
} from "./lib/bundledModels.js";

type JobFailedEvent = Extract<JobEvent, { kind: "failed" }>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDisplayName = "VocalFlow";
const runningJobs = new Map<string, ChildProcessByStdio<null, Readable, Readable>>();
const knownFilePaths = new Set<string>();
const knownOutputDirs = new Set<string>();
const mediaUrlTokens = new Map<string, string>();
const webLogClients = new Set<ServerResponse>();
const roomEventClients = new Set<ServerResponse>();
let savedHistory: SavedJobHistory[] = [];
let hiddenSampleIds = new Set<string>();
const DEFAULT_USER_SETTINGS: UserSettings = {
  locale: null,
  themeMode: "dark",
  accentColor: "green",
  hfToken: null,
  hfEndpoint: null,
  separatorModelDir: null
};
let userSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
let webApiServer: Server | null = null;
const roomToken = randomUUID().replaceAll("-", "").slice(0, 12);
let roomQueue: RoomQueueItem[] = [];
let roomNowPlaying: RoomQueueItem | null = null;

const jobProgressClients = new Set<Electron.WebContents>();

function isAccentColor(value: unknown): value is UserSettings["accentColor"] {
  return value === "green" || value === "lime" || value === "mint" || value === "teal";
}

function desktopIconPath(): string {
  return path.join(__dirname, "../../build/icon.png");
}

interface CommandInvocation {
  command: string;
  argsPrefix: string[];
}

interface PreparedRuntime {
  env: NodeJS.ProcessEnv;
  python?: CommandInvocation;
}

interface RuntimeNeeds {
  ytDlp: boolean;
  whisper: boolean;
  separator: boolean;
  zhconv: boolean;
}

type RuntimeLog = (chunk: string) => void;

interface SamplePackageManifest {
  id: string;
  title: string;
  input?: string;
  workflowMode?: "karaoke" | "subtitle";
  sourceUrl?: string | null;
  assets?: Array<Partial<GeneratedAsset> & { path: string }>;
  primarySubtitle?: string | null;
  primaryMedia?: string | null;
}

const runtimePackageChecks = {
  ytDlp: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('yt_dlp') else 1)",
  whisper: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('faster_whisper') else 1)",
  whisperTimestamped: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('whisper_timestamped') else 1)",
  separator: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('audio_separator') else 1)",
  zhconv: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('zhconv') else 1)"
};

const runtimePackages = {
  ytDlp: "yt-dlp",
  whisper: "faster-whisper",
  whisperTimestamped: "whisper-timestamped",
  separator: "audio-separator[cpu]",
  zhconv: "zhconv"
};

const subtitleExtensions = new Set([".srt", ".vtt", ".lrc", ".txt", ".json", ".ass"]);
const mediaExtensions = new Set([".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".opus", ".aiff", ".aif", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const reviewExtensions = new Set([...subtitleExtensions, ...mediaExtensions]);
const mediaProtocol = "vocalflow-media";
const webApiHost = "0.0.0.0";
const webApiLocalHost = "127.0.0.1";
const webApiPort = 5175;
const webApiOrigin = `http://${webApiLocalHost}:${webApiPort}`;
const mediaMimeTypes = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".aiff", "audio/aiff"],
  [".aif", "audio/aiff"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mkv", "video/x-matroska"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".m4v", "video/x-m4v"]
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: mediaProtocol,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

function audioSubtitlesInvocation(runtime?: PreparedRuntime): CommandInvocation {
  const bundledScript = bundledAudioSubtitlesScript();
  if (bundledScript && runtime?.python) {
    return {
      command: runtime.python.command,
      argsPrefix: [...runtime.python.argsPrefix, bundledScript]
    };
  }

  if (bundledScript && app.isPackaged) {
    const python = pythonInvocation();
    if (!python) {
      throw new Error("VocalFlow could not find its bundled Python runtime. Reinstall the app and try again.");
    }
    return {
      command: python.command,
      argsPrefix: [...python.argsPrefix, bundledScript]
    };
  }

  const localCommand = path.join(homedir(), ".local", "bin", "audio-subtitles");
  if (existsSync(localCommand)) {
    return { command: localCommand, argsPrefix: [] };
  }

  const pathCommand = findExecutable("audio-subtitles");
  if (pathCommand) {
    return { command: pathCommand, argsPrefix: [] };
  }

  if (bundledScript) {
    const python = pythonInvocation();
    if (!python) {
      throw new Error(
        "VocalFlow includes its audio-subtitles script, but Python 3 was not found. Reinstall the app or install Python 3 and try again."
      );
    }
    return {
      command: python.command,
      argsPrefix: [...python.argsPrefix, bundledScript]
    };
  }

  throw new Error(
    "audio-subtitles was not found. Install the CLI with ./install.sh, or reinstall VocalFlow so the bundled audio-subtitles script is included."
  );
}

function createWindow(): void {
  const iconPath = desktopIconPath();
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: appDisplayName,
    icon: iconPath,
    backgroundColor: "#0b0c10",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {
          autoHideMenuBar: true
        }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (app.isPackaged) {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    window.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174");
  }
}

app.whenReady().then(() => {
  app.setName(appDisplayName);
  if (process.platform === "darwin") {
    app.dock?.setIcon(nativeImage.createFromPath(desktopIconPath()));
  }
  process.env.PATH = [
    path.join(homedir(), ".local", "bin"),
    process.env.PATH ?? "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ].join(path.delimiter);

  loadSavedHistory();
  loadUserSettings();
  // Auto-detect UVR before the renderer mounts so settings load with the
  // shadow folder already wired in. Failures are non-fatal and the
  // renderer can re-trigger detection from the Settings drawer.
  try {
    detectAndLinkUvr();
  } catch (error) {
    console.warn(
      `[separator] UVR auto-detect threw: ${error instanceof Error ? error.message : error}`
    );
  }
  registerMediaProtocol();
  registerBilibiliMediaHeaders();
  registerIpcHandlers();
  registerMediaPermissions();
  startWebApiServer();
  createWindow();

  app.on("activate", () => {
    // macOS keeps the process alive after the last window closes. The web API
    // powers browser/UI search + remote room, so bring it back if it was torn
    // down, then recreate the window.
    startWebApiServer();
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const child of runningJobs.values()) {
    terminateChildProcess(child);
  }
  runningJobs.clear();

  // On macOS the app stays in the Dock; keep the web API listening so Vite UI
  // / remote room / HTTP search fallbacks don't die with "Failed to fetch".
  // Tear the server down only when the process is actually quitting.
  if (process.platform !== "darwin") {
    webApiServer?.close();
    webApiServer = null;
    app.quit();
  }
});

app.on("before-quit", () => {
  webApiServer?.close();
  webApiServer = null;
});

function registerMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    callback(permission === "media" && mediaTypes.includes("audio"));
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("dialog:select-input", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory"],
      filters: [
        { name: "Media", extensions: ["mp3", "wav", "m4a", "flac", "aac", "mp4", "mov", "mkv", "webm"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:select-output-dir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Generic folder picker for Settings (e.g. UVR models folder). Distinct
  // from `select-output-dir` so we don't surface "create directory" UX
  // for read-only model folders.
  ipcMain.handle("dialog:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("job:preview-command", (_event, options: JobOptions): CommandPreview => {
    return buildCommandPreview(options);
  });

  ipcMain.handle("job:run", async (event, jobId: string, options: JobOptions): Promise<JobResult> => {
    return runAudioWorkflowJob(jobId, options, (log) => event.sender.send("job:log", log));
  });

  ipcMain.handle("job:cancel", (_event, jobId: string) => {
    return cancelRunningJob(jobId);
  });

  ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
    if (!targetPath) {
      return;
    }
    await shell.openPath(targetPath);
  });

  ipcMain.handle("shell:open-external-url", async (_event, url: string) => {
    if (!isHttpUrl(url)) {
      throw new Error("Only http and https links can be opened.");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle("file:read-text", async (_event, targetPath: string) => {
    const safePath = assertKnownReviewFile(targetPath, subtitleExtensions);
    return readFile(safePath, "utf-8");
  });

  ipcMain.handle("file:write-text", async (_event, targetPath: string, content: string) => {
    const safePath = assertKnownReviewFile(targetPath, subtitleExtensions);
    await writeFile(safePath, content, "utf-8");
  });

  ipcMain.handle("file:media-url", async (_event, targetPath: string) => {
    const safePath = assertKnownReviewFile(targetPath, mediaExtensions);
    return createMediaUrl(safePath);
  });

  ipcMain.handle("history:list", () => {
    savedHistory = dedupeHistoryEntries(savedHistory.map(refreshHistoryEntry));
    writeHistoryFile();
    const history = historyWithBundledSamples();
    rebuildKnownReviewFiles(history);
    return history;
  });

  ipcMain.handle("history:remove", (_event, historyId: string) => {
    const history = removeHistoryById(historyId);
    return history;
  });

  ipcMain.handle("youtube:search", (_event, query: string, appendKaraoke: boolean) => {
    return runYoutubeSearch(String(query ?? ""), Boolean(appendKaraoke));
  });

  ipcMain.handle("bilibili:search", (_event, query: string, appendKaraoke: boolean) => {
    return runBilibiliSearch(String(query ?? ""), Boolean(appendKaraoke));
  });

  ipcMain.handle("metadata:prefetch", async (_event, input: string): Promise<UrlMetadataPreview | null> => {
    const trimmed = String(input ?? "").trim();
    if (!trimmed) {
      return null;
    }
    try {
      // Reuse the existing yt-dlp-only runtime stub used by media search so we
      // don't trigger whisper/separator install probes for a pure metadata
      // fetch. The placeholder URL keeps `runtimeNeeds` returning ytDlp-only
      // even when the user's pasted URL is Bilibili.
      const runtime = await prepareAudioRuntime(ytdlpSearchPlaceholderOptions(), () => {});
      if (!runtime.python) {
        return null;
      }
      return await prefetchUrlMetadata(trimmed, {
        env: runtime.env,
        python: runtime.python
      });
    } catch {
      return null;
    }
  });

  ipcMain.handle("stream:resolve", async (_event, input: string): Promise<string | null> => {
    const trimmed = String(input ?? "").trim();
    if (!trimmed || !isHttpUrl(trimmed)) {
      return null;
    }
    try {
      const runtime = await prepareAudioRuntime(ytdlpSearchPlaceholderOptions(), () => {});
      if (!runtime.python) {
        return null;
      }
      return await resolveDirectStreamUrl(trimmed, runtime.python, runtime.env);
    } catch {
      return null;
    }
  });

  ipcMain.handle("room:status", () => roomStatus());

  ipcMain.handle("room:enqueue", (_event, input: string, title: string, requestedBy: string) => {
    return enqueueRoomSong(input, title, requestedBy);
  });

  ipcMain.handle("room:start-item", (_event, itemId: string) => {
    return startRoomQueueItem(itemId);
  });

  ipcMain.handle("room:finish-item", (_event, itemId: string, status: RoomQueueItem["status"], resultHistoryId?: string | null, error?: string | null) => {
    return finishRoomQueueItem(itemId, status, resultHistoryId, error);
  });

  ipcMain.handle("room:remove-item", (_event, itemId: string) => {
    return removeRoomQueueItem(itemId);
  });

  ipcMain.handle("room:clear", () => clearRoomQueue());

  ipcMain.handle("app:get-locale", () => {
    try {
      return app.getLocale();
    } catch {
      return "en-US";
    }
  });

  ipcMain.handle("settings:get", () => userSettings);

  ipcMain.handle("settings:set", (_event, patch: Partial<UserSettings>): UserSettings => {
    userSettings = mergeUserSettings(userSettings, patch);
    writeUserSettings();
    return userSettings;
  });

  // Re-run UVR detection on demand so the user can hit "Re-detect" in
  // Settings after installing UVR / downloading new models without
  // restarting the desktop app.
  ipcMain.handle("audio:detect-uvr", () => detectAndLinkUvr());
}

function loadUserSettings(): void {
  try {
    if (!existsSync(userSettingsFilePath())) {
      userSettings = { ...DEFAULT_USER_SETTINGS };
      return;
    }
    const raw = readFileSync(userSettingsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    userSettings = mergeUserSettings({ ...DEFAULT_USER_SETTINGS }, parsed);
    // Persist back if `mergeUserSettings` rejected any field (malformed
    // hfToken / hfEndpoint, etc.). Otherwise the bad on-disk value stays
    // forever, and a future code change that doesn't sanitize on load
    // would re-poison `userSettings`.
    const cleanedSerialized = JSON.stringify(userSettings, null, 2);
    if (JSON.stringify(parsed, null, 2) !== cleanedSerialized) {
      writeUserSettings();
    }
  } catch {
    userSettings = { ...DEFAULT_USER_SETTINGS };
  }
}

/**
 * Detect Ultimate Vocal Remover on the host, materialise a flat shadow
 * folder of its model weights, and (when the user hasn't picked their
 * own folder) point `separatorModelDir` at it. Always returns the
 * detection payload so the renderer can render an "auto-linked from
 * UVR" badge or surface a one-shot info notification on first launch.
 *
 * Safe to call repeatedly (idempotent); used both on app boot and from
 * the manual "Re-detect UVR" button in Settings.
 */
function detectAndLinkUvr(): UvrDetectionPayload {
  const targetDir = vocalflowManagedSeparatorDir(app.getPath("userData"));
  // Always prune obvious garbage (partial downloads from a killed
  // audio-separator run) before resyncing — they would otherwise still
  // be picked up as "real" model files and trigger PytorchStreamReader
  // errors at load time. Non-symlink files >= 5 MB are kept; symlinks
  // are never touched here.
  try {
    const purged = cleanupCorruptDownloads(targetDir);
    if (purged > 0) {
      console.warn(
        `[separator] Pruned ${purged} suspected partial download(s) from ${targetDir}`
      );
    }
  } catch (error) {
    console.warn(
      `[separator] Failed to prune ${targetDir}: ${error instanceof Error ? error.message : error}`
    );
  }

  // Layer 1: a system UVR install (zero-config for users who already
  // have Ultimate Vocal Remover).
  const uvrRoot = detectUvrModelsRoot();
  let linkedDir: string | null = null;
  let modelCount = 0;
  let newlyLinked = 0;
  if (uvrRoot) {
    try {
      const result = syncUvrShadowFolder(uvrRoot, targetDir);
      linkedDir = result.targetDir;
      modelCount = result.modelCount;
      newlyLinked = result.newlyLinked;
    } catch (error) {
      console.warn(
        `[separator] Failed to mirror UVR models from ${uvrRoot}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // Layer 2: bundled fallback models from `vendor/separator-models/`,
  // populated by `apps/desktop/scripts/fetch-bundled-models.sh` before
  // `electron-builder` runs. This is what makes the desktop work
  // out-of-box for users on networks where huggingface.co is unreachable
  // AND who haven't installed UVR. When the maintainer hasn't run the
  // fetch script (typical for `pnpm dev`), the helper returns null and
  // this layer no-ops — the existing UVR-or-HF flow is preserved.
  const bundleDir = bundledSeparatorModelsDir({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  if (bundleDir) {
    try {
      const seeded = seedBundledSeparator(bundleDir, targetDir);
      if (seeded > 0) {
        console.log(`[separator] Seeded ${seeded} bundled model(s) into ${targetDir}`);
        newlyLinked += seeded;
      }
    } catch (error) {
      console.warn(
        `[separator] Failed to seed bundled models from ${bundleDir}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // Recount once after both layers ran (UVR sync may have populated
  // the count, bundled seed may have added more) so the renderer badge
  // reflects the merged total.
  if (existsSync(targetDir)) {
    try {
      modelCount = readdirSync(targetDir).filter((name) =>
        /\.(onnx|pth|ckpt)$/i.test(name)
      ).length;
      if (!linkedDir && modelCount > 0) {
        linkedDir = targetDir;
      }
    } catch {
      // Best-effort recount.
    }
  }

  let appliedToSettings = false;
  if (
    linkedDir &&
    (userSettings.separatorModelDir === null || userSettings.separatorModelDir === linkedDir)
  ) {
    if (userSettings.separatorModelDir !== linkedDir) {
      userSettings = { ...userSettings, separatorModelDir: linkedDir };
      writeUserSettings();
    }
    appliedToSettings = true;
  }

  return {
    uvrRoot,
    linkedDir,
    modelCount,
    newlyLinked,
    appliedToSettings,
    currentSeparatorModelDir: userSettings.separatorModelDir,
    preferredModel: userSettings.separatorModelDir
      ? pickPreferredSeparatorModel(userSettings.separatorModelDir)
      : null
  };
}

/**
 * Resolve the writable HuggingFace cache directory used by all child
 * subprocesses (faster-whisper, whisper-timestamped, audio-separator).
 * On first call we copy any bundled snapshot from `vendor/whisper-cache/`
 * into the user-data folder so faster-whisper doesn't try to write into
 * the read-only DMG bundle on macOS.
 */
let cachedHfHomeDir: string | null | undefined;
function ensureHfHomeDir(): string | null {
  if (cachedHfHomeDir !== undefined) {
    return cachedHfHomeDir;
  }
  const target = path.join(app.getPath("userData"), "hf-cache");
  try {
    mkdirSync(target, { recursive: true });
  } catch {
    cachedHfHomeDir = null;
    return null;
  }

  const bundle = bundledWhisperHfHomeDir({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  if (bundle) {
    try {
      const result = seedBundledWhisperCache(bundle, target);
      if (result.copied) {
        const sizeMb = (dirSizeBytes(target) / 1024 / 1024).toFixed(0);
        console.log(`[whisper] Seeded bundled cache into ${target} (${sizeMb} MB)`);
      }
    } catch (error) {
      console.warn(
        `[whisper] Failed to seed bundled cache from ${bundle}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  cachedHfHomeDir = target;
  return target;
}

function writeUserSettings(): void {
  try {
    mkdirSync(path.dirname(userSettingsFilePath()), { recursive: true });
    writeFileSync(userSettingsFilePath(), JSON.stringify(userSettings, null, 2), "utf-8");
  } catch (error) {
    console.warn(`[settings] Failed to persist settings: ${error instanceof Error ? error.message : error}`);
  }
}

function userSettingsFilePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function mergeUserSettings(current: UserSettings, patch: Partial<UserSettings> | null | undefined): UserSettings {
  if (!patch || typeof patch !== "object") {
    return current;
  }
  const next: UserSettings = { ...current };
  if ("locale" in patch) {
    const locale = patch.locale;
    next.locale = locale === "en" || locale === "zh" || locale === null ? locale : current.locale;
  }
  if ("themeMode" in patch) {
    const themeMode = patch.themeMode;
    next.themeMode = themeMode === "system" || themeMode === "light" || themeMode === "dark" ? themeMode : current.themeMode;
  }
  if ("accentColor" in patch) {
    const accentColor = patch.accentColor;
    next.accentColor = isAccentColor(accentColor) ? accentColor : current.accentColor;
  }
  if ("hfToken" in patch) {
    const token = patch.hfToken;
    if (token === null) {
      next.hfToken = null;
    } else if (typeof token === "string") {
      const trimmed = token.trim();
      // HuggingFace tokens always start with `hf_` followed by 20+
      // alphanumerics. Reject anything else: it's a hard requirement of
      // the HF Hub API, and accepting a malformed value (e.g. a shell
      // command the user pasted from the "Copy setup command" toast by
      // mistake — the field is `type=password` so it isn't visible) would
      // poison every downstream subprocess via `HF_TOKEN` until the user
      // notices and clears it manually. Silent rejection keeps the field
      // empty so the user re-paste a real token.
      if (trimmed.length === 0) {
        next.hfToken = null;
      } else if (/^hf_[A-Za-z0-9_]{20,}$/.test(trimmed)) {
        next.hfToken = trimmed;
      } else {
        next.hfToken = null;
      }
    }
  }
  if ("hfEndpoint" in patch) {
    const endpoint = patch.hfEndpoint;
    if (endpoint === null) {
      next.hfEndpoint = null;
    } else if (typeof endpoint === "string") {
      const trimmed = endpoint.trim().replace(/\/+$/, "");
      // Only accept http(s) URLs; silently drop anything else so a bad
      // paste can't poison the env var (which would break every model
      // download until the user manually clears it).
      next.hfEndpoint = /^https?:\/\//i.test(trimmed) ? trimmed : null;
    }
  }
  if ("separatorModelDir" in patch) {
    const dir = patch.separatorModelDir;
    if (dir === null) {
      next.separatorModelDir = null;
    } else if (typeof dir === "string") {
      const trimmed = dir.trim();
      next.separatorModelDir = trimmed.length > 0 ? trimmed : null;
    }
  }
  return next;
}

function broadcastJobProgress(event: JobProgressStage): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) {
        window.webContents.send("job:progress", event);
      }
    } catch {
      // Ignore detached renderer windows.
    }
  }
  for (const sender of jobProgressClients) {
    try {
      if (!sender.isDestroyed()) {
        sender.send("job:progress", event);
      }
    } catch {
      // Ignore.
    }
  }
}

// Re-export so D-01 can drive structured stage events from the job runner.
export { broadcastJobProgress };

function broadcastJobFailed(event: JobFailedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) {
        window.webContents.send("job:failed", event);
      }
    } catch {
      // Ignore detached renderer windows.
    }
  }
}

/**
 * Unified event channel that carries the full {@link JobEvent} union
 * (queued / stage / log / succeeded / failed). Existing dedicated channels
 * (`job:progress`, `job:failed`) keep working for backward compatibility,
 * but new subscribers (notification toaster, status bar, future state
 * store) should prefer this single subscription.
 */
function broadcastJobEvent(event: JobEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) {
        window.webContents.send("job:event", event);
      }
    } catch {
      // Ignore detached renderer windows.
    }
  }
}

function parseProgressEvent(jobId: string, rawLine: string): JobProgressStage | null {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    if (value.event !== "stage") {
      return null;
    }
    const name = typeof value.name === "string" ? value.name : null;
    const progress = typeof value.progress === "number" ? value.progress : -1;
    if (!name) {
      return null;
    }
    return {
      jobId,
      name,
      progress,
      message: typeof value.message === "string" ? value.message : undefined,
      etaSec: typeof value.etaSec === "number" ? value.etaSec : null,
      done: value.done === true,
      failed: value.failed === true
    };
  } catch {
    return null;
  }
}

/** Maximum number of stderr lines kept per job for failure classification. */
const STDERR_TAIL_MAX_LINES = 40;

async function runAudioWorkflowJob(jobId: string, options: JobOptions, emitLog: (log: { jobId: string; stream: "stdout" | "stderr"; chunk: string }) => void): Promise<JobResult> {
  const jobOptions = withDefaultDesktopOutputDir(options, jobId);
  const runtime = await prepareAudioRuntime(jobOptions, (chunk) => {
    emitLog({ jobId, stream: "stderr", chunk });
  });
  const preview = buildCommandPreview(jobOptions, runtime);
  const startedAtMs = Date.now();

  broadcastJobEvent({
    kind: "queued",
    jobId,
    input: jobOptions.input,
    createdAt: startedAtMs,
    options: jobOptions
  });

  return new Promise((resolve, reject) => {
    const child = spawn(preview.command, preview.args, {
      env: runtime.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    runningJobs.set(jobId, child);

    let output = "";
    let stderrBuffer = "";
    const stderrTail: string[] = [];
    const parseState: RawParseState = createParseState();

    const pushStderrLine = (line: string): void => {
      if (!line) {
        return;
      }
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_MAX_LINES) {
        stderrTail.splice(0, stderrTail.length - STDERR_TAIL_MAX_LINES);
      }
    };

    const emitStageFromEnvelope = (event: JobProgressStage): void => {
      const mappedStage = mapScriptStage(event.name);
      if (!mappedStage) {
        return;
      }
      if (parseState.currentScriptStage !== event.name) {
        parseState.currentScriptStage = event.name;
        parseState.ffmpeg = {};
      }
      parseState.currentStage = mappedStage;
      const progress = event.failed
        ? -1
        : event.done
          ? 1
          : event.progress >= 0
            ? Math.min(event.progress, 1)
            : -1;
      broadcastJobEvent({
        kind: "stage",
        jobId,
        stage: mappedStage,
        progress,
        etaSec: event.etaSec ?? null,
        message: event.message ?? (event.done ? `${event.name} · done` : event.name),
        failed: event.failed === true
      });
    };

    const emitStageFromRawLine = (rawLine: string): boolean => {
      const result = parseRawProgressLine(rawLine, parseState);
      if (result.type === "passthrough") {
        return false;
      }
      if (result.type === "consumed") {
        return true;
      }
      if (shouldEmitRaw(result.data, parseState, Date.now())) {
        broadcastJobEvent({
          kind: "stage",
          jobId,
          stage: result.data.stage,
          progress: result.data.progress,
          etaSec: result.data.etaSec ?? null,
          message: result.data.message
        });
      }
      return true;
    };

    const emitFailure = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      const tail = stderrTail.join("\n");
      const classified = classifyError(tail, exitCode, signal);
      const failedEvent: JobFailedEvent = {
        kind: "failed",
        jobId,
        reason: classified.reason,
        durationMs: Date.now() - startedAtMs,
        logsTail: [...stderrTail]
      };
      if (classified.hint) {
        failedEvent.hint = classified.hint;
      }
      broadcastJobFailed(failedEvent);
      broadcastJobEvent(failedEvent);
    };

    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      emitLog({ jobId, stream: "stdout", chunk });
    });

    child.stderr.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      stderrBuffer += chunk;
      const newlineIndex = stderrBuffer.lastIndexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const completeLines = stderrBuffer.slice(0, newlineIndex);
      stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
      let logCarry = "";
      for (const rawLine of completeLines.split("\n")) {
        const event = parseProgressEvent(jobId, rawLine);
        if (event) {
          if (logCarry) {
            emitLog({ jobId, stream: "stderr", chunk: logCarry });
            logCarry = "";
          }
          broadcastJobProgress(event);
          emitStageFromEnvelope(event);
          continue;
        }
        if (emitStageFromRawLine(rawLine)) {
          // Raw progress line consumed; suppress noisy log forwarding so the
          // renderer's log pane doesn't drown in yt-dlp / ffmpeg lines.
          continue;
        }
        pushStderrLine(rawLine);
        logCarry += `${rawLine}\n`;
      }
      if (logCarry) {
        emitLog({ jobId, stream: "stderr", chunk: logCarry });
      }
    });

    child.on("error", (error) => {
      runningJobs.delete(jobId);
      pushStderrLine(`spawn error: ${error.message}`);
      emitFailure(null, null);
      reject(new Error(formatSpawnError(error, preview.command)));
    });

    child.on("close", (exitCode, signal) => {
      runningJobs.delete(jobId);
      if (stderrBuffer.length > 0) {
        const event = parseProgressEvent(jobId, stderrBuffer);
        if (event) {
          broadcastJobProgress(event);
          emitStageFromEnvelope(event);
        } else if (!emitStageFromRawLine(stderrBuffer)) {
          emitLog({ jobId, stream: "stderr", chunk: stderrBuffer });
          pushStderrLine(stderrBuffer);
        }
        stderrBuffer = "";
      }
      const success = exitCode === 0 && signal === null;
      const rawParsed = parseGeneratedOutput(output);
      const parsed = success ? simplifyKaraokeOutput(jobOptions, rawParsed, startedAtMs) : rawParsed;
      if (!success) {
        emitFailure(exitCode, signal);
      }
      let historyEntry = success ? createSavedHistoryEntry(jobId, jobOptions, parsed, startedAtMs) : null;
      const discovered = historyEntry ? null : discoverAssets(jobOptions, parsed, startedAtMs);
      const fallbackAssets = discovered?.assets ?? [];
      if (historyEntry) {
        historyEntry = saveHistoryEntry(historyEntry);
      }
      if (success && historyEntry) {
        try {
          const sourceKey = derivePackageSourceKey(historyEntry);
          const manifest = buildPackageManifest({
            packageId: historyEntry.id,
            sourceKey,
            options: jobOptions,
            historyEntry,
            startedAtMs,
            completedAtMs: Date.now()
          });
          writePackageManifest(historyEntry.outputDir, manifest);
        } catch (error) {
          // Manifest write failures must NEVER mask a successful job — the
          // renderer can still hydrate from history.json. Surface a warning
          // so the issue is visible without breaking the user-facing flow.
          const reason = error instanceof Error ? error.message : String(error);
          emitLog({ jobId, stream: "stderr", chunk: `[manifest] write failed: ${reason}\n` });
        }
        broadcastJobEvent({
          kind: "succeeded",
          jobId,
          packageId: historyEntry.id,
          durationMs: Date.now() - startedAtMs,
          historyEntry
        });
      }
      resolve({
        jobId,
        exitCode,
        signal,
        outputDir: parsed.outputDir,
        generatedFiles: parsed.generatedFiles,
        assets: historyEntry?.assets ?? fallbackAssets,
        sourceUrl: historyEntry?.sourceUrl ?? sourceUrlForInput(jobOptions.input),
        primarySubtitle: historyEntry?.primarySubtitle ?? null,
        primaryMedia: historyEntry?.primaryMedia ?? null,
        playbackBundle: historyEntry?.playbackBundle ?? buildPlaybackBundle(jobOptions, fallbackAssets),
        historyEntry
      });
    });
  });
}

function cancelRunningJob(jobId: string): boolean {
  const child = runningJobs.get(jobId);
  if (!child) {
    return false;
  }
  terminateChildProcess(child);
  runningJobs.delete(jobId);
  return true;
}

function terminateChildProcess(child: ChildProcessByStdio<null, Readable, Readable>): void {
  if (!child.pid) {
    child.kill("SIGTERM");
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("error", () => child.kill("SIGTERM"));
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function startWebApiServer(): void {
  if (webApiServer?.listening) {
    return;
  }
  if (webApiServer) {
    webApiServer.removeAllListeners();
    try {
      webApiServer.close();
    } catch {
      // already closed
    }
    webApiServer = null;
  }

  webApiServer = createServer((request, response) => {
    void handleWebApiRequest(request, response);
  });

  webApiServer.on("error", (error) => {
    console.warn(`[web-api] Unable to start ${webApiOrigin}: ${error.message}`);
  });

  webApiServer.listen(webApiPort, webApiHost, () => {
    console.log(`[web-api] Listening on ${webApiOrigin}; remote room ${roomStatus().remoteUrl}`);
  });
}

function primaryLanAddress(): string {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return webApiLocalHost;
}

function roomStatus(): RoomStatus {
  const base = `http://${primaryLanAddress()}:${webApiPort}`;
  return {
    token: roomToken,
    remoteUrl: `${base}/remote?token=${encodeURIComponent(roomToken)}`,
    localUrl: `${webApiOrigin}/remote?token=${encodeURIComponent(roomToken)}`,
    queue: roomQueue,
    nowPlaying: roomNowPlaying
  };
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function roomTokenFromRequest(request: IncomingMessage, url: URL, body?: { token?: string }): string {
  const header = request.headers["x-vocalflow-room-token"];
  return (
    (Array.isArray(header) ? header[0] : header) ??
    body?.token ??
    url.searchParams.get("token") ??
    ""
  );
}

function assertRoomAccess(request: IncomingMessage, url: URL, body?: { token?: string }): void {
  if (isLocalRequest(request)) {
    return;
  }
  if (roomTokenFromRequest(request, url, body) !== roomToken) {
    throw new Error("Invalid room token.");
  }
}

function enqueueRoomSong(input: string, title: string, requestedBy: string): RoomStatus {
  const safeInput = input.trim();
  if (!safeInput) {
    throw new Error("Song URL or input is required.");
  }
  const safeTitle = title.trim() || shortTitleFromInput(safeInput);
  roomQueue = [
    ...roomQueue,
    {
      id: randomUUID(),
      input: safeInput,
      title: safeTitle,
      requestedBy: requestedBy.trim() || "Guest",
      createdAt: new Date().toISOString(),
      status: "queued",
      resultHistoryId: null,
      error: null
    }
  ];
  broadcastRoomStatus();
  return roomStatus();
}

function startRoomQueueItem(itemId: string): RoomStatus {
  const item = roomQueue.find((entry) => entry.id === itemId);
  if (!item) {
    throw new Error("Queue item not found.");
  }
  roomQueue = roomQueue.map((entry) => (entry.id === itemId ? { ...entry, status: "running", error: null } : entry));
  roomNowPlaying = { ...item, status: "running", error: null };
  broadcastRoomStatus();
  return roomStatus();
}

function finishRoomQueueItem(itemId: string, status: RoomQueueItem["status"], resultHistoryId?: string | null, error?: string | null): RoomStatus {
  const finishedStatus = status === "complete" || status === "failed" || status === "canceled" ? status : "complete";
  roomQueue = roomQueue.map((entry) =>
    entry.id === itemId
      ? {
          ...entry,
          status: finishedStatus,
          resultHistoryId: resultHistoryId ?? entry.resultHistoryId ?? null,
          error: error ?? null
        }
      : entry
  );
  if (roomNowPlaying?.id === itemId) {
    roomNowPlaying = roomQueue.find((entry) => entry.id === itemId) ?? null;
  }
  broadcastRoomStatus();
  return roomStatus();
}

function removeRoomQueueItem(itemId: string): RoomStatus {
  roomQueue = roomQueue.filter((entry) => entry.id !== itemId);
  if (roomNowPlaying?.id === itemId) {
    roomNowPlaying = null;
  }
  broadcastRoomStatus();
  return roomStatus();
}

function clearRoomQueue(): RoomStatus {
  roomQueue = roomQueue.filter((entry) => entry.status === "running");
  broadcastRoomStatus();
  return roomStatus();
}

function shortTitleFromInput(input: string): string {
  try {
    const url = new URL(input);
    const videoId = url.searchParams.get("v");
    return videoId ? `YouTube ${videoId}` : url.hostname;
  } catch {
    return path.basename(input) || input;
  }
}

function attachRoomEventClient(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    ...corsHeaders(),
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream"
  });
  response.write(`event: room\ndata: ${JSON.stringify(roomStatus())}\n\n`);
  roomEventClients.add(response);
  request.on("close", () => {
    roomEventClients.delete(response);
  });
}

function broadcastRoomStatus(): void {
  const payload = `event: room\ndata: ${JSON.stringify(roomStatus())}\n\n`;
  for (const client of roomEventClients) {
    client.write(payload);
  }
}

function remoteRoomHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VocalFlow Remote</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: oklch(0.2303 0.0125 264.2926); color: oklch(0.9219 0 0); }
    main { width: min(720px, calc(100% - 28px)); margin: 0 auto; padding: 22px 0 36px; display: grid; gap: 18px; }
    h1, h2, p { margin: 0; }
    .card { border: 1px solid oklch(0.3867 0 0); border-radius: 8px; padding: 16px; background: oklch(0.3210 0.0078 223.6661); box-shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10); }
    .muted { color: oklch(0.7155 0 0); font-size: 14px; line-height: 1.45; }
    label { display: grid; gap: 6px; font-size: 13px; color: oklch(0.7155 0 0); font-weight: 500; }
    input { min-height: 44px; border: 1px solid oklch(0.3867 0 0); border-radius: 6px; padding: 0 12px; background: oklch(0.2303 0.0125 264.2926); color: oklch(0.9219 0 0); font: inherit; }
    input:focus-visible { outline: 2px solid color-mix(in oklch, oklch(0.7395 0.2268 142.8504) 58%, transparent); outline-offset: 2px; border-color: oklch(0.7395 0.2268 142.8504); }
    button { min-height: 42px; border: 0; border-radius: 6px; padding: 0 16px; font-weight: 500; background: oklch(0.7395 0.2268 142.8504); color: #000; }
    button.secondary { background: oklch(0.7395 0.2268 142.8504); color: #000; border: 1px solid oklch(0.3867 0 0); }
    button:disabled { opacity: .5; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    .row > label { flex: 1 1 220px; }
    .status { color: oklch(0.8148 0.0819 225.7537); font-size: 13px; min-height: 18px; }
    .results, .queue { list-style: none; display: grid; gap: 10px; padding: 0; margin: 12px 0 0; }
    li { border: 1px solid oklch(0.3867 0 0); border-radius: 8px; padding: 12px; background: oklch(0.3210 0.0078 223.6661); }
    .title { font-weight: 600; line-height: 1.3; }
    .sub { color: oklch(0.7155 0 0); font-size: 12px; margin-top: 4px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>VocalFlow Remote</h1>
      <p class="muted">Search YouTube, request a song, and let the desktop host process the room queue.</p>
      <p id="status" class="status">Connecting...</p>
    </section>

    <section class="card">
      <h2>Request a Song</h2>
      <div class="row" style="margin-top: 12px;">
        <label>Your name <input id="name" autocomplete="name" placeholder="Guest" /></label>
        <label>Direct URL <input id="directUrl" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." /></label>
        <button id="addDirect" type="button">Add</button>
      </div>
    </section>

    <section class="card">
      <h2>Media Search</h2>
      <div class="row" style="margin-top: 12px;">
        <label style="display:flex;align-items:center;gap:8px;"><input type="radio" name="platform" value="youtube" checked /> YouTube</label>
        <label style="display:flex;align-items:center;gap:8px;"><input type="radio" name="platform" value="bilibili" /> Bilibili</label>
      </div>
      <div class="row" style="margin-top: 12px;">
        <label>Keywords <input id="query" placeholder="artist song title" /></label>
        <button id="search" type="button">Search</button>
      </div>
      <ul id="results" class="results"></ul>
    </section>

    <section class="card">
      <h2>Room Queue</h2>
      <ul id="queue" class="queue"></ul>
    </section>
  </main>
  <script>
    const token = new URLSearchParams(location.search).get("token") || "";
    const statusEl = document.getElementById("status");
    const queueEl = document.getElementById("queue");
    const resultsEl = document.getElementById("results");
    const nameEl = document.getElementById("name");
    const directUrlEl = document.getElementById("directUrl");
    const queryEl = document.getElementById("query");
    const savedName = localStorage.getItem("vocalflow-remote-name") || "";
    nameEl.value = savedName;
    nameEl.addEventListener("change", () => localStorage.setItem("vocalflow-remote-name", nameEl.value.trim()));

    async function post(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vocalflow-room-token": token },
        body: JSON.stringify({ token, ...body })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    function who() { return nameEl.value.trim() || "Guest"; }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    async function enqueue(input, title) {
      await post("/api/room/enqueue", { input, title, requestedBy: who() });
      directUrlEl.value = "";
      statusEl.textContent = "Added to queue.";
    }

    document.getElementById("addDirect").addEventListener("click", async () => {
      try {
        const value = directUrlEl.value.trim();
        if (!value) return;
        await enqueue(value, value);
      } catch (error) {
        statusEl.textContent = error.message || "Failed to add song.";
      }
    });

    document.getElementById("search").addEventListener("click", async () => {
      const query = queryEl.value.trim();
      if (!query) return;
      resultsEl.innerHTML = "";
      statusEl.textContent = "Searching...";
      try {
        const platform = document.querySelector('input[name="platform"]:checked')?.value || "youtube";
        const endpoint = platform === "bilibili" ? "/api/bilibili-search" : "/api/youtube-search";
        const results = await post(endpoint, { query, appendKaraoke: true });
        statusEl.textContent = results.length ? "Pick a result to add it." : "No results.";
        resultsEl.innerHTML = results.map(row => \`
          <li>
            <div class="title">\${escapeHtml(row.title)}</div>
            <div class="sub">\${escapeHtml(row.channel || "")} \${escapeHtml(row.durationLabel || "")}</div>
            <div class="actions">
              <button type="button" data-url="\${escapeHtml(row.url)}" data-title="\${escapeHtml(row.title)}">Add to queue</button>
            </div>
          </li>\`).join("");
      } catch (error) {
        statusEl.textContent = error.message || "Search failed.";
      }
    });

    resultsEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-url]");
      if (!button) return;
      try {
        await enqueue(button.dataset.url, button.dataset.title);
      } catch (error) {
        statusEl.textContent = error.message || "Failed to add song.";
      }
    });

    function renderQueue(status) {
      const items = status.queue || [];
      queueEl.innerHTML = items.length ? items.map((item, index) => \`
        <li>
          <div class="title">\${index + 1}. \${escapeHtml(item.title)}</div>
          <div class="sub">Requested by \${escapeHtml(item.requestedBy)} · \${escapeHtml(item.status)}</div>
        </li>\`).join("") : '<li class="sub">Queue is empty.</li>';
    }

    const events = new EventSource("/api/room/events?token=" + encodeURIComponent(token));
    events.addEventListener("room", (event) => renderQueue(JSON.parse(event.data)));
    events.onerror = () => { statusEl.textContent = "Disconnected. Check Wi-Fi and room link."; };
    fetch("/api/room/status?token=" + encodeURIComponent(token)).then(r => r.json()).then(renderQueue).catch(() => {});
  </script>
</body>
</html>`;
}

async function handleWebApiRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", webApiOrigin);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/remote") {
      response.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(remoteRoomHtml());
      return;
    }

    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/room/status") {
      assertRoomAccess(request, url);
      sendJson(response, roomStatus());
      return;
    }

    if (request.method === "GET" && pathname === "/api/room/events") {
      assertRoomAccess(request, url);
      attachRoomEventClient(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/logs") {
      attachWebLogClient(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/history") {
      savedHistory = dedupeHistoryEntries(savedHistory.map(refreshHistoryEntry));
      writeHistoryFile();
      const history = historyWithBundledSamples();
      rebuildKnownReviewFiles(history);
      sendJson(response, history);
      return;
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/history/")) {
      const historyId = decodeURIComponent(pathname.slice("/api/history/".length));
      const history = removeHistoryById(historyId);
      sendJson(response, history);
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/media/")) {
      const token = pathname.split("/").filter(Boolean)[2] ?? "";
      const targetPath = mediaUrlTokens.get(token);
      if (!targetPath) {
        sendText(response, 404, "Media not found.");
        return;
      }
      const safePath = assertKnownReviewFile(targetPath, mediaExtensions);
      sendHttpMediaFile(safePath, request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/thumbnail") {
      await proxyThumbnail(url, response);
      return;
    }

    if (request.method !== "POST") {
      sendText(response, 404, "Not found.");
      return;
    }

    if (pathname === "/api/preview-command") {
      const { options } = await readJsonBody<{ options: JobOptions }>(request);
      sendJson(response, buildCommandPreview(options));
      return;
    }

    if (pathname === "/api/run-job") {
      const { jobId, options } = await readJsonBody<{ jobId: string; options: JobOptions }>(request);
      const result = await runAudioWorkflowJob(jobId, options, broadcastWebJobLog);
      sendJson(response, result);
      return;
    }

    if (pathname === "/api/room/enqueue") {
      const body = await readJsonBody<{ token?: string; input?: string; title?: string; requestedBy?: string }>(request);
      assertRoomAccess(request, url, body);
      sendJson(response, enqueueRoomSong(String(body.input ?? ""), String(body.title ?? ""), String(body.requestedBy ?? "")));
      return;
    }

    if (pathname === "/api/room/start-item") {
      const body = await readJsonBody<{ token?: string; itemId?: string }>(request);
      assertRoomAccess(request, url, body);
      sendJson(response, startRoomQueueItem(String(body.itemId ?? "")));
      return;
    }

    if (pathname === "/api/room/finish-item") {
      const body = await readJsonBody<{ token?: string; itemId?: string; status?: RoomQueueItem["status"]; resultHistoryId?: string | null; error?: string | null }>(request);
      assertRoomAccess(request, url, body);
      sendJson(response, finishRoomQueueItem(String(body.itemId ?? ""), body.status ?? "complete", body.resultHistoryId, body.error));
      return;
    }

    if (pathname === "/api/room/remove-item") {
      const body = await readJsonBody<{ token?: string; itemId?: string }>(request);
      assertRoomAccess(request, url, body);
      sendJson(response, removeRoomQueueItem(String(body.itemId ?? "")));
      return;
    }

    if (pathname === "/api/room/clear") {
      const body = await readJsonBody<{ token?: string }>(request);
      assertRoomAccess(request, url, body);
      sendJson(response, clearRoomQueue());
      return;
    }

    if (pathname === "/api/cancel-job") {
      const { jobId } = await readJsonBody<{ jobId: string }>(request);
      sendJson(response, cancelRunningJob(jobId));
      return;
    }

    if (pathname === "/api/open-path") {
      const { targetPath } = await readJsonBody<{ targetPath: string }>(request);
      if (targetPath) {
        await shell.openPath(targetPath);
      }
      sendJson(response, { ok: true });
      return;
    }

    if (pathname === "/api/open-external-url") {
      const { url: targetUrl } = await readJsonBody<{ url: string }>(request);
      if (!isHttpUrl(targetUrl)) {
        throw new Error("Only http and https links can be opened.");
      }
      await shell.openExternal(targetUrl);
      sendJson(response, { ok: true });
      return;
    }

    if (pathname === "/api/read-text") {
      const { targetPath } = await readJsonBody<{ targetPath: string }>(request);
      const safePath = assertKnownReviewFile(targetPath, subtitleExtensions);
      sendJson(response, { content: await readFile(safePath, "utf-8") });
      return;
    }

    if (pathname === "/api/write-text") {
      const { targetPath, content } = await readJsonBody<{ targetPath: string; content: string }>(request);
      const safePath = assertKnownReviewFile(targetPath, subtitleExtensions);
      await writeFile(safePath, content, "utf-8");
      sendJson(response, { ok: true });
      return;
    }

    if (pathname === "/api/media-url") {
      const { targetPath } = await readJsonBody<{ targetPath: string }>(request);
      const safePath = assertKnownReviewFile(targetPath, mediaExtensions);
      sendJson(response, { url: createWebMediaUrl(safePath) });
      return;
    }

    if (pathname === "/api/youtube-search") {
      const { query, appendKaraoke } = await readJsonBody<{ query?: string; appendKaraoke?: boolean }>(request);
      const q = String(query ?? "").trim();
      if (!q) {
        sendText(response, 400, "Search query is empty.");
        return;
      }
      if (q.length > MEDIA_SEARCH_MAX_QUERY_CHARS) {
        sendText(response, 400, `Search query is too long (max ${MEDIA_SEARCH_MAX_QUERY_CHARS} characters).`);
        return;
      }
      const results = await runYoutubeSearch(q, Boolean(appendKaraoke));
      sendJson(response, results);
      return;
    }

    if (pathname === "/api/bilibili-search") {
      const { query, appendKaraoke } = await readJsonBody<{ query?: string; appendKaraoke?: boolean }>(request);
      const q = String(query ?? "").trim();
      if (!q) {
        sendText(response, 400, "Search query is empty.");
        return;
      }
      if (q.length > MEDIA_SEARCH_MAX_QUERY_CHARS) {
        sendText(response, 400, `Search query is too long (max ${MEDIA_SEARCH_MAX_QUERY_CHARS} characters).`);
        return;
      }
      const results = await runBilibiliSearch(q, Boolean(appendKaraoke));
      sendJson(response, results);
      return;
    }

    sendText(response, 404, "Not found.");
  } catch (error) {
    sendText(response, 500, error instanceof Error ? error.message : "Unexpected server error.");
  }
}

function attachWebLogClient(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    ...corsHeaders(),
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream"
  });
  response.write(": connected\n\n");
  webLogClients.add(response);
  request.on("close", () => {
    webLogClients.delete(response);
  });
}

function broadcastWebJobLog(log: { jobId: string; stream: "stdout" | "stderr"; chunk: string }): void {
  const payload = `event: log\ndata: ${JSON.stringify(log)}\n\n`;
  for (const client of webLogClients) {
    client.write(payload);
  }
}

function sendHttpMediaFile(filePath: string, request: IncomingMessage, response: ServerResponse): void {
  const stats = statSync(filePath);
  const fileSize = stats.size;
  const contentType = mediaMimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  const range = request.headers.range;

  if (!range) {
    response.writeHead(200, {
      ...corsHeaders(),
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileSize),
      "Content-Type": contentType
    });
    createReadStream(filePath).pipe(response);
    return;
  }

  const byteRange = parseByteRange(range, fileSize);
  if (!byteRange) {
    response.writeHead(416, {
      ...corsHeaders(),
      "Content-Range": `bytes */${fileSize}`
    });
    response.end("Invalid range.");
    return;
  }

  const { start, end } = byteRange;
  response.writeHead(206, {
    ...corsHeaders(),
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Content-Type": contentType
  });
  createReadStream(filePath, { start, end }).pipe(response);
}

async function proxyThumbnail(url: URL, response: ServerResponse): Promise<void> {
  const target = url.searchParams.get("url") ?? "";
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    sendText(response, 400, "Invalid thumbnail URL.");
    return;
  }

  if (parsed.protocol !== "https:" || !/(\.|^)hdslb\.com$/i.test(parsed.hostname)) {
    sendText(response, 400, "Unsupported thumbnail host.");
    return;
  }

  const upstream = await fetch(parsed, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://www.bilibili.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!upstream.ok) {
    sendText(response, upstream.status, "Thumbnail unavailable.");
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    ...corsHeaders(),
    "Cache-Control": "public, max-age=86400",
    "Content-Length": String(buffer.byteLength),
    "Content-Type": contentType
  });
  response.end(buffer);
}

function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve((body ? JSON.parse(body) : {}) as T);
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(200, {
    ...corsHeaders(),
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

function setCorsHeaders(response: ServerResponse): void {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.setHeader(key, value);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5174"
  };
}

function createSavedHistoryEntry(jobId: string, options: JobOptions, parsed: Pick<JobResult, "outputDir" | "generatedFiles">, changedAfterMs?: number): SavedJobHistory {
  const discovered = discoverAssets(options, parsed, changedAfterMs);
  const entry: SavedJobHistory = {
    id: jobId,
    input: options.input.trim(),
    workflowMode: options.workflowMode,
    createdAt: new Date().toISOString(),
    outputDir: parsed.outputDir,
    generatedFiles: discovered.generatedFiles,
    assets: discovered.assets,
    sourceUrl: sourceUrlForInput(options.input),
    primarySubtitle: selectPrimarySubtitle(discovered.assets),
    primaryMedia: selectPrimaryMedia(options, discovered.assets),
    playbackBundle: buildPlaybackBundle(options, discovered.assets)
  };
  registerHistoryAccess(entry);
  return entry;
}

function registerMediaProtocol(): void {
  protocol.handle(mediaProtocol, async (request) => {
    const token = mediaTokenFromUrl(request.url);
    const targetPath = token ? mediaUrlTokens.get(token) : null;
    if (!targetPath) {
      return new Response("Media not found.", { status: 404 });
    }

    let safePath: string;
    try {
      safePath = assertKnownReviewFile(targetPath, mediaExtensions);
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Media not available.", { status: 404 });
    }

    return streamMediaFile(safePath, request);
  });
}

/**
 * Bilibili CDN rejects media requests without a site Referer (403).
 * Inject one so the muted online MV `<video>` can play resolved streams.
 */
function registerBilibiliMediaHeaders(): void {
  const filter = {
    urls: [
      "*://*.bilivideo.com/*",
      "*://*.bilivideo.cn/*",
      "*://*.akamaized.net/*",
      "*://*.hdslb.com/*"
    ]
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    requestHeaders.Referer = "https://www.bilibili.com/";
    if (!requestHeaders["User-Agent"] && !requestHeaders["user-agent"]) {
      requestHeaders["User-Agent"] =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    }
    callback({ requestHeaders });
  });
}

function streamMediaFile(filePath: string, request: Request): Response {
  const stats = statSync(filePath);
  const fileSize = stats.size;
  const contentType = mediaMimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  const range = request.headers.get("range");

  if (!range) {
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Content-Type": contentType
      }
    });
  }

  const byteRange = parseByteRange(range, fileSize);
  if (!byteRange) {
    return new Response("Invalid range.", { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
  }

  const { start, end } = byteRange;

  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Type": contentType
    }
  });
}

function parseByteRange(range: string, fileSize: number): { start: number; end: number } | null {
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || fileSize <= 0) {
    return null;
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : fileSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start >= fileSize || requestedEnd < start) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1)
  };
}

function createMediaUrl(targetPath: string): string {
  const token = createMediaToken(targetPath);
  return `${mediaProtocol}://file/${token}/${encodeURIComponent(path.basename(targetPath))}`;
}

function createWebMediaUrl(targetPath: string): string {
  const token = createMediaToken(targetPath);
  return `${webApiOrigin}/api/media/${token}/${encodeURIComponent(path.basename(targetPath))}`;
}

function createMediaToken(targetPath: string): string {
  const token = randomUUID();
  mediaUrlTokens.set(token, targetPath);
  return token;
}

function mediaTokenFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${mediaProtocol}:` || url.hostname !== "file") {
      return null;
    }
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function discoverAssets(
  options: Pick<JobOptions, "input" | "workflowMode">,
  parsed: Pick<JobResult, "outputDir" | "generatedFiles">,
  changedAfterMs?: number
): Pick<SavedJobHistory, "generatedFiles" | "assets"> {
  const outputFiles = new Set<string>();
  for (const file of parsed.generatedFiles) {
    addSafeExistingFile(outputFiles, file);
  }

  // Package-scoped karaoke jobs should include the copied original audio even
  // when the CLI omits it from the final file list. Shared output dirs still
  // rely on the explicit list to avoid cross-song pollution.
  if ((outputFiles.size === 0 || options.workflowMode === "karaoke") && parsed.outputDir && existsSync(parsed.outputDir)) {
    for (const file of listReviewFiles(parsed.outputDir, changedAfterMs)) {
      addSafeExistingFile(outputFiles, file);
    }
  }

  const assetFiles = new Set(outputFiles);
  const input = options.input.trim();
  if (!isHttpUrl(input)) {
    addSafeExistingFile(assetFiles, input);
  }

  const assets = [...assetFiles]
    .sort((a, b) => a.localeCompare(b))
    .map((file) => classifyAsset(file))
    .filter((asset) => options.workflowMode !== "karaoke" || !isKaraokeHiddenAsset(asset));

  return {
    generatedFiles: [...outputFiles]
      .filter((file) => {
        const asset = classifyAsset(file);
        return options.workflowMode !== "karaoke" || !isKaraokeHiddenAsset(asset);
      })
      .sort((a, b) => a.localeCompare(b)),
    assets
  };
}

function simplifyKaraokeOutput(
  options: JobOptions,
  parsed: Pick<JobResult, "outputDir" | "generatedFiles">,
  changedAfterMs?: number
): Pick<JobResult, "outputDir" | "generatedFiles"> {
  if (options.workflowMode !== "karaoke" || !parsed.outputDir || !existsSync(parsed.outputDir)) {
    return parsed;
  }

  const candidates = uniquePaths([
    ...parsed.generatedFiles,
    ...listReviewFiles(parsed.outputDir, changedAfterMs)
  ]);
  const assets = candidates
    .map((file) => classifyAsset(file))
    .filter((asset) => asset.exists);
  const keep = new Set<string>();
  const keepPath = (filePath: string | null | undefined): void => {
    if (filePath) {
      keep.add(path.resolve(filePath));
    }
  };
  const keepAsset = (asset: GeneratedAsset | null | undefined): void => keepPath(asset?.path);

  keepAsset(selectKaraokeOriginalAsset(assets));
  keepAsset(assets.find((asset) => asset.role === "backing" && isAudioInput(asset.path)));
  keepPath(selectByExtension(assets, "subtitle", [".lrc"]));

  for (const asset of assets) {
    const resolved = path.resolve(asset.path);
    if (keep.has(resolved) || !isInsideDirectory(parsed.outputDir, resolved)) {
      continue;
    }
    try {
      rmSync(resolved, { force: true });
    } catch (error) {
      console.warn(`[package] Failed to remove extra karaoke output ${resolved}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    outputDir: parsed.outputDir,
    generatedFiles: candidates
      .filter((file) => keep.has(path.resolve(file)) && existsSync(file))
      .sort((a, b) => a.localeCompare(b))
  };
}

function selectKaraokeOriginalAsset(assets: GeneratedAsset[]): GeneratedAsset | null {
  return (
    assets.find((asset) => asset.exists && asset.role === "original" && isAudioInput(asset.path)) ??
    assets.find((asset) => asset.exists && asset.role === "original" && (asset.type === "media" || asset.type === "stem")) ??
    null
  );
}

function isKaraokeHiddenAsset(asset: GeneratedAsset): boolean {
  return asset.role === "vocal" || asset.role === "transcribe" || asset.role === "preview";
}

function isInsideDirectory(directory: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function listReviewFiles(directory: string, changedAfterMs?: number): string[] {
  const root = path.resolve(directory);
  const results: string[] = [];
  const queue = [root];
  const minModifiedAt = changedAfterMs ? changedAfterMs - 5_000 : null;

  while (queue.length > 0 && results.length < 300) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const filePath = path.join(current, entry);
      let stats;
      try {
        stats = statSync(filePath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        queue.push(filePath);
        continue;
      }
      if (stats.isFile() && reviewExtensions.has(path.extname(filePath).toLowerCase()) && (!minModifiedAt || stats.mtimeMs >= minModifiedAt)) {
        results.push(path.resolve(filePath));
      }
    }
  }

  return results;
}

function addSafeExistingFile(target: Set<string>, candidate: string): void {
  if (!candidate) {
    return;
  }
  const resolved = path.resolve(candidate);
  if (!reviewExtensions.has(path.extname(resolved).toLowerCase()) || !existsSync(resolved)) {
    return;
  }
  target.add(resolved);
}

function classifyAsset(filePath: string): GeneratedAsset {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const name = path.basename(resolved);
  const marker = resolved.toLowerCase();
  const isSubtitle = subtitleExtensions.has(extension);
  const isMedia = mediaExtensions.has(extension);
  const isStem =
    isMedia &&
    (marker.includes(`${path.sep}stems${path.sep}`) ||
      /(^|[^a-z])(vocals?|voice|acapella|instrumental|no[_-]?vocals?|accompaniment|karaoke)([^a-z]|$)/i.test(name));

  return {
    path: resolved,
    name,
    extension: extension.replace(/^\./, ""),
    type: isSubtitle ? "subtitle" : isStem ? "stem" : isMedia ? "media" : "other",
    role: classifyAssetRole(resolved, isSubtitle ? "subtitle" : isStem ? "stem" : isMedia ? "media" : "other"),
    exists: existsSync(resolved)
  };
}

function classifyAssetRole(filePath: string, type: GeneratedAsset["type"]): GeneratedAssetRole {
  const name = path.basename(filePath);
  if (type === "subtitle") {
    return "subtitle";
  }
  if (type !== "media" && type !== "stem") {
    return "other";
  }
  if (isPreviewVideo(filePath)) {
    return "preview";
  }
  if (/\.transcribe\.(wav|mp3|m4a|flac)$/i.test(name)) {
    return "transcribe";
  }
  if (/(^|[^a-z])(vocals?|voice|acapella)([^a-z]|$)/i.test(name)) {
    return "vocal";
  }
  if (/instrumental|no[_-]?vocals?|accompaniment|karaoke/i.test(name)) {
    return "backing";
  }
  return type === "media" ? "original" : "other";
}

function selectPrimarySubtitle(assets: GeneratedAsset[]): string | null {
  return selectByExtension(assets, "subtitle", [".lrc", ".srt", ".vtt", ".json", ".txt", ".ass"]);
}

function selectPrimaryMedia(options: Pick<JobOptions, "input" | "workflowMode">, assets: GeneratedAsset[]): string | null {
  const input = options.input.trim();
  if (!isHttpUrl(input) && mediaExtensions.has(path.extname(input).toLowerCase()) && existsSync(input)) {
    return path.resolve(input);
  }

  if (options.workflowMode === "karaoke") {
    const backingTrack = assets.find((asset) => asset.exists && asset.role === "backing");
    if (backingTrack) {
      return backingTrack.path;
    }
  }

  const playableAudio = assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioInput(asset.path) && asset.role !== "transcribe" && asset.role !== "vocal");
  if (playableAudio) {
    return playableAudio.path;
  }

  return assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideo(asset.path) && asset.role !== "transcribe" && asset.role !== "vocal")?.path ?? null;
}

function selectByExtension(assets: GeneratedAsset[], type: GeneratedAsset["type"], extensions: string[]): string | null {
  for (const extension of extensions) {
    const asset = assets.find((item) => item.exists && item.type === type && path.extname(item.path).toLowerCase() === extension);
    if (asset) {
      return asset.path;
    }
  }
  return assets.find((item) => item.exists && item.type === type)?.path ?? null;
}

function buildPlaybackBundle(context: Pick<JobOptions, "input" | "workflowMode">, assets: GeneratedAsset[]): PlaybackBundle {
  const sourceUrl = sourceUrlForInput(context.input);
  const localAudioPath = selectPlaybackAudio(context, assets);
  const localVideoPath = localAudioPath ? null : selectPlaybackVideo(assets);
  const videoPreviewPath = sourceUrl ? selectPlaybackPreview(localAudioPath ?? localVideoPath, assets) : null;
  const controllable = Boolean(localAudioPath || localVideoPath);

  return {
    localAudioPath,
    localVideoPath,
    videoPreviewPath,
    sourceUrl,
    controllable,
    unavailableReason: controllable
      ? null
      : sourceUrl
        ? "Local playback package is missing. Rerun this Karaoke job; add browser cookies if the platform blocks downloads."
        : "No local playable audio or video was found in this result."
  };
}

function selectPlaybackPreview(primaryMediaPath: string | null, assets: GeneratedAsset[]): string | null {
  const previews = assets.filter((asset) => asset.exists && asset.role === "preview" && isVideoInput(asset.path));
  if (previews.length === 0) {
    return null;
  }

  const primaryKey = primaryMediaPath ? mediaFamilyKey(primaryMediaPath) : null;
  if (primaryKey) {
    const matchingPreview = previews.find((asset) => keysReferToSameMedia(mediaFamilyKey(asset.path), primaryKey));
    if (matchingPreview) {
      return matchingPreview.path;
    }
  }

  return previews.length === 1 ? previews[0].path : null;
}

function selectPlaybackAudio(context: Pick<JobOptions, "workflowMode">, assets: GeneratedAsset[]): string | null {
  const playableAudio = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioInput(asset.path) && asset.role !== "transcribe" && asset.role !== "vocal");
  if (context.workflowMode === "karaoke") {
    const backing = playableAudio.find((asset) => asset.role === "backing");
    if (backing) {
      return backing.path;
    }
  }
  return (
    playableAudio.find((asset) => asset.role === "original")?.path ??
    playableAudio[0]?.path ??
    null
  );
}

function selectPlaybackVideo(assets: GeneratedAsset[]): string | null {
  return (
    assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isVideoInput(asset.path) && asset.role !== "preview")
      ?.path ?? null
  );
}

function mediaFamilyKey(filePath: string): string {
  const withoutExtension = path.basename(filePath).replace(/\.[a-z0-9]{2,5}$/i, "");
  return withoutExtension
    .replace(/[_\s-]+model[_-].*$/i, "")
    .replace(/\.transcribe$/i, "")
    .replace(/[_\s-]*\((?:instrumental|vocals?|voice|acapella|no vocals)[^)]*\)\s*$/i, "")
    .replace(/[_\s-]+(?:instrumental|vocals?|voice|acapella|preview|transcribe|subtitle|audio|video)$/i, "")
    .replace(/\s*\[[^\]]{6,}\]\s*$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function keysReferToSameMedia(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function sourceUrlForInput(input: string): string | null {
  const trimmed = normalizeMediaInput(input.trim());
  return isHttpUrl(trimmed) ? trimmed : null;
}

function loadSavedHistory(): void {
  loadHiddenSampleIds();
  try {
    if (!existsSync(historyFilePath())) {
      savedHistory = [];
      rebuildKnownReviewFiles(historyWithBundledSamples());
      return;
    }
    const parsed = JSON.parse(readFileSync(historyFilePath(), "utf-8")) as SavedJobHistory[];
    savedHistory = Array.isArray(parsed) ? parsed.filter(isSavedHistoryEntry).slice(0, 100) : [];
    savedHistory = migrateHistoryWithManifests(savedHistory);
    rebuildKnownReviewFiles(historyWithBundledSamples());
  } catch {
    savedHistory = [];
  }
}

/**
 * One-shot read-side migration:
 *  - For each entry that has a matching `manifest.json` in its `outputDir`,
 *    lift the higher-fidelity manifest fields onto the entry.
 *  - For each entry WITHOUT a manifest, write one for the most recent
 *    `outputDir`-sharing entry so future loads can hydrate.
 *
 * Backfill is best-effort: any failure (permission, disk full, mismatched
 * `packageId` already on disk) is swallowed so a single bad row never breaks
 * history loading.
 */
function migrateHistoryWithManifests(entries: SavedJobHistory[]): SavedJobHistory[] {
  if (entries.length === 0) {
    return entries;
  }
  // Track the entry that "owns" each outputDir for backfill — the most
  // recent entry is preferred so its manifest reflects the latest run.
  const backfillOwners = new Map<string, SavedJobHistory>();

  const hydrated = entries.map((entry) => {
    const outputDir = entry.outputDir?.trim();
    if (!outputDir) {
      return entry;
    }
    const manifest = readPackageManifest(outputDir);
    if (manifest) {
      // Manifest exists — only lift if the packageId matches; otherwise
      // the manifest belongs to a sibling job that overwrote it. Either
      // way no backfill is needed for this entry.
      return manifest.packageId === entry.id
        ? hydrateHistoryFromManifest(entry, manifest)
        : entry;
    }
    if (!existsSync(outputDir) || entry.assets.length === 0) {
      return entry;
    }
    const resolvedDir = path.resolve(outputDir);
    const existingOwner = backfillOwners.get(resolvedDir);
    if (!existingOwner || Date.parse(entry.createdAt) > Date.parse(existingOwner.createdAt)) {
      backfillOwners.set(resolvedDir, entry);
    }
    return entry;
  });

  for (const entry of backfillOwners.values()) {
    try {
      const sourceKey = derivePackageSourceKey(entry);
      const manifest = buildPackageManifest({
        packageId: entry.id,
        sourceKey,
        options: {
          input: entry.input,
          workflowMode: entry.workflowMode,
          model: "",
          language: ""
        },
        historyEntry: entry,
        startedAtMs: Date.parse(entry.createdAt) || Date.now(),
        completedAtMs: Date.parse(entry.createdAt) || Date.now()
      });
      writePackageManifest(entry.outputDir, manifest);
    } catch {
      // Backfill is best-effort: writer errors are non-fatal — history
      // continues to load from `history.json` as before.
    }
  }
  return hydrated;
}

function saveHistoryEntry(entry: SavedJobHistory): SavedJobHistory {
  const entryKey = historyPackageKey(entry);
  const existing = savedHistory.find((item) => item.id === entry.id || (entryKey && historyPackageKey(item) === entryKey));
  const merged = existing ? mergeHistoryEntries(existing, entry) : refreshHistoryEntry(entry);
  const mergedKey = historyPackageKey(merged);
  savedHistory = [
    merged,
    ...savedHistory.filter((item) => item.id !== merged.id && item.id !== entry.id && (!mergedKey || historyPackageKey(item) !== mergedKey))
  ].slice(0, 100);
  writeHistoryFile();
  rebuildKnownReviewFiles(historyWithBundledSamples());
  return merged;
}

function removeHistoryById(historyId: string): SavedJobHistory[] {
  if (historyId.startsWith("sample:")) {
    hiddenSampleIds.add(historyId);
    writeHiddenSamplesFile();
  }

  savedHistory = savedHistory.filter((entry) => entry.id !== historyId);
  writeHistoryFile();
  const history = historyWithBundledSamples();
  rebuildKnownReviewFiles(history);
  return history;
}

function writeHistoryFile(): void {
  mkdirSync(path.dirname(historyFilePath()), { recursive: true });
  writeFileSync(historyFilePath(), JSON.stringify(savedHistory, null, 2), "utf-8");
}

function historyFilePath(): string {
  return path.join(app.getPath("userData"), "history.json");
}

function loadHiddenSampleIds(): void {
  try {
    if (!existsSync(hiddenSamplesFilePath())) {
      hiddenSampleIds = new Set();
      return;
    }
    const parsed = JSON.parse(readFileSync(hiddenSamplesFilePath(), "utf-8")) as string[];
    hiddenSampleIds = new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id.startsWith("sample:")) : []);
  } catch {
    hiddenSampleIds = new Set();
  }
}

function writeHiddenSamplesFile(): void {
  mkdirSync(path.dirname(hiddenSamplesFilePath()), { recursive: true });
  writeFileSync(hiddenSamplesFilePath(), JSON.stringify([...hiddenSampleIds].sort(), null, 2), "utf-8");
}

function hiddenSamplesFilePath(): string {
  return path.join(app.getPath("userData"), "hidden-samples.json");
}

function registerHistoryAccess(entry: SavedJobHistory): void {
  if (entry.outputDir) {
    knownOutputDirs.add(path.resolve(entry.outputDir));
  }
  for (const asset of entry.assets) {
    knownFilePaths.add(path.resolve(asset.path));
  }
  for (const file of entry.generatedFiles) {
    knownFilePaths.add(path.resolve(file));
  }
}

function refreshHistoryEntry(entry: SavedJobHistory): SavedJobHistory {
  const sourceAssets = entry.assets.length > 0 ? entry.assets : discoverAssets(entry, entry).assets;
  const refreshedAssets = sourceAssets.map((asset) => {
    const refreshed = classifyAsset(asset.path);
    return {
      ...asset,
      role: asset.role ?? refreshed.role,
      exists: existsSync(asset.path)
    };
  });
  const assets = pruneHistoryAssets(entry, refreshedAssets)
    .filter((asset) => entry.workflowMode !== "karaoke" || !isKaraokeHiddenAsset(asset));
  const generatedFiles = entry.generatedFiles.filter((file) => {
    const asset = classifyAsset(file);
    return entry.workflowMode !== "karaoke" || !isKaraokeHiddenAsset(asset);
  });
  const sourceUrl = entry.sourceUrl ?? sourceUrlForInput(entry.input);
  return {
    ...entry,
    generatedFiles,
    assets,
    sourceUrl,
    primarySubtitle: selectPrimarySubtitle(assets),
    primaryMedia: selectPrimaryMedia(entry, assets),
    playbackBundle: buildPlaybackBundle(entry, assets)
  };
}

function pruneHistoryAssets(entry: SavedJobHistory, assets: GeneratedAsset[]): GeneratedAsset[] {
  if (entry.input.startsWith("sample:")) {
    return assets;
  }

  const sourceId = sourceMediaIdForEntry(entry);
  if (sourceId) {
    const matching = assets.filter((asset) => assetPathContainsMediaId(asset.path, sourceId));
    if (matching.length > 0) {
      return matching;
    }
  }

  const reviewKey = historyAssetFamilyKey(entry);
  if (!reviewKey) {
    return assets;
  }

  const matching = assets.filter((asset) => keysReferToSameMedia(mediaFamilyKey(asset.path), reviewKey));
  return matching.length > 0 ? matching : assets;
}

function sourceMediaIdForEntry(entry: Pick<SavedJobHistory, "input" | "sourceUrl">): string | null {
  const sourceUrl = entry.sourceUrl ?? sourceUrlForInput(entry.input);
  if (!sourceUrl) {
    return null;
  }
  return sourceMediaIdFromUrl(sourceUrl);
}

function sourceMediaIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "youtu.be") {
      return normalizeMediaId(url.pathname.split("/").filter(Boolean)[0] ?? "");
    }
    if (hostname.endsWith("youtube.com")) {
      return normalizeMediaId(url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? "");
    }
    if (hostname.endsWith("bilibili.com") || hostname === "b23.tv") {
      return normalizeMediaId(url.pathname.match(/\/video\/([^/?#]+)/)?.[1] ?? url.pathname.split("/").filter(Boolean)[0] ?? "");
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeMediaId(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized || null;
}

function assetPathContainsMediaId(filePath: string, mediaId: string): boolean {
  return normalizeMediaId(path.basename(filePath))?.includes(mediaId) ?? false;
}

function historyAssetFamilyKey(entry: Pick<SavedJobHistory, "input" | "primaryMedia" | "primarySubtitle" | "playbackBundle" | "assets">): string {
  const candidates = [
    !isHttpUrl(entry.input) ? entry.input : "",
    entry.playbackBundle.localAudioPath,
    entry.playbackBundle.localVideoPath,
    entry.primaryMedia,
    entry.primarySubtitle,
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.path,
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem"))?.path
  ];

  for (const candidate of candidates) {
    const key = candidate ? mediaFamilyKey(candidate) : "";
    if (key) {
      return key;
    }
  }
  return "";
}

function dedupeHistoryEntries(entries: SavedJobHistory[]): SavedJobHistory[] {
  const deduped: SavedJobHistory[] = [];

  for (const entry of entries) {
    const entryKey = historyPackageKey(entry);
    const existingIndex = deduped.findIndex((item) => item.id === entry.id || (entryKey && historyPackageKey(item) === entryKey));
    if (existingIndex === -1) {
      deduped.push(entry);
      continue;
    }
    deduped[existingIndex] = mergeHistoryEntries(deduped[existingIndex], entry);
  }

  return deduped
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 100);
}

function mergeHistoryEntries(primary: SavedJobHistory, secondary: SavedJobHistory): SavedJobHistory {
  const newest = Date.parse(secondary.createdAt) >= Date.parse(primary.createdAt) ? secondary : primary;
  const oldest = newest === secondary ? primary : secondary;
  const mergedAssets = uniqueAssets([...primary.assets, ...secondary.assets]);
  const mergedInput = newest.input || oldest.input;
  const mergedSourceUrl = newest.sourceUrl ?? oldest.sourceUrl ?? sourceUrlForInput(mergedInput);
  const merged: SavedJobHistory = {
    ...newest,
    id: primary.id,
    title: newest.title ?? oldest.title,
    input: mergedInput,
    workflowMode: primary.workflowMode === "karaoke" || secondary.workflowMode === "karaoke" ? "karaoke" : newest.workflowMode,
    outputDir: newest.outputDir || oldest.outputDir,
    generatedFiles: uniquePaths([...primary.generatedFiles, ...secondary.generatedFiles]),
    assets: mergedAssets,
    sourceUrl: mergedSourceUrl,
    primarySubtitle: selectPrimarySubtitle(mergedAssets),
    primaryMedia: null,
    playbackBundle: newest.playbackBundle
  };

  merged.assets = pruneHistoryAssets(merged, mergedAssets);
  merged.generatedFiles = uniquePaths(merged.generatedFiles).filter((file) => merged.assets.some((asset) => path.resolve(asset.path) === path.resolve(file)));
  merged.primarySubtitle = selectPrimarySubtitle(merged.assets);
  merged.primaryMedia = selectPrimaryMedia(merged, merged.assets);
  merged.playbackBundle = buildPlaybackBundle(merged, merged.assets);
  registerHistoryAccess(merged);
  return merged;
}

function uniqueAssets(assets: GeneratedAsset[]): GeneratedAsset[] {
  const byPath = new Map<string, GeneratedAsset>();
  for (const asset of assets) {
    const resolved = path.resolve(asset.path);
    const refreshed = classifyAsset(resolved);
    const existing = byPath.get(resolved);
    byPath.set(resolved, {
      ...refreshed,
      ...existing,
      ...asset,
      path: resolved,
      role: asset.role ?? existing?.role ?? refreshed.role,
      exists: existsSync(resolved)
    });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function historyPackageKey(entry: Pick<SavedJobHistory, "input" | "sourceUrl" | "primaryMedia" | "primarySubtitle" | "playbackBundle" | "assets">): string {
  const sourceUrl = entry.sourceUrl ?? sourceUrlForInput(entry.input);
  if (sourceUrl) {
    return `url:${normalizeSourceUrl(sourceUrl)}`;
  }

  const input = entry.input.trim();
  if (input.startsWith("sample:")) {
    return input.toLowerCase();
  }
  if (input && !isHttpUrl(input)) {
    return `file:${path.resolve(input).toLowerCase()}`;
  }

  const mediaCandidate =
    entry.playbackBundle.localAudioPath ??
    entry.playbackBundle.localVideoPath ??
    entry.primaryMedia ??
    entry.primarySubtitle ??
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem"))?.path ??
    "";
  const mediaKey = mediaCandidate ? mediaFamilyKey(mediaCandidate) : "";
  return mediaKey ? `media:${mediaKey}` : `input:${input.toLowerCase()}`;
}

/**
 * Build a stable identity for the package manifest. Mirrors
 * {@link historyPackageKey} for URL/sample/local-file inputs but produces a
 * structured {@link PackageSourceKey} that records both the canonical key
 * and the `origin` enum the renderer can branch on for display.
 */
function derivePackageSourceKey(entry: Pick<SavedJobHistory, "input" | "sourceUrl">): PackageSourceKey {
  const rawInput = entry.input?.trim() ?? "";
  const sourceUrl = entry.sourceUrl ?? sourceUrlForInput(rawInput);

  if (sourceUrl) {
    const normalized = normalizeSourceUrl(sourceUrl);
    let origin: PackageSourceKey["origin"] = "url";
    if (normalized.startsWith("youtube:")) {
      origin = "youtube";
    } else if (normalized.startsWith("bilibili:")) {
      origin = "bilibili";
    }
    return { key: `url:${normalized}`, origin, rawInput };
  }

  if (rawInput.startsWith("sample:")) {
    return { key: rawInput.toLowerCase(), origin: "sample", rawInput };
  }

  if (rawInput && !isHttpUrl(rawInput)) {
    return { key: `file:${path.resolve(rawInput).toLowerCase()}`, origin: "local", rawInput };
  }

  return { key: `input:${rawInput.toLowerCase()}`, origin: "url", rawInput };
}

function normalizeSourceUrl(value: string): string {
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

function historyWithBundledSamples(): SavedJobHistory[] {
  return dedupeHistoryEntries([...savedHistory, ...loadBundledSampleHistory()]);
}

function loadBundledSampleHistory(): SavedJobHistory[] {
  const sampleRoot = samplePackagesDirectory();
  if (!existsSync(sampleRoot)) {
    return [];
  }

  return readdirSync(sampleRoot)
    .map((entry) => path.join(sampleRoot, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .map((directory) => readSamplePackage(directory))
    .filter((entry): entry is SavedJobHistory => Boolean(entry))
    .filter((entry) => !hiddenSampleIds.has(entry.id));
}

function readSamplePackage(directory: string): SavedJobHistory | null {
  const manifestPath = path.join(directory, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SamplePackageManifest;
    const assets = (manifest.assets ?? []).map((asset) => {
      const resolvedPath = path.resolve(directory, asset.path);
      const classified = classifyAsset(resolvedPath);
      return {
        ...classified,
        ...asset,
        path: resolvedPath,
        role: asset.role ?? classified.role,
        exists: existsSync(resolvedPath)
      } satisfies GeneratedAsset;
    });
    const sourceUrl = manifest.sourceUrl ?? null;
    const entry: SavedJobHistory = {
      id: `sample:${manifest.id}`,
      title: manifest.title,
      input: manifest.input ?? `sample:${manifest.id}`,
      workflowMode: manifest.workflowMode ?? "karaoke",
      createdAt: "2000-01-01T00:00:00.000Z",
      outputDir: directory,
      generatedFiles: assets.map((asset) => asset.path),
      assets,
      sourceUrl,
      primarySubtitle: resolveSampleAssetPath(directory, manifest.primarySubtitle) ?? selectPrimarySubtitle(assets),
      primaryMedia: resolveSampleAssetPath(directory, manifest.primaryMedia) ?? selectPrimaryMedia({ input: manifest.input ?? "", workflowMode: manifest.workflowMode ?? "karaoke" }, assets),
      playbackBundle: buildPlaybackBundle({ input: manifest.input ?? "", workflowMode: manifest.workflowMode ?? "karaoke" }, assets)
    };
    if (!entry.playbackBundle.controllable || !entry.primarySubtitle) {
      return null;
    }
    registerHistoryAccess(entry);
    return refreshHistoryEntry(entry);
  } catch {
    return null;
  }
}

function resolveSampleAssetPath(directory: string, value?: string | null): string | null {
  return value ? path.resolve(directory, value) : null;
}

function samplePackagesDirectory(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "samples") : path.join(__dirname, "../../samples");
}

function rebuildKnownReviewFiles(entries: SavedJobHistory[] = savedHistory): void {
  knownFilePaths.clear();
  knownOutputDirs.clear();
  for (const entry of entries) {
    registerHistoryAccess(entry);
  }
}

function assertKnownReviewFile(targetPath: string, allowedExtensions: Set<string>): string {
  const resolved = path.resolve(targetPath);
  const extension = path.extname(resolved).toLowerCase();
  if (!knownFilePaths.has(resolved) || !allowedExtensions.has(extension)) {
    throw new Error("File is not available in the current review history.");
  }
  if (!existsSync(resolved)) {
    throw new Error("File no longer exists on disk.");
  }
  return resolved;
}

function isSavedHistoryEntry(value: unknown): value is SavedJobHistory {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<SavedJobHistory>;
  return (
    typeof entry.id === "string" &&
    typeof entry.input === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.outputDir === "string" &&
    Array.isArray(entry.generatedFiles) &&
    Array.isArray(entry.assets)
  );
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) {
      seen.add(path.resolve(value));
    }
  }
  return [...seen];
}

function buildCommandPreview(options: JobOptions, runtime?: PreparedRuntime): CommandPreview {
  const invocation = audioSubtitlesInvocation(runtime);
  const command = invocation.command;
  const args = [...invocation.argsPrefix, ...buildAudioSubtitlesArgs(options)];
  return {
    command,
    args,
    display: [quoteForDisplay(command), ...args.map(quoteForDisplay)].join(" ")
  };
}

async function prepareAudioRuntime(options: JobOptions, log: RuntimeLog): Promise<PreparedRuntime> {
  const pathDirs = [
    venvBinDir(runtimeVenvDir()),
    bundledFfmpegDir(),
    path.join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ].filter((item): item is string => Boolean(item));
  const env = withHuggingFaceEnv(withPath(process.env, pathDirs));
  const needs = runtimeNeeds(options);

  if (!needs.ytDlp && !needs.whisper && !needs.separator && !needs.zhconv) {
    return { env };
  }

  const basePython = bundledPythonInvocation() ?? pythonInvocation();
  if (!basePython) {
    throw new Error(
      "VocalFlow could not find Python. Reinstall the app and try again; the installer should include a bundled Python runtime."
    );
  }

  const venvDir = runtimeVenvDir();
  const venvPython = runtimeVenvPython(venvDir);
  mkdirSync(path.dirname(venvDir), { recursive: true });

  if (!existsSync(venvPython)) {
    log("[runtime] Preparing first-run Python environment. This can take a minute.\n");
    await runRuntimeCommand(basePython.command, [...basePython.argsPrefix, "-m", "venv", venvDir], env, log);
  }

  const venvPythonInvocation = { command: venvPython, argsPrefix: [] };
  const runtimeEnv = withHuggingFaceEnv(
    withPath(
      {
        ...env,
        AUDIO_SUBTITLES_PYTHON: venvPython,
        AUDIO_SUBTITLES_VENV: venvDir,
        PYTHONNOUSERSITE: "1",
        PIP_DISABLE_PIP_VERSION_CHECK: "1"
      },
      pathDirs
    )
  );

  try {
    await ensurePip(venvPython, runtimeEnv, log);
  } catch (error) {
    log(`[runtime] Existing Python environment is unusable; recreating it. ${error instanceof Error ? error.message : ""}\n`);
    rmSync(venvDir, { recursive: true, force: true });
    await runRuntimeCommand(basePython.command, [...basePython.argsPrefix, "-m", "venv", venvDir], env, log);
    await ensurePip(venvPython, runtimeEnv, log);
  }

  const missingPackages: string[] = [];
  if (needs.ytDlp && !(await pythonCheck(venvPython, runtimePackageChecks.ytDlp, runtimeEnv))) {
    missingPackages.push(runtimePackages.ytDlp);
  }
  if (needs.whisper && !(await pythonCheck(venvPython, runtimePackageChecks.whisper, runtimeEnv))) {
    missingPackages.push(runtimePackages.whisper);
  }
  if (needs.whisper && !(await pythonCheck(venvPython, runtimePackageChecks.whisperTimestamped, runtimeEnv))) {
    missingPackages.push(runtimePackages.whisperTimestamped);
  }
  if (needs.separator && !(await pythonCheck(venvPython, runtimePackageChecks.separator, runtimeEnv))) {
    missingPackages.push(runtimePackages.separator);
  }
  if (needs.zhconv && !(await pythonCheck(venvPython, runtimePackageChecks.zhconv, runtimeEnv))) {
    missingPackages.push(runtimePackages.zhconv);
  }

  if (missingPackages.length > 0) {
    log(`[runtime] Installing ${missingPackages.join(", ")}. First run may take several minutes.\n`);
    await runRuntimeCommand(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"], runtimeEnv, log);
    await runRuntimeCommand(venvPython, ["-m", "pip", "install", "--upgrade", ...missingPackages], runtimeEnv, log);
  }

  log("[runtime] Runtime ready.\n");
  return { env: runtimeEnv, python: venvPythonInvocation };
}

const YOUTUBE_SEARCH_PLACEHOLDER_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const MEDIA_SEARCH_MAX_QUERY_CHARS = 200;
const MEDIA_SEARCH_MAX_RESULTS = 12;
const MEDIA_SEARCH_TIMEOUT_MS = 55_000;

function ytdlpSearchPlaceholderOptions(): JobOptions {
  return {
    input: YOUTUBE_SEARCH_PLACEHOLDER_URL,
    workflowMode: "subtitle",
    outputDir: "",
    subtitleSource: "platform",
    localFallback: false,
    separate: false,
    saveAudio: false,
    keepPlatformSubs: false,
    simplifiedChinese: false,
    model: "medium",
    language: "",
    subLangs: "",
    browser: "",
    cookies: "",
    formats: ["srt"]
  };
}

function normalizeYoutubeWatchUrl(entry: Record<string, unknown>, fallbackId: string): string {
  const page = entry.webpage_url;
  if (typeof page === "string" && page.startsWith("http")) {
    return page;
  }
  const u = entry.url;
  if (typeof u === "string" && u.startsWith("http")) {
    return u;
  }
  if (typeof u === "string" && u.startsWith("//")) {
    return `https:${u}`;
  }
  return `https://www.youtube.com/watch?v=${fallbackId}`;
}

function normalizeBilibiliWatchUrl(entry: Record<string, unknown>, fallbackId: string): string {
  const page = entry.webpage_url;
  if (typeof page === "string" && page.startsWith("http")) {
    return page;
  }
  const u = entry.url;
  if (typeof u === "string" && u.startsWith("http")) {
    return u;
  }
  if (typeof u === "string" && u.startsWith("//")) {
    return `https:${u}`;
  }
  if (typeof u === "string" && /^BV[0-9A-Za-z]+$/i.test(u)) {
    return `https://www.bilibili.com/video/${u}`;
  }
  return `https://www.bilibili.com/video/${fallbackId}`;
}

function entryThumbnail(entry: Record<string, unknown>): string | undefined {
  const thumbnail = entry.thumbnail;
  if (typeof thumbnail !== "string") {
    return undefined;
  }
  if (thumbnail.startsWith("http")) {
    return thumbnail;
  }
  return thumbnail.startsWith("//") ? `https:${thumbnail}` : undefined;
}

function parseMediaSearchStdout(stdout: string, platform: "youtube" | "bilibili"): YoutubeSearchResult[] {
  const results: YoutubeSearchResult[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length < 3) {
      continue;
    }
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const idRaw = j.id;
    if (typeof idRaw !== "string" || !idRaw) {
      continue;
    }
    const title = typeof j.title === "string" ? j.title : "Untitled";
    const channel =
      (typeof j.channel === "string" && j.channel) || (typeof j.uploader === "string" && j.uploader) || "";
    let durationLabel = "";
    const durationRaw = j.duration;
    if (typeof durationRaw === "number" && Number.isFinite(durationRaw)) {
      const seconds = Math.floor(durationRaw);
      durationLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }
    results.push({
      videoId: idRaw,
      title,
      url: platform === "bilibili" ? normalizeBilibiliWatchUrl(j, idRaw) : normalizeYoutubeWatchUrl(j, idRaw),
      channel,
      durationLabel,
      platform,
      thumbnailUrl: entryThumbnail(j)
    });
  }
  return results;
}

async function runMediaSearch(platform: "youtube" | "bilibili", query: string, appendKaraoke: boolean): Promise<YoutubeSearchResult[]> {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Search query is empty.");
  }
  if (trimmed.length > MEDIA_SEARCH_MAX_QUERY_CHARS) {
    throw new Error(`Search query is too long (max ${MEDIA_SEARCH_MAX_QUERY_CHARS} characters).`);
  }
  let effective = appendKaraoke ? `${trimmed} karaoke` : trimmed;
  if (effective.length > MEDIA_SEARCH_MAX_QUERY_CHARS) {
    effective = effective.slice(0, MEDIA_SEARCH_MAX_QUERY_CHARS);
  }

  const runtime = await prepareAudioRuntime(ytdlpSearchPlaceholderOptions(), () => {});
  const python = runtime.python?.command;
  if (!python) {
    throw new Error("Python runtime is not available for yt-dlp.");
  }

  const searchPrefix = platform === "bilibili" ? "bilisearch" : "ytsearch";
  const searchArg = `${searchPrefix}${MEDIA_SEARCH_MAX_RESULTS}:${effective}`;
  const args = ["-m", "yt_dlp", "-j", "--no-playlist", "--flat-playlist", "--socket-timeout", "20", searchArg];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(python, args, {
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${platform === "bilibili" ? "Bilibili" : "YouTube"} search timed out.`));
    }, MEDIA_SEARCH_TIMEOUT_MS);
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(err.trim() || `yt-dlp ${platform} search failed (exit ${code ?? "unknown"}).`));
    });
  });

  return parseMediaSearchStdout(stdout, platform);
}

async function runYoutubeSearch(query: string, appendKaraoke: boolean): Promise<YoutubeSearchResult[]> {
  return runMediaSearch("youtube", query, appendKaraoke);
}

async function runBilibiliSearch(query: string, appendKaraoke: boolean): Promise<YoutubeSearchResult[]> {
  try {
    return await runBilibiliWebSearch(query, appendKaraoke);
  } catch (error) {
    console.warn(`[bilibili-search] web API search failed; using yt-dlp fallback. ${error instanceof Error ? error.message : ""}`);
    return runMediaSearch("bilibili", query, appendKaraoke);
  }
}

async function runBilibiliWebSearch(query: string, appendKaraoke: boolean): Promise<YoutubeSearchResult[]> {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Search query is empty.");
  }
  let effective = appendKaraoke ? `${trimmed} karaoke` : trimmed;
  if (effective.length > MEDIA_SEARCH_MAX_QUERY_CHARS) {
    effective = effective.slice(0, MEDIA_SEARCH_MAX_QUERY_CHARS);
  }

  const url = new URL("https://api.bilibili.com/x/web-interface/search/type");
  url.searchParams.set("search_type", "video");
  url.searchParams.set("keyword", effective);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(MEDIA_SEARCH_MAX_RESULTS));

  const buvid = `XY${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Cookie: `buvid3=${buvid}; buvid4=${buvid}; b_nut=${Math.floor(Date.now() / 1000)};`,
      Origin: "https://search.bilibili.com",
      Referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(effective)}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Bilibili search failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    code?: number;
    message?: string;
    data?: {
      result?: Array<{
        bvid?: string;
        aid?: number;
        title?: string;
        author?: string;
        duration?: string;
        pic?: string;
        arcurl?: string;
      }>;
    };
  };

  if (payload.code !== 0) {
    throw new Error(payload.message || "Bilibili search failed.");
  }

  return (payload.data?.result ?? [])
    .filter((item) => item.bvid || item.aid)
    .slice(0, MEDIA_SEARCH_MAX_RESULTS)
    .map((item) => {
      const videoId = item.bvid || `av${item.aid}`;
      const title = stripHtmlTags(item.title || "Untitled");
      return {
        videoId,
        title,
        url: `https://www.bilibili.com/video/${videoId}`,
        channel: item.author || "",
        durationLabel: item.duration || "",
        platform: "bilibili" as const,
        thumbnailUrl: proxiedBilibiliThumbnailUrl(normalizeMaybeProtocolRelativeUrl(item.pic))
      };
    });
}

function proxiedBilibiliThumbnailUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return `${webApiOrigin}/api/thumbnail?url=${encodeURIComponent(value)}`;
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function normalizeMaybeProtocolRelativeUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("http")) {
    return value;
  }
  return value.startsWith("//") ? `https:${value}` : undefined;
}

async function ensurePip(python: string, env: NodeJS.ProcessEnv, log: RuntimeLog): Promise<void> {
  if (await pythonCheck(python, "import pip", env)) {
    return;
  }

  log("[runtime] Python environment has no pip; installing bundled pip with ensurepip.\n");
  await runRuntimeCommand(python, ["-m", "ensurepip", "--upgrade"], env, log);

  if (!(await pythonCheck(python, "import pip", env))) {
    throw new Error("Python runtime setup failed: pip is still unavailable after ensurepip.");
  }
}

function runtimeNeeds(options: JobOptions): RuntimeNeeds {
  const input = normalizeMediaInput(options.input.trim());
  const urlInput = isHttpUrl(input);
  const bilibiliInput = isBilibiliUrl(input);
  const separatedStemInput = isLikelySeparatedStemInput(input);
  const needsLocalTranscription =
    !urlInput || options.subtitleSource === "local" || options.localFallback || bilibiliInput || options.separate;

  return {
    ytDlp: urlInput,
    whisper: needsLocalTranscription,
    separator: options.separate && !separatedStemInput,
    zhconv: options.simplifiedChinese
  };
}

function withDefaultDesktopOutputDir(options: JobOptions, jobId: string): JobOptions {
  if (options.outputDir.trim()) {
    return options;
  }
  return {
    ...options,
    outputDir: path.join(defaultDesktopOutputRoot(), packageOutputFolderName(options.input, jobId))
  };
}

function defaultDesktopOutputRoot(): string {
  return path.join(homedir(), "Downloads", "VocalFlow Studio");
}

function packageOutputFolderName(input: string, jobId: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const label = sanitizeOutputFolderLabel(outputLabelFromInput(input));
  return `${label}-${timestamp}-${jobId.slice(0, 8)}`;
}

function outputLabelFromInput(input: string): string {
  const trimmed = normalizeMediaInput(input.trim());
  if (!trimmed) {
    return "package";
  }

  if (isHttpUrl(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, "").split(".")[0] || "url";
      const id =
        url.searchParams.get("v") ??
        url.pathname.split("/").filter(Boolean).at(-1) ??
        "package";
      return `${host}-${id}`;
    } catch {
      return "url-package";
    }
  }

  return path.basename(trimmed, path.extname(trimmed));
}

function sanitizeOutputFolderLabel(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
    .replace(/\s/g, "-");
  return cleaned || "package";
}

function normalizeMediaInput(input: string): string {
  const value = input.trim();
  if (!value) {
    return value;
  }
  if (/^(www\.)?(bilibili\.com|youtube\.com)\//i.test(value) || /^b23\.tv\//i.test(value) || /^youtu\.be\//i.test(value)) {
    return `https://${value}`;
  }
  if (/^BV[0-9A-Za-z]+$/i.test(value) || /^av\d+$/i.test(value)) {
    return `https://www.bilibili.com/video/${value}`;
  }
  return value;
}

function isLikelySeparatedStemInput(input: string): boolean {
  if (!input || isHttpUrl(input)) {
    return false;
  }
  const ext = path.extname(input).toLowerCase();
  if (!mediaExtensions.has(ext)) {
    return false;
  }
  const basename = path.basename(input, ext);
  return /(^|[_\s([.-])(vocals?|voice|acapella|instrumental|inst|no[_\s-]?vocals?|backing|karaoke)([_\s)\].-]|$)/i.test(basename);
}

function runtimeVenvDir(): string {
  return path.join(app.getPath("userData"), "runtime", "audio-subtitles-venv");
}

function runtimeVenvPython(venvDir: string): string {
  return process.platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
}

function venvBinDir(venvDir: string): string {
  return process.platform === "win32" ? path.join(venvDir, "Scripts") : path.join(venvDir, "bin");
}

function bundledFfmpegDir(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg-static")
    : path.resolve(__dirname, "../../node_modules/ffmpeg-static");
  return existsSync(candidate) ? candidate : null;
}

function withPath(baseEnv: NodeJS.ProcessEnv, pathDirs: string[]): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PATH: [...pathDirs, baseEnv.PATH ?? ""].join(path.delimiter)
  };
}

/**
 * Inject the user's HuggingFace settings into the child env:
 *
 * - `HF_TOKEN` + `HUGGING_FACE_HUB_TOKEN` — when set, every downstream
 *   tool (audio-separator, faster-whisper, whisper-timestamped) downloads
 *   with authenticated rate limits instead of the anonymous ~10 req/min.
 * - `HF_ENDPOINT` — when set, all `huggingface_hub` clients route through
 *   the chosen host (e.g. `https://hf-mirror.com` for mainland China).
 *
 * Existing parent-env values are preserved when the user hasn't configured
 * a setting, so `HF_TOKEN` / `HF_ENDPOINT` exported in the user's shell
 * still work.
 */
function withHuggingFaceEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...baseEnv };
  const token = userSettings.hfToken?.trim();
  if (token) {
    next.HF_TOKEN = token;
    next.HUGGING_FACE_HUB_TOKEN = token;
  }
  const endpoint = userSettings.hfEndpoint?.trim().replace(/\/+$/, "");
  if (endpoint && /^https?:\/\//i.test(endpoint)) {
    next.HF_ENDPOINT = endpoint;
  }
  // Always pin `HF_HOME` to a writable user-data folder. When the
  // packaged build ships a pre-downloaded faster-whisper snapshot under
  // `vendor/whisper-cache/`, `ensureHfHomeDir()` copies it in once so
  // `WhisperModel(<repo>)` finds the model on first run without any HF
  // network traffic. On `pnpm dev` the bundle is empty and faster-whisper
  // falls back to its normal HF download path — but it now always writes
  // into our app-managed cache instead of the user's `~/.cache/huggingface/`,
  // so re-downloads after model upgrades stay scoped to this app.
  const hfHome = ensureHfHomeDir();
  if (hfHome) {
    next.HF_HOME = hfHome;
  }
  return next;
}

function pythonCheck(python: string, code: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(python, ["-c", code], {
      env,
      stdio: ["ignore", "ignore", "ignore"]
    });
    child.on("error", () => resolve(false));
    child.on("close", (exitCode) => resolve(exitCode === 0));
  });
}

function runRuntimeCommand(command: string, args: string[], env: NodeJS.ProcessEnv, log: RuntimeLog): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";

    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      log(chunk);
    });

    child.stderr.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      log(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(formatSpawnError(error, command)));
    });

    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${exitCode ?? "unknown"} while preparing the runtime.\n${lastOutputLine(output)}`));
    });
  });
}

function lastOutputLine(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

function bundledAudioSubtitlesScript(): string | null {
  const candidates = [
    process.env.VOCALFLOW_AUDIO_SUBTITLES_SCRIPT,
    app.isPackaged
      ? path.join(process.resourcesPath, "audio-subtitles", "scripts", "generate_subtitles.py")
      : path.resolve(__dirname, "../../../../skills/audio-subtitles/scripts/generate_subtitles.py")
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function bundledPythonInvocation(): CommandInvocation | null {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "python-runtime", "python")
    : path.resolve(__dirname, "../../vendor/python-runtime/python");
  const candidates =
    process.platform === "win32"
      ? [path.join(root, "python.exe")]
      : [path.join(root, "bin", "python3"), path.join(root, "bin", "python")];
  const command = candidates.find((candidate) => existsSync(candidate));
  return command ? { command, argsPrefix: [] } : null;
}

function pythonInvocation(): CommandInvocation | null {
  const bundledPython = bundledPythonInvocation();
  if (bundledPython) {
    return bundledPython;
  }

  const configuredPython = process.env.AUDIO_SUBTITLES_PYTHON;
  if (configuredPython && existsSync(configuredPython)) {
    return { command: configuredPython, argsPrefix: [] };
  }

  const candidates: CommandInvocation[] =
    process.platform === "win32"
      ? [
          { command: "py", argsPrefix: ["-3.12"] },
          { command: "py", argsPrefix: ["-3.11"] },
          { command: "py", argsPrefix: ["-3"] },
          { command: "python", argsPrefix: [] },
          { command: "python3", argsPrefix: [] }
        ]
      : [
          { command: "python3.12", argsPrefix: [] },
          { command: "python3.11", argsPrefix: [] },
          { command: "python3.10", argsPrefix: [] },
          { command: "python3", argsPrefix: [] },
          { command: "python", argsPrefix: [] }
        ];

  for (const candidate of candidates) {
    const command = findExecutable(candidate.command);
    if (command) {
      return { command, argsPrefix: candidate.argsPrefix };
    }
  }

  return null;
}

function findExecutable(command: string): string | null {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : null;
  }

  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function formatSpawnError(error: Error, command: string): string {
  const code = "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
  if (code === "ENOENT") {
    return `Unable to start ${command}: executable not found. Install Python 3 and the runtime dependencies from the README, then try again.`;
  }
  if (code === "EACCES") {
    return `Unable to start ${command}: permission denied. Check executable permissions and try again.`;
  }
  return error.message;
}

/**
 * Choose the local transcription engine for a given Whisper model.
 *
 * - `large-v3-turbo` (and other "turbo" / "v3-turbo" variants): always
 *   `faster_whisper`. The CTranslate2 backend is dramatically faster on
 *   these models and turbo's word-alignment quality through
 *   `whisper-timestamped` is no better than faster-whisper's native one.
 * - Everything else: keep `auto` (prefers `whisper-timestamped` for
 *   precise word boundaries; falls back to `faster_whisper` if missing).
 *
 * Centralized so the renderer never sets `--word-engine` directly.
 */
function pickWordEngine(_model: string): "faster_whisper" {
  return "faster_whisper";
}

function buildAudioSubtitlesArgs(options: JobOptions): string[] {
  const input = normalizeMediaInput(options.input.trim());
  if (!input) {
    throw new Error("Input is required.");
  }

  const formats: OutputFormat[] = options.workflowMode === "karaoke" ? ["lrc"] : normalizeFormats(options.formats);
  const args: string[] = [];

  if (options.outputDir.trim()) {
    args.push("--output-dir", options.outputDir.trim());
  }

  args.push("--subtitle-source", options.subtitleSource);
  const modelArg = options.model || "medium";
  args.push("--model", modelArg);
  args.push("--formats", formats.join(","));
  // Desktop jobs should prioritize responsiveness. faster-whisper avoids the
  // slow whisper-timestamped alignment path while still producing word timing.
  args.push("--word-engine", pickWordEngine(modelArg));

  if (options.language.trim()) {
    args.push("--language", options.language.trim());
  }
  if (options.subLangs.trim()) {
    args.push("--sub-langs", options.subLangs.trim());
  }
  if (options.browser.trim()) {
    args.push("--browser", options.browser.trim());
  }
  if (options.cookies.trim()) {
    args.push("--cookies", options.cookies.trim());
  }
  if (options.localFallback) {
    args.push("--local-fallback");
  }
  if (options.separate) {
    args.push("--separate");
    args.push("--separator-format", "MP3");
    const modelDir = userSettings.separatorModelDir?.trim();
    if (modelDir) {
      args.push("--separator-model-dir", modelDir);
      // Audio-separator's built-in default is
      // `model_bs_roformer_ep_317_sdr_12.9755.ckpt`. When `model_file_dir`
      // points at a UVR shadow folder that DOES NOT contain that file, the
      // CLI silently falls back to downloading from HF Hub — which 429s
      // for anonymous users and times out for users who can't reach
      // huggingface.co. Picking a model we KNOW is in the folder keeps
      // the offline path honest. When the folder is empty (fresh install,
      // no UVR), we fall through with no `--separator-model` so the CLI
      // applies its own default (and the user gets a one-shot HF download
      // as before, which is fine when network access is available).
      const preferred = pickPreferredSeparatorModel(modelDir);
      if (preferred) {
        args.push("--separator-model", preferred);
      }
    } else {
      // No UVR install and no bundled models. Without these flags
      // audio-separator falls back to its (slow on CPU) roformer default and
      // caches the download under /tmp, which is wiped on reboot — so users
      // re-download the model on every run. Pin the fast MDX-Net model and a
      // persistent cache dir instead; the CLI creates the dir itself.
      args.push("--separator-model-dir", path.join(app.getPath("userData"), "separator-models", "cache"));
      args.push("--separator-model", "UVR-MDX-NET-Inst_HQ_3.onnx");
    }
  }
  if (shouldSaveAudio(options)) {
    args.push("--save-audio");
  }
  if (shouldSaveVideoPreview(options)) {
    args.push("--save-video-preview");
  }
  if (options.keepPlatformSubs) {
    args.push("--keep-platform-subs");
  }
  if (options.simplifiedChinese) {
    args.push("--simplified-chinese");
  }

  args.push(input);
  return args;
}

function shouldSaveAudio(options: JobOptions): boolean {
  if (options.saveAudio) {
    return true;
  }
  if (options.workflowMode !== "karaoke") {
    return false;
  }
  const input = options.input.trim();
  return isHttpUrl(input) || isVideoInput(input);
}

function shouldSaveVideoPreview(_options: JobOptions): boolean {
  return false;
}

function isPreviewVideo(filePath: string): boolean {
  return isVideoInput(filePath) && /\.preview\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(path.basename(filePath));
}

function normalizeFormats(formats: OutputFormat[]): OutputFormat[] {
  const fallback: OutputFormat[] = ["srt", "vtt", "lrc", "txt", "json", "ass"];
  const allowed = new Set(fallback);
  const selected = formats.filter((format) => allowed.has(format));
  return selected.length > 0 ? selected : fallback;
}

/**
 * Resolve a media page URL (YouTube, Bilibili, ...) into a direct stream URL
 * that a `<video>` element can play. Stream URLs expire after a few hours, so
 * this is resolved at room entry and never persisted.
 *
 * Bilibili only publishes DASH (video-only + audio-only). Prefer a muted
 * ≤720p AVC video stream; combined `b[ext=mp4]` almost never exists there.
 */
function resolveDirectStreamUrl(
  url: string,
  python: { command: string; argsPrefix: string[] },
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  return new Promise((resolve) => {
    const format = isBilibiliUrl(url)
      ? "bv*[height<=720][vcodec^=avc1]/bv*[height<=720][vcodec^=avc]/bv*[height<=720]/bv*"
      : "b[ext=mp4]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b";
    const args = [
      ...python.argsPrefix,
      "-m",
      "yt_dlp",
      "--no-playlist",
      "--socket-timeout",
      "20",
      "-f",
      format,
      "-g",
      url
    ];
    const child = spawn(python.command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const settle = (value: string | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      settle(null);
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      settle(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle(null);
        return;
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^https?:\/\//i.test(line));
      settle(first ?? null);
    });
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isBilibiliUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com");
  } catch {
    return false;
  }
}

function isVideoInput(value: string): boolean {
  if (isHttpUrl(value)) {
    return false;
  }
  return [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(path.extname(value).toLowerCase());
}

function isAudioInput(value: string): boolean {
  if (isHttpUrl(value)) {
    return false;
  }
  return [".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".opus", ".aiff", ".aif"].includes(path.extname(value).toLowerCase());
}

function parseGeneratedOutput(output: string): Pick<JobResult, "outputDir" | "generatedFiles"> {
  const outputDirMatch = output.match(/^Output directory:\s*(.+)$/m);
  const generatedFiles = uniquePaths(
    output
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        return trimmed.match(/^\s*-\s+(.+)$/)?.[1] ?? (looksLikeGeneratedFile(trimmed) ? trimmed : null);
      })
      .filter((item): item is string => Boolean(item))
  );

  return {
    outputDir: outputDirMatch?.[1]?.trim() ?? "",
    generatedFiles
  };
}

function looksLikeGeneratedFile(value: string): boolean {
  return /\.(srt|vtt|lrc|txt|json|ass|mp3|wav|m4a|flac|aac|ogg|opus|aiff|aif|mp4|mov|mkv|webm|avi|m4v)$/i.test(value) && (path.isAbsolute(value) || value.includes(path.sep));
}

function quoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
