import {createContext, useContext} from 'react';
import type {RenderIR} from './ir';
import {resolveFont} from './fonts';

export type Theme = {
  mood: string;
  palette: {
    bg: string;
    bg_light: string;
    accent: string;
    accent2: string;
    text: string;
  };
  font: {
    family: string;
    caption_size: number;
    title_size: number;
  };
};

export const DEFAULT_THEME: Theme = {
  mood: 'calm',
  palette: {
    bg: '#0f1116',
    bg_light: '#e9edf2',
    accent: '#6EE7F9',
    accent2: '#4f46e5',
    text: '#ffffff',
  },
  font: {
    family: 'Poppins, system-ui, sans-serif',
    caption_size: 46,
    title_size: 92,
  },
};

export const themeOf = (ir: RenderIR): Theme => {
  const t = (ir.metadata as {theme?: Partial<Theme>}).theme;
  if (!t || !t.palette) return DEFAULT_THEME;
  const font = {...DEFAULT_THEME.font, ...t.font};
  // The flow emits a Google family name; resolve it to the loaded stack.
  font.family = resolveFont(font.family) ?? DEFAULT_THEME.font.family;
  return {
    mood: t.mood ?? DEFAULT_THEME.mood,
    palette: {...DEFAULT_THEME.palette, ...t.palette},
    font,
  };
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

const ThemeContext = createContext<Theme>(DEFAULT_THEME);
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);
