import { Composition } from "remotion";
import { DURATION_FRAMES, FPS, HEIGHT, WIDTH } from "./tokens";
import { VocalFlowIntro } from "./VocalFlowIntro";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="VocalFlowIntro"
        component={VocalFlowIntro}
        durationInFrames={DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
