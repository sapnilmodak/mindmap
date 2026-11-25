import { randomUUID } from 'node:crypto';
import type { Link, LinkCreate, Note, NoteCreate, NotePatch } from '@idea-office/shared';
import { run } from './graph.js';
import { embedNote } from './embeddings.js';

const NOTE_PROJ = 'n {.id, .type, .title, .body, .x, .y, .rotation, .z, .createdAt, .updatedAt}';
const asNote = (o: any): Note => o as Note;

export async function listWall(): Promise<{ notes: Note[]; links: Link[] }> {
  const notes = (await run(`MATCH (n:Note) WHERE n.deleted = false RETURN ${NOTE_PROJ} AS n ORDER BY n.z`)).map((r) => asNote(r.get('n')));
  const links = (await run(
    `MATCH (a:Note)-[r:LINKED]->(b:Note) WHERE a.deleted = false AND b.deleted = false
     RETURN r.id AS id, a.id AS from, b.id AS to, r.label AS label, r.createdBy AS createdBy, r.createdAt AS createdAt`,
  )).map((r) => r.toObject() as unknown as Link);
  return { notes, links };
}

export async function getNote(id: string): Promise<Note | null> {
  const r = await run(`MATCH (n:Note {id:$id}) WHERE n.deleted = false RETURN ${NOTE_PROJ} AS n`, { id });
  return r.length ? asNote(r[0].get('n')) : null;
}

export async function createNote(input: NoteCreate): Promise<Note> {
  const now = new Date().toISOString();
  const maxZ = (await run('MATCH (n:Note) RETURN coalesce(max(n.z), 0) AS m'))[0].get('m');
  const props = {
    id: input.id ?? randomUUID(), type: input.type, title: input.title, body: input.body,
    x: input.x ?? (Math.random() * 2 - 1) * 3.6, y: input.y ?? 0.4 + Math.random() * 2.2,
    rotation: (Math.random() * 12 - 6), z: Number(maxZ) + 1,
    createdAt: now, updatedAt: now, deleted: false,
  };
  await run('CREATE (n:Note) SET n = $p', { p: props });
  void embedNote(props.id, props.title, props.body);          // background; the note is already saved
  return (await getNote(props.id))!;
}

export async function patchNote(id: string, patch: NotePatch): Promise<Note | null> {
  const p = { ...patch, updatedAt: new Date().toISOString() };
  const r = await run(`MATCH (n:Note {id:$id}) WHERE n.deleted = false SET n += $p RETURN ${NOTE_PROJ} AS n`, { id, p });
  if (!r.length) return null;
  if (patch.title !== undefined || patch.body !== undefined) {
    const n = asNote(r[0].get('n'));
    void embedNote(id, n.title, n.body);
  }
  return asNote(r[0].get('n'));
}

export async function deleteNote(id: string): Promise<boolean> {
  const r = await run('MATCH (n:Note {id:$id}) WHERE n.deleted = false SET n.deleted = true, n.updatedAt = $t RETURN n.id', { id, t: new Date().toISOString() });
  return r.length > 0;
}

export type LinkResult = { ok: true; link: Link } | { ok: false; reason: 'self' | 'missing' | 'duplicate' };

export async function createLink(input: LinkCreate, createdBy: Link['createdBy'] = 'user'): Promise<LinkResult> {
  if (input.from === input.to) return { ok: false, reason: 'self' };
  const exists = await run(
    `MATCH (a:Note {id:$from}), (b:Note {id:$to}) WHERE a.deleted = false AND b.deleted = false
     OPTIONAL MATCH (a)-[r:LINKED]-(b) RETURN count(DISTINCT a) AS na, count(DISTINCT b) AS nb, count(r) AS c`, input);
  if (Number(exists[0].get('na')) === 0 || Number(exists[0].get('nb')) === 0) return { ok: false, reason: 'missing' };
  if (Number(exists[0].get('c')) > 0) return { ok: false, reason: 'duplicate' };
  const link: Link = { id: randomUUID(), from: input.from, to: input.to, label: input.label, createdBy, createdAt: new Date().toISOString() };
  await run(
    `MATCH (a:Note {id:$from}), (b:Note {id:$to})
     CREATE (a)-[:LINKED {id:$id, label:$label, createdBy:$createdBy, createdAt:$createdAt}]->(b)`, { ...link });
  return { ok: true, link };
}

export async function updateLink(id: string, label: string): Promise<Link | null> {
  const r = await run(
    `MATCH (a:Note)-[r:LINKED {id:$id}]->(b:Note) SET r.label = $label
     RETURN r.id AS id, a.id AS from, b.id AS to, r.label AS label, r.createdBy AS createdBy, r.createdAt AS createdAt`, { id, label });
  return r.length ? (r[0].toObject() as unknown as Link) : null;
}

export async function deleteLink(id: string): Promise<boolean> {
  const r = await run('MATCH ()-[r:LINKED {id:$id}]->() DELETE r RETURN 1 AS x', { id });
  return r.length > 0;
}
