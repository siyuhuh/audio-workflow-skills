import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface FieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, children, className }: FieldProps) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
