import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./Backdrop";
import { Headline } from "./Headline";
import { colors } from "../theme";

const chips = [
  { label: "appunti.pdf", from: [-400, 200], to: [330, 250], rot: -8 },
  { label: "lavagna.jpg", from: [2300, 100], to: [1560, 210], rot: 7 },
  { label: "esami_2024.pdf", from: [-400, 900], to: [420, 800], rot: 5 },
  { label: "schemi.png", from: [2300, 1000], to: [1500, 790], rot: -6 },
  { label: "dispense.pdf", from: [960, 1400], to: [960, 910], rot: 3 },
];

const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const converge = ease((frame - 66) / 26);
  const textOut = interpolate(frame, [58, 72], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logo = spring({ frame: frame - 92, fps, config: { damping: 14 } });
  return (
    <Backdrop>
      {chips.map((c, i) => {
        const inP = ease((frame - i * 5) / 28);
        const x = interpolate(inP, [0, 1], [c.from[0], c.to[0]]);
        const y =
          interpolate(inP, [0, 1], [c.from[1], c.to[1]]) +
          Math.sin((frame + i * 20) / 14) * 6 * (1 - converge);
        const cx = x + (960 - x) * converge;
        const cy = y + (540 - y) * converge;
        return (
          <div
            key={c.label}
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              transform: `translate(-50%, -50%) rotate(${c.rot * (1 - converge)}deg) scale(${1 - converge * 0.8})`,
              opacity: 1 - converge,
              fontSize: 38,
              fontWeight: 600,
              color: colors.text,
              padding: "16px 30px",
              borderRadius: 14,
              border: `1px solid ${colors.line}`,
              background: colors.panel,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {c.label}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          opacity: textOut,
        }}
      >
        <Headline text="Appunti ovunque." size={120} />
        <Headline
          text="L'esame si avvicina."
          size={80}
          delay={14}
          color={colors.accent}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 28,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 170,
            fontWeight: 800,
            letterSpacing: -6,
            color: colors.text,
            opacity: logo,
            transform: `scale(${interpolate(logo, [0, 1], [0.6, 1])})`,
          }}
        >
          Study<span style={{ color: colors.accent }}>Hub</span>
        </div>
        <Headline
          text="Dal materiale grezzo a un piano quotidiano."
          size={52}
          delay={104}
          color={colors.muted}
        />
      </div>
    </Backdrop>
  );
};
