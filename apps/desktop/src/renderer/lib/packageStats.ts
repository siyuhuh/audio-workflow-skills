import type { GeneratedAsset, PlaybackBundle, SavedJobHistory } from "../../shared/types";

export interface PackageGroup {
  entry: SavedJobHistory;
  duplicateIds: string[];
}

export interface PackageStats {
  totalPackages: number;
  karaokePackages: number;
  subtitlePackages: number;
  byKey: Map<string, PackageGroup>;
  shelfList: PackageGroup[];
  featured: PackageGroup | null;
}

/**
 * Single source of truth for package grouping, counting, shelf order, and
 * the featured pick.
 *
 * Grouping key resolution mirrors the legacy logic in App.tsx exactly:
 *  - normalized sourceUrl when present
 *  - sample id when entry is a bundled sample
 *  - normalized title fallback otherwise
 */
export function derivePackageStats(history: SavedJobHistory[]): PackageStats {
  const karaokeEntries = history.filter((entry) => entry.workflowMode === "karaoke");
  const subtitleEntries = history.filter((entry) => entry.workflowMode === "subtitle");

  const grouped = new Map<string, SavedJobHistory[]>();
  for (const entry of karaokeEntries) {
    const key = resolvePackageKey(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  const sortedGroupEntries = [...grouped.entries()]
    .map<[string, PackageGroup]>(([key, entries]) => [
      key,
      {
        entry: mergeClientHistoryEntries(entries),
        duplicateIds: entries.map((groupEntry) => groupEntry.id)
      }
    ])
    .sort(([, left], [, right]) => comparePackageGroups(left, right));

  const byKey = new Map<string, PackageGroup>();
  for (const [key, group] of sortedGroupEntries) {
    byKey.set(key, group);
  }

  const allKaraokeGroups = sortedGroupEntries.map(([, group]) => group);
  const processed = allKaraokeGroups.slice(0, 6);
  const userPackages = processed.filter((group) => !isSampleHistoryEntry(group.entry));
  const samplePackages = processed.filter((group) => isSampleHistoryEntry(group.entry));
  const featured = userPackages[0] ?? samplePackages[0] ?? null;
  const shelfList = processed.filter((group) => group !== featured);

  return {
    totalPackages: byKey.size + subtitleEntries.length,
    karaokePackages: byKey.size,
    subtitlePackages: subtitleEntries.length,
    byKey,
    shelfList,
    featured
  };
}

export function isSampleHistoryEntry(entry: SavedJobHistory): boolean {
  return entry.input.startsWith("sample:") || entry.id.startsWith("sample:");
}

export function resolvePackageKey(entry: SavedJobHistory): string {
  const sourceUrl = entry.sourceUrl || sourceUrlForKey(entry.input);
  if (sourceUrl) {
    return `url:${normalizeSourceUrlForKey(sourceUrl)}`;
  }

  const input = entry.input.trim();
  if (input.startsWith("sample:")) {
    return input.toLowerCase();
  }

  const mediaKey = reviewMediaFamilyKey(entry);
  if (mediaKey) {
    return `media:${mediaKey}`;
  }

  const titleKey = mediaFamilyKeyFromName(reviewDisplayTitle(entry));
  return titleKey ? `title:${titleKey}` : clientHistoryPackageKey(entry);
}

export function clientHistoryPackageKey(entry: SavedJobHistory): string {
  const sourceUrl = entry.sourceUrl || sourceUrlForKey(entry.input);
  if (sourceUrl) {
    return `url:${normalizeSourceUrlForKey(sourceUrl)}`;
  }

  const input = entry.input.trim();
  if (input.startsWith("sample:")) {
    return input.toLowerCase();
  }
  if (input && !sourceUrlForKey(input)) {
    return `file:${input.replace(/\\/g, "/").toLowerCase()}`;
  }

  const mediaCandidate =
    entry.playbackBundle.localAudioPath ??
    entry.playbackBundle.localVideoPath ??
    entry.primaryMedia ??
    entry.primarySubtitle ??
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem"))?.path ??
    "";
  const mediaKey = mediaCandidate ? mediaFamilyKeyFromName(mediaCandidate) : "";
  return mediaKey ? `media:${mediaKey}` : `input:${input.toLowerCase()}`;
}

export function sourceUrlForKey(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeSourceUrlForKey(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "youtu.be") {
      return `youtube:${url.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    }
    if (hostname.endsWith("youtube.com")) {
      const videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ??
        "";
      return videoId ? `youtube:${videoId}` : `${hostname}${url.pathname}`;
    }
    if (hostname.endsWith("bilibili.com") || hostname === "b23.tv") {
      const biliId = url.pathname.match(/\/video\/([^/?#]+)/)?.[1] ?? url.pathname.split("/").filter(Boolean)[0] ?? "";
      return biliId ? `bilibili:${biliId.toLowerCase()}` : `${hostname}${url.pathname}`;
    }
    return `${hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function reviewDisplayTitle(entry: SavedJobHistory): string {
  if (entry.title?.trim()) {
    return entry.title.trim();
  }

  const assetTitle = titleFromAssets(entry.assets);
  if (assetTitle) {
    return assetTitle;
  }

  const mediaPath =
    entry.playbackBundle.localAudioPath ??
    entry.playbackBundle.localVideoPath ??
    entry.primaryMedia ??
    entry.assets.find((asset) => asset.type === "media" || asset.type === "stem")?.path ??
    "";
  const mediaTitle = titleFromPath(mediaPath);
  if (mediaTitle) {
    return mediaTitle;
  }

  const sourceLabel = sourceHostLabel(entry.sourceUrl || entry.input);
  return sourceLabel ?? shortInputLabel(entry.input);
}

export function titleFromAssets(assets: GeneratedAsset[]): string | null {
  const rankedAssets = [
    assets.find((asset) => asset.role === "original" && asset.exists),
    assets.find((asset) => asset.type === "media" && asset.role !== "preview" && asset.exists),
    assets.find((asset) => asset.type === "stem" && asset.role === "backing" && asset.exists),
    assets.find((asset) => asset.type === "stem" && asset.exists),
    assets.find((asset) => asset.type === "subtitle" && asset.role !== "transcribe" && asset.exists),
    assets.find((asset) => asset.type === "subtitle" && asset.exists)
  ].filter((asset): asset is GeneratedAsset => Boolean(asset));

  for (const asset of rankedAssets) {
    const title = cleanMediaTitle(asset.name);
    if (title) {
      return title;
    }
  }

  return null;
}

export function titleFromPath(filePath: string): string | null {
  if (!filePath) {
    return null;
  }
  const filename = filePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? filePath;
  return cleanMediaTitle(filename);
}

export function cleanMediaTitle(name: string): string | null {
  const withoutExtension = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  const withoutModelSuffix = withoutExtension.replace(/[_\s-]+model[_-].*$/i, "");
  const withoutRoleSuffix = withoutModelSuffix
    .replace(/[_\s-]*\((?:instrumental|vocals?|voice|acapella|no vocals)[^)]*\)\s*$/i, "")
    .replace(/[_\s-]+(?:instrumental|vocals?|voice|acapella|preview|transcribe|subtitle|audio|video)$/i, "");
  const withoutPlatformId = withoutRoleSuffix.replace(/\s*\[[^\]]{6,}\]\s*$/i, "");
  const normalized = withoutPlatformId.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function sourceHostLabel(input: string): string | null {
  if (!input.trim()) {
    return null;
  }
  try {
    const hostname = new URL(input).hostname.replace(/^www\./, "");
    if (/youtu\.be|youtube\.com/i.test(hostname)) {
      return "YouTube";
    }
    if (/bilibili\.com|b23\.tv/i.test(hostname)) {
      return "Bilibili";
    }
    return hostname;
  } catch {
    return null;
  }
}

export function shortInputLabel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "Untitled";
  }
  try {
    const url = new URL(trimmed);
    return url.hostname.replace(/^www\./, "") + url.pathname;
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).at(-1) ?? trimmed;
  }
}

export function reviewMediaFamilyKey(entry: SavedJobHistory): string {
  const candidates = [
    entry.playbackBundle.localAudioPath,
    entry.primaryMedia,
    entry.primarySubtitle,
    entry.assets.find((asset) => asset.exists && asset.role === "original")?.name,
    entry.assets.find((asset) => asset.exists && asset.type === "media" && asset.role !== "preview")?.name
  ];

  for (const candidate of candidates) {
    const key = candidate ? mediaFamilyKeyFromName(candidate) : "";
    if (key) {
      return key;
    }
  }

  return "";
}

export function mediaFamilyKeyFromName(nameOrPath: string): string {
  const filename = nameOrPath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? nameOrPath;
  const title = cleanMediaTitle(filename);
  return title
    ? title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
        .trim()
    : "";
}

export function packageVideoPathForReview(entry: SavedJobHistory | null): string | null {
  if (!entry) {
    return null;
  }

  return (
    entry.playbackBundle.videoPreviewPath ??
    (entry.playbackBundle.localVideoPath && isVideoPath(entry.playbackBundle.localVideoPath) ? entry.playbackBundle.localVideoPath : null) ??
    entry.assets.find((asset) => asset.exists && asset.role === "preview" && isVideoPath(asset.path))?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && asset.role === "original" && isVideoPath(asset.path))?.path ??
    entry.assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && asset.role !== "preview" && isVideoPath(asset.path))?.path ??
    null
  );
}

