// Budget, usage, export, backup and settings. Real Neo4j, scripted colleagues, nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app.js';
import { closeGraph, initSchema, run } from './graph.js';
import * as notes from './notes.js';
import { fakeProvider } from './providers.js';
import { writeDailyBackup } from './backup.js';
import { toMarkdown } from './exporter.js';
import type { ExportData } from './exporter.js';
import { groupByDay, localDate, startOfLocalDay } from './usage.js';

const ids: string[] = [];
const mk = async (title: string, type: 'pattern' | 'problem' | 'business' | 'question' = 'business', body = '') => { const n = await notes.createNote({ type, title: `TEST ${title}`, body }); ids.push(n.id); return n; };
const SUMMARY = JSON.stringify({ verdict: 'promising', summary: 'Good angle.', key_points: [], risks: ['Who pays?'], next_steps: ['Call ten owners'], suggested_links: [], suggested_notes: [] });
const providers = () => ({
  claude: fakeProvider('claude', ['One.', 'Three.', SUMMARY]),
  gpt: fakeProvider('gpt', ['Two.', 'Four.']),
});

let app: Awaited<ReturnType<typeof buildApp>>, base = '';
let a: Awaited<ReturnType<typeof mk>>, b: typeof a, gone: typeof a;
const tmp = mkdtempSync(join(tmpdir(), 'idea-office-test-'));

const req = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const settings = async () => (await (await req('GET', '/api/settings')).json()) as any;
const usageToday = async () => ((await (await req('GET', '/api/usage')).json()) as any).today.tokens as number;
const debateOn = async (id: string) => { const r = await req('POST', `/api/notes/${id}/debate`); return { status: r.status, body: (await r.json()) as any }; };
const finish = async (debateId: string) => { await (await fetch(`${base}/api/debates/${debateId}/stream`)).text(); };

beforeAll(async () => {
  await initSchema();
  a = await mk('Shared parking', 'business', 'Rent unused office parking.');
  b = await mk('Parking pain', 'problem', 'Drivers circle for 20 minutes.');
  gone = await mk('Deleted idea', 'question');
  await notes.createLink({ from: a.id, to: b.id, label: 'solves' });
  await notes.deleteNote(gone.id);
  app = await buildApp({ providers, logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await req('PUT', '/api/settings', { autoDebate: true, founderProfile: '', turnsPerDebate: 4, dailyTokenBudget: 200000 });
  await app.close();
  await run('MATCH (d:Debate)-[:ABOUT]->(n:Note) WHERE n.id IN $ids OPTIONAL MATCH (d)-[:HAS_TURN|SUGGESTS]->(x) DETACH DELETE d, x', { ids });
  await run('MATCH (n:Note) WHERE n.title STARTS WITH "TEST " DETACH DELETE n');
  rmSync(tmp, { recursive: true, force: true });
  await closeGraph();
});

describe('settings', () => {
  it('has sensible defaults, validates, and never exposes API keys', async () => {
    await req('PUT', '/api/settings', { turnsPerDebate: 4, dailyTokenBudget: 200000 });
    const s = await settings();
    expect(s).toMatchObject({ turnsPerDebate: 4, dailyTokenBudget: 200000 });
    expect(s.models).toEqual({ claude: expect.any(String), gpt: expect.any(String) });
    expect(Object.keys(s).some((k) => /key|secret|token$/i.test(k))).toBe(false);
    expect(JSON.stringify(s)).not.toMatch(/sk-/);
    expect((await req('PUT', '/api/settings', { turnsPerDebate: 9 })).status).toBe(400);
    expect((await req('PUT', '/api/settings', { dailyTokenBudget: -5 })).status).toBe(400);
    expect((await req('PUT', '/api/settings', { dailyTokenBudget: 1.5 })).status).toBe(400);
  });
  it('turnsPerDebate decides how long a debate runs when the caller does not say', async () => {
    await req('PUT', '/api/settings', { turnsPerDebate: 2 });
    const r = await debateOn(a.id);
    expect(r.status).toBe(202);
    await finish(r.body.debateId);
    const d = (await (await req('GET', `/api/debates/${r.body.debateId}`)).json()) as any;
    expect(d.turns).toHaveLength(2);
    await req('PUT', '/api/settings', { turnsPerDebate: 4 });
  });
});

describe('budget and usage', () => {
  it('counts the tokens a debate used and shows them in today\'s usage', async () => {
    const before = await usageToday();
    const r = await debateOn(a.id);
    await finish(r.body.debateId);
    const after = await usageToday();
    expect(after).toBeGreaterThan(before);
    const u = (await (await req('GET', '/api/usage')).json()) as any;
    expect(u.days).toHaveLength(7);
    expect(u.days[6].date).toBe(localDate(new Date()));
    expect(u.today.debates).toBeGreaterThanOrEqual(1);
    expect(u.remaining).toBe(Math.max(0, u.budget - u.today.tokens));
  });
  it('refuses a new debate with 429 once today\'s budget is used up, and 0 means no limit', async () => {
    await req('PUT', '/api/settings', { dailyTokenBudget: 1 });
    const blocked = await debateOn(a.id);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'budget', budget: 1 });
    expect(blocked.body.used).toBeGreaterThanOrEqual(1);
    await req('PUT', '/api/settings', { dailyTokenBudget: 0 });
    expect((await req('GET', '/api/usage').then((r) => r.json()) as any).remaining).toBeNull();
    const ok = await debateOn(a.id);
    expect(ok.status).toBe(202);
    await finish(ok.body.debateId);
    await req('PUT', '/api/settings', { dailyTokenBudget: 200000 });
  });
  it('groups debates into calendar days, zero-filled, ignoring anything outside the window', () => {
    const now = new Date(2026, 10, 24, 15, 0, 0);                       // 24 Nov 2026, local
    const at = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();
    const g = groupByDay([{ startedAt: at(24), tokens: 100 }, { startedAt: at(24, 1), tokens: 50 }, { startedAt: at(22), tokens: 7 }, { startedAt: at(1), tokens: 999 }], 3, now);
    expect(g).toEqual([{ date: '2026-11-22', tokens: 7, debates: 1 }, { date: '2026-11-23', tokens: 0, debates: 0 }, { date: '2026-11-24', tokens: 150, debates: 2 }]);
    expect(startOfLocalDay(now).getHours()).toBe(0);
  });
});

