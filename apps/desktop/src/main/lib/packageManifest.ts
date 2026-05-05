import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PACKAGE_MANIFEST_FILE,
  PACKAGE_MANIFEST_VERSION,
  type PackageAsset,
  type PackageManifest,
  type PackageSourceKey
} from "../../shared/package-manifest.js";
import type {
  GeneratedAsset,
  GeneratedAssetRole,
  JobOptions,
  PlaybackBundle,
  RecordingPackage,
  SavedJobHistory,
  WorkflowMode
} from "../../shared/types.js";

interface BuildPackageManifestArgs {
  packageId: string;
  sourceKey: PackageSourceKey;
  options: Pick<JobOptions, "input" | "workflowMode" | "model" | "language">;
  historyEntry: Pick<
    SavedJobHistory,
    "title" | "input" | "workflowMode" | "outputDir" | "assets" | "sourceUrl" | "playbackBundle"
  >;
  /** ms epoch when the job started — used as fallback when no manifest exists yet. */
  startedAtMs: number;
  /** ms epoch when the job ended — `Date.now()` works; passed in for testability. */
  completedAtMs?: number;
  /** Optional carry-over recordings from a previous manifest (preserved across reruns). */
  recordings?: RecordingPackage[];
  /** Optional free-form metadata; merged with auto-derived fields like `whisperModel`. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Promote a renderer-facing {@link GeneratedAsset} to a {@link PackageAsset}
 * with role guaranteed and on-disk metadata (bytes + writtenAt) attached
 * when the file is reachable.
 */
function promoteAsset(asset: GeneratedAsset): PackageAsset {
  const role: GeneratedAssetRole = asset.role ?? "other";
  let bytes: number | undefined;
  let writtenAt: string | undefined;
  try {
    if (asset.exists) {
      const stats = statSync(asset.path);
      bytes = stats.size;
      writtenAt = new Date(stats.mtimeMs).toISOString();
    }
  } catch {
    // Stat failures (permission errors, race conditions) are acceptable —
    // the manifest field is optional and the renderer never requires it.
  }
  const promoted: PackageAsset = {
    path: asset.path,
    name: asset.name,
    extension: asset.extension,
    type: asset.type,
    exists: asset.exists,
    role
  };
  if (bytes !== undefined) {
    promoted.bytes = bytes;
  }
  if (writtenAt !== undefined) {
    promoted.writtenAt = writtenAt;
  }
  return promoted;
}

export function buildPackageManifest(args: BuildPackageManifestArgs): PackageManifest {
  const completedAt = args.completedAtMs ?? Date.now();
  const createdAtIso = new Date(args.startedAtMs).toISOString();
  const updatedAtIso = new Date(completedAt).toISOString();
  const playbackBundle: PlaybackBundle = args.historyEntry.playbackBundle;
  const workflowMode: WorkflowMode = args.historyEntry.workflowMode;

  const assets: PackageAsset[] = args.historyEntry.assets.map(promoteAsset);

  const metadata: Record<string, string | number | boolean | null> = {
    ...(args.metadata ?? {})
  };
  if (args.options.model && metadata.whisperModel === undefined) {
    metadata.whisperModel = args.options.model;
  }
  if (args.options.language && metadata.language === undefined) {
    metadata.language = args.options.language;
  }

  const manifest: PackageManifest = {
    version: PACKAGE_MANIFEST_VERSION,
    packageId: args.packageId,
    packageType: "songPackage",
    sourceKey: args.sourceKey,
    workflowMode,
    title: args.historyEntry.title?.trim() || titleFallback(args.historyEntry, args.sourceKey),
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    outputDir: args.historyEntry.outputDir,
    sourceUrl: args.historyEntry.sourceUrl,
    assets,
    playbackBundle
  };
  if (args.recordings && args.recordings.length > 0) {
    manifest.recordings = args.recordings;
  }
  if (Object.keys(metadata).length > 0) {
    manifest.metadata = metadata;
  }
  return manifest;
}

function titleFallback(
  entry: Pick<SavedJobHistory, "input">,
  sourceKey: PackageSourceKey
): string {
  const fromInput = entry.input?.trim();
  if (fromInput) {
    if (fromInput.startsWith("http")) {
      return sourceKey.key;
    }
    return path.basename(fromInput);
  }
  return sourceKey.key;
}

/**
 * Atomically write the package manifest. Writes to `manifest.json.tmp` first
 * then renames over the target so a process crash mid-write cannot leave a
 * truncated JSON file (which would break every subsequent history scan).
 */
export function writePackageManifest(outputDir: string, manifest: PackageManifest): void {
  if (!outputDir) {
    return;
  }
  mkdirSync(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, PACKAGE_MANIFEST_FILE);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  renameSync(tmpPath, finalPath);
}

/**
 * Defensive read — returns `null` instead of throwing when the file is
 * missing, malformed, or written by an incompatible future schema. The
 * caller is expected to fall back to legacy directory-scan behaviour.
 */
export function readPackageManifest(outputDir: string): PackageManifest | null {
  if (!outputDir) {
    return null;
  }
  const target = path.join(outputDir, PACKAGE_MANIFEST_FILE);
  if (!existsSync(target)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(target, "utf-8")) as Partial<PackageManifest>;
    if (!isManifestShape(raw)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function isManifestShape(value: Partial<PackageManifest>): value is PackageManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    value.version === PACKAGE_MANIFEST_VERSION &&
    typeof value.packageId === "string" &&
    value.packageType === "songPackage" &&
    typeof value.outputDir === "string" &&
    Array.isArray(value.assets) &&
    typeof value.playbackBundle === "object"
  );
}

/**
 * Lift the higher-fidelity fields from a `PackageManifest` onto an existing
 * `SavedJobHistory` entry. Used by the read-side migration so older
 * `history.json` rows pick up newer metadata (asset roles, playbackBundle
 * tweaks, post-yt-dlp title) without losing their identity.
 *
 * Only applied when `manifest.packageId === entry.id`. All other entries
 * are returned unchanged so multi-entry-shared `outputDir` packages don't
 * accidentally cross-pollute each other.
 *
 * The returned entry is NOT validated against disk — call sites should
 * still funnel through `refreshHistoryEntry` / `pruneHistoryAssets` to
 * drop assets that have since been deleted.
 */
export function hydrateHistoryFromManifest(
  entry: SavedJobHistory,
  manifest: PackageManifest
): SavedJobHistory {
  if (manifest.packageId !== entry.id) {
    return entry;
  }
  const assets: GeneratedAsset[] = manifest.assets.map((asset) => ({
    path: asset.path,
    name: asset.name,
    extension: asset.extension,
    type: asset.type,
    role: asset.role,
    exists: asset.exists
  }));
  return {
    ...entry,
    title: manifest.title || entry.title,
    workflowMode: manifest.workflowMode,
    outputDir: manifest.outputDir || entry.outputDir,
    assets,
    sourceUrl: manifest.sourceUrl ?? entry.sourceUrl,
    playbackBundle: manifest.playbackBundle
  };
}
