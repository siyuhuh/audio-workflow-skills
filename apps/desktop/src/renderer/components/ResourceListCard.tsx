import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type ResourceListCardBadgeTone =
  | "default"
  | "youtube"
  | "bilibili"
  | "local"
  | "sample"
  | "ready"
  | "warning";

export interface ResourceListCardBadge {
  label: string;
  tone?: ResourceListCardBadgeTone;
}

export interface ResourceListCardProps {
  indexLabel?: string;
  title: string;
  badges?: ResourceListCardBadge[];
  metadata?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  actions?: ReactNode;
  className?: string;
}

/**
 * Compact resource-card foundation used by dense lists. The title, badges,
 * metadata, and action slots stay independent so other resource types can add
 * source- or workflow-specific information without changing the card shell.
 */
export function ResourceListCard({
  indexLabel,
  title,
  badges = [],
  metadata,
  selected = false,
  onSelect,
  actions,
  className
}: ResourceListCardProps) {
  const content = (
    <>
      <span className="resourceListCardTitle" title={title}>
        {title}
      </span>
      {badges.length > 0 || metadata ? (
        <span className="resourceListCardMeta">
          {badges.map((badge, index) => (
            <span
              key={`${badge.label}-${index}`}
              className="resourceListCardBadge"
              data-tone={badge.tone ?? "default"}
            >
              {badge.label}
            </span>
          ))}
          {metadata ? <span className="resourceListCardMetadata">{metadata}</span> : null}
        </span>
      ) : null}
    </>
  );

  return (
    <article
      className={cn("resourceListCard", className)}
      data-selected={selected ? "true" : "false"}
      aria-current={selected ? "true" : undefined}
    >
      {indexLabel ? <span className="resourceListCardIndex">{indexLabel}</span> : null}
      {onSelect ? (
        <button type="button" className="resourceListCardMain" onClick={onSelect}>
          {content}
        </button>
      ) : (
        <div className="resourceListCardMain">{content}</div>
      )}
      {actions ? <div className="resourceListCardActions">{actions}</div> : null}
    </article>
  );
}
