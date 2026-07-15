import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const SCRAMBLE_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-:;<>";

type LineHoverProps = {
  text: string;
  className?: string;
  scramble?: boolean;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

/**
 * Codrops Line TextHover demo-4 style: south-growing fill + optional glyph scramble.
 */
export function LineHover({
  text,
  className,
  scramble = true,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: LineHoverProps) {
  const [chars, setChars] = useState(() => text.split(""));
  const originalRef = useRef(text);
  const frameRef = useRef(0);
  const activeRef = useRef(false);

  useEffect(() => {
    originalRef.current = text;
    if (!activeRef.current) {
      setChars(text.split(""));
    }
  }, [text]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const runScramble = () => {
    if (!scramble) return;
    activeRef.current = true;
    const original = originalRef.current.split("");
    const total = original.length;
    let step = 0;
    const tick = () => {
      step += 1;
      const reveal = Math.min(total, Math.floor(step / 2));
      setChars(
        original.map((ch, i) => {
          if (ch === " ") return " ";
          if (i < reveal) return original[i]!;
          return SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)]!;
        })
      );
      if (reveal < total) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setChars(original);
        activeRef.current = false;
      }
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
  };

  const reset = () => {
    cancelAnimationFrame(frameRef.current);
    activeRef.current = false;
    setChars(originalRef.current.split(""));
  };

  return (
    <span
      className={cn("hoverEffect hoverEffect--bgSouth", className)}
      onMouseEnter={(event) => {
        runScramble();
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        reset();
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        runScramble();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        reset();
        onBlur?.(event);
      }}
      {...props}
    >
      {chars.map((ch, i) => (
        <span key={`${i}-${ch === " " ? "sp" : ch}`} className="hoverEffectChar">
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}
