import {AbsoluteFill, Audio, interpolate, Sequence} from 'remotion';
import {SceneRenderer} from './SceneRenderer';
import type {RenderIR, Transition} from './ir';
import {asset, transitionFrames} from './ir';
import {ThemeProvider, themeOf} from './theme';

// Each scene's sequence extends by its own transition_out frames into the
// next scene; the next scene (later in DOM = on top) animates in over that
// overlap, driven by the previous scene's transition.
export const MainVideo: React.FC<{ir: RenderIR}> = ({ir}) => {
  const {fps, total_frames: totalFrames, music} = ir.metadata;
  return (
    <ThemeProvider value={themeOf(ir)}>
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {music ? (
        <Audio
          src={asset(music.src)}
          loop
          volume={(f) => {
            // Fade in/out, but keep the interpolate input range strictly
            // increasing even for very short videos (else Remotion throws and
            // the whole render fails). Below ~4 frames, just hold the level.
            if (totalFrames < 4) return music.volume;
            const fi = Math.max(1, Math.min(Math.round(fps * 2), Math.floor(totalFrames / 4)));
            const fo = Math.min(totalFrames - 1, Math.max(fi + 1, totalFrames - Math.round(fps * 3)));
            return (
              music.volume *
              interpolate(f, [0, fi, fo, totalFrames], [0, 1, 1, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            );
          }}
        />
      ) : null}
      {ir.scenes.map((scene, i) => {
        const overlap = transitionFrames(scene.transition_out, fps);
        const prevTransition: Transition | null =
          i === 0 ? null : ir.scenes[i - 1].transition_out;
        return (
          <Sequence
            key={scene.scene}
            from={scene.start_frame}
            durationInFrames={scene.duration_frames + overlap}
            name={`Scene ${scene.scene}`}
          >
            <SceneRenderer scene={scene} sceneIdx={i} fps={fps} prevTransition={prevTransition} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
    </ThemeProvider>
  );
};
