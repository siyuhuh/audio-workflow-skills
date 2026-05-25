import type {
  GeneratedAsset,
  GeneratedAssetRole,
  PlaybackBundle,
  RecordingPackage,
  WorkflowMode
} from "./types.js";

/**
 * Stable identity for a song package. Allows dedup across:
 *  - the same YouTube/Bilibili URL imported twice
 *  - a backing-track rerun on the existing package
 *  - the same local file dropped twice
 *
 * The `key` is the canonical id used for grouping. `origin` and `rawInput`
 * are kept for display and diagnostics.
 */
export interface PackageSourceKey {
  /** Examples: "youtube:dQw4w9WgXcQ", "local:/abs/path/audio.mp3", "sample:bohemian". */
  key: string;
  origin: "youtube" | "bilibili" | "local" | "sample" | "url";
  rawInput: string;
}

export interface PackageAsset extends GeneratedAsset {
  /** Always set in the manifest; legacy filename heuristics only run during migration. */
  role: GeneratedAssetRole;
  bytes?: number;
  writtenAt?: string;
}

/**
 * Per-package manifest written to `<outputDir>/manifest.json` after every job.
 *
 * The manifest is the source of truth for history, asset roles, playback
 * bundle, and recordings. The legacy directory-scan path remains as fallback
 * for pre-manifest packages until they are migrated on first read.
 */
export interface PackageManifest {
  /** Bump when the schema changes in a non-additive way. */
  version: 1;
  packageId: string;
  packageType: "songPackage";
  sourceKey: PackageSourceKey;
  workflowMode: WorkflowMode;
  title: string;
  artist?: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  outputDir: string;
  /** Original media URL when the source was a URL, otherwise null. */
  sourceUrl: string | null;
  assets: PackageAsset[];
  playbackBundle: PlaybackBundle;
  /** Linked recording packages (vocal takes, mix, exports). */
  recordings?: RecordingPackage[];
  /**
   * Free-form per-package metadata for future features
   * (preset name, language confidence, whisper model used, etc.).
   */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Filename inside the package output directory. */
export const PACKAGE_MANIFEST_FILE = "manifest.json";

/** Schema version produced by current writers. */
export const PACKAGE_MANIFEST_VERSION = 1 as const;
