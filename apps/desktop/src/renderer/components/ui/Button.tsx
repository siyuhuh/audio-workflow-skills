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
  "uiKey whitespace-nowrap " +
  "disabled:cursor-not-allowed " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base"
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "uiKeyPrimary",
  secondary: "",
  ghost: "uiKeyGhost",
  danger: "uiKeyDanger"
};

const selectedClasses =
  "bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)] " +
  "text-[color-mix(in_oklch,var(--primary)_75%,var(--foreground))]";

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
