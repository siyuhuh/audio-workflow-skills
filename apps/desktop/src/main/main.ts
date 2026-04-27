import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
  CommandPreview,
  GeneratedAsset,
  GeneratedAssetRole,
  JobOptions,
  JobResult,
  OutputFormat,
  PlaybackBundle,
  SavedJobHistory
} from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runningJobs = new Map<string, ChildProcessByStdio<null, Readable, Readable>>();
const knownFilePaths = new Set<string>();
const knownOutputDirs = new Set<string>();
const mediaUrlTokens = new Map<string, string>();
const webLogClients = new Set<ServerResponse>();
let savedHistory: SavedJobHistory[] = [];
let hiddenSampleIds = new Set<string>();
let webApiServer: Server | null = null;

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
  separator: "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('audio_separator') else 1)"
};

const runtimePackages = {
  ytDlp: "yt-dlp",
  whisper: "faster-whisper",
  whisperTimestamped: "whisper-timestamped",
  separator: "audio-separator[cpu]"
};

const subtitleExtensions = new Set([".srt", ".vtt", ".lrc", ".txt", ".json", ".ass"]);
const mediaExtensions = new Set([".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".opus", ".aiff", ".aif", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const reviewExtensions = new Set([...subtitleExtensions, ...mediaExtensions]);
const mediaProtocol = "vocalflow-media";
const webApiHost = "127.0.0.1";
const webApiPort = 5175;
const webApiOrigin = `http://${webApiHost}:${webApiPort}`;
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
      throw new Error("VocalFlow Studio could not find its bundled Python runtime. Reinstall the app and try again.");
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
        "VocalFlow Studio includes its audio-subtitles script, but Python 3 was not found. Reinstall the app or install Python 3 and try again."
      );
    }
    return {
      command: python.command,
      argsPrefix: [...python.argsPrefix, bundledScript]
    };
  }

  throw new Error(
    "audio-subtitles was not found. Install the CLI with ./install.sh, or reinstall VocalFlow Studio so the bundled audio-subtitles script is included."
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "VocalFlow Studio",
    backgroundColor: "#f7f7f3",
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
  process.env.PATH = [
    path.join(homedir(), ".local", "bin"),
    process.env.PATH ?? "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ].join(path.delimiter);

  loadSavedHistory();
  registerMediaProtocol();
  registerIpcHandlers();
  registerMediaPermissions();
  startWebApiServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const child of runningJobs.values()) {
    child.kill("SIGTERM");
  }
  runningJobs.clear();
  webApiServer?.close();
  webApiServer = null;

  if (process.platform !== "darwin") {
    app.quit();
  }
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
}

