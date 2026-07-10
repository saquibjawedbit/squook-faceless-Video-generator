import {createContext, useContext} from 'react';

// Editor bridge: the web editor provides this context around <MainVideo> so
// layers become selectable/draggable in the live preview. It is ALWAYS null
// during CLI renders — every editor feature must degrade to a no-op without it.
// `part` addresses a sub-element inside a composite graphic (counter number,
// title-card subtitle, …).
export type LayerRef = {scene: number; layer: number; part?: string};

export type EditorApi = {
  selected: LayerRef | null;
  select: (scene: number, layer: number, part?: string) => void;
  // Live-drag updates (rAF-throttled by the caller); history is pushed on commit.
  patchLayer: (scene: number, layer: number, patch: Record<string, unknown>) => void;
  patchPart: (scene: number, layer: number, part: string, stylePatch: Record<string, unknown>) => void;
  commit: () => void;
};

export const EditorContext = createContext<EditorApi | null>(null);
export const useEditor = (): EditorApi | null => useContext(EditorContext);

// Which layer a graphic's parts belong to — provided by LayerBox in editor mode.
export const LayerRefContext = createContext<{scene: number; layer: number} | null>(null);
