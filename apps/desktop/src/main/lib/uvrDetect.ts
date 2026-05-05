import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

/**
 * Auto-detect an Ultimate Vocal Remover (UVR) install on the host and
 * "flatten" its categorised models tree into a shadow folder that
 * `audio-separator --model_file_dir <dir>` can consume directly.
 *
 * UVR ships its weight files in subfolders (`MDX_Net_Models/`,
 * `VR_Models/`, `Demucs_Models/`, `MDXC_Models/`), but `audio-separator`
 * looks for `<model_file_dir>/<filename>` without recursion. We bridge the
 * gap by symlinking every model file from UVR's subfolders into a single
 * managed directory under the desktop app's userData. Symlinks are
 * zero-copy (no GB-scale duplication of model weights) and re-running the
 * sync is idempotent.
 */

const UVR_MODEL_EXTENSIONS = new Set([".onnx", ".pth", ".ckpt"]);
const UVR_MODEL_SUBDIRS = ["MDX_Net_Models", "VR_Models", "Demucs_Models", "MDXC_Models"];

/**
 * Models we explicitly try to use when the user's local folder contains
 * one. Order matters: highest-quality first.
 *
 * - `model_bs_roformer_ep_317_sdr_12.9755.ckpt` — audio-separator's
 *   built-in default in v0.44+. Listed first because it's what the CLI
 *   would otherwise try to download from HF Hub on first run.
 * - `UVR-MDX-NET-Voc_FT.onnx` — vocal-finetuned MDX-Net, very common
 *   high-quality choice for singing voice.
 * - `UVR-MDX-NET-Inst_HQ_3` / `_2` — strong instrumental MDX-Nets that
 *   ship as defaults in many UVR installs.
 *
 * Hard-coding this list (rather than parsing audio-separator's model
 * registry) keeps the desktop independent of the CLI version.
 */
const PREFERRED_SEPARATOR_MODELS: readonly string[] = [
  "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
  "UVR-MDX-NET-Voc_FT.onnx",
  "UVR-MDX-NET-Inst_HQ_3.onnx",
  "UVR-MDX-NET-Inst_HQ_2.onnx",
  "UVR-MDX-NET-Inst_3.onnx",
  "Kim_Vocal_2.onnx",
  "Kim_Inst.onnx"
];

/** Platform-specific candidate paths for the UVR `models/` root. */
function uvrCandidatePaths(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Ultimate Vocal Remover.app/Contents/Resources/models",
      path.join(homedir(), "Applications/Ultimate Vocal Remover.app/Contents/Resources/models")
    ];
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Ultimate Vocal Remover\\models",
      "C:\\Program Files (x86)\\Ultimate Vocal Remover\\models"
    ];
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(path.join(localAppData, "Programs", "UltimateVocalRemoverGUI", "models"));
    }
    return candidates;
  }
  return [
    path.join(homedir(), ".local/share/UltimateVocalRemoverGUI/models"),
    path.join(homedir(), "UltimateVocalRemoverGUI/models"),
    "/opt/UltimateVocalRemoverGUI/models"
  ];
}

/** True iff `dir` is a UVR-style models root with at least one weight file. */
function looksLikeUvrModelsRoot(dir: string): boolean {
  if (!existsSync(dir)) {
    return false;
  }
  for (const subdir of UVR_MODEL_SUBDIRS) {
    const subdirPath = path.join(dir, subdir);
    if (!existsSync(subdirPath)) {
      continue;
    }
    try {
      const entries = readdirSync(subdirPath);
      if (entries.some((name) => UVR_MODEL_EXTENSIONS.has(path.extname(name).toLowerCase()))) {
        return true;
      }
    } catch {
      // Unreadable subdir — keep scanning others.
    }
  }
  return false;
}

/**
 * Scan candidate paths and return the first one that looks like a populated
 * UVR install. Returns `null` when UVR is not installed (or contains no
 * downloaded models yet — UVR's first launch defers downloads until the
 * user picks a model, so an empty `models/` tree is treated as "no UVR").
 */
export function detectUvrModelsRoot(): string | null {
  for (const candidate of uvrCandidatePaths()) {
    if (looksLikeUvrModelsRoot(candidate)) {
      return candidate;
    }
  }
  return null;
}

