import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const source = readFileSync(new URL("../src/main/lib/roomQueueStore.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { loadRoomQueue, saveRoomQueue } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const root = mkdtempSync(path.join(tmpdir(), "vocalflow-queue-test-"));
const file = path.join(root, "queue.json");
const item = { id: "song-1", input: "https://example.com/song", title: "Test song", requestedBy: "Guest",
  createdAt: "2026-10-27T00:00:00.000Z", status: "queued", resultHistoryId: null, error: null };
try {
  assert.deepEqual(loadRoomQueue(file), []);
  const queue = [item, { ...item, id: "song-2", status: "running" },
    { ...item, id: "song-3", status: "complete", resultHistoryId: "history-3" }];
  saveRoomQueue(file, queue);
  const loaded = loadRoomQueue(file);
  assert.deepEqual(loaded.map((row) => row.id), ["song-1", "song-2", "song-3"]);
  assert.equal(loaded[1].status, "failed");
  assert.match(loaded[1].error, /interrupted/);
  assert.equal(loaded[2].resultHistoryId, "history-3");
  const original = readFileSync(file, "utf8");
  assert.throws(() => saveRoomQueue(file, [item, item]), /Duplicate/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.throws(() => saveRoomQueue(file, [{ ...item, status: "unknown" }]));
  assert.equal(readFileSync(file, "utf8"), original);
  saveRoomQueue(file, [item]);
  assert.deepEqual(loadRoomQueue(file), [item]);
  assert.deepEqual(readdirSync(root), ["queue.json"]);
  for (const invalid of ["broken json", JSON.stringify({ version: 2, queue: [] }),
    JSON.stringify({ version: 1, queue: [{ ...item, input: null }] })]) {
    writeFileSync(file, invalid);
    assert.throws(() => loadRoomQueue(file));
    assert.equal(readFileSync(file, "utf8"), invalid);
  }
  // A rename failure must clean only the temporary file and preserve the target.
  assert.throws(() => saveRoomQueue(root, [item]));
  assert.deepEqual(readdirSync(root), ["queue.json"]);
  console.log("PASS: queue persistence, interrupted recovery, validation and failed-write preservation");
} finally {
  rmSync(root, { recursive: true, force: true });
}
