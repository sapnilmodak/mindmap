// Route tests against the real Neo4j with scripted colleagues: start, stream, replay, busy, cancel, interject, suggestions, settings.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { DebateEvent } from '@idea-office/shared';
import { buildApp } from './app.js';
import { closeGraph, initSchema, run } from './graph.js';
import * as notes from './notes.js';
import { fakeProvider } from './providers.js';
import { getDebate } from './debateStore.js';

const ids: string[] = [];
const mk = async (title: string, type: 'pattern' | 'problem' | 'business' | 'question' = 'business') => { const n = await notes.createNote({ type, title: `TEST ${title}`, body: '' }); ids.push(n.id); return n; };

let app: Awaited<ReturnType<typeof buildApp>>, base = '';
let root: Awaited<ReturnType<typeof mk>>, other: typeof root;
let delay = 0;
const summaryJson = () => JSON.stringify({
  verdict: 'promising', summary: 'Good angle.', key_points: ['k'], risks: ['r'], next_steps: ['n'],
  suggested_links: [{ target_note_id: other.id, label: 'same pattern', reason: 'idle asset' }],
  suggested_notes: [{ type: 'question', title: 'TEST Who pays first?', body: 'Supply or demand?' }, { type: 'problem', title: 'TEST Trust', body: '' }],
});
const LONG = 'A reasonably long spoken turn so that streaming takes a little while to finish, long enough to cancel it.';
const fakes = () => ({
  claude: fakeProvider('claude', [LONG, LONG, summaryJson()], { delayMs: delay }),
  gpt: fakeProvider('gpt', [LONG, LONG], { delayMs: delay }),
});

beforeAll(async () => {
  await initSchema();
  root = await mk('Shared parking'); other = await mk('Airbnb pattern', 'pattern');
  app = await buildApp({ providers: fakes, logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoDebate: true, founderProfile: '' }) });
  await app.close();
  await run('MATCH (d:Debate)-[:ABOUT]->(n:Note) WHERE n.id IN $ids OPTIONAL MATCH (d)-[:HAS_TURN|SUGGESTS]->(x) DETACH DELETE d, x', { ids });
  await run('MATCH (n:Note) WHERE n.title STARTS WITH "TEST " DETACH DELETE n');
  await closeGraph();
});

// Like the browser client: a JSON content-type only when there is a body.
const j = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function readStream(path: string): Promise<DebateEvent[]> {
  const res = await fetch(base + path);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const out: DebateEvent[] = [];
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
      buf = buf.slice(i + 2);
      if (line) out.push(JSON.parse(line.slice(6)));
    }
  }
  return out;
}
const start = async (noteId: string, body: object = {}) => { const r = await j('POST', `/api/notes/${noteId}/debate`, body); return { status: r.status, body: await r.json() as any }; };

