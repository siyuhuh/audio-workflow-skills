import type { ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, tokens } from "../tokens";

type FeatureCardProps = {
  index: number;
  title: string;
  detail: string;
  icon: string;
};

export function FeatureCard({ index, title, detail, icon }: FeatureCardProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = index * 8;
  const enter = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 110 } });
  const y = interpolate(enter, [0, 1], [32, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: tokens.sageCard,
        border: `1px solid ${tokens.rule}`,
        borderRadius: 20,
        padding: "32px 28px",
        transform: `translateY(${y}px)`,
        opacity,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 10, color: tokens.foreground }}>{title}</div>
      <div style={{ fontSize: 22, lineHeight: 1.5, color: tokens.foregroundMuted }}>{detail}</div>
    </div>
  );
}

type PipelineStepProps = {
  index: number;
  label: string;
  active: boolean;
};

export function PipelineStep({ index, label, active }: PipelineStepProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - index * 10, fps, config: { damping: 14, stiffness: 100 } });
  const scale = interpolate(enter, [0, 1], [0.85, 1]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        flex: 1,
        transform: `scale(${scale})`,
        opacity: enter,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 0,
          background: active ? tokens.primary : tokens.roomPanel,
          color: tokens.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: fonts.mono,
          fontSize: 24,
          fontWeight: 600,
          boxShadow: active ? `0 0 0 3px ${tokens.sageBg}, 0 0 0 5px ${tokens.primary}` : "none",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          textAlign: "center",
          color: active ? tokens.foreground : tokens.foregroundMuted,
          maxWidth: 160,
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

type MockUiCardProps = {
  title: string;
  children: ReactNode;
};

export function MockUiCard({ title, children }: MockUiCardProps) {
  return (
    <div
      style={{
        background: tokens.sageCard,
        border: `1px solid ${tokens.rule}`,
        borderRadius: 24,
        overflow: "hidden",
        width: "100%",
        maxWidth: 900,
        boxShadow: "0 32px 80px rgba(30, 34, 28, 0.12)",
      }}
    >
      <div
        style={{
          padding: "18px 24px",
          borderBottom: `1px solid ${tokens.rule}`,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: tokens.foregroundMuted,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 32 }}>{children}</div>
    </div>
  );
}
