import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

export const Headline: React.FC<{
  readonly text: string;
  readonly size?: number;
  readonly delay?: number;
  readonly color?: string;
}> = ({ text, size = 84, delay = 0, color = colors.text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -size * 0.02,
        lineHeight: 1.05,
        color,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)`,
      }}
    >
      {text}
    </div>
  );
};
