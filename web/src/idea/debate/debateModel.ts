// Pure model of what the browser shows for one debate: events from the server stream in, UI state comes out.
// No clocks and no network, so the same events always give the same state (which is what makes replaying an old debate work).
import type { DebateEvent, DebateSummary, Speaker } from '@idea-office/shared';

export interface TurnView { seq: number; speaker: Speaker; text: string; done: boolean }
export interface SuggestionView { id: string; kind: 'link' | 'note'; payload: any; status: 'open' | 'accepted' | 'dismissed' }
export type DebatePhase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface DebateState {
  phase: DebatePhase;
  debateId: string | null;
  noteId: string | null;
  turns: TurnView[];
  plannedTurns: number;                  // spoken turns the server says it will run (0 = unknown)
  speaker: Speaker | null;               // who is talking this instant (null between turns)
  summarizing: boolean;                  // every turn is done, the summary is being written
  summary: DebateSummary | null;
  suggestions: SuggestionView[];
  error: { provider: 'claude' | 'gpt' | 'system'; reason: string } | null;
}

export const initialDebate = (): DebateState => ({ phase: 'idle', debateId: null, noteId: null, turns: [], plannedTurns: 0, speaker: null, summarizing: false, summary: null, suggestions: [], error: null });
export const isRunning = (s: DebateState) => s.phase === 'running';

export function reduceDebate(s: DebateState, e: DebateEvent): DebateState {
  switch (e.type) {
    case 'debate_started':      // also the first event of a replay, so a reconnect starts clean instead of doubling up
      return { ...initialDebate(), phase: 'running', debateId: e.debateId, noteId: e.noteId, plannedTurns: e.turns ?? 0 };
    case 'turn_started':
      return { ...s, speaker: e.speaker, summarizing: false, turns: s.turns.some((t) => t.seq === e.seq) ? s.turns : [...s.turns, { seq: e.seq, speaker: e.speaker, text: '', done: false }] };
    case 'turn_delta': {
      const has = s.turns.some((t) => t.seq === e.seq);
      const turns = has ? s.turns.map((t) => (t.seq === e.seq ? { ...t, text: t.text + e.text } : t)) : [...s.turns, { seq: e.seq, speaker: e.speaker, text: e.text, done: false }];
      return { ...s, turns };
    }
    case 'turn_done': {
      const turns = s.turns.map((t) => (t.seq === e.seq ? { ...t, done: true } : t));
      // "Writing the summary" only once every planned spoken turn is finished; before that the next colleague is just thinking.
      const spoken = turns.filter((t) => t.done && t.speaker !== 'user').length;
      return { ...s, speaker: s.speaker === e.speaker ? null : s.speaker, summarizing: s.plannedTurns > 0 && spoken >= s.plannedTurns, turns };
    }
    case 'synthesis_ready':
      return { ...s, summary: e.summary as DebateSummary, summarizing: false };
    case 'suggestions_ready':
      return { ...s, suggestions: e.suggestions.map((x) => ({ id: x.id, kind: x.kind, payload: x.payload, status: x.status ?? 'open' })) };
    case 'debate_done':
      return { ...s, phase: 'done', speaker: null, summarizing: false };
    case 'debate_failed':
      return { ...s, phase: 'failed', speaker: null, summarizing: false, error: { provider: e.provider, reason: e.reason } };
    case 'debate_cancelled':
      return { ...s, phase: 'cancelled', speaker: null, summarizing: false };
  }
}

export function resolveSuggestion(s: DebateState, id: string, status: 'accepted' | 'dismissed'): DebateState {
  return { ...s, suggestions: s.suggestions.map((x) => (x.id === id ? { ...x, status } : x)) };
}

// The latest thing a colleague said, for their speech bubble: the tail of their most recent turn (so it shows what is being said now).
export function bubbleFor(s: DebateState, who: 'claude' | 'gpt', maxChars = 150): { text: string; speaking: boolean } {
  const last = [...s.turns].reverse().find((t) => t.speaker === who && t.text);
  if (!last) return { text: '', speaking: false };
  const t = last.text.trim();
  return { text: t.length > maxChars ? `…${t.slice(t.length - maxChars).replace(/^\S*\s/, '')}` : t, speaking: s.speaker === who };
}

export function statusLine(s: DebateState): string {
  if (s.phase === 'idle') return '';
  if (s.phase === 'done') return 'Debate finished';
  if (s.phase === 'cancelled') return 'Debate stopped';
  if (s.phase === 'failed') return s.error?.provider === 'system' ? 'Debate could not finish' : `${s.error?.provider === 'gpt' ? 'Haiku' : 'Claude'} stepped out`;
  if (s.speaker) return `${s.speaker === 'claude' ? 'Claude' : s.speaker === 'gpt' ? 'Haiku' : 'You'} is speaking…`;
  if (s.summarizing) return 'Writing the summary…';
  return s.turns.length > 0 ? 'Thinking…' : 'Reading the wall…';
}
