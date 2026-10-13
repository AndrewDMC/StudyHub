import { AbsoluteFill } from "remotion";
import { colors } from "../theme";

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 80% -10%, #1a2550 0%, transparent 60%), ${colors.bg}`,
    }}
  >
    {children}
  </AbsoluteFill>
);
