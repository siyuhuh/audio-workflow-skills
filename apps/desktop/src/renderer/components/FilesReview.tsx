import { useTranslation } from "react-i18next";
import type { GeneratedAsset } from "../../shared/types";

interface FilesReviewProps {
  assets: GeneratedAsset[];
  onOpen: (path: string) => void;
}

export function FilesReview({ assets, onOpen }: FilesReviewProps) {
  const { t } = useTranslation();

  if (assets.length === 0) {
    return (
      <p className="m-0 text-sm font-medium text-muted-foreground">{t("package:filesEmpty")}</p>
    );
  }

  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {assets.map((asset) => (
        <li key={asset.path}>
          <button
            type="button"
            disabled={!asset.exists}
            onClick={() => onOpen(asset.path)}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:enabled:border-line-strong hover:enabled:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">
              {asset.name}
            </span>
            <em className="shrink-0 text-xs font-medium not-italic text-faint">
              {asset.role ?? asset.type}
              {asset.exists ? "" : " · missing"}
            </em>
          </button>
        </li>
      ))}
    </ul>
  );
}
