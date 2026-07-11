import {AbsoluteFill, Freeze, Video, useCurrentFrame} from 'remotion';
import type {VideoLayer as VideoLayerType} from '../ir';
import {asset} from '../ir';

export const VideoLayer: React.FC<{layer: VideoLayerType; fps: number}> = ({
  layer,
  fps,
}) => {
  const frame = useCurrentFrame();
  // These fields are optional on the IR (AI-added / edited layers may omit
  // them); default them so Remotion never gets a NaN trim prop.
  const startFrom = Math.round((layer.trim_start_s ?? 0) * fps);
  const endAt =
    layer.trim_end_s == null ? undefined : Math.round(layer.trim_end_s * fps);
  const playbackRate = layer.playback_rate ?? 1;
  // Clips are silent by default (volume absent/0). A manual mix or a Director
  // edit raises layer.volume; only then do we un-mute and play the clip audio.
  const vol = Math.max(0, Math.min(1, layer.volume ?? 0));

  const style = {
    width: '100%',
    height: '100%',
    objectFit: layer.fit === 'contain' ? ('contain' as const) : ('cover' as const),
  };

  // Measured on this machine (software WebGL, CPU-only): the browser <Video>
  // path renders ~2× faster than <OffthreadVideo>'s per-frame FFmpeg
  // extraction on high-res H.264 stock clips — so <Video> stays.
  const video = (
    <Video
      src={asset(layer.src)}
      muted={vol <= 0}
      volume={vol}
      loop={layer.loop}
      startFrom={startFrom}
      endAt={endAt}
      playbackRate={playbackRate}
      style={style}
    />
  );

  // freeze_last: play the clip once, then hold its last frame.
  if (layer.freeze_last && endAt !== undefined) {
    const clipFrames = Math.floor((endAt - startFrom) / playbackRate);
    if (frame >= clipFrames) {
      return (
        <AbsoluteFill>
          <Freeze frame={Math.max(0, clipFrames - 1)}>{video}</Freeze>
        </AbsoluteFill>
      );
    }
  }

  return <AbsoluteFill>{video}</AbsoluteFill>;
};
