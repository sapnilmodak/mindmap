// The pure parts of a debate: who speaks when, what each speaker is shown, cleaning up a spoken turn, and validating the summary.
// No database and no network here, so all of it is unit-tested.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NoteType } from '@idea-office/shared';
import type { ChatMsg } from './providers.js';
import type { Context } from './retrieval.js';

export type Speaker = 'claude' | 'gpt';
export interface TurnRec { speaker: Speaker | 'user'; content: string }

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'prompts');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8').trim();
export const PROMPTS = {
  rules: read('shared-rules.md'), claude: read('claude-persona.md'), gpt: read('sceptic-persona.md'),
  synthesis: read('synthesis.md'), briefs: read('turn-briefs.md').split(/\r?\n/).filter(Boolean),
};

export const MAX_TURNS = 6;
export const speakerFor = (turnIndex: number): Speaker => (turnIndex % 2 === 0 ? 'claude' : 'gpt');   // the analyst opens, the sceptic answers
export const NAME: Record<Speaker | 'user', string> = { claude: 'Claude', gpt: 'Haiku', user: 'The founder' };

export function systemPrompt(speaker: Speaker, founderProfile: string): string {
  const profile = founderProfile.trim() ? `\n\nAbout the founder (use it to judge fit, never repeat it back):\n${founderProfile.trim()}` : '';
  return `${PROMPTS.rules}\n\n${PROMPTS[speaker]}${profile}`;
}

// What `speaker` sees on turn `turnIndex`: the context as the first user message, the debate so far (their own turns as
// "assistant", everyone else's as "user"), and this turn's brief last. Consecutive messages of one role are merged because
// both APIs want roles to alternate.
export function buildTurnMessages(contextText: string, transcript: TurnRec[], speaker: Speaker, turnIndex: number, totalTurns: number): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: 'user', content: contextText }];
  const push = (role: ChatMsg['role'], content: string) => {
    const last = msgs[msgs.length - 1];
    if (last.role === role) last.content += `\n\n${content}`; else msgs.push({ role, content });
  };
  for (const t of transcript) {
    if (t.speaker === speaker) push('assistant', t.content);
    else push('user', `${NAME[t.speaker]} said: ${t.content}`);
  }
  const brief = PROMPTS.briefs[Math.min(turnIndex, PROMPTS.briefs.length - 1)];
  push('user', `${turnIndex === 0 ? 'The debate starts now.' : `Debate so far is above.`} It is turn ${turnIndex + 1} of ${totalTurns}.\n${brief}\nReply with your turn only: plain text in Hindi (Devanagari script), at most 80 words, no name prefix.`);
  return msgs;
}

const MAX_WORDS = 140;     // the prompt asks for 80; this is only a safety net for a model that ignores it
// Cleans one spoken turn: no name prefix, one paragraph, bounded length, and never ends mid-sentence if a clean cut exists.
export function tidyTurn(raw: string): string {
  let t = raw.replace(/^\s*(claude|gpt|assistant|क्लॉड|क्लाउड|जीपीटी|haiku|हाइकू)\s*[:\-–]\s*/i, '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const words = t.split(' ');
  if (words.length > MAX_WORDS) t = words.slice(0, MAX_WORDS).join(' ');
  if (/[.?!।…"')\]]$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! '), t.lastIndexOf('। '));
  return cut > t.length * 0.4 ? t.slice(0, cut + 1) : `${t}…`;
}

// ---- the summary ----
const Str = (n: number) => z.string().trim().max(n);
export const SynthesisSchema = z.object({
  verdict: z.enum(['promising', 'needs_work', 'weak']),
  summary: Str(700).min(1),
  key_points: z.array(Str(240)).max(6).default([]),
  risks: z.array(Str(240)).max(6).default([]),
  next_steps: z.array(Str(240)).max(5).default([]),
  suggested_links: z.array(z.object({ target_note_id: Str(80), label: z.string().trim().default('').transform((s) => s.slice(0, 60)), reason: Str(300).default('') })).max(8).default([]),
  suggested_notes: z.array(z.object({ type: NoteType, title: Str(120).min(1), body: Str(600).default('') })).max(4).default([]),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

// Notes the summary may propose linking to: similar (unlinked), one step further out, and the rest of the wall.
// Never the note itself, and never notes the founder already linked.
export function candidateIds(c: Context): Set<string> {
  const linked = new Set(c.linked.map((l) => l.id));
  const ids = [...c.similar.map((s) => s.id), ...c.twoHop.map((t) => t.id), ...c.outline.map((o) => o.id)];
  return new Set(ids.filter((id) => id !== c.note.id && !linked.has(id)));
}

export type ParsedSynthesis = { ok: true; value: Synthesis; dropped: number } | { ok: false; error: string };

// Models sometimes wrap JSON in fences or add a sentence: take the outermost {...}. Then validate the shape, and drop any
// suggested link whose id is not a real candidate (the hallucination guard) or that repeats an earlier target.
export function parseSynthesis(raw: string, valid: ReadonlySet<string>): ParsedSynthesis {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, error: 'no JSON object found' };
  let json: unknown;
  try { json = JSON.parse(raw.slice(a, b + 1)); } catch (e) { return { ok: false, error: `invalid JSON: ${(e as Error).message}` }; }
  const r = SynthesisSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const seen = new Set<string>();
  const links = r.data.suggested_links.filter((l) => valid.has(l.target_note_id) && !seen.has(l.target_note_id) && !!seen.add(l.target_note_id)).slice(0, 4);
  return { ok: true, value: { ...r.data, suggested_links: links }, dropped: r.data.suggested_links.length - links.length };
}

// The summary as plain text, stored on the debate so later debates can read it as context.
export const summaryText = (s: Synthesis): string =>
  `[${s.verdict}] ${s.summary}${s.risks.length ? ` Risks: ${s.risks.join('; ')}.` : ''}${s.next_steps.length ? ` Next: ${s.next_steps.join('; ')}.` : ''}`;
