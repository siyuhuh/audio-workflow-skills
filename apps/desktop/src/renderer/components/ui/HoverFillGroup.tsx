import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface HoverFillOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface HoverFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HoverFillGroupProps<T extends string> {
  ariaLabel: string;
  className?: string;
  items: Array<HoverFillOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function HoverFillGroup<T extends string>({
  ariaLabel,
  className,
  items,
  value,
  onChange
}: HoverFillGroupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fillRect, setFillRect] = useState<HoverFillRect | null>(null);
  const itemSignature = items.map((item) => `${item.value}:${item.disabled ? "1" : "0"}`).join("|");

  const setFillForTarget = useCallback((target: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !target) {
      setFillRect(null);
      return;
    }

    const parentRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setFillRect({
      x: targetRect.left - parentRect.left,
      y: targetRect.top - parentRect.top,
      width: targetRect.width,
      height: targetRect.height
    });
  }, []);

  const setFillForSelected = useCallback(() => {
    const container = containerRef.current;
    const selectedButton =
      container?.querySelector<HTMLButtonElement>('button[data-selected="true"]:not(:disabled)') ?? null;
    setFillForTarget(selectedButton);
  }, [setFillForTarget]);

  useEffect(() => {
    setFillForSelected();
  }, [itemSignature, setFillForSelected, value]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "hoverFillGroup relative inline-flex items-stretch rounded-full border border-ktv-line bg-ktv-surface p-0.5",
        className
      )}
      onMouseLeave={() => {
        if (!containerRef.current?.matches(":focus-within")) {
          setFillForSelected();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFillForSelected();
        }
      }}
      style={
        {
          "--hover-x": `${fillRect?.x ?? 0}px`,
          "--hover-y": `${fillRect?.y ?? 0}px`,
          "--hover-width": `${fillRect?.width ?? 0}px`,
          "--hover-height": `${fillRect?.height ?? 0}px`
        } as CSSProperties
      }
    >
      <span className="hoverFillSurface" data-visible={Boolean(fillRect)} aria-hidden="true" />
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={item.disabled}
          aria-pressed={item.value === value}
          data-selected={item.value === value}
          onMouseEnter={(event) => setFillForTarget(event.currentTarget)}
          onFocus={(event) => setFillForTarget(event.currentTarget)}
          onClick={() => onChange(item.value)}
          className="relative z-[1] inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent px-3 text-sm font-medium text-white/70 transition-colors duration-150 ease-out hover:enabled:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="hoverFillLabel hoverFillLabelBase">{item.label}</span>
          <span className="hoverFillLabel hoverFillLabelActive" aria-hidden="true">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