async function runAudioWorkflowJob(jobId: string, options: JobOptions, emitLog: (log: { jobId: string; stream: "stdout" | "stderr"; chunk: string }) => void): Promise<JobResult> {
  const runtime = await prepareAudioRuntime(options, (chunk) => {
    emitLog({ jobId, stream: "stderr", chunk });
  });
  const preview = buildCommandPreview(options, runtime);
  const startedAtMs = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(preview.command, preview.args, {
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    runningJobs.set(jobId, child);

    let output = "";

    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      emitLog({ jobId, stream: "stdout", chunk });
    });

    child.stderr.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      output += chunk;
      emitLog({ jobId, stream: "stderr", chunk });
    });

    child.on("error", (error) => {
      runningJobs.delete(jobId);
      reject(new Error(formatSpawnError(error, preview.command)));
    });

    child.on("close", (exitCode, signal) => {
      runningJobs.delete(jobId);
      const parsed = parseGeneratedOutput(output);
      const success = exitCode === 0 && signal === null;
      let historyEntry = success ? createSavedHistoryEntry(jobId, options, parsed, startedAtMs) : null;
      const discovered = historyEntry ? null : discoverAssets(options, parsed, startedAtMs);
      const fallbackAssets = discovered?.assets ?? [];
      if (historyEntry) {
        historyEntry = saveHistoryEntry(historyEntry);
      }
      resolve({
        jobId,
        exitCode,
        signal,
        outputDir: parsed.outputDir,
        generatedFiles: parsed.generatedFiles,
        assets: historyEntry?.assets ?? fallbackAssets,
        sourceUrl: historyEntry?.sourceUrl ?? sourceUrlForInput(options.input),
        primarySubtitle: historyEntry?.primarySubtitle ?? null,
        primaryMedia: historyEntry?.primaryMedia ?? null,
        playbackBundle: historyEntry?.playbackBundle ?? buildPlaybackBundle(options, fallbackAssets),
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
  child.kill("SIGTERM");
  runningJobs.delete(jobId);
  return true;
}

function startWebApiServer(): void {
  if (webApiServer) {
    return;
  }

  webApiServer = createServer((request, response) => {
    void handleWebApiRequest(request, response);
  });

  webApiServer.on("error", (error) => {
    console.warn(`[web-api] Unable to start ${webApiOrigin}: ${error.message}`);
  });

  webApiServer.listen(webApiPort, webApiHost, () => {
    console.log(`[web-api] Listening on ${webApiOrigin}`);
  });
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

    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, { ok: true });
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
  options: Pick<JobOptions, "input">,
  parsed: Pick<JobResult, "outputDir" | "generatedFiles">,
  changedAfterMs?: number
): Pick<SavedJobHistory, "generatedFiles" | "assets"> {
  const outputFiles = new Set<string>();
  for (const file of parsed.generatedFiles) {
    addSafeExistingFile(outputFiles, file);
  }

  if (parsed.outputDir && existsSync(parsed.outputDir)) {
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
    .map((file) => classifyAsset(file));

  return {
    generatedFiles: [...outputFiles].sort((a, b) => a.localeCompare(b)),
    assets
  };
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

  const transcribeAudio = assets.find((asset) => asset.exists && asset.role === "transcribe");
  if (transcribeAudio) {
    return transcribeAudio.path;
  }

  const playableAudio = assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioInput(asset.path));
  if (playableAudio) {
    return playableAudio.path;
  }

  return assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideo(asset.path))?.path ?? null;
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
  const playableAudio = assets.filter((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && isAudioInput(asset.path));
  if (context.workflowMode === "karaoke") {
    const backing = playableAudio.find((asset) => asset.role === "backing");
    if (backing) {
      return backing.path;
    }
  }
  return (
    playableAudio.find((asset) => asset.role === "original")?.path ??
    playableAudio.find((asset) => asset.role === "transcribe")?.path ??
    playableAudio.find((asset) => asset.role === "vocal")?.path ??
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
  const trimmed = input.trim();
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
    rebuildKnownReviewFiles(historyWithBundledSamples());
  } catch {
    savedHistory = [];
  }
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
  const assets = sourceAssets.map((asset) => {
    const refreshed = classifyAsset(asset.path);
    return {
      ...asset,
      role: asset.role ?? refreshed.role,
      exists: existsSync(asset.path)
    };
  });
  const sourceUrl = entry.sourceUrl ?? sourceUrlForInput(entry.input);
  return {
    ...entry,
    assets,
    sourceUrl,
    primarySubtitle: selectPrimarySubtitle(assets) ?? entry.primarySubtitle,
    primaryMedia: selectPrimaryMedia(entry, assets) ?? entry.primaryMedia,
    playbackBundle: buildPlaybackBundle(entry, assets)
  };
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
  const assets = uniqueAssets([...primary.assets, ...secondary.assets]);
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
    assets,
    sourceUrl: mergedSourceUrl,
    primarySubtitle: selectPrimarySubtitle(assets) ?? newest.primarySubtitle ?? oldest.primarySubtitle,
    primaryMedia: null,
    playbackBundle: newest.playbackBundle
  };

  merged.primaryMedia = selectPrimaryMedia(merged, assets) ?? newest.primaryMedia ?? oldest.primaryMedia;
  merged.playbackBundle = buildPlaybackBundle(merged, assets);
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
  const env = withPath(process.env, pathDirs);
  const needs = runtimeNeeds(options);

  if (!needs.ytDlp && !needs.whisper && !needs.separator) {
    return { env };
  }

  const basePython = bundledPythonInvocation() ?? pythonInvocation();
  if (!basePython) {
    throw new Error(
      "VocalFlow Studio could not find Python. Reinstall the app and try again; the installer should include a bundled Python runtime."
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
  const runtimeEnv = withPath(
    {
      ...env,
      AUDIO_SUBTITLES_PYTHON: venvPython,
      AUDIO_SUBTITLES_VENV: venvDir,
      PYTHONNOUSERSITE: "1",
      PIP_DISABLE_PIP_VERSION_CHECK: "1"
    },
    pathDirs
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

  if (missingPackages.length > 0) {
    log(`[runtime] Installing ${missingPackages.join(", ")}. First run may take several minutes.\n`);
    await runRuntimeCommand(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"], runtimeEnv, log);
    await runRuntimeCommand(venvPython, ["-m", "pip", "install", "--upgrade", ...missingPackages], runtimeEnv, log);
  }

  log("[runtime] Runtime ready.\n");
  return { env: runtimeEnv, python: venvPythonInvocation };
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
  const input = options.input.trim();
  const urlInput = isHttpUrl(input);
  const bilibiliInput = isBilibiliUrl(input);
  const needsLocalTranscription =
    !urlInput || options.subtitleSource === "local" || options.localFallback || bilibiliInput || options.separate;

  return {
    ytDlp: urlInput,
    whisper: needsLocalTranscription,
    separator: options.separate
  };
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

function buildAudioSubtitlesArgs(options: JobOptions): string[] {
  const input = options.input.trim();
  if (!input) {
    throw new Error("Input is required.");
  }

  const formats = normalizeFormats(options.formats);
  const args: string[] = [];

  if (options.outputDir.trim()) {
    args.push("--output-dir", options.outputDir.trim());
  }

  args.push("--subtitle-source", options.subtitleSource);
  args.push("--model", options.model || "medium");
  args.push("--formats", formats.join(","));
  args.push("--word-engine", "auto");

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

function shouldSaveVideoPreview(options: JobOptions): boolean {
  if (options.workflowMode !== "karaoke") {
    return false;
  }
  return isHttpUrl(options.input.trim());
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
