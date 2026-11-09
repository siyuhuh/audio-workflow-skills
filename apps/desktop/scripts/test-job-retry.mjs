import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const source = readFileSync(new URL("../src/main/lib/jobRetryStore.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { JobRetryStore, retryKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const root = mkdtempSync(path.join(tmpdir(), "vocalflow-retry-test-"));
try {
  const file = path.join(root, "journal.json");
  const first = { input: "https://example.com/song", outputDir: path.join(root, "first"), model: "small", cookies: "private-cookie-path" };
  const second = { ...first, outputDir: path.join(root, "second") };
  const store = new JobRetryStore(file);
  assert.equal(store.begin(first).resumed, false);
  mkdirSync(first.outputDir);
  assert.deepEqual(new JobRetryStore(file).begin(second), { resumed: true, outputDir: first.outputDir });
  assert.equal(readFileSync(file, "utf8").includes(first.cookies), false);
  assert.notEqual(retryKey(first), retryKey({ ...first, input: "other" }));
  assert.notEqual(retryKey(first), retryKey({ ...first, model: "medium" }));
  store.complete(second);
  assert.deepEqual(store.begin(second), { resumed: false, outputDir: second.outputDir });
  writeFileSync(file, "damaged journal");
  assert.throws(() => store.begin(first));
  assert.equal(readFileSync(file, "utf8"), "damaged journal");
  console.log("PASS: retry identity, restart recovery, success cleanup and journal preservation");
} finally {
  rmSync(root, { recursive: true, force: true });
}
