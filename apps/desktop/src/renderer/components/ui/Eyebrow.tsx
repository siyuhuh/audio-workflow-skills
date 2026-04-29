import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "m-0 mb-1 text-xs font-medium uppercase tracking-normal text-faint",
        className
      )}
      {...props}
    />
  );
}
