// Per-project Director-chat sessions, persisted as JSONL beside the project's
// IR snapshot in artifacts/. Unlike the in-memory project store, chat history
// survives server restarts — the conversation IS the editing context.
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACTS_DIR } from './config.js';

const chatPath = (id) => join(ARTIFACTS_DIR, `${id}.chat.jsonl`);

// entry: { role: 'user' | 'assistant' | 'system', text, proposal?: {summary, diff} }
// 'system' entries are events the agent should know about (applied/discarded).
export async function appendChat(id, entry) {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await appendFile(chatPath(id), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}

// Wipe a project's Director conversation — the "New chat" button. Removes the
// persisted history so the next turn starts with no prior context (no anchoring
// on old refusals/proposals).
export async function clearChat(id) {
  await rm(chatPath(id), { force: true });
}

export async function readChat(id) {
  try {
    const raw = await readFile(chatPath(id), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
