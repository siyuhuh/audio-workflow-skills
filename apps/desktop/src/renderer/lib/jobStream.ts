import { useCallback, useSyncExternalStore } from "react";
import type { JobErrorReason, JobEvent, JobStage } from "../../shared/job-events.js";
import type { SavedJobHistory } from "../../shared/types";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobStreamSnapshot {
  jobId: string;
  status: JobStatus;
  /** Most recently active canonical stage. `null` until first stage event. */
  currentStage: JobStage | null;
  /** Most recent fractional progress (0..1) for currentStage, or -1 for indeterminate. */
  progress: number;
  /** Most recent human-readable status message (e.g. "42.7% · 3.91MiB · ETA 00:02"). */
  message: string | null;
  etaSec: number | null;
  startedAt: number;
  updatedAt: number;
  /** Stages that have reached progress >= 1, in order of completion. */
  completedStages: JobStage[];
  /**
   * Stages that the CLI flagged as non-fatally failed (e.g. separation
   * fell through to original audio). Recorded in the order each failure
   * was first observed so consumers can show a warning toast exactly once.
   */
  failedStages: JobStage[];
  /** Set on succeeded events. */
  packageId?: string;
  historyEntry?: SavedJobHistory;
  /** Set on failed events. */
  reason?: JobErrorReason;
}

/**
 * How long to keep a terminal snapshot around so callers can render a
 * "just done" or "failed" indicator before it disappears.
 */
const EVICTION_DELAY_MS = 60_000;

/**
 * Module-scoped state. The Map identity is stable; only individual
 * snapshot values are swapped (via Map.set with a fresh object) when
 * something genuinely changes. That keeps `snapshots.get(jobId)` stable
 * for `useSyncExternalStore` until a new event lands.
 */
const snapshots = new Map<string, JobStreamSnapshot>();
let activeJobId: string | null = null;
const evictionTimers = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActiveSnapshot(): JobStreamSnapshot | null {
  if (activeJobId === null) {
    return null;
  }
  return snapshots.get(activeJobId) ?? null;
}

export function getActiveJobSnapshot(): JobStreamSnapshot | null {
  return getActiveSnapshot();
}

export function getJobSnapshot(jobId: string): JobStreamSnapshot | null {
  return snapshots.get(jobId) ?? null;
}

function clearEvictionTimer(jobId: string): void {
  const handle = evictionTimers.get(jobId);
  if (handle === undefined) {
    return;
  }
  evictionTimers.delete(jobId);
  if (typeof window !== "undefined") {
    window.clearTimeout(handle);
  }
}

function scheduleEviction(jobId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  clearEvictionTimer(jobId);
  const handle = window.setTimeout(() => {
    evictionTimers.delete(jobId);
    if (!snapshots.has(jobId)) {
      return;
    }
    snapshots.delete(jobId);
    if (activeJobId === jobId) {
      activeJobId = null;
    }
    notify();
  }, EVICTION_DELAY_MS);
  evictionTimers.set(jobId, handle);
}

function makeBaseSnapshot(jobId: string, startedAt: number): JobStreamSnapshot {
  return {
    jobId,
    status: "queued",
    currentStage: null,
    progress: -1,
    message: null,
    etaSec: null,
    startedAt,
    updatedAt: startedAt,
    completedStages: [],
    failedStages: []
  };
}

