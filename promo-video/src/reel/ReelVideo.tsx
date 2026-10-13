import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import {
  AbsoluteFill,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fontFamily } from "../theme";
import {
  ReelAI,
  ReelFeatures,
  ReelHook,
  ReelNav,
  ReelOutro,
  ReelPiano,
  ReelSearch,
} from "./scenes";

const timing = linearTiming({
  durationInFrames: 12,
  easing: Easing.inOut(Easing.cubic),
});

// Durate delle scene: Root.tsx usa REEL_DURATION, così il totale resta sempre allineato.
const scenes = [150, 150, 304, 140, 130, 110, 120];
export const REEL_DURATION =
  scenes.reduce((a, b) => a + b, 0) - (scenes.length - 1) * 12;

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        height: 8,
        width: `${(frame / durationInFrames) * 100}%`,
        background: colors.accent,
        boxShadow: `0 0 18px ${colors.accent}`,
      }}
    />
  );
};

export const ReelVideo: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily, background: "#08090d" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence
          name="Gancio"
          durationInFrames={scenes[0]}
          premountFor={fps}
        >
          <ReelHook />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="AI"
          durationInFrames={scenes[1]}
          premountFor={fps}
        >
          <ReelAI />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={timing}
        />
        <TransitionSeries.Sequence
          name="Telefono"
          durationInFrames={scenes[2]}
          premountFor={fps}
        >
          <ReelNav />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={timing}
        />
        <TransitionSeries.Sequence
          name="Ricerca"
          durationInFrames={scenes[3]}
          premountFor={fps}
        >
          <ReelSearch />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={timing}
        />
        <TransitionSeries.Sequence
          name="Piano"
          durationInFrames={scenes[4]}
          premountFor={fps}
        >
          <ReelPiano />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="Funzioni AI"
          durationInFrames={scenes[5]}
          premountFor={fps}
        >
          <ReelFeatures />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          name="Chiusura"
          durationInFrames={scenes[6]}
          premountFor={fps}
        >
          <ReelOutro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <ProgressBar />
    </AbsoluteFill>
  );
};
