import {AbsoluteFill, Audio, interpolate, Sequence} from 'remotion';
import {SceneRenderer} from './SceneRenderer';
import type {RenderIR, Transition} from './ir';
import {asset, setAssetBase, transitionFrames} from './ir';
import {ThemeProvider, themeOf} from './theme';
import type {Theme} from './theme';
import {StyleProvider, styleOf, setLite} from './styles';
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
// Music level at time t: full in the gaps, dipped to `duck` (relative) while
// the voice speaks, with short ramps either side; a lift after `swell_at` for
// the finale. Spans come from the voice-over's word timings.
type Music = NonNullable<RenderIR['metadata']['music']> & {
  start_s?: number; loop?: boolean; duck?: number; spans?: [number, number][]; swell_at?: number; swell?: number;
};
const RAMP = 0.3;
function duckGain(m: Music, t: number): number {
  const duck = m.duck ?? 1;
  let g = 1;
  for (const [a, b] of m.spans ?? []) {
    if (t < a - RAMP || t > b + RAMP) continue;
    const inRamp = t < a ? (a - t) / RAMP : t > b ? (t - b) / RAMP : 0;
    g = Math.min(g, duck + (1 - duck) * inRamp);
  }
  if (m.swell_at !== undefined && t > m.swell_at) g *= 1 + ((m.swell ?? 1.4) - 1) * Math.min(1, (t - m.swell_at) / 0.8);
  return g;
}

// next scene; the next scene (later in DOM = on top) animates in over that
// overlap, driven by the previous scene's transition.
export const MainVideo: React.FC<{ir: RenderIR}> = ({ir}) => {
  setAssetBase((ir.metadata as {asset_base?: string}).asset_base);
  setLite((ir.metadata as {lite?: boolean}).lite);
  const {fps, total_frames: totalFrames} = ir.metadata;
  const music = ir.metadata.music as Music | undefined;
  const pack = styleOf(ir);
  const theme = pack ? themeFromPack(themeOf(ir), pack) : themeOf(ir);
  const {brand_font: brandFont, brand_font_css: brandFontCss} = ir.metadata as {brand_font?: string; brand_font_css?: string};
  return (
    <StyleProvider value={pack}>
    <ThemeProvider value={theme}>
    {brandFont ? <BrandFont family={brandFont} href={brandFontCss} /> : null}
    <AbsoluteFill style={{backgroundColor: pack ? pack.palette.bg : '#000'}}>
      {music ? (
        <Audio
          src={asset(music.src)}
          loop={music.loop ?? true}
          // Start partway into the track so its energy peak lands on the finale.
          startFrom={music.start_s ? Math.round(music.start_s * fps) : undefined}
          volume={(f) => {
            // Fade in/out, but keep the interpolate input range strictly
            // increasing even for very short videos (else Remotion throws and
            // the whole render fails). Below ~4 frames, just hold the level.
            if (totalFrames < 4) return music.volume;
            const fi = Math.max(1, Math.min(Math.round(fps * 1.2), Math.floor(totalFrames / 4)));
            const fo = Math.min(totalFrames - 1, Math.max(fi + 1, totalFrames - Math.round(fps * 2.5)));
            const fade = interpolate(f, [0, fi, fo, totalFrames], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return music.volume * fade * duckGain(music, f / fps);
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
