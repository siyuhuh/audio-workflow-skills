import { AnimatePresence, motion } from "motion/react";
import type { RoomQueueItem, RoomStatus } from "../../shared/types";
import { motionDuration, motionEase } from "../lib/motion";
import type { Translator } from "../lib/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";

export interface RoomRemoteDrawerProps {
  open: boolean;
  onClose: () => void;
  roomStatus: RoomStatus | null;
  roomQrDataUrl: string;
  roomMessage: string;
  roomQueue: RoomQueueItem[];
  nextRoomRequest: RoomQueueItem | null;
  isRunning: boolean;
  onCopyLink: () => void | Promise<void>;
  onProcessItem: (item: RoomQueueItem) => void | Promise<void>;
  onRemoveItem: (itemId: string) => void | Promise<void>;
  onClearQueue: () => void | Promise<void>;
  t: Translator;
}

const queueItemStatusClasses: Record<string, string> = {
  queued: "border-border bg-card/70",
  running: "border-primary/60 bg-accent-soft",
  failed: "border-danger/60 bg-danger-soft",
  done: "border-border bg-card/70"
};

export function RoomRemoteDrawer({
  open,
  onClose,
  roomStatus,
  roomQrDataUrl,
  roomMessage,
  roomQueue,
  nextRoomRequest,
  isRunning,
  onCopyLink,
  onProcessItem,
  onRemoveItem,
  onClearQueue,
  t
}: RoomRemoteDrawerProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="roomDrawer"
          id="vocalflow-room-drawer"
          role="dialog"
          aria-label={t("room:panelTitle")}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: motionDuration.panel, ease: motionEase }}
          className="fixed inset-0 z-50 grid grid-cols-1 sm:grid-cols-[1fr_min(420px,92vw)]"
        >
          <div
            onClick={onClose}
            aria-hidden="true"
            className="hidden cursor-pointer bg-black/35 sm:block"
          />
          <div className="grid grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-y-auto border-l border-border bg-card p-4 shadow-[var(--shadow-overlay)]">
            <header className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow>{t("room:drawerToggle")}</Eyebrow>
                <h2 className="m-0 mt-[2px] mb-1 text-xl font-semibold text-foreground">
                  {t("room:panelTitle")}
                </h2>
                <p className="m-0 text-sm font-medium leading-normal text-muted-foreground">
                  {t("room:panelHint")}
                </p>
              </div>
              <Button onClick={onClose} aria-label={t("common:actions.cancel")}>
                {t("room:drawerToggleOpen")}
              </Button>
            </header>

            <div className="grid gap-3">
              <div className="grid justify-self-center gap-2">
                {roomQrDataUrl ? (
                  <img
                    src={roomQrDataUrl}
                    alt={t("room:drawerToggle")}
                    className="h-[180px] w-[180px] rounded-xl border border-border bg-card"
                  />
                ) : (
                  <div className="grid h-[180px] w-[180px] place-items-center rounded-xl border border-border bg-card font-semibold text-faint">
                    QR
                  </div>
                )}
                <Button onClick={() => void onCopyLink()} disabled={!roomStatus?.remoteUrl}>
                  {t("room:copyLink")}
                </Button>
              </div>

              <div className="grid gap-2">
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                  {roomStatus?.remoteUrl ?? t("room:starting")}
                </div>
                {roomMessage ? (
                  <p className="m-0 text-sm font-medium leading-normal text-muted-foreground">{roomMessage}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => nextRoomRequest && void onProcessItem(nextRoomRequest)}
                    disabled={!nextRoomRequest || isRunning}
                  >
                    {t("room:runNext")}
                  </Button>
                  <Button onClick={() => void onClearQueue()} disabled={roomQueue.length === 0}>
                    {t("room:clearQueue")}
                  </Button>
                </div>

                <ul className="m-0 grid list-none gap-2 p-0" aria-label={t("room:panelTitle")}>
                  {roomQueue.length > 0 ? (
                    roomQueue.map((item, index) => (
                      <li
                        key={item.id}
                        data-status={item.status}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                          queueItemStatusClasses[item.status] ?? queueItemStatusClasses.queued
                        )}
                      >
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {index + 1}. {item.title}
                          </div>
                          <div className="text-xs font-medium text-faint">
                            {item.requestedBy} · {item.status}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {item.status === "queued" ? (
                            <Button
                              size="sm"
                              onClick={() => void onProcessItem(item)}
                              disabled={isRunning}
                            >
                              {t("room:queueRun")}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            onClick={() => void onRemoveItem(item.id)}
                            disabled={item.status === "running"}
                          >
                            {t("room:queueRemove")}
                          </Button>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-faint">
                      {t("room:queueEmpty")}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
