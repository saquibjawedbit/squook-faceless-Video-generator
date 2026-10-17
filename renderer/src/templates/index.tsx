import type {TemplateLayer as TemplateLayerType} from '../ir';
import {Hero} from './Hero';
import {Cta} from './Cta';
import {Stat} from './Stat';
import {Stats} from './Stats';
import {Icons} from './Icons';
import {Chart} from './Chart';
import {Steps} from './Steps';
import {Chat} from './Chat';
import {Split} from './Split';
import {BeforeAfter} from './BeforeAfter';
import {Compare} from './Compare';
import {Quote} from './Quote';
import {Kinetic} from './Kinetic';
import {Phone} from './Phone';
import {Logos} from './Logos';
import {Screen} from './Screen';
import {Backdrop} from './Backdrop';
import {Visual} from './Visual';
import {Formula} from './Formula';
import {Graph} from './Graph';

/**
 * Scene templates. Every template receives the same props:
 *   { p: props for its kind, layout, beats, fps, durationFrames }
 * and styles itself from useStyle() (../styles). Props per kind
 * (all strings are short on-screen copy; srcs are project asset paths):
 *
 *   hero         { eyebrow?, title, subtitle?, logo? }                  layout: left | center
 *   cta          { title, subtitle?, button?, url?, logo? }
 *   stat         { number, prefix?, suffix?, label, context? }          layout: left | center
 *   stats        { title?, items: [{ number, prefix?, suffix?, label }] } 2–3 items
 *   icons        { title?, items: [{ icon_src?, label, text? }] }       2–4 items
 *   chart        { title?, unit?, items: [{ label, value }], highlight? } 3–6 items; highlight = index
 *   steps        { title?, items: [{ title, text? }] }                  3–4 items
 *   chat         { app?, contact?, messages: [{ from: 'them'|'me', text, time? }],
 *                  result?: { title, rows: [{ left, right, flag? }] } }  messages then (optional) clean table
 *   split        { eyebrow?, title, text?, bullets?: string[], image }   layout: left | right (image side)
 *   before_after { title?, before: { label, items: string[] }, after: { label, items: string[] } }
 *   compare      { title?, columns: [string, string], rows: [{ label, a: boolean|string, b: boolean|string }] }
 *   quote        { text, author?, role? }
 *   kinetic      { lines: string[] }  big type; one beat per line
 *   phone        { image, title?, text? }                                layout: left | right (phone side)
 *   logos        { title?, logos: string[] }
 *   visual       { image, title?, caption?, move?: 'push'|'pull'|'pan_left'|'pan_right' }  full-bleed AI picture  layout: left | center | right
 *   backdrop     { kind?: 'gradient'|'dots'|'grid'|'solid' }  the pack's background (first layer)
 *   formula      { title?, expr: "V = I × R", parts: [{ sym, label, unit? }], note? }  symbols light up on their cues
 *   graph        { title?, x_label, y_label, points: [{ x, y }], note?, highlight? }  x–y line that draws itself
 *   screen       { image, img_w, img_h, title?, focus: [{ box: [x,y,w,h] (0–1), at (s), action: 'zoom'|'highlight'|'click', label? }] }
 */
export type TemplateProps = {
  p: Record<string, any>;
  layout?: string;
  beats?: number[];
  fps: number;
  durationFrames: number;
};

const KINDS: Record<string, React.FC<TemplateProps>> = {
  hero: Hero, cta: Cta, stat: Stat, stats: Stats, icons: Icons, chart: Chart,
  steps: Steps, chat: Chat, split: Split, before_after: BeforeAfter, compare: Compare,
  quote: Quote, kinetic: Kinetic, phone: Phone, logos: Logos, screen: Screen,
  visual: Visual, formula: Formula, graph: Graph,
  backdrop: ({p}) => <Backdrop kind={p.kind} image={p.image} />,
};

export const TemplateLayer: React.FC<{layer: TemplateLayerType; fps: number; durationFrames: number}> = ({layer, fps, durationFrames}) => {
  const C = KINDS[layer.kind];
  if (!C) return null;
  return <C p={layer.props || {}} layout={layer.layout} beats={layer.beats} fps={fps} durationFrames={durationFrames} />;
};
