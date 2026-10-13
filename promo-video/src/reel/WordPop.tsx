import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

/**
 * Testo stile reel: le parole entrano una alla volta con un piccolo rimbalzo.
 * Le parole tra asterischi (*così* o *anche più parole*) finiscono in un'unica pillola colorata.
 */
export const WordPop: React.FC<{
  readonly text: string;
  readonly size: number;
  readonly delay?: number;
  readonly stagger?: number;
  readonly color?: string;
  readonly animate?: boolean;
}> = ({
  text,
  size,
  delay = 0,
  stagger = 3,
  color = colors.text,
  animate = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // segmenti: parole singole, oppure gruppi evidenziati tenuti insieme
  const segments: { text: string; highlight: boolean }[] = [];
  let group: string[] | null = null;
  for (const raw of text.split(" ")) {
    const opens = raw.startsWith("*");
    const closes = raw.endsWith("*") && (raw.length > 1 || !opens);
    const word = raw.replace(/\*/g, "");
    if (opens) group = [];
    if (group) {
      group.push(word);
      if (closes) {
        segments.push({ text: group.join(" "), highlight: true });
        group = null;
      }
    } else {
      segments.push({ text: word, highlight: false });
    }
  }
  if (group) segments.push({ text: group.join(" "), highlight: true });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        columnGap: size * 0.24,
        rowGap: size * 0.14,
        textAlign: "center",
      }}
    >
      {segments.map(({ text: t, highlight }, i) => {
        const p = animate
          ? spring({
              frame: frame - delay - i * stagger,
              fps,
              config: { damping: 12, stiffness: 170, mass: 0.6 },
            })
          : 1;
        return (
          <span
            key={`${t}-${i}`}
            style={{
              display: "inline-block",
              whiteSpace: "nowrap",
              fontSize: size,
              fontWeight: 800,
              letterSpacing: -size * 0.025,
              lineHeight: 1.08,
              color: highlight ? "#fff" : color,
              background: highlight ? colors.accent : "transparent",
              padding: highlight ? `0 ${size * 0.18}px` : 0,
              borderRadius: size * 0.18,
              opacity: interpolate(p, [0, 0.4], [0, 1], {
                extrapolateRight: "clamp",
              }),
              transform: `translateY(${interpolate(p, [0, 1], [size * 0.45, 0])}px) scale(${interpolate(p, [0, 1], [0.6, 1])}) rotate(${highlight ? -2 : 0}deg)`,
              boxShadow: highlight
                ? "0 12px 40px rgba(91,140,255,0.45)"
                : "none",
            }}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
};
