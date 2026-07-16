import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, tokens } from "../tokens";

type SceneTitleProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  dark?: boolean;
};

export function SceneTitle({ eyebrow, title, subtitle, align = "center", dark = false }: SceneTitleProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 100 } });
  const y = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  const color = dark ? tokens.white : tokens.foreground;
  const muted = dark ? "rgba(245, 247, 242, 0.72)" : tokens.foregroundMuted;

  return (
    <div
      style={{
        textAlign: align,
        transform: `translateY(${y}px)`,
        opacity,
        maxWidth: 1200,
      }}
    >
      {eyebrow ? (
        <div
          style={{
            fontSize: 22,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: tokens.primary,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h1
        style={{
          margin: 0,
          fontSize: 72,
          lineHeight: 1.08,
          fontWeight: 600,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          style={{
            margin: "24px 0 0",
            fontSize: 32,
            lineHeight: 1.45,
            color: muted,
            fontWeight: 400,
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

export function MonoBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "10px 18px",
        background: tokens.roomInk,
        color: tokens.sageAccent,
        fontFamily: fonts.mono,
        fontSize: 20,
        borderRadius: 8,
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  );
}