export interface UvrSyncResult {
  /** Flat target directory `audio-separator --model_file_dir` can use. */
  targetDir: string;
  /** Number of model files now reachable via flat symlinks (incl. preexisting). */
  modelCount: number;
  /** Files newly linked during this sync (excludes already-present links). */
  newlyLinked: number;
  /** Dangling links removed during this sync. */
  prunedDangling: number;
}

/**
 * Resolve the shadow directory we manage on the user's behalf. Lives under
 * the Electron `userData` so an app uninstall + reinstall doesn't leave
 * orphan files in `/Applications/...`.
 */
export function vocalflowManagedSeparatorDir(userDataDir: string): string {
  return path.join(userDataDir, "separator-models", "uvr-link");
}

/**
 * Mirror every weight file under `uvrRoot/<subdir>/*.{onnx,pth,ckpt}` into
 * a flat `targetDir`, using symlinks (or hard links as a fallback when
 * symlinks are unavailable, e.g. NTFS without developer mode).
 *
 * - Idempotent: re-runs are cheap; preexisting valid links are kept.
 * - Self-healing: dangling links (UVR uninstalled / model deleted) are
 *   pruned before the new pass, so a stale shadow dir converges back to
 *   reality.
 */
export function syncUvrShadowFolder(uvrRoot: string, targetDir: string): UvrSyncResult {
  mkdirSync(targetDir, { recursive: true });

  let prunedDangling = 0;
  for (const entry of readdirSync(targetDir)) {
    const linkPath = path.join(targetDir, entry);
    try {
      const stat = lstatSync(linkPath);
      // Only manage files we created (symlinks/hard links). Ignore plain
      // files in case the user dropped extra weights into the folder.
      if (stat.isSymbolicLink() && !existsSync(linkPath)) {
        rmSync(linkPath, { force: true });
        prunedDangling += 1;
      }
    } catch {
      // Best-effort cleanup; ignore unreadable entries.
    }
  }

  let newlyLinked = 0;
  for (const subdir of UVR_MODEL_SUBDIRS) {
    const subdirPath = path.join(uvrRoot, subdir);
    if (!existsSync(subdirPath)) {
      continue;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(subdirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!UVR_MODEL_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
        continue;
      }
      const src = path.join(subdirPath, entry);
      const dst = path.join(targetDir, entry);
      if (existsSync(dst)) {
        continue;
      }
      try {
        symlinkSync(src, dst);
        newlyLinked += 1;
      } catch {
        try {
          linkSync(src, dst);
          newlyLinked += 1;
        } catch {
          // Symlink + hard link both unavailable. Skip; user can still copy
          // the file in manually or fall back to the HF download path.
        }
      }
    }
  }

  let modelCount = 0;
  try {
    modelCount = readdirSync(targetDir).filter((name) =>
      UVR_MODEL_EXTENSIONS.has(path.extname(name).toLowerCase())
    ).length;
  } catch {
    modelCount = newlyLinked;
  }

  return { targetDir, modelCount, newlyLinked, prunedDangling };
}

/**
 * Pick the best-available separator model in `dir` so we can pass it to
 * `audio-separator --model_filename` explicitly.
 *
 * Why this exists: audio-separator's built-in default is
 * `model_bs_roformer_ep_317_sdr_12.9755.ckpt`. When `--model_file_dir` is
 * a UVR shadow folder that DOES NOT contain that BS-Roformer model
 * (typical UVR installs ship `UVR-MDX-NET-Inst_HQ_3.onnx` instead), the
 * CLI silently falls back to downloading the default model from HF Hub —
 * which 429s for anonymous users and times out for users on networks
 * where huggingface.co is unreachable. By scanning the dir up-front and
 * naming a model we KNOW is local, we keep the offline path honest.
 *
 * Trust ranking (highest to lowest):
 *   1. **Symlinks** — these always point at a UVR install (which UVR
 *      validated on download). If audio-separator can't load them, the
 *      problem is in audio-separator / the file format, not data
 *      integrity.
 *   2. **Plain files >= 5 MB** — likely a complete download from a
 *      previous run. Genuine separator weights are ~50 MB to ~600 MB;
 *      anything tiny is almost certainly a partial download or stub.
 *
 * We deliberately skip plain files when symlinks are available: a
 * partial download by audio-separator (network blip, killed process,
 * corrupted on-disk archive) shows up as a same-name plain file and
 * causes `PytorchStreamReader failed reading zip archive` on every
 * subsequent run until the user manually deletes it. UVR symlinks
 * sidestep that entire failure mode.
 *
 * Preference order within a trust tier:
 *   1. Audio-separator's built-in default (best quality if local).
 *   2. Common high-quality MDX-Net checkpoints.
 *   3. Any other `.onnx` (most version-stable across audio-separator
 *      releases — Roformer/.ckpt loaders shift between versions).
 *   4. Any `.ckpt` then any `.pth`.
 */
