import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
  block?: boolean;
  children?: ReactNode;
}

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap " +
  "transition-[transform,background-color,border-color,color] duration-150 ease-out " +
  "active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-7 px-3 text-xs",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-14 px-6 text-lg"
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-primary bg-primary text-primary-foreground shadow-xs " +
    "hover:enabled:bg-accent-strong hover:enabled:border-accent-strong " +
    "focus-visible:enabled:bg-accent-strong focus-visible:enabled:border-accent-strong",
  secondary:
    "border border-border bg-card text-foreground " +
    "hover:enabled:bg-muted hover:enabled:border-line-strong " +
    "focus-visible:enabled:bg-muted focus-visible:enabled:border-line-strong",
  ghost:
    "border border-transparent bg-transparent text-foreground " +
    "hover:enabled:bg-muted focus-visible:enabled:bg-muted",
  danger:
    "border border-danger bg-danger-soft text-danger " +
    "hover:enabled:bg-danger hover:enabled:text-white"
};

const selectedClasses = "border-primary bg-accent-soft text-accent-strong";

export function Button({
  variant = "secondary",
  size = "md",
  selected,
  block,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        selected && selectedClasses,
        block && "w-full",
        className
      )}
      {...props}
    />
  );
}
