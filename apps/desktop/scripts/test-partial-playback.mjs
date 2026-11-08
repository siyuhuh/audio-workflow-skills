import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/main/lib/partialPlayback.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { partialPlaybackAssets } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const backing = { path: "/test/backing.mp3", extension: "mp3", exists: true, role: "backing" };
const vocal = { ...backing, path: "/test/vocals.mp3", role: "vocal" };
const subtitle = { ...backing, path: "/test/partial.lrc", extension: "lrc", role: "subtitle" };
const state = { karaoke: true, separationComplete: true, exitCode: 1, signal: null };
assert.deepEqual(partialPlaybackAssets([backing, vocal, subtitle], state), [backing, vocal]);
for (const change of [{ karaoke: false }, { separationComplete: false }, { exitCode: 0 }, { exitCode: null }, { signal: "SIGTERM" }]) {
  assert.deepEqual(partialPlaybackAssets([backing, vocal], { ...state, ...change }), []);
}
assert.deepEqual(partialPlaybackAssets([vocal, subtitle], state), []);
assert.deepEqual(partialPlaybackAssets([{ ...backing, exists: false }], state), []);
assert.deepEqual(partialPlaybackAssets([{ ...backing, role: "original" }], state), []);
assert.deepEqual(partialPlaybackAssets([{ ...backing, extension: "json" }], state), []);
console.log("PASS: partial backing retention excludes cancellation, failed separation and incomplete lyrics");
