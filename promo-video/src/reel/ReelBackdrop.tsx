import { AbsoluteFill, useCurrentFrame } from "remotion";

// Sfondo scuro con due aloni di colore che si muovono piano: dà profondità senza distrarre.
export const ReelBackdrop: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const f = useCurrentFrame();
  const ax = 30 + Math.sin(f / 70) * 18;
  const ay = 18 + Math.cos(f / 90) * 8;
  const bx = 75 + Math.cos(f / 80) * 15;
  const by = 78 + Math.sin(f / 60) * 8;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(900px 900px at ${ax}% ${ay}%, rgba(64,96,230,0.32) 0%, transparent 60%)`,
          `radial-gradient(800px 800px at ${bx}% ${by}%, rgba(124,72,220,0.22) 0%, transparent 60%)`,
          "#08090d",
        ].join(", "),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
