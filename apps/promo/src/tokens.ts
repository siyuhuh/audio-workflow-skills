/** VocalFlow brand tokens — aligned with DESIGN.md sage industrial palette */
export const tokens = {
  sageBg: "#b5c4ad",
  sageCard: "#c8d4c0",
  foreground: "#3a4236",
  foregroundMuted: "#5c6658",
  primary: "#d17a4f",
  roomInk: "#1e221c",
  roomPanel: "#55624e",
  sageAccent: "#92a688",
  rule: "rgba(58, 66, 54, 0.28)",
  white: "#f5f7f2",
} as const;

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif',
  mono: '"SF Mono", "Cascadia Code", "JetBrains Mono", monospace',
} as const;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION_FRAMES = 45 * FPS;
