import type {GraphicLayer as GraphicLayerType} from '../ir';
import {NodeGraph} from '../graphics/NodeGraph';
import {BarChart} from '../graphics/BarChart';
import {Counter} from '../graphics/Counter';
import {IconRow} from '../graphics/IconRow';
import {TitleCard} from '../graphics/TitleCard';
import {Annotate} from '../graphics/Annotate';

export const GraphicLayer: React.FC<{
  layer: GraphicLayerType;
  fps: number;
  durationFrames: number;
}> = ({layer, fps, durationFrames}) => {
  const p = layer.params;
  const ps = layer.part_styles;
  switch (layer.kind) {
    case 'node_graph':
      return (
        <NodeGraph
          nodeLayers={p.node_layers ?? [3, 4, 2]}
          labels={p.labels ?? []}
          pulse={p.pulse ?? 'forward'}
          fps={fps}
          partStyles={ps}
        />
      );
    case 'bar_chart':
      return (
        <BarChart
          values={p.values ?? [3, 6, 4, 8]}
          labels={p.labels ?? []}
          title={p.title ?? ''}
          fps={fps}
          partStyles={ps}
        />
      );
    case 'counter':
      return (
        <Counter
          number={p.number ?? 0}
          suffix={p.suffix ?? ''}
          label={p.label ?? ''}
          fps={fps}
          partStyles={ps}
        />
      );
    case 'icon_row':
      return <IconRow icons={p.icons ?? []} labels={p.labels ?? []} fps={fps} partStyles={ps} />;
    case 'title_card':
      return <TitleCard title={p.title ?? ''} subtitle={p.subtitle ?? ''} fps={fps} partStyles={ps} />;
    case 'annotate':
      return (
        <Annotate
          annotation={p.annotation ?? 'circle'}
          label={p.label ?? ''}
          fps={fps}
          durationFrames={durationFrames}
          partStyles={ps}
        />
      );
    default:
      return null;
  }
};
