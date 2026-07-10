import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import type {TextLayer as TextLayerType} from '../ir';
import {useTheme} from '../theme';
import {resolveFont} from '../fonts';

const POSITION_STYLES: Record<TextLayerType['position'], React.CSSProperties> = {
  lower_third: {justifyContent: 'flex-end', paddingBottom: '12%'},
  center: {justifyContent: 'center'},
  top: {justifyContent: 'flex-start', paddingTop: '8%'},
};

const ENTER_FRAMES = 20;

export const TextLayer: React.FC<{
  layer: TextLayerType;
  fps: number;
  durationFrames: number;
}> = ({layer, fps, durationFrames}) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const enterAt = Math.round(layer.enter.at_s * fps);
  const exitAt = Math.min(Math.round(layer.exit.at_s * fps), durationFrames - 1);

  if (frame < enterAt) {
    return null;
  }

  const enterProgress = interpolate(frame, [enterAt, enterAt + ENTER_FRAMES], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const exitOpacity = interpolate(frame, [exitAt, exitAt + 12], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  let content = layer.content;
  let opacity = enterProgress * exitOpacity;
  let transform = 'none';

  switch (layer.enter.anim) {
    case 'fade_up':
      transform = `translateY(${(1 - enterProgress) * 30}px)`;
      break;
    case 'slide_in':
      transform = `translateX(${(1 - enterProgress) * -80}px)`;
      break;
    case 'typewriter': {
      const chars = Math.round(
        interpolate(frame, [enterAt, enterAt + fps * 1.2], [0, layer.content.length], {
          extrapolateRight: 'clamp',
        })
      );
      content = layer.content.slice(0, chars);
      opacity = exitOpacity;
      break;
    }
  }

  return (
    <AbsoluteFill
      style={{
        ...POSITION_STYLES[layer.position],
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          opacity,
          transform,
          fontFamily: resolveFont(layer.style?.font_family) ?? theme.font.family,
          fontSize: layer.style?.font_size ?? theme.font.caption_size + 10,
          fontWeight: layer.style?.font_weight ?? 700,
          fontStyle: layer.style?.italic ? 'italic' : 'normal',
          letterSpacing: layer.style?.letter_spacing != null ? `${layer.style.letter_spacing}px` : undefined,
          color: layer.style?.color ?? theme.palette.text,
          background: layer.style?.bg ?? 'rgba(0, 0, 0, 0.55)',
          padding: '16px 40px',
          borderRadius: 12,
          maxWidth: '80%',
          textAlign: layer.style?.align ?? 'center',
        }}
      >
        {content}
      </div>
    </AbsoluteFill>
  );
};
