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
import {LayerBox} from './layers/LayerBox';

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
  if (prevTransition && prevTransition.type !== 'cut') {
    const t = transitionFrames(prevTransition, fps);
    if (t > 0) {
      const progress = interpolate(frame, [0, t], [0, 1], {
        extrapolateRight: 'clamp',
      });
      if (prevTransition.type === 'crossfade') {
        opacity = progress;
      } else {
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
        return <ShaderLayer kind={layer.kind} />;
      case 'lottie':
        return <LottieLayer src={layer.src} loop={layer.loop} />;
      case 'captions':
        return <CaptionLayer words={layer.words} fps={fps} style={layer.style} />;
      case 'graphic':
        return <GraphicLayer layer={layer} fps={fps} durationFrames={scene.duration_frames} />;
      case 'text':
        return <TextLayer layer={layer} fps={fps} durationFrames={scene.duration_frames} />;
      default:
        return null;
    }
  };

  return (
    <AbsoluteFill style={{opacity, transform: `translateX(${translateX}px)`}}>
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
