import { cn } from "../../lib/cn";

interface SegmentedControlProps<T extends string> {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className
}: SegmentedControlProps<T>) {
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
