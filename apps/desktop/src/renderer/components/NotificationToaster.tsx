import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn";
import { motionDuration, motionEase } from "../lib/motion";
import {
  type Notification,
  type NotificationLevel,
  useNotifications
} from "../lib/notifications";
import { Button } from "./ui/Button";

const levelSurfaceClasses: Record<NotificationLevel, string> = {
  info: "border-border bg-card",
  success: "border-primary/50 bg-accent-soft",
  warning: "border-warning/40 bg-warning-soft",
  error: "border-danger/50 bg-danger-soft"
};

const levelIconColorClasses: Record<NotificationLevel, string> = {
  info: "text-muted-foreground",
  success: "text-primary",
  warning: "text-warning",
  error: "text-danger"
};

const levelIconPaths: Record<NotificationLevel, readonly string[]> = {
  info: [
    "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z",
    "M10 9.5v4",
    "M10 6.6v.01"
  ],
  success: [
    "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z",
    "m6.8 10 2.3 2.3L13.4 8"
  ],
  warning: [
    "M10 4 3 16.5h14L10 4Z",
    "M10 8.5v3.5",
    "M10 14.5v.01"
  ],
  error: [
    "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z",
    "M10 6.6V11",
    "M10 13.5v.01"
  ]
};

interface LevelIconProps {
  level: NotificationLevel;
  className?: string;
}

function LevelIcon({ level, className }: LevelIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={cn("size-5 flex-none", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {levelIconPaths[level].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function DismissIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="m5.5 5.5 9 9" />
      <path d="m14.5 5.5-9 9" />
    </svg>
  );
}

interface ToastItemProps {
  notification: Notification;
  reduceMotion: boolean;
  onDismiss: (id: string) => void;
  dismissLabel: string;
}

function ToastItem({ notification, reduceMotion, onDismiss, dismissLabel }: ToastItemProps) {
  const { id, level, title, body, actions } = notification;
  const isAlert = level === "warning" || level === "error";

  const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 };
  const animate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 };

  return (
    <motion.div
      layout
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={{ duration: reduceMotion ? 0 : motionDuration.base, ease: motionEase }}
      className={cn(
        "pointer-events-auto w-full max-w-[380px] rounded-lg border p-3 shadow-sm",
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3",
        levelSurfaceClasses[level]
      )}
    >
      <LevelIcon
        level={level}
        className={cn("mt-0.5", levelIconColorClasses[level])}
      />
      <div className="grid min-w-0 gap-1">
        <div className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
          {title}
        </div>
        {body ? (
          <div className="text-xs font-medium leading-normal text-muted-foreground [overflow-wrap:anywhere]">
            {body}
          </div>
        ) : null}
        {actions && actions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                onClick={() => {
                  action.onClick();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => onDismiss(id)}
        className={cn(
          "-mr-1 -mt-1 grid size-7 place-items-center self-start rounded-md",
          "text-muted-foreground transition-colors duration-150 ease-out",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        )}
      >
        <DismissIcon />
      </button>
    </motion.div>
  );
}

export function NotificationToaster() {
  const { items, dismiss } = useNotifications();
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion() ?? false;

  return (
    <div
      aria-hidden={items.length === 0 ? "true" : undefined}
      className={cn(
        "pointer-events-none fixed inset-x-3 bottom-3 z-[80] flex flex-col items-center gap-2",
        "sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end",
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <AnimatePresence initial={false}>
        {items.map((notification) => (
          <ToastItem
            key={notification.id}
            notification={notification}
            reduceMotion={shouldReduceMotion}
            onDismiss={dismiss}
            dismissLabel={t("common:notifications.dismiss")}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
