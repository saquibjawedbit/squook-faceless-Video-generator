import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Software WebGL for headless rendering — without this, shader canvases
// come out black on machines without a GPU.
Config.setChromiumOpenGlRenderer('swangle');
// Concurrency: measured on this machine (600-frame slices, same IR):
// c4 2m07s · c6 (default) 2m09s · c8 2m48s · c10 2m28s. c4 renders as fast
// as the default but holds ~2 fewer Chromium tabs (~0.5-1GB RAM) — on this
// 7GB box that margin is what keeps the render out of swap when the rest of
// the stack is running. Raise this only after a RAM upgrade.
// Also measured and rejected: <OffthreadVideo> 2.2× slower than <Video>
// (5m23s vs 2m28s — FFmpeg per-frame extraction loses to browser decode);
// --gl=angle-egl 3m17s vs swangle 2m09s (GPU readback overhead, no shader
// scenes to amortize it).
Config.setConcurrency(4);
