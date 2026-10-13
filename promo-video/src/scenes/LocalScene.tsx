import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./Backdrop";
import { Headline } from "./Headline";
import { colors } from "../theme";

const chips = [
  "Local-first",
  "OCR su PDF e immagini",
  "Ricerca ibrida",
  "FSRS-5",
  "Simulazioni d'esame",
  "Backup e restore",
];

export const LocalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Backdrop>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 70,
        }}
      >
        <Headline text="Tutto in locale. Tutto tuo." size={104} />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 24,
            width: 1400,
          }}
        >
          {chips.map((c, i) => {
            const p = spring({
              frame: frame - 14 - i * 7,
              fps,
              config: { damping: 200 },
            });
            return (
              <div
                key={c}
                style={{
                  fontSize: 40,
                  fontWeight: 600,
                  color: colors.text,
                  padding: "18px 34px",
                  borderRadius: 999,
                  border: `1px solid ${colors.line}`,
                  background: colors.panel,
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
                }}
              >
                <span style={{ color: colors.green, marginRight: 14 }}>●</span>
                {c}
              </div>
            );
          })}
        </div>
      </div>
    </Backdrop>
  );
};
