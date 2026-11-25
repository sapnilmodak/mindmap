// Everything on the wall as one file: notes, links, debates (turns, summaries, suggestions). JSON for safekeeping and for other
// tools, Markdown for reading. Deleted notes are not exported.
import type { DebateSummary, Link, Note, NoteType } from '@idea-office/shared';
import { run } from './graph.js';
import { listWall } from './notes.js';
import { getDebate } from './debateStore.js';
import type { StoredDebate } from './debateStore.js';

export interface ExportData { version: 1; exportedAt: string; notes: Note[]; links: Link[]; debates: StoredDebate[] }

export async function buildExport(now = new Date()): Promise<ExportData> {
  const { notes, links } = await listWall();
  const ids = new Set(notes.map((n) => n.id));
  const debateIds = (await run('MATCH (d:Debate)-[:ABOUT]->(n:Note) WHERE n.deleted = false RETURN d.id AS id ORDER BY d.startedAt')).map((r) => r.get('id') as string);
  const debates: StoredDebate[] = [];
  for (const id of debateIds) { const d = await getDebate(id); if (d && ids.has(d.noteId)) debates.push(d); }
  return { version: 1, exportedAt: now.toISOString(), notes, links, debates };
}

const ORDER: NoteType[] = ['pattern', 'problem', 'business', 'question'];
const HEADING: Record<NoteType, string> = { pattern: 'Patterns', problem: 'Problems', business: 'Business ideas', question: 'Questions' };
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim();

export function toMarkdown(data: ExportData): string {
  const title = new Map(data.notes.map((n) => [n.id, n.title]));
  const out: string[] = [`# Idea wall`, '', `Exported ${data.exportedAt.slice(0, 10)}. ${count(data.notes.length, 'note')}, ${count(data.links.length, 'link')}, ${count(data.debates.length, 'debate')}.`, ''];
  for (const type of ORDER) {
    const group = data.notes.filter((n) => n.type === type).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!group.length) continue;
    out.push(`## ${HEADING[type]} (${group.length})`, '');
    for (const n of group) {
      out.push(`### ${oneLine(n.title)}`, '');
      if (n.body.trim()) out.push(n.body.trim(), '');
      const mine = data.links.filter((l) => l.from === n.id || l.to === n.id);
      for (const l of mine) {
        const other = title.get(l.from === n.id ? l.to : l.from);
        if (other) out.push(`- ${l.from === n.id ? '→' : '←'} **${oneLine(other)}**${l.label ? ` (${oneLine(l.label)})` : ''}`);
      }
      if (mine.length) out.push('');
      const done = data.debates.filter((d) => d.noteId === n.id && d.result).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (done) {
        const r = done.result as DebateSummary;
        out.push(`**Debate verdict: ${r.verdict.replace('_', ' ')}.** ${oneLine(r.summary)}`, '');
        if (r.risks?.length) out.push('Risks:', ...r.risks.map((x) => `- ${oneLine(x)}`), '');
        if (r.next_steps?.length) out.push('Next steps:', ...r.next_steps.map((x) => `- ${oneLine(x)}`), '');
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
