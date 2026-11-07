import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RoomQueueItem } from "../../shared/types.js";

const statuses = new Set(["queued", "running", "complete", "failed", "canceled"]);

function parseItem(value: unknown): RoomQueueItem {
  if (!value || typeof value !== "object") throw new Error("Invalid room queue item.");
  const item = value as Record<string, unknown>;
  for (const key of ["id", "input", "title", "requestedBy", "createdAt"]) {
    if (typeof item[key] !== "string" || !(item[key] as string).trim()) {
      throw new Error(`Invalid room queue field: ${key}`);
    }
  }
  if (!statuses.has(String(item.status)) || !Number.isFinite(Date.parse(String(item.createdAt)))) {
    throw new Error("Invalid room queue state.");
  }
  for (const key of ["resultHistoryId", "error"]) {
    if (item[key] != null && typeof item[key] !== "string") throw new Error(`Invalid room queue field: ${key}`);
  }
  return {
    id: item.id as string, input: item.input as string, title: item.title as string,
    requestedBy: item.requestedBy as string, createdAt: item.createdAt as string,
    status: item.status as RoomQueueItem["status"],
    resultHistoryId: item.resultHistoryId as string | null | undefined,
    error: item.error as string | null | undefined
  };
}

export function loadRoomQueue(filePath: string): RoomQueueItem[] {
  if (!existsSync(filePath)) return [];
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.queue)) throw new Error("Unsupported room queue file.");
  const queue = data.queue.map(parseItem) as RoomQueueItem[];
  if (new Set(queue.map((item) => item.id)).size !== queue.length) throw new Error("Duplicate room queue IDs.");
  // An interrupted process cannot still be running. Require a deliberate retry
  // instead of silently repeating a download or claiming playback has resumed.
  return queue.map((item) => item.status === "running"
    ? { ...item, status: "failed", error: "Processing was interrupted when the app closed. Retry this song." }
    : item);
}

export function saveRoomQueue(filePath: string, queue: RoomQueueItem[]): void {
  const clean = queue.map(parseItem);
  if (new Set(clean.map((item) => item.id)).size !== clean.length) throw new Error("Duplicate room queue IDs.");
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, queue: clean }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, filePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