describe('export', () => {
  it('JSON holds notes, links and debates, and leaves out deleted notes', async () => {
    const r = await req('GET', '/api/export');
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="idea-wall-\d{4}-\d{2}-\d{2}\.json"/);
    const data = (await r.json()) as ExportData;
    expect(data.version).toBe(1);
    const titles = data.notes.map((n) => n.title);
    expect(titles).toContain('TEST Shared parking');
    expect(titles).not.toContain('TEST Deleted idea');
    expect(data.links.some((l) => l.from === a.id && l.to === b.id && l.label === 'solves')).toBe(true);
    const mine = data.debates.filter((d) => d.noteId === a.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].turns.length).toBeGreaterThan(0);
    expect(data.debates.every((d) => data.notes.some((n) => n.id === d.noteId))).toBe(true);
  });
  it('Markdown reads like a document: grouped by type, links with direction, the latest verdict', async () => {
    const r = await req('GET', '/api/export?format=md');
    expect(r.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(r.headers.get('content-disposition')).toMatch(/\.md"/);
    const md = await r.text();
    expect(md).toMatch(/^# Idea wall/);
    expect(md).toMatch(/## Business ideas \(\d+\)[\s\S]*### TEST Shared parking/);
    expect(md).toMatch(/→ \*\*TEST Parking pain\*\* \(solves\)/);
    expect(md).toMatch(/← \*\*TEST Shared parking\*\* \(solves\)/);
    expect(md).toMatch(/\*\*Debate verdict: promising\.\*\* Good angle\./);
    expect(md).toMatch(/Risks:\n- Who pays\?/);
    expect(md).not.toMatch(/Deleted idea/);
  });
  it('toMarkdown copes with an empty wall and with line breaks inside titles', () => {
    const empty: ExportData = { version: 1, exportedAt: '2026-11-24T00:00:00.000Z', notes: [], links: [], debates: [] };
    expect(toMarkdown(empty)).toBe('# Idea wall\n\nExported 2026-11-24. 0 notes, 0 links, 0 debates.\n');
    expect(toMarkdown({ ...empty, links: [{ id: 'l', from: 'a', to: 'b', label: '', createdBy: 'user', createdAt: '' }] })).toMatch(/0 notes, 1 link, 0 debates\./);   // singular
    const n = { id: 'x', type: 'pattern' as const, title: 'Two\nlines', body: '', x: 0, y: 0, rotation: 0, z: 1, createdAt: '', updatedAt: '' };
    expect(toMarkdown({ ...empty, notes: [n] })).toMatch(/### Two lines\n/);
  });
});

describe('daily backup', () => {
  it('writes today\'s file once, and keeps only the newest few', async () => {
    const day = (d: number) => new Date(2026, 5, d, 12);
    const first = await writeDailyBackup(tmp, day(1), 2);
    expect(first).toMatch(/wall-2026-06-01\.json$/);
    expect(JSON.parse(readFileSync(first!, 'utf8')).version).toBe(1);
    expect(await writeDailyBackup(tmp, day(1), 2)).toBeNull();            // already done today
    await writeDailyBackup(tmp, day(2), 2);
    await writeDailyBackup(tmp, day(3), 2);
    await writeDailyBackup(tmp, day(4), 2);
    expect(readdirSync(tmp).sort()).toEqual(['wall-2026-06-03.json', 'wall-2026-06-04.json']);
    expect(existsSync(join(tmp, 'wall-2026-06-01.json'))).toBe(false);
  });
});
