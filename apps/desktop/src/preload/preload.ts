import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioWorkflowApi,
  JobFailedEvent,
  JobLog,
  JobOptions,
  JobProgressStage,
  UrlMetadataPreview,
  UserSettings,
  UvrDetectionResult,
  YoutubeSearchResult
} from "../shared/types.js";
import type { JobEvent } from "../shared/job-events.js";

const api: AudioWorkflowApi = {
  selectInput: () => ipcRenderer.invoke("dialog:select-input"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder") as Promise<string | null>,
  previewCommand: (options: JobOptions) => ipcRenderer.invoke("job:preview-command", options),
  runJob: (jobId: string, options: JobOptions) => ipcRenderer.invoke("job:run", jobId, options),
  cancelJob: (jobId: string) => ipcRenderer.invoke("job:cancel", jobId),
  openPath: (targetPath: string) => ipcRenderer.invoke("shell:open-path", targetPath),
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:open-external-url", url),
  readTextFile: (targetPath: string) => ipcRenderer.invoke("file:read-text", targetPath),
  writeTextFile: (targetPath: string, content: string) => ipcRenderer.invoke("file:write-text", targetPath, content),
  getMediaUrl: (targetPath: string) => ipcRenderer.invoke("file:media-url", targetPath),
  listHistory: () => ipcRenderer.invoke("history:list"),
  removeHistory: (historyId: string) => ipcRenderer.invoke("history:remove", historyId),
  onJobLog: (callback: (log: JobLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: JobLog) => callback(log);
    ipcRenderer.on("job:log", listener);
    return () => ipcRenderer.removeListener("job:log", listener);
  },
  onJobProgress: (callback: (event: JobProgressStage) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: JobProgressStage) => callback(payload);
    ipcRenderer.on("job:progress", listener);
    return () => ipcRenderer.removeListener("job:progress", listener);
  },
  onJobFailed: (callback: (event: JobFailedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: JobFailedEvent) => callback(payload);
    ipcRenderer.on("job:failed", listener);
    return () => ipcRenderer.removeListener("job:failed", listener);
  },
  onJobEvent: (callback: (event: JobEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: JobEvent) => callback(payload);
    ipcRenderer.on("job:event", listener);
    return () => ipcRenderer.removeListener("job:event", listener);
  },
  youtubeSearch: (query, opts) =>
    ipcRenderer.invoke("youtube:search", query, opts?.appendKaraoke ?? false) as Promise<YoutubeSearchResult[]>,
  bilibiliSearch: (query, opts) =>
    ipcRenderer.invoke("bilibili:search", query, opts?.appendKaraoke ?? false) as Promise<YoutubeSearchResult[]>,
  prefetchUrlMetadata: (input: string) =>
    ipcRenderer.invoke("metadata:prefetch", input) as Promise<UrlMetadataPreview | null>,
  getRoomStatus: () => ipcRenderer.invoke("room:status"),
  enqueueRoomSong: (input, title, requestedBy) => ipcRenderer.invoke("room:enqueue", input, title, requestedBy),
  startRoomQueueItem: (itemId) => ipcRenderer.invoke("room:start-item", itemId),
  finishRoomQueueItem: (itemId, status, resultHistoryId, error) => ipcRenderer.invoke("room:finish-item", itemId, status, resultHistoryId, error),
  removeRoomQueueItem: (itemId) => ipcRenderer.invoke("room:remove-item", itemId),
  clearRoomQueue: () => ipcRenderer.invoke("room:clear"),
  getSystemLocale: () => ipcRenderer.invoke("app:get-locale") as Promise<string>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<UserSettings>,
  setSettings: (patch: Partial<UserSettings>) => ipcRenderer.invoke("settings:set", patch) as Promise<UserSettings>,
  detectUvr: () => ipcRenderer.invoke("audio:detect-uvr") as Promise<UvrDetectionResult>
};

contextBridge.exposeInMainWorld("audioWorkflow", api);
