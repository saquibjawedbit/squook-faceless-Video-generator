import {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import type {CaptionWord, TextStyle} from '../ir';
import {useTheme} from '../theme';
import {resolveFont} from '../fonts';

const VERTICAL = {
  top: {justify: 'flex-start' as const, pad: {paddingTop: '9%'}},
  center: {justify: 'center' as const, pad: {}},
  bottom: {justify: 'flex-end' as const, pad: {paddingBottom: '6%'}},
};

const MAX_PHRASE_WORDS = 5;
const PHRASE_GAP_S = 0.6;
const PHRASE_HOLD_S = 0.3; // keep the phrase up briefly after its last word

// Karaoke-style captions: words grouped into short phrases by pause gaps,
// the currently spoken word highlighted.
export const CaptionLayer: React.FC<{
  words: CaptionWord[];
  fps: number;
  style?: TextStyle;
}> = ({words, fps, style}) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  const theme = useTheme();

  const phrases = useMemo(() => {
    const out: CaptionWord[][] = [];
    let current: CaptionWord[] = [];
    for (const w of words) {
      const prev = current[current.length - 1];
      if (
        current.length >= MAX_PHRASE_WORDS ||
        (prev && w.start_s - prev.end_s > PHRASE_GAP_S)
      ) {
        if (current.length) out.push(current);
        current = [];
      }
      current.push(w);
    }
    if (current.length) out.push(current);
    return out;
  }, [words]);

  const phrase = phrases.find(
    (p) => t >= p[0].start_s && t <= p[p.length - 1].end_s + PHRASE_HOLD_S
  );
  if (!phrase) return null;

  // All caption styling is overridable per-layer via the IR `style` (which the
  // Director/edit agent writes), falling back to the theme.
  const place = VERTICAL[style?.position ?? 'bottom'];
  const highlight = style?.highlight ?? theme.palette.accent;
  const fontFamily = resolveFont(style?.font_family) ?? theme.font.family;

  return (
    <AbsoluteFill
      style={{justifyContent: place.justify, alignItems: 'center', ...place.pad}}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 14px',
          maxWidth: '72%',
          background: style?.bg ?? 'rgba(0, 0, 0, 0.6)',
          padding: '14px 30px',
          borderRadius: 14,
        }}
      >
        {phrase.map((w, i) => {
          const active = t >= w.start_s && t <= w.end_s;
          return (
            <span
              key={i}
              style={{
                fontFamily,
                fontSize: style?.font_size ?? theme.font.caption_size,
                fontWeight: style?.font_weight ?? 700,
                fontStyle: style?.italic ? 'italic' : 'normal',
                letterSpacing: style?.letter_spacing != null ? `${style.letter_spacing}px` : undefined,
                textTransform: style?.uppercase ? 'uppercase' : 'none',
                lineHeight: 1.35,
                color: active ? highlight : (style?.color ?? theme.palette.text),
                transform: active ? 'scale(1.06)' : 'none',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
