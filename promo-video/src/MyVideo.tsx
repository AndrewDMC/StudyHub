import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { useVideoConfig } from "remotion";
import { ClaudeScene } from "./scenes/ClaudeScene";
import { FlowScene, MobileFlowScene } from "./scenes/FlowScene";
import { HookScene } from "./scenes/HookScene";
import { LocalScene } from "./scenes/LocalScene";
import { PianoScene } from "./scenes/PianoScene";
import { fontFamily } from "./theme";

const crossfade = () => (
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 12 })}
  />
);

export const MyVideo: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontFamily, width: "100%", height: "100%" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence
          name="Hook"
          durationInFrames={150}
          premountFor={fps}
        >
          <HookScene />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Navigazione e ripasso"
          durationInFrames={248}
          premountFor={fps}
        >
          <FlowScene flow="nav" />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Ricerca"
          durationInFrames={194}
          premountFor={fps}
        >
          <FlowScene flow="search" />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Piano"
          durationInFrames={170}
          premountFor={fps}
        >
          <PianoScene />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Mobile"
          durationInFrames={160}
          premountFor={fps}
        >
          <MobileFlowScene />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Locale"
          durationInFrames={150}
          premountFor={fps}
        >
          <LocalScene />
        </TransitionSeries.Sequence>
        {crossfade()}
        <TransitionSeries.Sequence
          name="Claude"
          durationInFrames={120}
          premountFor={fps}
        >
          <ClaudeScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </div>
  );
};
