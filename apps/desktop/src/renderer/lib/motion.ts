export const motionEase = [0.23, 1, 0.32, 1] as const;

export const motionDuration = {
  instant: 0.01,
  fast: 0.14,
  base: 0.18,
  panel: 0.2,
  drawer: 0.22
} as const;

export type MotionDurationKey = keyof typeof motionDuration;
