// AI revision of the review-screen script: the user types an instruction
// ("make it punchier", "add a scene about pricing", "shorten scene 2") and the
// local model rewrites the scene-by-scene script. Same model the flow uses;
// output is whitelisted and re-indexed before it goes back to the client.
import { chatJSON } from './ollama.js';

const SYSTEM = `You revise a short video's scene-by-scene script from a plain-language instruction.
Rules:
- NARRATION is ONLY the words the voice-over speaks, about the SUBJECT. Never stage directions, never mention the video, screen, captions, or footage.
- ON_SCREEN_TEXT is a short on-screen caption for the scene (or an empty string).
- VISUAL is a brief description of what's shown (used to pick footage/graphics).
- Keep the SAME number of scenes unless the instruction clearly asks to add or remove scenes. Apply the instruction to every scene it affects; leave the rest as they are.
Respond with RAW JSON ONLY, no prose:
{"scenes":[{"index":1,"narration":"...","on_screen_text":"...","visual":"..."}, ...]}`;

const wordCount = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);

/**
 * Revise `script` per `instruction`. Returns a script of the same shape
 * (metadata + music preserved), with rewritten, re-indexed scenes.
 */
export async function reviseScript(script, instruction) {
  const compact = (script.scenes || []).map((s) => ({
    index: s.index, narration: s.narration || '', on_screen_text: s.on_screen_text || '', visual: s.visual || '',
  }));
  const resp = await chatJSON({
    system: SYSTEM,
    user: `Current script (${compact.length} scenes):\n${JSON.stringify(compact, null, 1)}\n\nInstruction: ${instruction}`,
  });
  const raw = Array.isArray(resp?.scenes) ? resp.scenes : null;
  if (!raw?.length) throw new Error('the editor could not revise the script — try rephrasing');
  const scenes = raw.slice(0, 24).map((s, i) => {
    const narration = String(s.narration || '').slice(0, 1500);
    return {
      index: i + 1,
      narration,
      on_screen_text: String(s.on_screen_text || '').slice(0, 200),
      visual: String(s.visual || '').slice(0, 400),
      // Rough estimate (~2.3 words/sec); the real duration is retimed from the
      // synthesized audio at generation, so this only drives the review preview.
      duration_seconds: Math.max(2, Math.round(wordCount(narration) / 2.3)),
    };
  });
  return { ...script, metadata: { ...(script.metadata || {}), scene_count: scenes.length }, scenes };
}
