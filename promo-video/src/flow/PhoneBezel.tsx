export const BEZEL = 12;
const RADIUS = 58;

/**
 * Cornice del telefono: lo schermo ha il suo raggio e un clip-path, così il contenuto
 * (anche se trasformato) resta sempre dentro la sagoma e allineato al bordo.
 */
export const PhoneBezel: React.FC<{
  readonly width: number;
  readonly height: number;
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}> = ({ width, height, children, style }) => (
  <div
    style={{
      position: "absolute",
      padding: BEZEL,
      borderRadius: RADIUS,
      background:
        "linear-gradient(150deg, #343a48 0%, #1a1d25 45%, #2a2f3b 100%)",
      boxShadow:
        "inset 0 0 0 1.5px rgba(255,255,255,0.14), 0 50px 140px rgba(0,0,0,0.7), 0 0 90px rgba(91,140,255,0.18)",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: RADIUS - BEZEL,
        overflow: "hidden",
        clipPath: `inset(0 round ${RADIUS - BEZEL}px)`,
        background: "#0b0c10",
        boxShadow: "0 0 0 1px #000",
      }}
    >
      {children}
    </div>
  </div>
);