function applyEvent(event: JobEvent): void {
  switch (event.kind) {
    case "queued": {
      clearEvictionTimer(event.jobId);
      const now = Date.now();
      const next: JobStreamSnapshot = {
        jobId: event.jobId,
        status: "queued",
        currentStage: null,
        progress: -1,
        message: null,
        etaSec: null,
        startedAt: event.createdAt,
        updatedAt: now,
        completedStages: [],
        failedStages: []
      };
      snapshots.set(event.jobId, next);
      activeJobId = event.jobId;
      notify();
      return;
    }
    case "stage": {
      const existing = snapshots.get(event.jobId) ?? makeBaseSnapshot(event.jobId, Date.now());
      const isTerminal = existing.status === "succeeded" || existing.status === "failed";
      const nextStatus: JobStatus = isTerminal ? existing.status : "running";

      let completedStages = existing.completedStages;
      if (event.progress >= 1 && !completedStages.includes(event.stage)) {
        completedStages = completedStages.concat(event.stage);
      }

      let failedStages = existing.failedStages;
      if (event.failed && !failedStages.includes(event.stage)) {
        failedStages = failedStages.concat(event.stage);
      }

      const next: JobStreamSnapshot = {
        ...existing,
        status: nextStatus,
        currentStage: event.stage,
        progress: event.progress,
        message: event.message ?? null,
        etaSec: event.etaSec ?? null,
        updatedAt: Date.now(),
        completedStages,
        failedStages
      };
      snapshots.set(event.jobId, next);
      if (!isTerminal) {
        activeJobId = event.jobId;
      }
      notify();
      return;
    }
    case "log": {
      // Intentionally ignored: the existing onJobLog handler covers raw log streams.
      return;
    }
    case "succeeded": {
      const existing = snapshots.get(event.jobId) ?? makeBaseSnapshot(event.jobId, Date.now());
      const next: JobStreamSnapshot = {
        ...existing,
        status: "succeeded",
        progress: 1,
        message: null,
        etaSec: null,
        packageId: event.packageId,
        historyEntry: event.historyEntry,
        updatedAt: Date.now()
      };
      snapshots.set(event.jobId, next);
      // Keep `activeJobId` pointing at this job until eviction or the next
      // queued event supersedes it — that way `useActiveJobStream` still
      // surfaces the brief "Done" tail instead of flashing off instantly.
      scheduleEviction(event.jobId);
      notify();
      return;
    }
    case "failed": {
      const existing = snapshots.get(event.jobId) ?? makeBaseSnapshot(event.jobId, Date.now());
      const next: JobStreamSnapshot = {
        ...existing,
        status: "failed",
        reason: event.reason,
        updatedAt: Date.now()
      };
      snapshots.set(event.jobId, next);
      // Same as succeeded: keep `activeJobId` so the failed pill shows for
      // the eviction window instead of vanishing under the user.
      scheduleEviction(event.jobId);
      notify();
      return;
    }
  }
}

/**
 * Wire the IPC subscription exactly once. We stash the unsubscribe function
 * on `globalThis` so HMR re-evaluations of this module tear down the previous
 * listener before installing a new one — otherwise Vite hot-swaps would leak
 * a stack of duplicate listeners on the renderer.
 */
const HMR_FLAG = "__vocalflowJobStreamSubscription__";

interface JobStreamHmrRegistry {
  [HMR_FLAG]?: { unsubscribe: () => void };
}

function ensureSubscription(): void {
  if (typeof window === "undefined") {
    return;
  }
  const onJobEvent = window.audioWorkflow?.onJobEvent;
  if (!onJobEvent) {
    return;
  }
  const registry = globalThis as unknown as JobStreamHmrRegistry;
  const previous = registry[HMR_FLAG];
  if (previous) {
    try {
      previous.unsubscribe();
    } catch {
      // Listener already detached; ignore.
    }
  }
  const unsubscribe = onJobEvent((event) => {
    applyEvent(event);
  });
  registry[HMR_FLAG] = { unsubscribe };
}

ensureSubscription();

/**
 * Reset all snapshot state. Primarily intended for tests / manual recovery;
 * does not detach the IPC subscription.
 */
export function clear(): void {
  evictionTimers.forEach((handle) => {
    if (typeof window !== "undefined") {
      window.clearTimeout(handle);
    }
  });
  evictionTimers.clear();
  if (snapshots.size === 0 && activeJobId === null) {
    return;
  }
  snapshots.clear();
  activeJobId = null;
  notify();
}

export function useActiveJobStream(): JobStreamSnapshot | null {
  return useSyncExternalStore(subscribe, getActiveSnapshot, getActiveSnapshot);
}

export function useJobStream(jobId: string): JobStreamSnapshot | null {
  const getSnapshot = useCallback(() => snapshots.get(jobId) ?? null, [jobId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
