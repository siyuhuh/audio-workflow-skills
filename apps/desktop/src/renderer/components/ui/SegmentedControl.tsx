import { cn } from "../../lib/cn";

interface SegmentedControlProps<T extends string> {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  className?: string;
  /** `pill` = header nav capsule; `default` = soft-rounded grid. */
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
        className={cn("segControl segControl--pill", className)}
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
                "segControlItem",
                size === "sm" ? "segControlItem--sm" : "segControlItem--md",
                selected && "segControlItem--active"
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
      className={cn("segControl segControl--grid", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map(([optionValue, label]) => {
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            data-selected={selected}
            onClick={() => onChange(optionValue)}
            className={cn(
              "segControlItem segControlItem--md",
              selected && "segControlItem--active"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
