import {staticFile} from 'remotion';

// Optional editor overrides. Absent fields mean exactly the pre-editor
// behavior, so IRs from the Python builder need no changes.
export type Transform = {
  x_pct?: number; // translate, % of composition width  (-100..100)
  y_pct?: number; // translate, % of composition height (-100..100)
  scale?: number; // 0.1..5
  rotate_deg?: number; // -180..180
  opacity?: number; // 0..1
};

export type TextStyle = {
  font_size?: number; // px, overrides the theme size
  font_family?: string; // Google font name / css stack, overrides theme.font.family
  font_weight?: number; // 100–900
  italic?: boolean;
  letter_spacing?: number; // px
  align?: 'left' | 'center' | 'right';
  color?: string; // overrides theme.palette.text
  bg?: string; // overrides the default pill background
  // Captions only:
  position?: 'top' | 'center' | 'bottom'; // vertical placement (default bottom)
  highlight?: string; // active-word color (default theme accent)
  uppercase?: boolean; // force all-caps captions
};

export type VideoLayer = {
  type: 'video';
  src: string;
  fit: 'cover' | 'contain';
  playback_rate: number;
  loop: boolean;
  freeze_last: boolean;
  trim_start_s: number;
  trim_end_s: number | null;
  // Clip's own audio level, 0..1. Absent/0 = muted (the default — clips are
  // silent unless mixed up manually or by the Director), so existing IRs are
  // unchanged. 1 = full volume.
  volume?: number;
  transform?: Transform;
};

export type ImageLayer = {
  type: 'image';
  src: string;
  fit: 'cover' | 'contain';
  ken_burns: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right';
  transform?: Transform;
};

export type SolidLayer = {
  type: 'solid';
  color: string;
  transform?: Transform;
};

export type AudioLayer = {
  type: 'audio';
  src: string;
  volume?: number;
  start_s?: number; // offset into the scene (SFX cues); default 0
};

// Per-part overrides inside composite graphics (e.g. a counter's "number" vs
// its "label") — same optional-only contract as everything else.
export type PartStyle = TextStyle & {transform?: Transform};

export type GraphicLayer = {
  type: 'graphic';
  kind: 'node_graph' | 'bar_chart' | 'counter' | 'icon_row' | 'title_card' | 'annotate';
  transform?: Transform;
  part_styles?: Record<string, PartStyle>;
  params: {
    node_layers?: number[];
    labels?: string[];
    pulse?: 'forward' | 'backward' | 'none';
    values?: number[];
    title?: string;
    subtitle?: string;
    number?: number;
    suffix?: string;
    label?: string;
    icons?: string[];
    // Per-icon fetched SVG paths (Iconify). Aligned with `icons`; an entry may
    // be null when the fetch failed, in which case the renderer uses an emoji.
    icon_srcs?: (string | null)[];
    annotation?: 'arrow' | 'circle' | 'underline';
  };
};

export type ShaderIRLayer = {
  type: 'shader';
  kind: 'nebula' | 'waves' | 'grid' | 'aurora' | 'mesh' | 'rays';
  speed?: number; // time multiplier (default 1); <1 calmer, >1 livelier
  intensity?: number; // strength of the effect over the base bg (default 1)
  color_a?: string; // hex override for the primary accent the shader uses
  color_b?: string; // hex override for the secondary accent
  transform?: Transform;
};

// A keyframe animates a subset of a shape's props at time `t` (seconds into the
// scene). Missing props hold their base/previous value.
export type MotionKeyframe = {
  t: number;
  x?: number; // 0..100, % of canvas width
  y?: number; // 0..100, % of canvas height
  r?: number; // 0..100, % of min(width,height)
  scale?: number;
  rotate?: number; // degrees
  opacity?: number; // 0..1
};

// One primitive in a generic vector animation. Coordinates are 0..100 (% of the
// canvas) so they're resolution-independent. Colors are a theme token
// (accent|accent2|text|bg) or a hex string.
export type MotionShape = {
  kind: 'circle' | 'ring' | 'dot' | 'rect' | 'line' | 'text';
  x?: number; y?: number; // center (line: start point)
  x2?: number; y2?: number; // line end point
  r?: number; // circle/ring/dot radius, % of min dimension
  w?: number; h?: number; // rect size, % of canvas
  text?: string;
  size?: number; // text px
  fill?: string;
  stroke?: string;
  stroke_width?: number; // px
  opacity?: number;
  keyframes?: MotionKeyframe[];
};

// A data-authored custom animation: the Director composes shapes + keyframes and
// this layer interprets them deterministically — no generated code, no assets.
export type MotionLayer = {
  type: 'motion';
  shapes: MotionShape[];
  bg?: string; // optional background fill (token or hex); default transparent
  transform?: Transform;
};

export type LottieIRLayer = {
  type: 'lottie';
  src: string;
  loop: boolean;
  transform?: Transform;
};

export type CaptionWord = {
  word: string;
  start_s: number;
  end_s: number;
};

export type CaptionsLayer = {
  type: 'captions';
  words: CaptionWord[];
  transform?: Transform;
  style?: TextStyle;
};

export type TextLayer = {
  type: 'text';
  content: string;
  position: 'lower_third' | 'center' | 'top';
  enter: {anim: 'fade_up' | 'typewriter' | 'slide_in'; at_s: number};
  exit: {anim: 'fade'; at_s: number};
  transform?: Transform;
  style?: TextStyle;
};

export type Layer =
  | VideoLayer
  | ImageLayer
  | SolidLayer
  | AudioLayer
  | TextLayer
  | GraphicLayer
  | CaptionsLayer
  | LottieIRLayer
  | ShaderIRLayer
  | MotionLayer;


export type Transition = {
  type: 'cut' | 'crossfade' | 'slide';
  duration_s: number;
};

export type IRScene = {
  scene: number;
  start_frame: number;
  duration_frames: number;
  duration_s: number;
  narration: string;
  layers: Layer[];
  transition_out: Transition;
};

export type RenderIR = {
  metadata: {
    title: string;
    prompt: string;
    fps: number;
    width: number;
    height: number;
    scene_count: number;
    total_frames: number;
    total_duration_seconds: number;
    music?: {
      src: string;
      volume: number;
      // Required credit for a fetched Creative-Commons track (CC BY / CC0);
      // absent for the in-house synthesised bed.
      attribution?: {
        name?: string;
        artist?: string;
        page_url?: string;
        license?: string;
        license_name?: string;
      };
    };
  };
  scenes: IRScene[];
};

// IR paths look like "output/assets/scene_1.mp4"; media is synced to public/.
// The web editor sets __SQUOOK_ASSET_RESOLVE__ to serve a project's snapshot instead.
export const asset = (src: string): string => {
  const p = src.replace(/^output\//, '');
  const g = globalThis as {__SQUOOK_ASSET_RESOLVE__?: (p: string) => string};
  return g.__SQUOOK_ASSET_RESOLVE__ ? g.__SQUOOK_ASSET_RESOLVE__(p) : staticFile(p);
};

export const transitionFrames = (t: Transition, fps: number): number =>
  t.type === 'cut' ? 0 : Math.round(t.duration_s * fps);
