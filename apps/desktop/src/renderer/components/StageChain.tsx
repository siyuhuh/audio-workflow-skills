import { cn } from "../lib/cn";
import type { Translator } from "../lib/types";

export interface StageProgress {
  name: string;
  progress: number;
  message?: string;
  done: boolean;
  failed: boolean;
}

export const PIPELINE_STAGES: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: "prepare", labelKey: "capture:stages.prepare" },
  { id: "download", labelKey: "capture:stages.download" },
  { id: "separate", labelKey: "capture:stages.separate" },
  { id: "convert", labelKey: "capture:stages.convert" },
  { id: "transcribe", labelKey: "capture:stages.transcribe" },
  { id: "write", labelKey: "capture:stages.write" },
  { id: "preview", labelKey: "capture:stages.preview" }
];

export function clampProgress(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

interface StageChainProps {
  stages: Map<string, StageProgress>;
  isRunning: boolean;
  t: Translator;
}

const stateLabelClasses = {
  pending: "text-muted-foreground",
  active: "text-primary",
  done: "text-success",
  failed: "text-danger"
} as const;

const stateFillClasses = {
  pending: "bg-muted-foreground/45",
  active: "bg-primary",
  done: "bg-success",
  failed: "bg-danger"
} as const;

export function StageChain({ stages, isRunning, t }: StageChainProps) {
  const visible = PIPELINE_STAGES.filter((stage) => stages.has(stage.id));
  if (visible.length === 0) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="polite"
      data-running={isRunning ? "true" : "false"}
      className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2 rounded-lg border border-border bg-elevated p-3 shadow-sm"
    >
      {visible.map((stage) => {
        const progress = stages.get(stage.id);
        if (!progress) {
          return null;
        }
        const fraction = clampProgress(progress.progress);
        const state = progress.failed ? "failed" : progress.done ? "done" : fraction > 0 ? "active" : "pending";
        return (
          <div key={stage.id} className="grid gap-1">
            <div
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                stateLabelClasses[state]
              )}
            >
              {t(stage.labelKey)}
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <span
                className={cn(
                  "block h-full transition-[width] duration-200 ease-out",
                  stateFillClasses[state]
                )}
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
            {progress.message ? (
              <div className="text-xs font-medium text-faint">{progress.message}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
