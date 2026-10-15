import {createContext, useContext} from 'react';
import type {RenderIR} from './ir';
import {resolveFont} from './fonts';

// Style packs: one complete look per video — fonts, colour rules, background,
// motion feel, captions and transitions. Templates (./templates) read only
// from here, so swapping the pack restyles every scene consistently.
// The brand's own colours (metadata.theme.palette) feed into each pack; a pack
// decides how to use them (e.g. "clean" keeps a light canvas and uses the
// brand colour as the accent only).

export type StyleId = 'clean' | 'bold' | 'tech' | 'playful' | 'corporate' | 'editorial';
export type EnterKind = 'rise' | 'pop' | 'blur' | 'slide' | 'mask';
export type BackgroundKind = 'shader' | 'gradient' | 'grid' | 'dots' | 'solid';

export type StylePack = {
  id: StyleId;
  font: {heading: string; body: string; mono: string};
  headingWeight: number;
  headingCase: 'none' | 'upper';
  headingTracking: number; // em
  palette: {bg: string; surface: string; text: string; muted: string; accent: string; accent2: string; onAccent: string};
  radius: number;
  // Motion feel: spring config + gap between staggered items (frames).
  spring: {damping: number; stiffness: number; mass: number};
  stagger: number;
  enter: EnterKind;
  background: {kind: BackgroundKind; shader?: 'nebula' | 'waves' | 'grid' | 'aurora' | 'mesh' | 'rays'};
  card: {bg: string; border: string; shadow: string};
  caption: {box: boolean; uppercase: boolean; size: number; weight: number; highlight: string; position: 'bottom' | 'center'};
  transition: 'crossfade' | 'slide' | 'zoom' | 'wipe' | 'whip' | 'blur';
  scale: number; // type-size multiplier (bold packs shout, editorial whispers)
  logoTone?: 'light' | 'dark'; // brightness of the captured brand logo
};

// ── colour helpers ──────────────────────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const mix = (a: string, b: string, t: number) => {
  const A = rgb(a), B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
export const alpha = (h: string, a: number) => h + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
const readableOn = (bg: string) => (luminance(bg) > 0.45 ? '#0d0f14' : '#ffffff');
// An accent that is too close to the canvas is pushed toward contrast.
const legibleAccent = (accent: string, bg: string) => {
  const d = Math.abs(luminance(accent) - luminance(bg));
  if (d > 0.18) return accent;
  return luminance(bg) > 0.5 ? mix(accent, '#000000', 0.45) : mix(accent, '#ffffff', 0.35);
};

type Brand = {bg?: string; accent?: string; accent2?: string; text?: string};

const f = (name: string) => resolveFont(name) ?? name;

