import {AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame} from 'remotion';
import type {IRScene, Transition} from './ir';
import {asset, transitionFrames} from './ir';
import type {Layer} from './ir';
import {VideoLayer} from './layers/VideoLayer';
import {ImageLayer} from './layers/ImageLayer';
import {TextLayer} from './layers/TextLayer';
import {GraphicLayer} from './layers/GraphicLayer';
import {CaptionLayer} from './layers/CaptionLayer';
import {LottieLayer} from './layers/LottieLayer';
import {ShaderLayer} from './layers/ShaderLayer';
import {MotionLayer} from './layers/MotionLayer';
import {LayerBox} from './layers/LayerBox';
import {TemplateLayer} from './templates';

export const SceneRenderer: React.FC<{
  scene: IRScene;
  sceneIdx: number;
  fps: number;
  prevTransition: Transition | null;
}> = ({scene, sceneIdx, fps, prevTransition}) => {
  const frame = useCurrentFrame();

  // Entrance driven by the previous scene's transition_out.
  let opacity = 1;
  let translateX = 0;
  let scale = 1;
  let blur = 0;
  let clip: string | undefined;
  if (prevTransition && prevTransition.type !== 'cut') {
    const t = transitionFrames(prevTransition, fps);
    if (t > 0) {
      const progress = interpolate(frame, [0, t], [0, 1], {
        extrapolateRight: 'clamp',
      });
      const ease = 1 - (1 - progress) ** 3;
      switch (prevTransition.type) {
        case 'crossfade':
          opacity = progress;
          break;
        case 'zoom': // push in from slightly small + fade
          opacity = progress;
          scale = 0.86 + 0.14 * ease;
          break;
        case 'blur':
          opacity = progress;
          blur = (1 - ease) * 24;
          break;
        case 'wipe': // reveal left → right
          clip = `inset(0 ${(1 - ease) * 100}% 0 0)`;
          break;
        case 'whip': // fast slide with motion blur
          translateX = (1 - ease) * 1400;
          blur = (1 - ease) * 30;
          break;
        default: // slide
          opacity = progress;
          translateX = (1 - progress) * 120;
      }
    }
  }

  const renderLayer = (layer: Layer) => {
    switch (layer.type) {
      case 'solid':
        return <AbsoluteFill style={{backgroundColor: layer.color}} />;
      case 'video':
        return <VideoLayer layer={layer} fps={fps} />;
      case 'image':
        return <ImageLayer layer={layer} durationFrames={scene.duration_frames} />;
      case 'shader':
        return <ShaderLayer layer={layer} />;
      case 'motion':
        return <MotionLayer layer={layer} fps={fps} />;
      case 'lottie':
        return <LottieLayer src={layer.src} loop={layer.loop} />;
      case 'captions':
        return <CaptionLayer words={layer.words} fps={fps} style={layer.style} />;
      case 'graphic':
        return <GraphicLayer layer={layer} fps={fps} durationFrames={scene.duration_frames} />;
      case 'text':
        return <TextLayer layer={layer} fps={fps} durationFrames={scene.duration_frames} />;
      case 'template':
        return <TemplateLayer layer={layer} fps={fps} durationFrames={scene.duration_frames} />;
      default:
        return null;
    }
  };

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${translateX}px) scale(${scale})`,
        filter: blur ? `blur(${blur}px)` : undefined,
        clipPath: clip,
      }}
    >
      {scene.layers.map((layer, i) => {
        // Audio is non-visual — no wrapper. SFX cues carry a start offset.
        if (layer.type === 'audio') {
          const from = Math.round((layer.start_s ?? 0) * fps);
          const audio = <Audio src={asset(layer.src)} volume={layer.volume ?? 1} />;
          return from > 0 ? (
            <Sequence key={i} from={from} name="sfx">{audio}</Sequence>
          ) : (
            <Audio key={i} src={asset(layer.src)} volume={layer.volume ?? 1} />
          );
        }
        return (
          <LayerBox key={i} layer={layer} sceneIdx={sceneIdx} layerIdx={i}>
            {renderLayer(layer)}
          </LayerBox>
        );
      })}
    </AbsoluteFill>
  );
};
