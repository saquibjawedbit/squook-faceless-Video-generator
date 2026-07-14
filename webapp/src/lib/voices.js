// Narration voice catalog — mirrors guide_creator_flow's tts.VOICES ids.
// Samples are pre-synthesized Kokoro clips in public/voices/ (one per voice),
// so previews are instant, work offline, and sound exactly like generation.

export const VOICES = [
  { id: 'nova',  label: 'Nova',  desc: 'US female · warm & friendly' },
  { id: 'atlas', label: 'Atlas', desc: 'US male · deep & steady' },
  { id: 'juno',  label: 'Juno',  desc: 'US female · bright & energetic' },
  { id: 'ryan',  label: 'Ryan',  desc: 'British male · calm documentary' },
  { id: 'sonia', label: 'Sonia', desc: 'British female · polished' },
  { id: 'guy',   label: 'Guy',   desc: 'US male · relaxed & conversational' },
];

export const sampleSrc = (id) => `/voices/${id}.wav`;

// One shared <audio> so starting a preview always stops the previous one.
// Components subscribe to know which sample is playing (for the ▶/■ state).
let player = null;
let playingId = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(playingId));

export function playSample(id) {
  if (playingId === id) { stopSample(); return; } // toggle off
  stopSample();
  player = new Audio(sampleSrc(id));
  playingId = id;
  player.onended = () => { playingId = null; player = null; notify(); };
  player.play().catch(() => { playingId = null; player = null; notify(); });
  notify();
}

export function stopSample() {
  if (player) { player.pause(); player = null; }
  if (playingId !== null) { playingId = null; notify(); }
}

export const currentSample = () => playingId;
export function onSampleChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
