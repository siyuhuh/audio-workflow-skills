import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { fonts, tokens } from "../tokens";

type BrandFrameProps = {
  children: ReactNode;
  variant?: "studio" | "room";
};

export function BrandFrame({ children, variant = "studio" }: BrandFrameProps) {
  const bg = variant === "room" ? tokens.roomInk : tokens.sageBg;
  const fg = variant === "room" ? tokens.white : tokens.foreground;

  return (
    <AbsoluteFill
      style={{
        background: bg,
        color: fg,
        fontFamily: fonts.sans,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          backgroundImage:
            "repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 6px)",
          pointerEvents: "none",
        }}
      />
      {children}
    </AbsoluteFill>
  );
}
