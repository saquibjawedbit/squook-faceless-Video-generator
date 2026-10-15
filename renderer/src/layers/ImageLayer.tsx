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

  // A website screenshot: shown as a browser window (title bar, rounded corners,
  // shadow) so it stands apart from a background of the same colour.
  if (layer.frame) {
    const bar = 44;
    return (
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 18,
            overflow: 'hidden',
            background: '#1b1d22',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.4)',
            transform: `scale(${scale}) translateX(${translateX}%)`,
          }}
        >
          <div style={{height: bar, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', background: '#24262c'}}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <div key={c} style={{width: 14, height: 14, borderRadius: 7, background: c}} />
            ))}
          </div>
          <Img
            src={asset(layer.src)}
            style={{display: 'block', maxWidth: '100%', maxHeight: `calc(100% - ${bar}px)`, width: 'auto', height: 'auto'}}
          />
        </div>
      </AbsoluteFill>
    );
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
