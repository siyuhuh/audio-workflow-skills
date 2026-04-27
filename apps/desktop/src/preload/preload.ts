import { contextBridge, ipcRenderer } from "electron";
import type { AudioWorkflowApi, JobLog, JobOptions } from "../shared/types.js";

const api: AudioWorkflowApi = {
  selectInput: () => ipcRenderer.invoke("dialog:select-input"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
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
  }
};

contextBridge.exposeInMainWorld("audioWorkflow", api);
