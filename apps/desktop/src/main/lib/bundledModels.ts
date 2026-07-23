import {
  existsSync,
  mkdirSync,
  readdirSync,
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
 *   <resourcesPath>/whisper-models/
 *     └── small/
 *         ├── config.json
 *         ├── model.bin
 *         ├── tokenizer.json
 *         └── vocabulary.txt
 *
 * The direct model layout avoids shipping Hugging Face's blob and snapshot
 * copies of the same 461 MB weight. The Python pipeline resolves a matching
 * model through `VOCALFLOW_WHISPER_MODEL_DIR`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEPARATOR_BUNDLE_NAME = "separator-models";
const WHISPER_BUNDLE_NAME = "whisper-models";

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
 * Folder containing direct faster-whisper model directories such as `small/`.
 * Returns `null` when no Whisper bundle was shipped.
 */
export function bundledWhisperModelsDir(opts: ResourcePathOpts): string | null {
  return bundleDir(WHISPER_BUNDLE_NAME, opts);
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
