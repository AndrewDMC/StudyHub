import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { PhoneBezel } from "../flow/PhoneBezel";

// Geometria comune del telefono nel reel (1080x1920): schermo 390x844 px CSS.
export const PHONE = {
  screenW: 520,
  left: 270,
  top: 590,
  viewport: { w: 390, h: 844 },
};
export const phoneScale = PHONE.screenW / PHONE.viewport.w;

/** Oscillazione 3D leggera: il telefono "galleggia" invece di restare fermo. */
export const Float: React.FC<{ readonly children: React.ReactNode }> = ({
  children,
}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ perspective: 1800 }}>
      <AbsoluteFill
        style={{
          transformOrigin: "540px 1150px",
          transform: `rotateY(${Math.sin(f / 45) * 4}deg) rotateX(${2 + Math.cos(f / 60) * 1.5}deg) translateY(${Math.sin(f / 30) * 7}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const PhoneShell: React.FC<{
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}> = ({ children, style }) => (
  <PhoneBezel
    width={PHONE.screenW}
    height={PHONE.viewport.h * phoneScale}
    style={{ left: PHONE.left, top: PHONE.top, ...style }}
  >
    {children}
  </PhoneBezel>
);

export const PhoneScreenshot: React.FC<{ readonly img: string }> = ({
  img,
}) => (
  <PhoneShell>
    <Img
      src={staticFile(`flows/${img}`)}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  </PhoneShell>
);
