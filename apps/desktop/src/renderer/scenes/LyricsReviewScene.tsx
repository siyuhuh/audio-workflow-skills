import { useTranslation } from "react-i18next";
import type { GeneratedAsset, SavedJobHistory } from "../../shared/types";
import { type Cue, formatClock } from "../lib/lyrics";
import { Button } from "../components/ui/Button";
import { Eyebrow } from "../components/ui/Eyebrow";
import { ScriptReview } from "../components/ScriptReview";

interface LyricsReviewSceneProps {
  activeReview: SavedJobHistory;
  cues: Cue[];
  scriptStatus: string;
  scriptText: string;
  selectedSubtitlePath: string;
  subtitleAssets: GeneratedAsset[];
  reviewTitle: string;
  onBack: () => void;
  onCueSeek?: (cue: Cue) => void;
  onEnterKaraoke: () => void;
  onOpenFolder: () => void;
  onScriptChange: (content: string) => void;
  onSave: () => void;
}

export function LyricsReviewScene({
  cues,
  scriptStatus,
  scriptText,
  selectedSubtitlePath,
  subtitleAssets,
  reviewTitle,
  onBack,
  onCueSeek,
  onEnterKaraoke,
  onOpenFolder,
  onScriptChange,
  onSave
}: LyricsReviewSceneProps) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto grid max-w-[1200px] gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <Eyebrow>{t("package:detail")}</Eyebrow>
          <h1 className="m-0 truncate text-2xl font-semibold text-foreground">{reviewTitle}</h1>
          <p className="m-0 text-sm font-medium text-muted-foreground">{t("package:detailHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack}>{t("common:actions.back")}</Button>
          <Button onClick={onOpenFolder}>{t("package:openFolder")}</Button>
          <Button variant="primary" onClick={onEnterKaraoke} disabled={!selectedSubtitlePath}>
            {t("package:saveAndEnter")}
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <ScriptReview
          selectedSubtitlePath={selectedSubtitlePath}
          subtitleAssets={subtitleAssets}
          scriptText={scriptText}
          scriptStatus={scriptStatus}
          onScriptChange={onScriptChange}
          onSave={onSave}
        />
        <div className="grid grid-rows-[auto_1fr] gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
          <header className="flex items-center justify-between">
            <h2 className="m-0 text-sm font-semibold text-foreground">{t("package:timedLines")}</h2>
            <span className="text-xs font-medium text-faint tabular-nums">{cues.length}</span>
          </header>
          <div className="grid max-h-[560px] auto-rows-min gap-1 overflow-y-auto">
            {cues.length === 0 ? (
              <p className="m-0 px-2 py-4 text-sm font-medium text-muted-foreground">
                {t("package:noTimedLines")}
              </p>
            ) : (
              cues.map((cue, index) => (
                <button
                  key={`${cue.start}-${index}`}
                  type="button"
                  onClick={() => onCueSeek?.(cue)}
                  aria-label={`${formatClock(cue.start)} ${cue.text}`}
                  className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                    {formatClock(cue.start)}
                  </span>
                  <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">
                    {cue.text}
                  </strong>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
