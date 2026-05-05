import { useSyncExternalStore } from "react";

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  id: string;
  label: string;
  onClick: () => void;
}

export interface Notification {
  id: string;
  level: NotificationLevel;
  title: string;
  body?: string;
  actions?: NotificationAction[];
  /**
   * Auto-dismiss delay in milliseconds. Only applied to non-sticky levels
   * (`info`, `success`). For `warning` and `error` the field is accepted but
   * ignored — those toasts are sticky until the user dismisses them.
   * Defaults: info=6000, success=4000, warning=undefined, error=undefined.
   */
  ttlMs?: number;
  jobId?: string;
}

export type PushNotificationInput = Omit<Notification, "id"> & { id?: string };

export interface NotificationStore {
  items: Notification[];
  push: (notification: PushNotificationInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const EMPTY_ITEMS: readonly Notification[] = Object.freeze([]);

let items: Notification[] = EMPTY_ITEMS as Notification[];
const listeners = new Set<() => void>();
const timers = new Map<string, number>();

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function setItems(next: Notification[]): void {
  if (next === items) {
    return;
  }
  items = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Notification[] {
  return items;
}

let counter = 0;
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  counter += 1;
  return `notification-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function resolveTtlMs(level: NotificationLevel, explicit: number | undefined): number | null {
  if (level === "warning" || level === "error") {
    return null;
  }
  if (typeof explicit === "number") {
    return explicit > 0 ? explicit : null;
  }
  return level === "success" ? 4000 : 6000;
}

function clearTimer(id: string): void {
  const handle = timers.get(id);
  if (handle === undefined) {
    return;
  }
  timers.delete(id);
  if (typeof window !== "undefined") {
    window.clearTimeout(handle);
  }
}

function scheduleTimer(id: string, ttlMs: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const handle = window.setTimeout(() => {
    timers.delete(id);
    dismiss(id);
  }, ttlMs);
  timers.set(id, handle);
}

export function push(input: PushNotificationInput): string {
  const id = input.id ?? generateId();
  if (timers.has(id)) {
    clearTimer(id);
  }

  const next: Notification = {
    id,
    level: input.level,
    title: input.title,
    body: input.body,
    actions: input.actions,
    ttlMs: input.ttlMs,
    jobId: input.jobId
  };

  const existingIndex = items.findIndex((item) => item.id === id);
  let nextItems: Notification[];
  if (existingIndex >= 0) {
    nextItems = items.slice();
    nextItems.splice(existingIndex, 1, next);
  } else {
    nextItems = items.concat(next);
  }
  setItems(nextItems);

  const ttl = resolveTtlMs(next.level, next.ttlMs);
  if (ttl !== null) {
    scheduleTimer(id, ttl);
  }

  return id;
}

export function dismiss(id: string): void {
  clearTimer(id);
  if (!items.some((item) => item.id === id)) {
    return;
  }
  setItems(items.filter((item) => item.id !== id));
}

export function clear(): void {
  timers.forEach((handle) => {
    if (typeof window !== "undefined") {
      window.clearTimeout(handle);
    }
  });
  timers.clear();
  if (items.length === 0) {
    return;
  }
  setItems(EMPTY_ITEMS as Notification[]);
}

/**
 * Subscribe to the notification queue. Re-renders only when the items array
 * changes by reference. Action functions are stable module-level references.
 */
export function useNotifications(): NotificationStore {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    items: snapshot,
    push,
    dismiss,
    clear
  };
}
