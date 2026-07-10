// Curated Google Fonts catalog. Every font is loaded at module import (each
// loadFont() registers a delayRender internally, so the render waits until the
// webfont is ready) — this replaces the old system-only stack (DejaVu /
// Liberation) that rendered inconsistently across machines and not at all in
// the browser preview.
//
// The flow's Design Director picks one of these by FAMILY NAME (see
// FONT_STYLES in ir_builder.py); the renderer resolves that name to the loaded
// font here. Keep this list and the Python catalog in sync.
import {loadFont as poppins} from '@remotion/google-fonts/Poppins';
import {loadFont as inter} from '@remotion/google-fonts/Inter';
import {loadFont as montserrat} from '@remotion/google-fonts/Montserrat';
import {loadFont as oswald} from '@remotion/google-fonts/Oswald';
import {loadFont as bebas} from '@remotion/google-fonts/BebasNeue';
import {loadFont as anton} from '@remotion/google-fonts/Anton';
import {loadFont as spaceGrotesk} from '@remotion/google-fonts/SpaceGrotesk';
import {loadFont as playfair} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as lora} from '@remotion/google-fonts/Lora';
import {loadFont as dmSerif} from '@remotion/google-fonts/DMSerifDisplay';
import {loadFont as jetbrains} from '@remotion/google-fonts/JetBrainsMono';

// Fallback stack appended to every resolved family so a missing glyph or a
// still-loading webfont degrades to a sane system face, never a serif surprise.
const SANS = ', system-ui, sans-serif';
const SERIF = ', Georgia, serif';
const MONO = ', ui-monospace, monospace';

// familyName → loaded CSS font stack. loadFont() returns {fontFamily} = the
// exact Google name, so keys here match what the flow may emit.
const LOADED: Record<string, string> = {
  [poppins().fontFamily]: poppins().fontFamily + SANS,
  [inter().fontFamily]: inter().fontFamily + SANS,
  [montserrat().fontFamily]: montserrat().fontFamily + SANS,
  [oswald().fontFamily]: oswald().fontFamily + SANS,
  [bebas().fontFamily]: bebas().fontFamily + SANS,
  [anton().fontFamily]: anton().fontFamily + SANS,
  [spaceGrotesk().fontFamily]: spaceGrotesk().fontFamily + SANS,
  [playfair().fontFamily]: playfair().fontFamily + SERIF,
  [lora().fontFamily]: lora().fontFamily + SERIF,
  [dmSerif().fontFamily]: dmSerif().fontFamily + SERIF,
  [jetbrains().fontFamily]: jetbrains().fontFamily + MONO,
};

// Names the AI may use in edits ("use Playfair for the captions"). Exact,
// case-insensitive, or a loose contains-match against a catalog family.
export function resolveFont(family?: string): string | undefined {
  if (!family) return undefined;
  const raw = family.trim();
  if (LOADED[raw]) return LOADED[raw]; // exact catalog name
  const lower = raw.toLowerCase();
  for (const name of Object.keys(LOADED)) {
    if (name.toLowerCase() === lower) return LOADED[name];
  }
  // A CSS stack or bare name that names a catalog font somewhere inside it.
  for (const name of Object.keys(LOADED)) {
    if (lower.includes(name.toLowerCase())) return LOADED[name];
  }
  return raw; // unknown → use as-is (may be a system font or already a stack)
}

// The catalog's family names — handed to the Design Director / edit agent so
// they only ever pick fonts that are actually loaded.
export const CATALOG_FAMILIES = Object.keys(LOADED);
