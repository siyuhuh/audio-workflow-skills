import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../tokens";

type LogoMarkProps = {
  size?: number;
  animate?: boolean;
};

export function LogoMark({ size = 200, animate = true }: LogoMarkProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = animate
    ? spring({ frame, fps, config: { damping: 14, stiffness: 120 } })
    : 1;
  const opacity = animate ? interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" }) : 1;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.133,
        background: tokens.roomPanel,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity,
        boxShadow: "0 24px 80px rgba(30, 34, 28, 0.28)",
      }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 750 750" fill="none">
        <path
          d="M259.976 375.507L335.811 241H647.27L685.895 304.671L646.905 375.507H493.175L570.675 509.231L532.938 574.117H455.587L376.836 441.223L300.109 574.117H222.618L184.44 509.231H184.734L64 304.671L108.203 241H184.588L259.976 375.507Z"
          fill="url(#logoGrad)"
          stroke="white"
          strokeWidth="4"
        />
        <defs>
          <linearGradient id="logoGrad" x1="374.947" y1="241" x2="374.947" y2="574.117" gradientUnits="userSpaceOnUse">
            <stop stopColor="#92A688" />
            <stop offset="1" stopColor="white" stopOpacity="0.2" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
