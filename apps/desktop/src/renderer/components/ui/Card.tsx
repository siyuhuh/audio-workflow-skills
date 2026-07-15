import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type CardSurface = "card" | "elevated" | "muted" | "overlay";
type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  surface?: CardSurface;
  padding?: CardPadding;
  bordered?: boolean;
  elevated?: boolean;
}

const surfaceClasses: Record<CardSurface, string> = {
  card: "bg-card",
  elevated: "bg-card",
  muted: "bg-muted",
  overlay: "bg-overlay"
};

const paddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-3",
  lg: "p-4"
};

export function Card({
  surface = "card",
  padding = "md",
  bordered = true,
  elevated = false,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)]",
        elevated ? "uiChassis border-0" : surfaceClasses[surface],
        paddingClasses[padding],
        !elevated && bordered && "border border-[var(--rule)]",
        className
      )}
      {...props}
    />
  );
}
