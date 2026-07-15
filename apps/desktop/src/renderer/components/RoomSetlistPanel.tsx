import { useTranslation } from "react-i18next";
import type { SavedJobHistory } from "../../shared/types";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { LineHover } from "./ui/LineHover";

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
  const selectedIndex = selected ? items.findIndex((item) => item.entry.id === selected.entry.id) : -1;
  const canStartSelected = Boolean(selected?.ready);
  const readyCount = items.filter((item) => item.ready).length;
  const clockLabel = String(Math.max(items.length, 0)).padStart(2, "0");
  const needlePos = items.length > 1 && selectedIndex >= 0
    ? `${Math.round((selectedIndex / (items.length - 1)) * 100)}%`
    : "42%";

  if (items.length === 0) {
    return (
      <section className="roomSetlistPanel grid gap-5" aria-label={t("common:room.emptyTitle")}>
        <div>
          <p className="roomInstrumentClock">00</p>
          <p className="roomInstrumentNext">{t("common:room.emptyTitle")}</p>
        </div>
        <div className="roomInstrumentTuner" style={{ ["--needle-pos" as string]: "42%" }} aria-hidden="true">
          <span className="roomInstrumentNeedle" />
        </div>
        <p className="m-0 text-sm font-medium text-muted-foreground">{t("common:room.emptyBody")}</p>
        <Button onClick={onAddSongs} className="justify-self-start gap-2">
          <Icon name="plus" />
          {t("common:nav.add")}
        </Button>
      </section>
    );
  }

  return (
    <section className="roomSetlistPanel grid gap-0" aria-label={t("common:room.setlistLabel")}>
      <div>
        <p className="roomInstrumentClock">{clockLabel}</p>
        <p className="roomInstrumentNext">
          {t("common:room.nextCue", {
            count: readyCount,
            title: selected?.title ?? "—"
          })}
        </p>
      </div>

      <div
        className="roomInstrumentTuner"
        style={{ ["--needle-pos" as string]: needlePos }}
        aria-hidden="true"
      >
        <span className="roomInstrumentNeedle" />
      </div>

      {selected ? (
        <div className="roomInstrumentSelected">
          <div className="min-w-0">
            <h2 className="roomInstrumentSelectedTitle">{selected.title}</h2>
            <p className="roomInstrumentSelectedMeta">
              {String(selectedIndex + 1).padStart(2, "0")} ·{" "}
              {selected.ready ? t("common:room.ready") : t("common:room.notReady")}
            </p>
          </div>
          <button
            type="button"
            className="roomInstrumentSelectedPlay"
            disabled={!canStartSelected}
            onClick={() => onStart(selected.entry.id)}
            aria-label={t("common:room.startSinging")}
            title={t("common:room.startSinging")}
          >
            <Icon name="play" />
          </button>
        </div>
      ) : null}

      <ol className="roomSetlist">
        {items.map((item, index) => {
          const isSelected = item.entry.id === (selected?.entry.id ?? null);
          return (
            <li
              key={item.entry.id}
              className="roomSetlistItem"
              data-selected={isSelected ? "true" : "false"}
            >
              <span className="roomSetlistIndex">{String(index + 1).padStart(2, "0")}</span>

              <button
                type="button"
                className="roomSetlistMain"
                onClick={() => onSelect(item.entry.id)}
              >
                <LineHover text={item.title} className="roomSetlistTitle" scramble />
                <span className="roomSetlistMeta">
                  {item.ready ? t("common:room.ready") : t("common:room.notReady")}
                </span>
              </button>

              <div className="roomSetlistActions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMove(item.entry.id, -1)}
                  aria-label={t("common:room.moveUp")}
                  title={t("common:room.moveUp")}
                  className="roomSetlistIconBtn"
                >
                  <Icon name="chevronUp" />
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.entry.id, 1)}
                  aria-label={t("common:room.moveDown")}
                  title={t("common:room.moveDown")}
                  className="roomSetlistIconBtn"
                >
                  <Icon name="chevronDown" />
                </button>
                <button
                  type="button"
                  disabled={!item.ready}
                  onClick={() => onStart(item.entry.id)}
                  aria-label={t("common:room.singThis")}
                  title={t("common:room.singThis")}
                  className="roomSetlistIconBtn"
                  data-primary="true"
                >
                  <Icon name="play" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="roomInstrumentDock">
        <div className="roomInstrumentDial" aria-hidden="true" />
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
          <Button size="lg" onClick={onAddSongs} className="gap-2">
            <Icon name="plus" />
            {t("common:nav.add")}
          </Button>
        </div>
      </div>
    </section>
  );
}
