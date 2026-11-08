import { copyFileSync, chmodSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// CI setup-node supplies the target platform's standalone Node executable.
// Keep it beside Python so Electron and native macOS packages share the layout.
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ is required');
if (!process.argv[2]) throw new Error('Expected the bundled Python executable path');
const directory = path.dirname(path.resolve(process.argv[2]));
const target = path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
const candidates = [path.join(path.dirname(process.execPath), 'LICENSE'), path.resolve(path.dirname(process.execPath), '../LICENSE')];
const localLicense = candidates.find(existsSync);
let license;
if (localLicense) license = readFileSync(localLicense, 'utf8');
else {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot retrieve Node license: ${response.status}`);
  license = await response.text();
}
if (!license.includes('Node.js') || !license.includes('Copyright')) throw new Error('Invalid Node license');
writeFileSync(path.join(directory, 'NODE-LICENSE.txt'), license);
copyFileSync(process.execPath, target);
chmodSync(target, 0o755);
writeFileSync(path.join(directory, 'node-runtime.json'), JSON.stringify({
  version: process.versions.node, platform: process.platform, arch: process.arch
}, null, 2));
console.log(`[runtime] Bundled Node ${process.versions.node} (${process.platform}/${process.arch})`);
