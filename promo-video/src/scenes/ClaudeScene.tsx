import { Backdrop } from "./Backdrop";
import { Headline } from "./Headline";
import { colors } from "../theme";

export const ClaudeScene: React.FC = () => (
  <Backdrop>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 30,
        textAlign: "center",
        padding: "0 160px",
      }}
    >
      <Headline text="Costruito interamente con Claude." size={110} />
      <Headline text="StudyHub" size={72} delay={26} color={colors.accent} />
    </div>
  </Backdrop>
);