describe('debate routes', () => {
  it('starts a debate (202), streams every event to the end, then replays the same events to a late viewer', async () => {
    const s = await start(root.id);
    expect(s.status).toBe(202);
    expect(s.body.debateId).toBeTruthy();
    const live = await readStream(`/api/debates/${s.body.debateId}/stream`);
    expect(live[0]).toMatchObject({ type: 'debate_started', noteId: root.id });
    expect(live.filter((e) => e.type === 'turn_done')).toHaveLength(4);
    expect(live[live.length - 1].type).toBe('debate_done');
    expect(live.map((e) => e.type)).toContain('synthesis_ready');
    const late = await readStream(`/api/debates/${s.body.debateId}/stream`);
    expect(late).toEqual(live);
    expect((await getDebate(s.body.debateId))!.status).toBe('done');
    const list = await (await j('GET', `/api/notes/${root.id}/debates`)).json() as any[];
    expect(list[0]).toMatchObject({ id: s.body.debateId, status: 'done', verdict: 'promising' });
  });

  it('rebuilds a finished debate from the database when it is no longer in memory', async () => {
    const { runDebate } = await import('./debate.js');
    const r = await runDebate({ noteId: root.id, providers: fakes() });         // run directly: never registered in memory
    const ev = await readStream(`/api/debates/${r.debateId}/stream`);
    expect(ev[0].type).toBe('debate_started');
    expect(ev.filter((e) => e.type === 'turn_started')).toHaveLength(4);
    expect(ev.find((e) => e.type === 'suggestions_ready')).toBeTruthy();
    expect(ev[ev.length - 1].type).toBe('debate_done');
    const turnText = ev.filter((e): e is Extract<DebateEvent, { type: 'turn_delta' }> => e.type === 'turn_delta').map((e) => e.text);
    expect(turnText[0]).toBe(LONG.slice(0, turnText[0].length));              // the stored words come back whole
  });

  it('refuses a second debate on a note that is already debating (409) and a missing note (404)', async () => {
    delay = 40;
    const a = await start(root.id);
    expect(a.status).toBe(202);
    expect((await start(root.id)).status).toBe(409);
    expect((await start('nope')).status).toBe(404);
    await j('POST', `/api/debates/${a.body.debateId}/cancel`);
    await readStream(`/api/debates/${a.body.debateId}/stream`);
    delay = 0;
  });

  it('cancels a running debate: the stream ends with debate_cancelled and a second cancel is refused', async () => {
    delay = 40;
    const s = await start(root.id);
    const done = readStream(`/api/debates/${s.body.debateId}/stream`);
    await new Promise((r) => setTimeout(r, 150));
    expect((await j('POST', `/api/debates/${s.body.debateId}/cancel`)).status).toBe(200);
    const ev = await done;
    expect(ev[ev.length - 1].type).toBe('debate_cancelled');
    expect((await getDebate(s.body.debateId))!.status).toBe('cancelled');
    expect((await j('POST', `/api/debates/${s.body.debateId}/cancel`)).status).toBe(409);
    delay = 0;
  });

  it('lets the founder speak mid-debate: it joins the transcript in order and both colleagues are shown it', async () => {
    delay = 30;
    let gptFake: ReturnType<typeof fakeProvider> | undefined;
    const app2 = await buildApp({ providers: () => { const f = fakes(); gptFake = f.gpt as ReturnType<typeof fakeProvider>; return f; }, logger: false });
    await app2.listen({ host: '127.0.0.1', port: 0 });
    const b2 = `http://127.0.0.1:${(app2.server.address() as AddressInfo).port}`;
    try {
      const s = await (await fetch(`${b2}/api/notes/${root.id}/debate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as any;
      expect((await fetch(`${b2}/api/debates/${s.debateId}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  What about colleges?  ' }) })).status).toBe(200);
      expect((await fetch(`${b2}/api/debates/${s.debateId}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '   ' }) })).status).toBe(400);
      const res = await fetch(`${b2}/api/debates/${s.debateId}/stream`); await res.text();
      const d = (await getDebate(s.debateId))!;
      expect(d.turns.map((t) => t.speaker)).toContain('user');
      expect(d.turns.find((t) => t.speaker === 'user')!.content).toBe('What about colleges?');
      expect(d.turns.map((t) => t.seq)).toEqual(d.turns.map((_, i) => i));        // contiguous, in the order said
      expect(gptFake!.calls[0].messages[0].content).toMatch(/The founder said: What about colleges\?/);
      expect((await fetch(`${b2}/api/debates/${s.debateId}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'late' }) })).status).toBe(409);
    } finally { await app2.close(); delay = 0; }
  });

  it('validates input and 404s unknown debates', async () => {
    expect((await start(root.id, { turns: 99 })).status).toBe(400);
    expect((await j('GET', '/api/debates/nope')).status).toBe(404);
    expect((await j('GET', '/api/debates/nope/stream')).status).toBe(404);
    // a malformed body is the caller's fault: 400, not a server error
    const bad = await fetch(`${base}/api/notes/${root.id}/debate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' });
    expect(bad.status).toBe(400);
  });
});

describe('suggestions', () => {
  const fresh = async () => {
    const s = await start(root.id);
    await readStream(`/api/debates/${s.body.debateId}/stream`);
    const d = (await getDebate(s.body.debateId))!;
    return { link: d.suggestions.find((x) => x.kind === 'link')!, notesS: d.suggestions.filter((x) => x.kind === 'note') };
  };

  it('accepting a link suggestion links the debated note to the suggested one, once', async () => {
    const { link } = await fresh();
    const r = await j('POST', `/api/suggestions/${link.id}/accept`, {});
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.link).toMatchObject({ from: root.id, to: other.id, label: 'same pattern', createdBy: 'claude' });
    expect((await j('POST', `/api/suggestions/${link.id}/accept`, {})).status).toBe(409);     // already resolved
    expect((await j('POST', `/api/suggestions/${link.id}/dismiss`)).status).toBe(409);
    await notes.deleteLink(body.link.id);
  });

  it('accepting a note suggestion creates it where asked and links it as a follow-up; dismissing leaves the wall alone', async () => {
    const { notesS } = await fresh();
    const byTitle = (t: string) => notesS.find((x) => (x.payload as { title: string }).title === t)!;   // the database does not promise an order
    const [accept, dismiss] = [byTitle('TEST Who pays first?'), byTitle('TEST Trust')];
    const newId = crypto.randomUUID();
    const r = await j('POST', `/api/suggestions/${accept.id}/accept`, { note: { id: newId, x: 1.2, y: 1.4 } });
    const body = await r.json() as any;
    expect(r.status).toBe(200);
    expect(body.note).toMatchObject({ id: newId, title: 'TEST Who pays first?', x: 1.2, y: 1.4 });
    expect(body.link).toMatchObject({ from: root.id, to: newId, label: 'follow-up', createdBy: 'claude' });
    const before = (await notes.listWall()).notes.length;
    expect((await j('POST', `/api/suggestions/${dismiss.id}/dismiss`)).status).toBe(200);
    expect((await notes.listWall()).notes.length).toBe(before);
    expect((await j('POST', `/api/suggestions/${dismiss.id}/accept`, {})).status).toBe(409);   // dismissed stays dismissed
    expect((await j('POST', '/api/suggestions/nope/accept', {})).status).toBe(404);
  });

  it('an already-linked pair is accepted without creating a duplicate', async () => {
    const { link } = await fresh();
    const pre = await notes.createLink({ from: other.id, to: root.id, label: 'manual' });
    expect(pre.ok).toBe(true);
    const body = await (await j('POST', `/api/suggestions/${link.id}/accept`, {})).json() as any;
    expect(body.alreadyLinked).toBe(true);
    if (pre.ok) await notes.deleteLink(pre.link.id);
  });
});

describe('settings', () => {
  it('auto-debate is on by default and can be switched; the founder profile is saved', async () => {
    const get = async () => (await (await j('GET', '/api/settings')).json()) as any;
    await j('PUT', '/api/settings', { autoDebate: true });
    expect((await get()).autoDebate).toBe(true);
    const off = await (await j('PUT', '/api/settings', { autoDebate: false, founderProfile: '  Pune, B2C  ' })).json() as any;
    expect(off).toMatchObject({ autoDebate: false, founderProfile: 'Pune, B2C' });
    expect((await get()).autoDebate).toBe(false);
    expect((await j('PUT', '/api/settings', { autoDebate: 'yes' })).status).toBe(400);
    expect(typeof (await get()).demo).toBe('boolean');
  });
});