export function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
}

export function isPreviewVideoPath(filePath: string): boolean {
  return isVideoPath(filePath) && /\.preview\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath);
}

function mergeClientHistoryEntries(entries: SavedJobHistory[]): SavedJobHistory {
  const best = entries.reduce((current, entry) => (resourceEntryScore(entry) > resourceEntryScore(current) ? entry : current));
  const assets = uniqueClientAssets(entries.flatMap((entry) => entry.assets));
  const generatedFiles = uniqueStrings(entries.flatMap((entry) => entry.generatedFiles));
  const bestPlaybackBundle = entries.map((entry) => entry.playbackBundle).sort((left, right) => playbackBundleScore(right) - playbackBundleScore(left))[0] ?? best.playbackBundle;

  return {
    ...best,
    assets,
    generatedFiles,
    title: best.title ?? entries.find((entry) => entry.title)?.title,
    sourceUrl: best.sourceUrl ?? entries.find((entry) => entry.sourceUrl)?.sourceUrl ?? null,
    primarySubtitle: best.primarySubtitle ?? assets.find((asset) => asset.exists && asset.type === "subtitle")?.path ?? null,
    primaryMedia: best.primaryMedia ?? assets.find((asset) => asset.exists && (asset.type === "media" || asset.type === "stem") && !isPreviewVideoPath(asset.path))?.path ?? null,
    playbackBundle: bestPlaybackBundle
  };
}

