import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "./Backdrop";
import { Headline } from "./Headline";
import { colors } from "../theme";

// Pagina del piano catturata a 1600x2400 px CSS: mostriamo la colonna dei task e la facciamo scorrere.
const CROP_X = 540;
const CROP_W = 740;
const VIEW_H = 740;
const PAN_FROM = 215;
const PAN_TO = 953;

export const PianoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const frameW = 1344;
  const s = frameW / CROP_W;
  const p = interpolate(frame, [30, durationInFrames - 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const panY = PAN_FROM + (PAN_TO - PAN_FROM) * eased;
  return (
    <Backdrop>
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Headline text="Un piano che si adatta" size={72} />
        <Headline
          text="Letture, flashcard e simulazioni distribuite fino all'esame"
          size={34}
          delay={10}
          color={colors.muted}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: (1920 - frameW) / 2,
          top: 250,
          width: frameW,
          borderRadius: 18,
          overflow: "hidden",
          border: `1px solid ${colors.line}`,
          background: colors.panel,
          boxShadow:
            "0 40px 120px rgba(0,0,0,0.6), 0 0 80px rgba(91,140,255,0.15)",
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px)`,
        }}
      >
        <div
          style={{
            height: 36,
            background: "#1b1e27",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px",
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div
              key={c}
              style={{ width: 12, height: 12, borderRadius: 6, background: c }}
            />
          ))}
        </div>
        <div
          style={{
            position: "relative",
            width: frameW,
            height: VIEW_H,
            overflow: "hidden",
          }}
        >
          <Img
            src={staticFile("flows/piano-full.png")}
            style={{
              position: "absolute",
              left: -CROP_X * s,
              top: -panY * s,
              width: 1600 * s,
            }}
          />
        </div>
      </div>
    </Backdrop>
  );
};
