import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
  linkSync,
  copyFileSync
} from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundled model layout shipped inside the .dmg / .nsis installer. The two
 * folders below are populated by `apps/desktop/scripts/fetch-bundled-models.sh`
 * before `electron-builder` runs and end up under `process.resourcesPath`
 * via the `extraResources` entries in `apps/desktop/package.json`.
 *
 * The whole stack is opt-in: when the maintainer hasn't run the fetch
 * script (typical for `pnpm dev`), every helper here returns `null` /
 * `0` and the caller falls back to the regular HF download path. So a
 * fresh checkout doesn't need to download 300 MB of model weights to be
 * usable.
 *
 * Layout shipped on a release build:
 *
 *   <resourcesPath>/separator-models/
 *     ├── UVR-MDX-NET-Inst_HQ_3.onnx
 *     └── (other .onnx / .pth / .ckpt files added by the maintainer)
 *
 *   <resourcesPath>/whisper-cache/
 *     └── hub/models--Systran--faster-whisper-small/
 *         ├── refs/
 *         ├── snapshots/<sha>/
 *         └── blobs/
 *
 * The whisper layout mirrors HuggingFace Hub's native cache exactly so
 * `faster-whisper`'s `WhisperModel(<repo>)` constructor finds it via
 * `HF_HOME` without any code change in the Python script.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEPARATOR_BUNDLE_NAME = "separator-models";
const WHISPER_BUNDLE_NAME = "whisper-cache";
/** Mirror HF Hub's directory naming so faster-whisper picks it up. */
const WHISPER_HUB_SUBDIR = "hub";

const MODEL_EXTENSIONS = new Set([".onnx", ".pth", ".ckpt"]);

interface ResourcePathOpts {
  /** `app.isPackaged` — toggles between `process.resourcesPath` and the dev `vendor/` folder. */
  isPackaged: boolean;
  /** `process.resourcesPath` — populated by Electron in production. */
  resourcesPath?: string;
}

function repoVendorRoot(): string {
  // Resolves to `apps/desktop/vendor/` regardless of where the dist file
  // lives (`dist/main/lib/bundledModels.js` → up three levels).
  return path.resolve(__dirname, "..", "..", "..", "vendor");
}

function bundleDir(name: string, opts: ResourcePathOpts): string | null {
  const candidate = opts.isPackaged
    ? path.join(opts.resourcesPath ?? "", name)
    : path.join(repoVendorRoot(), name);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Folder that contains pre-downloaded vocal-separator weight files.
 * Returns `null` when the maintainer hasn't populated `vendor/separator-models/`
 * (or its packaged equivalent), in which case the caller should fall through
 * to the existing UVR detection / HF download flow.
 */
export function bundledSeparatorModelsDir(opts: ResourcePathOpts): string | null {
  return bundleDir(SEPARATOR_BUNDLE_NAME, opts);
}

/**
 * Folder formatted as a HuggingFace Hub cache (i.e. it contains a `hub/`
 * subdir with `models--<author>--<repo>/snapshots/<sha>/...` inside).
 * Returns `null` when no Whisper bundle was shipped.
 *
 * NOTE: Returns the PARENT of `hub/` so it can be passed directly as
 * `HF_HOME` to subprocesses.
 */
export function bundledWhisperHfHomeDir(opts: ResourcePathOpts): string | null {
  const root = bundleDir(WHISPER_BUNDLE_NAME, opts);
  if (!root) {
    return null;
  }
  const hub = path.join(root, WHISPER_HUB_SUBDIR);
  return existsSync(hub) ? root : null;
}

/**
 * Mirror every weight file from `bundleDir` into the user-managed
 * separator shadow folder using symlinks (or hard links / copies as
 * fallback). Files already present are left untouched, so re-running on
 * every boot is cheap.
 *
 * Returns the number of files newly added to the shadow folder.
 */
export function seedBundledSeparator(bundleDirPath: string, targetDir: string): number {
  if (!existsSync(bundleDirPath)) {
    return 0;
  }
  mkdirSync(targetDir, { recursive: true });
  let added = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(bundleDirPath);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!MODEL_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      continue;
    }
    const src = path.join(bundleDirPath, entry);
    const dst = path.join(targetDir, entry);
    if (existsSync(dst)) {
      continue;
    }
    try {
      symlinkSync(src, dst);
      added += 1;
      continue;
    } catch {
      // Fall through to hard link / copy.
    }
    try {
      linkSync(src, dst);
      added += 1;
      continue;
    } catch {
      // Fall through to copy.
    }
    try {
      copyFileSync(src, dst);
      added += 1;
    } catch {
      // Best-effort — a single failure shouldn't poison the rest.
    }
  }
  return added;
}

export interface SeedWhisperResult {
  /** Absolute path of the writable HF cache directory (or `null` on failure). */
  hfHomeDir: string | null;
  /** Whether files were copied during this call (false if already seeded). */
  copied: boolean;
}

/**
 * Mirror a read-only bundled HF cache (under `<bundle>/hub/`) into a
 * writable user-data folder so faster-whisper's runtime cache writes
 * (lock files, ETag metadata, partial fetches) don't fail on the
 * read-only DMG-bundled copy.
 *
 * Idempotent: existing files are NOT re-copied. The bundled cache only
 * contains the model snapshot + blobs we shipped; faster-whisper may
 * later pull additional files (vocab / config updates), which land in
 * the user-data copy where they belong.
 */
export function seedBundledWhisperCache(bundleHfHome: string, targetHfHome: string): SeedWhisperResult {
  if (!existsSync(bundleHfHome)) {
    return { hfHomeDir: null, copied: false };
  }
  mkdirSync(targetHfHome, { recursive: true });
  const bundleHub = path.join(bundleHfHome, WHISPER_HUB_SUBDIR);
  const targetHub = path.join(targetHfHome, WHISPER_HUB_SUBDIR);
  if (!existsSync(bundleHub)) {
    return { hfHomeDir: targetHfHome, copied: false };
  }
  let copied = false;
  let entries: string[] = [];
  try {
    entries = readdirSync(bundleHub);
  } catch {
    return { hfHomeDir: targetHfHome, copied: false };
  }
  mkdirSync(targetHub, { recursive: true });
  for (const entry of entries) {
    if (!entry.startsWith("models--")) {
      continue;
    }
    const src = path.join(bundleHub, entry);
    const dst = path.join(targetHub, entry);
    if (existsSync(dst)) {
      continue;
    }
    try {
      // `cpSync` with `dereference: true` materialises any symlinks the
      // bundled cache may carry (HF's snapshot dir uses relative
      // symlinks pointing into `blobs/`), so the user-data copy is
      // self-contained even if the bundled folder later becomes
      // unreadable (e.g. app update replaces it).
      cpSync(src, dst, { recursive: true, dereference: true, errorOnExist: false, force: false });
      copied = true;
    } catch {
      // Best-effort.
    }
  }
  return { hfHomeDir: targetHfHome, copied };
}

/** Total size in bytes of every regular file under `dir`. Returns 0 on error. */
export function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      try {
        const link = lstatSync(full);
        if (link.isSymbolicLink()) {
          // Skip — symlinks point at storage we already counted (or at
          // an external file we don't want to charge against the bundle).
          continue;
        }
        if (link.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (link.isFile()) {
          total += statSync(full).size;
        }
      } catch {
        // Skip unreadable entries.
      }
    }
  }
  return total;
}
