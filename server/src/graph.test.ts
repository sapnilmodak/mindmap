// Integration test against the real Neo4j from docker-compose (npm run db:up). No API keys needed:
// embeddings are skipped when unavailable, which is itself part of what is tested.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeGraph, initSchema, run } from './graph.js';
import * as notes from './notes.js';
import { buildContext, renderContext } from './retrieval.js';

const ids: string[] = [];
const mk = async (title: string, type: 'pattern' | 'problem' | 'business' | 'question' = 'business', body = '') => {
  const n = await notes.createNote({ type, title: `TEST ${title}`, body });
  ids.push(n.id);
  return n;
};

beforeAll(async () => { await initSchema(); });
afterAll(async () => {
  await run('MATCH (n:Note) WHERE n.id IN $ids DETACH DELETE n', { ids });
  await closeGraph();
});

describe('notes and links in the graph', () => {
  it('creates, patches and soft-deletes notes', async () => {
    const a = await mk('alpha');
    expect((await notes.getNote(a.id))?.title).toBe('TEST alpha');
    expect((await notes.patchNote(a.id, { x: 1.5 }))?.x).toBe(1.5);
    expect(await notes.deleteNote(a.id)).toBe(true);
    expect(await notes.getNote(a.id)).toBeNull();
  });

  it('links notes, rejects self and duplicate links in either direction', async () => {
    const a = await mk('a'); const b = await mk('b');
    const r = await notes.createLink({ from: a.id, to: b.id, label: 'same pattern' });
    expect(r.ok).toBe(true);
    expect(await notes.createLink({ from: a.id, to: a.id, label: '' })).toEqual({ ok: false, reason: 'self' });
    expect(await notes.createLink({ from: b.id, to: a.id, label: '' })).toEqual({ ok: false, reason: 'duplicate' });
    expect(await notes.createLink({ from: a.id, to: 'nope', label: '' })).toEqual({ ok: false, reason: 'missing' });
    const wall = await notes.listWall();
    expect(wall.links.some((l) => r.ok && l.id === r.link.id)).toBe(true);
  });

  it('edits a link label and keeps direction; unknown id is null', async () => {
    const a = await mk('la'); const b = await mk('lb');
    const r = await notes.createLink({ from: a.id, to: b.id, label: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = await notes.updateLink(r.link.id, 'solves');
    expect(u).toMatchObject({ id: r.link.id, from: a.id, to: b.id, label: 'solves' });
    expect(await notes.updateLink('nope', 'x')).toBeNull();
    expect(await notes.deleteLink(r.link.id)).toBe(true);
    expect(await notes.deleteLink(r.link.id)).toBe(false);
  });

  it('GraphRAG context holds linked notes (1 hop with label) and 2-hop notes', async () => {
    const root = await mk('root', 'business', 'sell X');
    const near = await mk('near', 'problem', 'people hate Y');
    const far = await mk('far', 'pattern', 'Z works like Uber');
    await notes.createLink({ from: root.id, to: near.id, label: 'solves' });
    await notes.createLink({ from: far.id, to: near.id, label: 'inspired by' });
    const c = await buildContext(root.id);
    expect(c).not.toBeNull();
    expect(c!.linked.map((l) => [l.id, l.label])).toEqual([[near.id, 'solves']]);
    expect(c!.twoHop.map((t) => t.id)).toEqual([far.id]);
    const text = renderContext(c!);
    expect(text).toContain(near.id);
    expect(text).toContain('solves');
    expect(text).not.toContain('NaN');
  });

  it('a deleted note disappears from the wall, links and context', async () => {
    const a = await mk('keep'); const b = await mk('gone');
    await notes.createLink({ from: a.id, to: b.id, label: 'x' });
    await notes.deleteNote(b.id);
    expect((await buildContext(a.id))!.linked).toHaveLength(0);
    expect((await notes.listWall()).links.some((l) => l.to === b.id)).toBe(false);
  });
});
