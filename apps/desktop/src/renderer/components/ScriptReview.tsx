import { useTranslation } from "react-i18next";
import type { GeneratedAsset } from "../../shared/types";
import { Button } from "./ui/Button";

interface ScriptReviewProps {
  selectedSubtitlePath: string;
  subtitleAssets: GeneratedAsset[];
  scriptText: string;
  scriptStatus: string;
  onScriptChange: (content: string) => void;
  onSave: () => void;
}

function fileNameFromPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? filePath;
}

export function ScriptReview({
  selectedSubtitlePath,
  subtitleAssets,
  scriptText,
  scriptStatus,
  onScriptChange,
  onSave
}: ScriptReviewProps) {
  const { t } = useTranslation();
  const selectedSubtitle = subtitleAssets.find((asset) => asset.path === selectedSubtitlePath);
  const subtitleName =
    selectedSubtitle?.name ??
    (selectedSubtitlePath ? fileNameFromPath(selectedSubtitlePath) : t("package:badges.noLyrics"));

  return (
    <div className="grid grid-rows-[auto_1fr] gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">
            {t("package:lyricsBound")}
          </span>
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">
            {subtitleName}
          </strong>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-faint">{scriptStatus}</span>
          <Button variant="primary" onClick={onSave} disabled={!selectedSubtitlePath}>
            {t("common:actions.save")}
          </Button>
        </div>
      </div>
      <textarea
        value={scriptText}
        onChange={(event) => onScriptChange(event.target.value)}
        placeholder={t("package:scriptEmptyPlaceholder", {
          defaultValue: "This package does not have an editable lyrics file yet."
        })}
        spellCheck={false}
        className="min-h-[280px] w-full resize-y rounded-md border border-border bg-card px-3 py-2 font-mono text-sm leading-relaxed text-foreground focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)] [scrollbar-color:gray_transparent] [scrollbar-width:thin]"
      />
    </div>
  );
}
