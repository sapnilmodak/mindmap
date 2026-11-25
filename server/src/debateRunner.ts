// Live debates held in memory so a browser can connect late or reconnect and still see everything from the start, plus the
// conversion of a stored debate back into events (so an old debate can be replayed through the same stream).
import type { DebateEvent } from '@idea-office/shared';
import { runDebate } from './debate.js';
import type { DebateOptions } from './debate.js';
import type { StoredDebate } from './debateStore.js';

export interface Run {
  id: string; noteId: string; events: DebateEvent[]; finished: boolean;
  listeners: Set<(e: DebateEvent) => void>; ac: AbortController; interjections: string[];
}
const runs = new Map<string, Run>();
const runningByNote = new Map<string, string>();
const KEEP_MS = 10 * 60 * 1000;      // a finished run stays replayable from memory this long; after that it is read from the database

export const isTerminal = (e: DebateEvent) => e.type === 'debate_done' || e.type === 'debate_failed' || e.type === 'debate_cancelled';
export const getRun = (id: string) => runs.get(id);

export type StartResult = { ok: true; debateId: string } | { ok: false; reason: 'not_found' | 'busy' };

// Starts a debate in the background. Resolves as soon as the debate exists (so the caller can subscribe), not when it finishes.
export function startDebate(o: Omit<DebateOptions, 'signal' | 'onEvent' | 'pullInterjection'>): Promise<StartResult> {
  if (runningByNote.has(o.noteId)) return Promise.resolve({ ok: false, reason: 'busy' });
  runningByNote.set(o.noteId, 'pending');
  const run: Run = { id: '', noteId: o.noteId, events: [], finished: false, listeners: new Set(), ac: new AbortController(), interjections: [] };
  return new Promise<StartResult>((resolve) => {
    let started = false;
    const push = (e: DebateEvent) => { run.events.push(e); for (const l of [...run.listeners]) l(e); };
    const settle = () => {
      run.finished = true; runningByNote.delete(o.noteId); run.listeners.clear();
      if (run.id) setTimeout(() => runs.delete(run.id), KEEP_MS).unref();
    };
    runDebate({
      ...o, signal: run.ac.signal, pullInterjection: () => run.interjections.shift(),
      onEvent: (e) => {
        if (e.type === 'debate_started') { run.id = e.debateId; runs.set(run.id, run); runningByNote.set(o.noteId, run.id); started = true; push(e); resolve({ ok: true, debateId: run.id }); }
        else push(e);
      },
    }).then(settle, (err) => {
      if (!started) { runningByNote.delete(o.noteId); resolve({ ok: false, reason: 'not_found' }); return; }
      push({ type: 'debate_failed', provider: 'system', reason: err instanceof Error ? err.message : String(err) });
      settle();
    });
  });
}

export function cancelDebate(id: string): boolean {
  const r = runs.get(id);
  if (!r || r.finished) return false;
  r.ac.abort();
  return true;
}

export function interject(id: string, text: string): boolean {
  const r = runs.get(id);
  const t = text.trim();
  if (!r || r.finished || !t) return false;
  r.interjections.push(t.slice(0, 500));
  return true;
}

// A stored debate as the events a live one would have produced, so the browser can replay it the same way.
export function eventsFromStored(d: StoredDebate): DebateEvent[] {
  const ev: DebateEvent[] = [{ type: 'debate_started', debateId: d.id, noteId: d.noteId, turns: d.turns.filter((t) => t.speaker !== 'user').length }];
  for (const t of d.turns) {
    ev.push({ type: 'turn_started', speaker: t.speaker, seq: t.seq }, { type: 'turn_delta', speaker: t.speaker, seq: t.seq, text: t.content }, { type: 'turn_done', speaker: t.speaker, seq: t.seq });
  }
  if (d.result) ev.push({ type: 'synthesis_ready', summary: d.result });
  if (d.suggestions.length) ev.push({ type: 'suggestions_ready', suggestions: d.suggestions.map((s) => ({ id: s.id, kind: s.kind, payload: s.payload, status: s.status })) });
  if (d.status === 'done') ev.push({ type: 'debate_done', debateId: d.id });
  else if (d.status === 'cancelled') ev.push({ type: 'debate_cancelled', debateId: d.id });
  else ev.push({ type: 'debate_failed', provider: (d.failProvider as 'claude' | 'gpt' | 'system' | null) ?? 'system', reason: d.failReason ?? (d.status === 'running' ? 'interrupted' : 'failed') });
  return ev;
}
