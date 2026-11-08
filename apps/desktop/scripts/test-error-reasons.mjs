import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/lib/errorReason.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { classifyError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
for (const [message, reason] of [
  ['Bundled runtime is incomplete: audio-separator failed its import check', 'runtime_incomplete'],
  ['ERROR: HTTP Error 403: Forbidden', 'source_blocked'],
  ['YouTube challenge solving failed', 'source_blocked'],
  ['Sign in to confirm you are not a bot. HTTP Error 403', 'auth_required'],
  ['Login required', 'auth_required'],
  ['HTTP Error 429: Too Many Requests', 'rate_limited'],
  ['huggingface.co HTTP 429', 'hf_rate_limited'],
  ['No space left on device', 'disk_full']
]) {
  assert.equal(classifyError(message).reason, reason, message);
}
assert.equal(classifyError('HTTP Error 403').hint.actions[0].id, 'copyLog');
for (const locale of ['en', 'zh']) {
  const messages = JSON.parse(readFileSync(new URL(`../src/renderer/i18n/locales/${locale}/capture.json`, import.meta.url)));
  assert.ok(messages.error.sourceBlocked.title && messages.error.sourceBlocked.body);
}
console.log('PASS: error classification and bilingual recovery messages');
