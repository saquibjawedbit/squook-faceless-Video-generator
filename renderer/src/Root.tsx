import {Composition} from 'remotion';
import {MainVideo} from './MainVideo';
import type {RenderIR} from './ir';
import irJson from '../public/render_ir.json';

const ir = irJson as unknown as RenderIR;

export const Root: React.FC = () => {
  return (
    <Composition
      id="Explainer"
      component={MainVideo}
      durationInFrames={ir.metadata.total_frames}
      fps={ir.metadata.fps}
      width={ir.metadata.width}
      height={ir.metadata.height}
      defaultProps={{ir}}
      // Size and length follow the IR passed in (server renders pass a
      // project's IR as input props; the CLI default is public/render_ir.json).
      calculateMetadata={({props}) => {
        const m = (props as {ir: RenderIR}).ir.metadata;
        return {durationInFrames: Math.max(1, m.total_frames), fps: m.fps, width: m.width, height: m.height};
      }}
    />
  );
};
