import { cn } from "../lib/cn";
import type { JobStreamSnapshot } from "../lib/jobStream";
import { formatClock } from "../lib/lyrics";
import type { Translator } from "../lib/types";

interface LiveJobStatusProps {
  job: JobStreamSnapshot | null;
  t: Translator;
}

const stateLabelClasses = {
  queued: "text-muted-foreground",
  running: "text-primary",
  succeeded: "text-success",
  failed: "text-danger"
} as const;

const stateDotClasses = {
  queued: "bg-muted-foreground/60",
  running: "bg-primary",
  succeeded: "bg-success",
  failed: "bg-danger"
} as const;

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function LiveJobStatus({ job, t }: LiveJobStatusProps) {
  if (!job) {
    return null;
  }

  if (job.status === "succeeded" && Date.now() - job.updatedAt > 60_000) {
    return null;
  }

  const stageLabel = job.currentStage
    ? t(`capture:jobStream.stage.${job.currentStage}`)
    : t("capture:jobStream.status.queued");
  const statusLabel = t(`capture:jobStream.status.${job.status}`);
  const isIndeterminate = job.progress < 0;
  const fraction = clampFraction(job.progress);
  const percentLabel = `${Math.round(fraction * 100)}%`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-status={job.status}
      className="grid gap-2 rounded-lg border border-border bg-elevated p-3 shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 flex-none rounded-full",
            stateDotClasses[job.status],
            job.status === "running" && isIndeterminate ? "animate-pulse" : ""
          )}
        />
        <span
          className={cn(
            "truncate text-xs font-semibold uppercase tracking-wide",
            stateLabelClasses[job.status]
          )}
        >
          {job.status === "running" || job.status === "queued" ? stageLabel : statusLabel}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-3 text-xs font-medium text-muted-foreground">
          {(job.status === "running" || job.status === "queued") && job.message ? (
            <span className="min-w-0 truncate" title={job.message}>
              {job.message}
            </span>
          ) : null}
          {(job.status === "running" || job.status === "queued") && job.etaSec !== null && job.etaSec !== undefined ? (
            <span className="flex-none whitespace-nowrap text-faint">
              {t("capture:jobStream.etaPrefix")} {formatClock(job.etaSec)}
            </span>
          ) : null}
          {(job.status === "running" || job.status === "queued") && !isIndeterminate ? (
            <span className="flex-none whitespace-nowrap tabular-nums text-faint">
              {percentLabel}
            </span>
          ) : null}
        </div>
      </div>

      {job.status === "running" || job.status === "queued" ? (
        <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
          {isIndeterminate ? (
            <span className="block h-full w-full animate-pulse bg-primary/40" />
          ) : (
            <span
              className="block h-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
