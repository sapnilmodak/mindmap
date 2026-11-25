// GraphRAG: what the two workers know when they debate a note.
//   1. the note itself
//   2. notes the founder linked to it (1 hop with link labels, 2 hops as titles): the founder's own mapping
//   3. notes that are semantically similar but NOT linked (vector index): candidates for new links
//   4. summaries of earlier debates about any of those notes
//   5. a titles-only outline of the rest of the wall, capped
import { run, int } from './graph.js';
import { embed, embedMissing, noteText } from './embeddings.js';
import { cfg } from './config.js';

export interface CtxNote { id: string; type: string; title: string; body: string }
export interface Context {
  note: CtxNote;
  linked: (CtxNote & { label: string; direction: 'out' | 'in' })[];
  twoHop: { id: string; type: string; title: string; via: string }[];
  similar: (CtxNote & { score: number })[];
  pastDebates: { noteId: string; noteTitle: string; summary: string }[];
  outline: { id: string; type: string; title: string }[];
}

const MIN_SIMILARITY = 0.55;
const OUTLINE_CAP = 60;

export async function buildContext(noteId: string): Promise<Context | null> {
  const nr = await run('MATCH (n:Note {id:$id}) WHERE n.deleted = false RETURN n {.id,.type,.title,.body} AS n', { id: noteId });
  if (!nr.length) return null;
  const note = nr[0].get('n') as CtxNote;

  const linked = (await run(
    `MATCH (n:Note {id:$id})-[r:LINKED]-(m:Note) WHERE m.deleted = false
     RETURN m {.id,.type,.title,.body} AS m, r.label AS label,
            CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS direction`, { id: noteId },
  )).map((r) => ({ ...(r.get('m') as CtxNote), label: r.get('label') as string, direction: r.get('direction') as 'out' | 'in' }));
  const linkedIds = new Set(linked.map((l) => l.id));

  const twoHop = (await run(
    `MATCH (n:Note {id:$id})-[:LINKED]-(a:Note)-[:LINKED]-(m:Note)
     WHERE m.deleted = false AND a.deleted = false AND m.id <> n.id AND NOT (n)-[:LINKED]-(m)
     RETURN DISTINCT m.id AS id, m.type AS type, m.title AS title, a.title AS via LIMIT 15`, { id: noteId },
  )).map((r) => r.toObject() as Context['twoHop'][number]);

  let similar: Context['similar'] = [];
  try {
    const vec = await embed(noteText(note.title, note.body));   // fails fast without a working key, before trying every note
    if (cfg.openaiKey) await embedMissing();                // notes written before the key worked get their vectors now
    similar = (await run(
      `CALL db.index.vector.queryNodes('note_embedding', $k, $vec) YIELD node, score
       WHERE node.deleted = false AND node.id <> $id AND score >= $min
       RETURN node {.id,.type,.title,.body} AS m, score`, { k: int(12), vec, id: noteId, min: MIN_SIMILARITY },
    )).map((r) => ({ ...(r.get('m') as CtxNote), score: r.get('score') as number }))
      .filter((s) => !linkedIds.has(s.id)).slice(0, 6);
  } catch (e) {
    console.warn(`[rag] similarity search skipped: ${(e as Error).message}`);   // linked context still works
  }

  const relatedIds = [noteId, ...linked.map((l) => l.id), ...similar.map((s) => s.id)];
  const pastDebates = (await run(
    `MATCH (d:Debate {status:'done'})-[:ABOUT]->(m:Note) WHERE m.id IN $ids AND d.summary IS NOT NULL
     RETURN m.id AS noteId, m.title AS noteTitle, d.summary AS summary ORDER BY d.startedAt DESC LIMIT 5`, { ids: relatedIds },
  )).map((r) => r.toObject() as Context['pastDebates'][number]);

  const skip = new Set(relatedIds);
  const outline = (await run(
    'MATCH (m:Note) WHERE m.deleted = false RETURN m.id AS id, m.type AS type, m.title AS title ORDER BY m.updatedAt DESC LIMIT $cap', { cap: int(OUTLINE_CAP + relatedIds.length) },
  )).map((r) => r.toObject() as Context['outline'][number]).filter((o) => !skip.has(o.id)).slice(0, OUTLINE_CAP);

  return { note, linked, twoHop, similar, pastDebates, outline };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Plain text block for the prompt. Note ids are included so the models can propose links by id.
export function renderContext(c: Context): string {
  const out: string[] = [];
  out.push(`## NEW NOTE [${c.note.id}] (${c.note.type})\n${c.note.title}\n${c.note.body}`);
  if (c.linked.length) {
    out.push('## NOTES THE FOUNDER LINKED TO IT');
    for (const l of c.linked) out.push(`- [${l.id}] (${l.type}) ${l.title}${l.label ? ` | link: "${l.label}"` : ''} | ${l.direction === 'out' ? 'this note points to it' : 'it points to this note'}\n  ${clip(l.body, 300)}`);
  }
  if (c.twoHop.length) {
    out.push('## ONE STEP FURTHER OUT');
    for (const t of c.twoHop) out.push(`- [${t.id}] (${t.type}) ${t.title} (via "${t.via}")`);
  }
  if (c.similar.length) {
    out.push('## SIMILAR NOTES NOT YET LINKED (found by vector search; candidate links)');
    for (const s of c.similar) out.push(`- [${s.id}] (${s.type}) ${s.title} (similarity ${s.score.toFixed(2)})\n  ${clip(s.body, 200)}`);
  }
  if (c.pastDebates.length) {
    out.push('## EARLIER DEBATES ON RELATED NOTES');
    for (const d of c.pastDebates) out.push(`- about "${d.noteTitle}": ${clip(d.summary, 400)}`);
  }
  if (c.outline.length) {
    out.push('## REST OF THE WALL (titles only)');
    for (const o of c.outline) out.push(`- [${o.id}] (${o.type}) ${o.title}`);
  }
  return out.join('\n\n');
}
