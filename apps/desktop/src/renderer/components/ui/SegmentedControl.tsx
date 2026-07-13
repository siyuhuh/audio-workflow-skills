import { cn } from "../../lib/cn";

interface SegmentedControlProps<T extends string> {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  className?: string;
  /** `pill` matches Meevis-style header tabs; `default` is a bordered grid. */
  variant?: "default" | "pill";
  size?: "md" | "sm";
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  variant = "default",
  size = "md"
}: SegmentedControlProps<T>) {
  if (variant === "pill") {
    return (
      <div
        role="tablist"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-2xs backdrop-blur-md",
          className
        )}
      >
        {options.map(([optionValue, label]) => {
          const selected = value === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              role="tab"
              aria-selected={selected}
              data-selected={selected}
              onClick={() => onChange(optionValue)}
              className={cn(
                "rounded-full border-0 px-4 text-sm font-medium transition-colors duration-150 ease-out",
                size === "sm" ? "min-h-8" : "min-h-9",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                selected
                  ? "bg-muted text-foreground shadow-2xs"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-md border border-border shadow-2xs",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map(([optionValue, label], index) => {
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            data-selected={selected}
            onClick={() => onChange(optionValue)}
            className={cn(
              "min-h-10 border-0 text-sm font-medium transition-colors duration-150 ease-out",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              index < options.length - 1 && "border-r border-border",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-muted"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
