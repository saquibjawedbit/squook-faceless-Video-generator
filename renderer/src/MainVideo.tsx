import {AbsoluteFill, Audio, interpolate, Sequence} from 'remotion';
import {SceneRenderer} from './SceneRenderer';
import type {RenderIR, Transition} from './ir';
import {asset, transitionFrames} from './ir';
import {ThemeProvider, themeOf} from './theme';
import type {Theme} from './theme';
import {StyleProvider, styleOf} from './styles';
import type {StylePack} from './styles';
import {BrandFont} from './templates/BrandFont';

// With a style pack, the legacy theme (used by shaders, captions and the older
// graphics) is derived from the pack so every layer agrees on colours/fonts.
const themeFromPack = (base: Theme, s: StylePack): Theme => ({
  ...base,
  palette: {bg: s.palette.bg, bg_light: s.palette.surface, accent: s.palette.accent, accent2: s.palette.accent2, text: s.palette.text},
  font: {...base.font, family: s.font.body, caption_size: s.caption.size},
});

// Each scene's sequence extends by its own transition_out frames into the
// next scene; the next scene (later in DOM = on top) animates in over that
// overlap, driven by the previous scene's transition.
export const MainVideo: React.FC<{ir: RenderIR}> = ({ir}) => {
  const {fps, total_frames: totalFrames, music} = ir.metadata;
  const pack = styleOf(ir);
  const theme = pack ? themeFromPack(themeOf(ir), pack) : themeOf(ir);
  const {brand_font: brandFont, brand_font_css: brandFontCss} = ir.metadata as {brand_font?: string; brand_font_css?: string};
  return (
    <StyleProvider value={pack}>
    <ThemeProvider value={theme}>
    {brandFont ? <BrandFont family={brandFont} href={brandFontCss} /> : null}
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
    </StyleProvider>
  );
};
