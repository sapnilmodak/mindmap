// Orchestrator tests against the real Neo4j (npm run db:up) with scripted fake colleagues: no API keys, no cost.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DebateEvent } from '@idea-office/shared';
import { closeGraph, initSchema, run } from './graph.js';
import * as notes from './notes.js';
import { buildContext } from './retrieval.js';
import { runDebate } from './debate.js';
import { getDebate } from './debateStore.js';
import { fakeProvider } from './providers.js';
import type { Provider } from './providers.js';

const ids: string[] = [];
const mk = async (title: string, type: 'pattern' | 'problem' | 'business' | 'question' = 'business', body = '') => {
  const n = await notes.createNote({ type, title: `TEST ${title}`, body }); ids.push(n.id); return n;
};

let root: Awaited<ReturnType<typeof mk>>, near: typeof root, other: typeof root;
beforeAll(async () => {
  await initSchema();
  root = await mk('Shared parking', 'business', 'Rent unused office parking by the hour');
  near = await mk('Parking pain', 'problem', 'Drivers circle for 20 minutes');
  other = await mk('Airbnb pattern', 'pattern', 'Idle asset plus a marketplace');
  await notes.createLink({ from: root.id, to: near.id, label: 'solves' });
});
afterAll(async () => {
  await run('MATCH (d:Debate)-[:ABOUT]->(n:Note) WHERE n.id IN $ids OPTIONAL MATCH (d)-[:HAS_TURN|SUGGESTS]->(x) DETACH DELETE d, x', { ids });
  await run('MATCH (n:Note) WHERE n.id IN $ids DETACH DELETE n', { ids });
  await closeGraph();
});

const summaryJson = (links: object[] = [{ target_note_id: other.id, label: 'same pattern', reason: 'idle asset' }]) => JSON.stringify({
  verdict: 'needs_work', summary: 'A marketplace for idle parking.', key_points: ['k'], risks: ['r'], next_steps: ['n'],
  suggested_links: links, suggested_notes: [{ type: 'question', title: 'Who pays?', body: '' }],
});
const hang = (name: 'claude' | 'gpt'): Provider => ({ name, async *stream(_s, _m, _t, signal) { await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))); yield ''; return { inputTokens: 0, outputTokens: 0 }; } });
const collectEvents = () => { const ev: DebateEvent[] = []; return { ev, on: (e: DebateEvent) => ev.push(e) }; };

