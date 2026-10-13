import { Composition, Still } from "remotion";
import { MyVideo } from "./MyVideo";
import { ReelCover } from "./reel/scenes";
import { REEL_DURATION, ReelVideo } from "./reel/ReelVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Reel"
      component={ReelVideo}
      durationInFrames={REEL_DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
    <Still id="ReelCover" component={ReelCover} width={1080} height={1920} />
    <Composition
      id="Promo"
      component={MyVideo}
      durationInFrames={1120}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
