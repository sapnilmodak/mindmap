// Debates in the graph:
//   (:Debate {id,status,summary,result,startedAt,finishedAt,tokensIn,tokensOut,failProvider,failReason})-[:ABOUT]->(:Note)
//   (:Debate)-[:HAS_TURN]->(:Turn {id,seq,speaker,content,createdAt})
//   (:Debate)-[:SUGGESTS]->(:Suggestion {id,kind,payload,status})
// `summary` is the short text later debates read as context; `result` is the full JSON summary for the UI.
import { randomUUID } from 'node:crypto';
import { run } from './graph.js';

export type DebateStatus = 'running' | 'done' | 'failed' | 'cancelled';
export interface StoredTurn { seq: number; speaker: 'claude' | 'gpt' | 'user'; content: string; createdAt: string }
export interface StoredSuggestion { id: string; kind: 'link' | 'note'; payload: unknown; status: 'open' | 'accepted' | 'dismissed' }
export interface StoredDebate {
  id: string; noteId: string; status: DebateStatus; summary: string | null; result: unknown | null;
  startedAt: string; finishedAt: string | null; tokensIn: number; tokensOut: number; failProvider: string | null; failReason: string | null;
  turns: StoredTurn[]; suggestions: StoredSuggestion[];
}

export async function createDebate(noteId: string): Promise<string | null> {
  const id = randomUUID();
  const r = await run(
    `MATCH (n:Note {id:$noteId}) WHERE n.deleted = false
     CREATE (d:Debate {id:$id, status:'running', startedAt:$t, tokensIn:0, tokensOut:0})-[:ABOUT]->(n) RETURN d.id AS id`,
    { noteId, id, t: new Date().toISOString() });
  return r.length ? id : null;
}

export async function addTurn(debateId: string, seq: number, speaker: StoredTurn['speaker'], content: string) {
  await run(
    `MATCH (d:Debate {id:$debateId}) CREATE (d)-[:HAS_TURN]->(:Turn {id:$id, seq:$seq, speaker:$speaker, content:$content, createdAt:$t})`,
    { debateId, id: randomUUID(), seq, speaker, content, t: new Date().toISOString() });
}

export async function addTokens(debateId: string, inTok: number, outTok: number) {
  await run('MATCH (d:Debate {id:$id}) SET d.tokensIn = d.tokensIn + $i, d.tokensOut = d.tokensOut + $o', { id: debateId, i: inTok, o: outTok });
}

export async function finishDebate(id: string, summary: string, result: unknown) {
  await run("MATCH (d:Debate {id:$id}) SET d.status = 'done', d.summary = $summary, d.result = $result, d.finishedAt = $t",
    { id, summary, result: JSON.stringify(result), t: new Date().toISOString() });
}

export async function endDebate(id: string, status: 'failed' | 'cancelled', provider: string | null, reason: string | null) {
  await run('MATCH (d:Debate {id:$id}) SET d.status = $status, d.failProvider = $provider, d.failReason = $reason, d.finishedAt = $t',
    { id, status, provider, reason, t: new Date().toISOString() });
}

export async function addSuggestions(debateId: string, items: { kind: 'link' | 'note'; payload: unknown }[]): Promise<{ id: string; kind: 'link' | 'note'; payload: unknown }[]> {
  const made = items.map((i) => ({ id: randomUUID(), kind: i.kind, payload: i.payload }));
  for (const s of made) {
    await run(`MATCH (d:Debate {id:$debateId}) CREATE (d)-[:SUGGESTS]->(:Suggestion {id:$id, kind:$kind, payload:$payload, status:'open'})`,
      { debateId, id: s.id, kind: s.kind, payload: JSON.stringify(s.payload) });
  }
  return made;
}

export interface SuggestionRow { id: string; kind: 'link' | 'note'; payload: any; status: 'open' | 'accepted' | 'dismissed'; debateId: string; noteId: string }
export async function getSuggestion(id: string): Promise<SuggestionRow | null> {
  const r = await run(
    `MATCH (d:Debate)-[:SUGGESTS]->(s:Suggestion {id:$id}) MATCH (d)-[:ABOUT]->(n:Note)
     RETURN s.id AS id, s.kind AS kind, s.payload AS payload, s.status AS status, d.id AS debateId, n.id AS noteId`, { id });
  if (!r.length) return null;
  const o = r[0].toObject() as any;
  return { ...o, payload: JSON.parse(o.payload) };
}
export async function setSuggestionStatus(id: string, status: 'accepted' | 'dismissed') {
  await run('MATCH (s:Suggestion {id:$id}) SET s.status = $status', { id, status });
}

export interface DebateListItem { id: string; status: DebateStatus; startedAt: string; verdict: string | null }
// A note's debates, newest first (for reopening an old one).
export async function listDebatesForNote(noteId: string): Promise<DebateListItem[]> {
  const r = await run(
    `MATCH (d:Debate)-[:ABOUT]->(:Note {id:$noteId}) RETURN d.id AS id, d.status AS status, d.startedAt AS startedAt, d.result AS result ORDER BY d.startedAt DESC LIMIT 20`, { noteId });
  return r.map((x) => ({ id: x.get('id'), status: x.get('status'), startedAt: x.get('startedAt'), verdict: x.get('result') ? (JSON.parse(x.get('result')).verdict ?? null) : null }));
}

export async function getDebate(id: string): Promise<StoredDebate | null> {
  const r = await run(
    `MATCH (d:Debate {id:$id})-[:ABOUT]->(n:Note)
     OPTIONAL MATCH (d)-[:HAS_TURN]->(t:Turn)
     WITH d, n, t ORDER BY t.seq
     WITH d, n, collect(t {.seq, .speaker, .content, .createdAt}) AS turns
     OPTIONAL MATCH (d)-[:SUGGESTS]->(s:Suggestion)
     RETURN d {.*} AS d, n.id AS noteId, turns, collect(s {.id, .kind, .payload, .status}) AS suggestions`, { id });
  if (!r.length) return null;
  const d = r[0].get('d') as Record<string, any>;
  return {
    id: d.id, noteId: r[0].get('noteId'), status: d.status, summary: d.summary ?? null, result: d.result ? JSON.parse(d.result) : null,
    startedAt: d.startedAt, finishedAt: d.finishedAt ?? null, tokensIn: Number(d.tokensIn ?? 0), tokensOut: Number(d.tokensOut ?? 0),
    failProvider: d.failProvider ?? null, failReason: d.failReason ?? null,
    turns: r[0].get('turns') as StoredTurn[],
    suggestions: (r[0].get('suggestions') as any[]).map((s) => ({ ...s, payload: JSON.parse(s.payload) })),
  };
}