describe('runDebate', () => {
  it('runs four alternating turns, saves them, and stores a validated summary with suggestions', async () => {
    const claude = fakeProvider('claude', ['Opening: this is Airbnb for parking.', 'Answering: tie it to "Parking pain".', summaryJson([
      { target_note_id: other.id, label: 'same pattern', reason: 'idle asset' }, { target_note_id: 'made-up-id', label: 'x', reason: 'y' }, { target_note_id: near.id, label: 'dup', reason: 'already linked' }])]);
    const gpt = fakeProvider('gpt', ['Who pays, and why not use existing apps?', 'Fine, but validate demand with ten lot owners first.']);
    const { ev, on } = collectEvents();
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt }, onEvent: on, founderProfile: 'Pune-based, B2C first' });

    expect(r.status).toBe('done');
    const d = (await getDebate(r.debateId))!;
    expect(d.status).toBe('done');
    expect(d.turns.map((t) => [t.seq, t.speaker])).toEqual([[0, 'claude'], [1, 'gpt'], [2, 'claude'], [3, 'gpt']]);
    expect(d.turns[1].content).toBe('Who pays, and why not use existing apps?');
    expect(d.summary).toMatch(/^\[needs_work\]/);
    expect(d.tokensIn).toBeGreaterThan(0);
    expect(d.tokensOut).toBeGreaterThan(0);

    // suggestions: the real unlinked note and the follow-up question survive; the invented id and the already-linked note do not
    expect(d.suggestions.map((s) => s.kind).sort()).toEqual(['link', 'note']);
    const link = d.suggestions.find((s) => s.kind === 'link')!;
    expect((link.payload as { target_note_id: string }).target_note_id).toBe(other.id);
    expect(d.suggestions.every((s) => s.status === 'open')).toBe(true);

    // events arrive in order and stream text before each turn ends
    const kinds = ev.map((e) => e.type);
    expect(ev[0]).toMatchObject({ type: 'debate_started', turns: 4 });
    expect(kinds[0]).toBe('debate_started');
    expect(kinds.filter((k) => k === 'turn_started')).toHaveLength(4);
    expect(kinds.indexOf('turn_delta')).toBeLessThan(kinds.indexOf('turn_done'));
    expect(kinds.slice(-3)).toEqual(['synthesis_ready', 'suggestions_ready', 'debate_done']);

    // what the models were shown
    expect(claude.calls[0].system).toMatch(/About the founder[\s\S]*Pune-based/);
    expect(claude.calls[0].messages[0].content).toMatch(/NEW NOTE[\s\S]*Shared parking/);
    expect(claude.calls[0].messages[0].content).toMatch(/Parking pain[\s\S]*solves/);          // the founder's own link, with its label
    expect(gpt.calls[0].messages[0].content).toMatch(/Claude said: Opening: this is Airbnb for parking\./);
    expect(claude.calls[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(claude.calls[2].messages[0].content).toMatch(/THE DEBATE[\s\S]*GPT: Fine, but validate/);
    expect(claude.calls[0].maxTokens).toBe(700);
  });

  it('keeps what was said when GPT fails mid-debate, and reports which colleague failed', async () => {
    const claude = fakeProvider('claude', ['Opening point.']);
    const gpt = fakeProvider('gpt', [new Error('429 rate limited')]);
    const { ev, on } = collectEvents();
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt }, onEvent: on });
    expect(r).toMatchObject({ status: 'failed', error: { provider: 'gpt' } });
    const d = (await getDebate(r.debateId))!;
    expect(d.status).toBe('failed');
    expect(d.failProvider).toBe('gpt');
    expect(d.failReason).toMatch(/429/);
    expect(d.turns).toHaveLength(1);
    expect(ev[ev.length - 1]).toMatchObject({ type: 'debate_failed', provider: 'gpt' });
  });

  it('stops when the token budget is used up', async () => {
    const claude = fakeProvider('claude', ['A fairly long opening statement about parking and why it matters to founders.']);
    const gpt = fakeProvider('gpt', ['Reply.']);
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt }, tokenBudget: 5 });
    expect(r).toMatchObject({ status: 'failed', error: { provider: 'system', reason: 'budget' } });
    expect((await getDebate(r.debateId))!.turns).toHaveLength(1);
    expect(gpt.calls).toHaveLength(0);
  });

  it('can be cancelled between turns', async () => {
    const ac = new AbortController();
    const claude = fakeProvider('claude', ['First turn.']);
    const gpt = fakeProvider('gpt', ['Never said.']);
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt }, signal: ac.signal, onEvent: (e) => { if (e.type === 'turn_done') ac.abort(); } });
    expect(r.status).toBe('cancelled');
    const d = (await getDebate(r.debateId))!;
    expect(d.status).toBe('cancelled');
    expect(d.turns).toHaveLength(1);
    expect(gpt.calls).toHaveLength(0);
  });

  it('times out a model that never answers', async () => {
    const r = await runDebate({ noteId: root.id, providers: { claude: hang('claude'), gpt: fakeProvider('gpt', ['x']) }, turnTimeoutMs: 80 });
    expect(r).toMatchObject({ status: 'failed', error: { provider: 'claude', reason: 'timeout' } });
  });

  it('asks once more when the summary is not valid JSON, telling the model what was wrong', async () => {
    const claude = fakeProvider('claude', ['Turn one.', 'Turn three.', 'Sorry, here is some prose instead of JSON.', summaryJson()]);
    const gpt = fakeProvider('gpt', ['Turn two.', 'Turn four.']);
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt } });
    expect(r.status).toBe('done');
    expect(claude.calls).toHaveLength(4);
    const retry = claude.calls[3].messages;
    expect(retry[retry.length - 1].content).toMatch(/not valid: no JSON object found/);
    expect(retry.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('fails clearly (keeping the debate) if the summary is invalid twice', async () => {
    const claude = fakeProvider('claude', ['Turn one.', 'Turn three.', 'prose', 'still prose']);
    const gpt = fakeProvider('gpt', ['Turn two.', 'Turn four.']);
    const r = await runDebate({ noteId: root.id, providers: { claude, gpt } });
    expect(r).toMatchObject({ status: 'failed', error: { provider: 'claude' } });
    expect(r.error?.reason).toMatch(/^summary_invalid/);
    expect((await getDebate(r.debateId))!.turns).toHaveLength(4);
  });

  it('respects the requested number of turns (clamped to 2..6)', async () => {
    const mkPair = () => [fakeProvider('claude', ['One.', 'Three.', 'Five.', summaryJson()]), fakeProvider('gpt', ['Two.', 'Four.', 'Six.'])] as const;
    const [c1, g1] = mkPair();
    expect((await getDebate((await runDebate({ noteId: root.id, providers: { claude: c1, gpt: g1 }, turns: 2 })).debateId))!.turns).toHaveLength(2);
    const [c2, g2] = mkPair();
    expect((await getDebate((await runDebate({ noteId: root.id, providers: { claude: c2, gpt: g2 }, turns: 99 })).debateId))!.turns).toHaveLength(6);
  });

  it('rejects a note that does not exist', async () => {
    await expect(runDebate({ noteId: 'nope', providers: { claude: fakeProvider('claude', ['x']), gpt: fakeProvider('gpt', ['x']) } })).rejects.toThrow(/not found/);
  });

  it('a finished debate becomes memory: the next debate on a related note is shown its summary', async () => {
    const claude = fakeProvider('claude', ['One.', 'Three.', summaryJson([])]);
    const gpt = fakeProvider('gpt', ['Two.', 'Four.']);
    expect((await runDebate({ noteId: near.id, providers: { claude, gpt } })).status).toBe('done');
    const c = await buildContext(root.id);                      // root is linked to `near`
    expect(c!.pastDebates.some((p) => p.noteTitle === 'TEST Parking pain' && /^\[needs_work\]/.test(p.summary))).toBe(true);
  });
});