function uniqueClientAssets(assets: GeneratedAsset[]): GeneratedAsset[] {
  const byPath = new Map<string, GeneratedAsset>();
  for (const asset of assets) {
    const key = asset.path.replace(/\\/g, "/").toLowerCase();
    byPath.set(key, { ...byPath.get(key), ...asset });
  }
  return [...byPath.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function resourceEntryScore(entry: SavedJobHistory): number {
  const hasPlayableLyrics = entry.playbackBundle.controllable && Boolean(entry.primarySubtitle);
  const hasVideo = Boolean(packageVideoPathForReview(entry));
  const hasStems = entry.assets.some((asset) => asset.exists && (asset.role === "backing" || asset.role === "vocal"));
  return Number(hasPlayableLyrics) * 100 + Number(entry.playbackBundle.controllable) * 60 + Number(entry.primarySubtitle) * 20 + Number(hasStems) * 10 + Number(hasVideo) * 5 + Date.parse(entry.createdAt) / 1000000000000;
}

function playbackBundleScore(bundle: PlaybackBundle): number {
  return Number(Boolean(bundle.localAudioPath)) * 100 + Number(Boolean(bundle.videoPreviewPath)) * 20 + Number(Boolean(bundle.localVideoPath)) * 50 + Number(bundle.controllable) * 10;
}

function comparePackageGroups(left: PackageGroup, right: PackageGroup): number {
  const yesterdayDelta = Number(isYesterdayPackage(right.entry)) - Number(isYesterdayPackage(left.entry));
  if (yesterdayDelta !== 0) {
    return yesterdayDelta;
  }

  const sampleDelta = Number(right.entry.input.startsWith("sample:")) - Number(left.entry.input.startsWith("sample:"));
  if (sampleDelta !== 0) {
    return sampleDelta;
  }

  return Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt);
}

function isYesterdayPackage(entry: SavedJobHistory): boolean {
  return entry.input.toLowerCase() === "sample:yesterday" || mediaFamilyKeyFromName(reviewDisplayTitle(entry)) === "yesterday";
}
