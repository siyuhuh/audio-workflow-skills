import type { GeneratedAsset } from "../../shared/types.js";

export function partialPlaybackAssets(
  assets: GeneratedAsset[],
  state: { karaoke: boolean; separationComplete: boolean; exitCode: number | null; signal: string | null }
): GeneratedAsset[] {
  if (!state.karaoke || !state.separationComplete || state.signal !== null || state.exitCode === null || state.exitCode === 0) return [];
  // Only keep stem audio for a partial package. A failed writer may have left
  // incomplete lyrics, and an original mix alone is not a ready backing track.
  const stems = assets.filter((asset) => asset.exists && (asset.role === "backing" || asset.role === "vocal")
    && /^(mp3|wav|m4a|flac|ogg|opus|aac|aiff|aif)$/i.test(asset.extension));
  return stems.some((asset) => asset.role === "backing") ? stems : [];
}
