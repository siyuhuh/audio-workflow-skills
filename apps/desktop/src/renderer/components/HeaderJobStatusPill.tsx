import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import type { JobStreamSnapshot } from "../lib/jobStream";
import type { Translator } from "../lib/types";

interface HeaderJobStatusPillProps {
  job: JobStreamSnapshot | null;
  t: Translator;
  /** Called when the user clicks the pill — typically scrolls to the inline LiveJobStatus. */
  onActivate?: () => void;
}

/**
 * How long terminal pills linger in the brand header before fading out.
 * Failure stays longer than success because the user often wants a moment
 * to react ("retry / open log") before the chrome empties.
 *
 * Note: the underlying snapshot eviction in `jobStream.ts` runs at 60 s;
 * the pill clears earlier via these thresholds and the timer below.
 */
const SUCCESS_HIDE_MS = 6_000;
const FAILURE_HIDE_MS = 12_000;

const DOT_CLASSES = {
  queued: "bg-muted-foreground/60",
  running: "bg-primary",
  succeeded: "bg-success",
  failed: "bg-danger"
} as const;

const LABEL_CLASSES = {
  queued: "text-muted-foreground",
  running: "text-foreground",
  succeeded: "text-success",
  failed: "text-danger"
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

export function HeaderJobStatusPill({ job, t, onActivate }: HeaderJobStatusPillProps) {
  // Tick state used purely to re-render once the auto-fade window has
  // elapsed. We only schedule a timer when the snapshot is in a terminal
  // state, so idle/running pills stay event-driven.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!job) {
      return;
    }
    if (job.status !== "succeeded" && job.status !== "failed") {
      return;
    }
    const threshold = job.status === "succeeded" ? SUCCESS_HIDE_MS : FAILURE_HIDE_MS;
    const remaining = threshold - (Date.now() - job.updatedAt);
    if (remaining <= 0) {
      return;
    }
    const handle = window.setTimeout(() => {
      setNowTick((value) => value + 1);
    }, remaining);
    return () => {
      window.clearTimeout(handle);
    };
  }, [job?.status, job?.updatedAt]);

  if (!job) {
    return null;
  }
  if (job.status === "succeeded" && Date.now() - job.updatedAt > SUCCESS_HIDE_MS) {
    return null;
  }
  if (job.status === "failed" && Date.now() - job.updatedAt > FAILURE_HIDE_MS) {
    return null;
  }

  const stageLabel = job.currentStage
    ? t(`capture:jobStream.stage.${job.currentStage}`)
    : t("capture:jobStream.status.queued");
  const statusLabel = t(`capture:jobStream.status.${job.status}`);
  const isRunning = job.status === "running" || job.status === "queued";
  const isIndeterminate = job.progress < 0;
  const fraction = clampFraction(job.progress);
  const percentLabel = isRunning && !isIndeterminate ? `${Math.round(fraction * 100)}%` : null;
  const visibleLabel = isRunning ? stageLabel : statusLabel;
  const ariaLabel = `${visibleLabel}${percentLabel ? ` ${percentLabel}` : ""}`;

  return (
    <button
      type="button"
      className="brandStatusPill"
      data-status={job.status}
      onClick={onActivate}
      aria-label={ariaLabel}
      title={job.message ?? ariaLabel}
    >
      <span
        aria-hidden="true"
        className={cn(
          "brandStatusPillDot",
          DOT_CLASSES[job.status],
          isRunning && isIndeterminate ? "animate-pulse" : ""
        )}
      />
      <span className={cn("brandStatusPillLabel", LABEL_CLASSES[job.status])}>
        {visibleLabel}
      </span>
      {percentLabel ? (
        <span className="brandStatusPillPercent tabular-nums">{percentLabel}</span>
      ) : null}
    </button>
  );
}
