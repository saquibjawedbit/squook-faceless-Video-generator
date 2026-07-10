import {AbsoluteFill, Img, interpolate, useCurrentFrame} from 'remotion';
import type {ImageLayer as ImageLayerType} from '../ir';
import {asset} from '../ir';

export const ImageLayer: React.FC<{
  layer: ImageLayerType;
  durationFrames: number;
}> = ({layer, durationFrames}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateRight: 'clamp',
  });

  let scale = 1;
  let translateX = 0;
  switch (layer.ken_burns) {
    case 'zoom_in':
      scale = 1 + 0.12 * progress;
      break;
    case 'zoom_out':
      scale = 1.12 - 0.12 * progress;
      break;
    case 'pan_left':
      scale = 1.1;
      translateX = interpolate(progress, [0, 1], [4, -4]);
      break;
    case 'pan_right':
      scale = 1.1;
      translateX = interpolate(progress, [0, 1], [-4, 4]);
      break;
  }

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={asset(layer.src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: layer.fit === 'contain' ? 'contain' : 'cover',
          transform: `scale(${scale}) translateX(${translateX}%)`,
        }}
      />
    </AbsoluteFill>
  );
};