export function pickPreferredSeparatorModel(dir: string): string | null {
  if (!dir || !existsSync(dir)) {
    return null;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const symlinked = new Set<string>();
  const plainValid = new Set<string>();

  for (const entry of entries) {
    if (!UVR_MODEL_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      continue;
    }
    const full = path.join(dir, entry);
    try {
      const link = lstatSync(full);
      if (link.isSymbolicLink()) {
        // Skip dangling symlinks (UVR uninstalled or model deleted).
        if (existsSync(full)) {
          symlinked.add(entry);
        }
        continue;
      }
      if (link.isFile()) {
        // Real separator weights are tens of megabytes minimum. Anything
        // smaller is almost certainly a partial download / corrupt file
        // (audio-separator's "download model" path leaves these behind on
        // network failure and then refuses to load them on next run).
        if (link.size >= 5 * 1024 * 1024) {
          plainValid.add(entry);
        }
      }
    } catch {
      // Skip unreadable entries.
    }
  }

  const tryTier = (set: ReadonlySet<string>): string | null => {
    for (const candidate of PREFERRED_SEPARATOR_MODELS) {
      if (set.has(candidate)) {
        return candidate;
      }
    }
    const onnx = [...set].find((name) => name.toLowerCase().endsWith(".onnx"));
    if (onnx) {
      return onnx;
    }
    const ckpt = [...set].find((name) => name.toLowerCase().endsWith(".ckpt"));
    if (ckpt) {
      return ckpt;
    }
    const pth = [...set].find((name) => name.toLowerCase().endsWith(".pth"));
    if (pth) {
      return pth;
    }
    return null;
  };

  return tryTier(symlinked) ?? tryTier(plainValid);
}

/**
 * Best-effort cleanup of obvious garbage in the shadow folder:
 *
 * - **Tiny plain files** that match a model extension are almost certainly
 *   partial downloads from a killed audio-separator run; they would
 *   trigger `PytorchStreamReader failed reading zip archive` on every
 *   subsequent run until removed.
 *
 * Files larger than the threshold are left alone (they may be valid
 * downloads from a previous successful run, even if the picker prefers
 * symlinks over them). Symlinks are never touched here — `syncUvrShadowFolder`
 * already prunes dangling links separately.
 *
 * Returns the number of files removed.
 */
export function cleanupCorruptDownloads(dir: string): number {
  if (!dir || !existsSync(dir)) {
    return 0;
  }
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!UVR_MODEL_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      continue;
    }
    const full = path.join(dir, entry);
    try {
      const link = lstatSync(full);
      if (link.isSymbolicLink()) {
        continue;
      }
      if (link.isFile() && link.size < 5 * 1024 * 1024) {
        rmSync(full, { force: true });
        removed += 1;
      }
    } catch {
      // Best-effort — skip unreadable files.
    }
  }
  return removed;
}

export interface UvrDetectionPayload {
  /** Absolute path to the detected UVR models root, or `null` when missing. */
  uvrRoot: string | null;
  /** Absolute path to the shadow flat folder, or `null` when sync failed. */
  linkedDir: string | null;
  /** Number of model files now reachable via the flat shadow folder. */
  modelCount: number;
  /** Files newly linked during this call. */
  newlyLinked: number;
  /** Set when this call updated `userSettings.separatorModelDir`. */
  appliedToSettings: boolean;
  /** Path the desktop app currently passes to `--separator-model-dir`. */
  currentSeparatorModelDir: string | null;
  /** Best-available model the CLI will pass to `--separator-model`, or `null`. */
  preferredModel: string | null;
}
