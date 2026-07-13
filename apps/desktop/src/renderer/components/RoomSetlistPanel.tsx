import { useTranslation } from "react-i18next";
import type { SavedJobHistory } from "../../shared/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Eyebrow } from "./ui/Eyebrow";
import { Icon } from "./ui/Icon";

export interface RoomSetlistItem {
  entry: SavedJobHistory;
  title: string;
  ready: boolean;
}

interface RoomSetlistPanelProps {
  items: RoomSetlistItem[];
  selectedId: string | null;
  onSelect: (historyId: string) => void;
  onMove: (historyId: string, direction: -1 | 1) => void;
  onStart: (historyId?: string) => void;
  onReview: (historyId: string) => void;
  onAddSongs: () => void;
}

export function RoomSetlistPanel({
  items,
  selectedId,
  onSelect,
  onMove,
  onStart,
  onReview,
  onAddSongs
}: RoomSetlistPanelProps) {
  const { t } = useTranslation();
  const selected = items.find((item) => item.entry.id === selectedId) ?? items[0] ?? null;
  const canStartSelected = Boolean(selected?.ready);

  if (items.length === 0) {
    return (
      <Card
        surface="elevated"
        padding="lg"
        bordered
        className="grid gap-3 border-dashed p-8 text-center"
        aria-label={t("common:room.emptyTitle")}
      >
        <h2 className="m-0 text-lg font-semibold text-foreground">{t("common:room.emptyTitle")}</h2>
        <p className="m-0 text-sm font-medium text-muted-foreground">{t("common:room.emptyBody")}</p>
        <Button onClick={onAddSongs} className="mx-auto gap-2">
          <Icon name="plus" />
          {t("common:nav.add")}
        </Button>
      </Card>
    );
  }

  return (
    <section className="grid gap-4" aria-label={t("common:room.setlistLabel")}>
      <Card surface="card" padding="lg" elevated className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Eyebrow className="m-0">{t("common:room.setlistLabel")}</Eyebrow>
            <p className="m-0 text-sm font-medium text-muted-foreground">{t("common:room.setlistHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              className="gap-2"
              disabled={!canStartSelected}
              onClick={() => onStart(selected?.entry.id)}
            >
              <Icon name="play" />
              {t("common:room.startSinging")}
            </Button>
            {selected ? (
              <Button size="lg" onClick={() => onReview(selected.entry.id)}>
                {t("common:room.reviewLyrics")}
              </Button>
            ) : null}
          </div>
        </div>

        <ol className="m-0 grid list-none gap-2 p-0">
          {items.map((item, index) => {
            const isSelected = item.entry.id === (selected?.entry.id ?? null);
            return (
              <li key={item.entry.id}>
                <div
                  data-selected={isSelected}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-foreground/20 hover:bg-muted/60"
                  )}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <button
                    type="button"
                    onClick={() => onSelect(item.entry.id)}
                    className="grid min-w-0 gap-0.5 border-0 bg-transparent p-0 text-left"
                  >
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
                      {item.title}
                    </strong>
                    <span className="text-xs font-medium text-muted-foreground">
                      {item.ready ? t("common:room.ready") : t("common:room.notReady")}
                    </span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => onMove(item.entry.id, -1)}
                      aria-label={t("common:room.moveUp")}
                      title={t("common:room.moveUp")}
                      className="inline-grid size-8 place-items-center rounded-full border border-border text-foreground/80 transition-colors hover:enabled:bg-muted disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <Icon name="chevronUp" />
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      onClick={() => onMove(item.entry.id, 1)}
                      aria-label={t("common:room.moveDown")}
                      title={t("common:room.moveDown")}
                      className="inline-grid size-8 place-items-center rounded-full border border-border text-foreground/80 transition-colors hover:enabled:bg-muted disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <Icon name="chevronDown" />
                    </button>
                    <button
                      type="button"
                      disabled={!item.ready}
                      onClick={() => onStart(item.entry.id)}
                      aria-label={t("common:room.singThis")}
                      title={t("common:room.singThis")}
                      className="inline-grid size-8 place-items-center rounded-full border border-border bg-primary text-primary-foreground transition-colors hover:enabled:opacity-90 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <Icon name="play" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
