import { Backdrop } from "./Backdrop";
import { FlowPlayer, type FlowState } from "../flow/FlowPlayer";
import manifest from "../../public/flows/manifest.json";

type FlowName = "nav" | "search" | "mobile";

const flows = manifest as unknown as Record<FlowName, FlowState[]>;

const captions: Record<FlowName, string[]> = {
  nav: [
    "Ogni giorno sai cosa fare",
    "Le tue materie, in ordine",
    "Tutto a portata di click",
    "Ripeti solo ciò che stai per dimenticare",
    "Valuti tu, FSRS pianifica il resto",
  ],
  search: [
    "Cerca ovunque con ⌘K",
    "Cerca ovunque con ⌘K",
    "Cerca ovunque con ⌘K",
    "Cerca ovunque con ⌘K",
    "Cerca ovunque con ⌘K",
    "Materie, piani e flashcard in un colpo",
  ],
  mobile: [
    "Anche sul telefono",
    "Anche sul telefono",
    "Pensata per il pollice",
  ],
};

export const FlowScene: React.FC<{ readonly flow: "nav" | "search" }> = ({
  flow,
}) => (
  <Backdrop>
    <FlowPlayer
      states={flows[flow]}
      captions={captions[flow]}
      viewport={{ w: 1600, h: 900 }}
      frameWidth={1344}
      device="browser"
      zoom={1.15}
      left={288}
      top={230}
    />
  </Backdrop>
);

export const MobileFlowScene: React.FC = () => (
  <Backdrop>
    <FlowPlayer
      states={flows.mobile}
      captions={captions.mobile}
      viewport={{ w: 390, h: 844 }}
      frameWidth={420}
      device="phone"
      zoom={1.1}
      left={1200}
      top={80}
      captionLeft={160}
      captionAlign="left"
    />
  </Backdrop>
);