// ── the packs ───────────────────────────────────────────────────────────────
function build(id: StyleId, brand: Brand, brandFont?: string): StylePack {
  const accentIn = HEX.test(brand.accent || '') ? brand.accent! : '#4f7cff';
  const accent2In = HEX.test(brand.accent2 || '') ? brand.accent2! : mix(accentIn, '#ffffff', 0.35);
  const brandBg = HEX.test(brand.bg || '') ? brand.bg! : '#0f1116';
  const bf = brandFont ? `'${brandFont}', ` : '';

  switch (id) {
    case 'clean': {
      const bg = '#f6f6f3';
      const accent = legibleAccent(accentIn, bg);
      return {
        id, font: {heading: bf + f('Inter'), body: f('Inter'), mono: f('JetBrains Mono')},
        headingWeight: 700, headingCase: 'none', headingTracking: -0.03,
        palette: {bg, surface: '#ffffff', text: '#111317', muted: '#5d6370', accent, accent2: mix(accent, '#ffffff', 0.55), onAccent: readableOn(accent)},
        radius: 22, spring: {damping: 200, stiffness: 120, mass: 1}, stagger: 6, enter: 'rise',
        background: {kind: 'gradient'},
        card: {bg: '#ffffff', border: 'rgba(17,19,23,0.08)', shadow: '0 30px 80px rgba(17,19,23,0.12)'},
        caption: {box: false, uppercase: false, size: 46, weight: 600, highlight: accent, position: 'bottom'},
        transition: 'blur', scale: 1,
      };
    }
    case 'bold': {
      const bg = '#0b0b0d';
      const accent = legibleAccent(accentIn, bg);
      return {
        id, font: {heading: f('Anton'), body: f('Montserrat'), mono: f('JetBrains Mono')},
        headingWeight: 400, headingCase: 'upper', headingTracking: 0.01,
        palette: {bg, surface: '#17171b', text: '#ffffff', muted: '#a3a3ad', accent, accent2: accent2In, onAccent: readableOn(accent)},
        radius: 8, spring: {damping: 12, stiffness: 180, mass: 0.6}, stagger: 4, enter: 'pop',
        background: {kind: 'solid'},
        card: {bg: '#17171b', border: 'rgba(255,255,255,0.10)', shadow: 'none'},
        caption: {box: true, uppercase: true, size: 54, weight: 800, highlight: accent, position: 'center'},
        transition: 'whip', scale: 1.25,
      };
    }
    case 'tech': {
      const bg = luminance(brandBg) < 0.08 ? brandBg : '#070a12';
      const accent = legibleAccent(accentIn, bg);
      return {
        id, font: {heading: bf + f('Space Grotesk'), body: f('Inter'), mono: f('JetBrains Mono')},
        headingWeight: 700, headingCase: 'none', headingTracking: -0.02,
        palette: {bg, surface: mix(bg, '#ffffff', 0.06), text: '#e9edf5', muted: '#8a93a6', accent, accent2: accent2In, onAccent: readableOn(accent)},
        radius: 14, spring: {damping: 26, stiffness: 140, mass: 0.8}, stagger: 5, enter: 'blur',
        background: {kind: 'shader', shader: 'grid'},
        card: {bg: alpha(mix(bg, '#ffffff', 0.06), 0.85), border: alpha(accent, 0.28), shadow: `0 0 60px ${alpha(accent, 0.18)}`},
        caption: {box: true, uppercase: false, size: 46, weight: 700, highlight: accent, position: 'bottom'},
        transition: 'zoom', scale: 1,
      };
    }
    case 'playful': {
      const bg = mix(accentIn, '#ffffff', 0.86);
      const accent = legibleAccent(accentIn, bg);
      return {
        id, font: {heading: bf + f('Poppins'), body: f('Poppins'), mono: f('JetBrains Mono')},
        headingWeight: 800, headingCase: 'none', headingTracking: -0.02,
        palette: {bg, surface: '#ffffff', text: '#1d1a2b', muted: '#6b6680', accent, accent2: legibleAccent(accent2In, bg), onAccent: readableOn(accent)},
        radius: 34, spring: {damping: 9, stiffness: 160, mass: 0.7}, stagger: 6, enter: 'pop',
        background: {kind: 'dots'},
        card: {bg: '#ffffff', border: 'rgba(29,26,43,0.06)', shadow: `0 18px 0 ${alpha(accent, 0.25)}`},
        caption: {box: true, uppercase: false, size: 50, weight: 800, highlight: accent, position: 'bottom'},
        transition: 'slide', scale: 1.08,
      };
    }
    case 'corporate': {
      const bg = '#0e1a2b';
      const accent = legibleAccent(accentIn, bg);
      return {
        id, font: {heading: bf + f('Montserrat'), body: f('Inter'), mono: f('JetBrains Mono')},
        headingWeight: 700, headingCase: 'none', headingTracking: -0.01,
        palette: {bg, surface: '#16263d', text: '#f2f5f9', muted: '#9aa8bb', accent, accent2: accent2In, onAccent: readableOn(accent)},
        radius: 12, spring: {damping: 200, stiffness: 90, mass: 1}, stagger: 7, enter: 'slide',
        background: {kind: 'gradient'},
        card: {bg: '#16263d', border: 'rgba(255,255,255,0.08)', shadow: '0 24px 60px rgba(0,0,0,0.35)'},
        caption: {box: false, uppercase: false, size: 44, weight: 600, highlight: accent, position: 'bottom'},
        transition: 'crossfade', scale: 0.95,
      };
    }
    case 'editorial':
    default: {
      const bg = '#f3efe6';
      const accent = legibleAccent(accentIn, bg);
      return {
        id: 'editorial', font: {heading: f('Playfair Display'), body: f('Lora'), mono: f('JetBrains Mono')},
        headingWeight: 700, headingCase: 'none', headingTracking: -0.02,
        palette: {bg, surface: '#fbf8f1', text: '#1b1712', muted: '#6e6455', accent, accent2: mix(accent, bg, 0.5), onAccent: readableOn(accent)},
        radius: 4, spring: {damping: 200, stiffness: 70, mass: 1.2}, stagger: 8, enter: 'mask',
        background: {kind: 'solid'},
        card: {bg: '#fbf8f1', border: 'rgba(27,23,18,0.14)', shadow: 'none'},
        caption: {box: false, uppercase: false, size: 44, weight: 500, highlight: accent, position: 'bottom'},
        transition: 'wipe', scale: 1,
      };
    }
  }
}

export const STYLE_IDS: StyleId[] = ['clean', 'bold', 'tech', 'playful', 'corporate', 'editorial'];

type StyleMeta = {style?: string; brand_font?: string; logo_tone?: 'light' | 'dark'; theme?: {palette?: Brand}};

/** The pack for an IR, or null for older IRs (which keep the legacy theme). */
export const styleOf = (ir: RenderIR): StylePack | null => {
  const md = ir.metadata as StyleMeta;
  if (!md.style || !STYLE_IDS.includes(md.style as StyleId)) return null;
  return {...build(md.style as StyleId, md.theme?.palette || {}, md.brand_font), logoTone: md.logo_tone};
};

const StyleContext = createContext<StylePack | null>(null);
export const StyleProvider = StyleContext.Provider;
export const useStyleOrNull = () => useContext(StyleContext);
export const useStyle = (): StylePack => {
  const s = useContext(StyleContext);
  // Templates are only ever emitted together with a style pack; this fallback
  // keeps a hand-edited IR from crashing the whole render.
  return s ?? build('tech', {});
};
