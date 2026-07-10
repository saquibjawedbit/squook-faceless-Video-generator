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
    />
  );
};
