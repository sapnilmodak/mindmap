// Accepting or dismissing what the colleagues suggested. Nothing changes on the wall until the founder accepts it.
import type { Link, Note, NoteType } from '@idea-office/shared';
import { createLink, createNote } from './notes.js';
import { getSuggestion, setSuggestionStatus } from './debateStore.js';

export type AcceptResult =
  | { ok: true; link?: Link; note?: Note; alreadyLinked?: boolean }
  | { ok: false; reason: 'not_found' | 'resolved' | 'target_missing' };

// link suggestion: link the debated note to the suggested note (created by 'claude').
// note suggestion: create the follow-up note where the client says (x, y) and link it to the debated note as a "follow-up".
export async function acceptSuggestion(id: string, spec: { id?: string; x?: number; y?: number } = {}): Promise<AcceptResult> {
  const s = await getSuggestion(id);
  if (!s) return { ok: false, reason: 'not_found' };
  if (s.status !== 'open') return { ok: false, reason: 'resolved' };

  if (s.kind === 'link') {
    const r = await createLink({ from: s.noteId, to: s.payload.target_note_id, label: s.payload.label ?? '' }, 'claude');
    if (r.ok) { await setSuggestionStatus(id, 'accepted'); return { ok: true, link: r.link }; }
    if (r.reason === 'duplicate') { await setSuggestionStatus(id, 'accepted'); return { ok: true, alreadyLinked: true }; }
    return { ok: false, reason: 'target_missing' };
  }

  const p = s.payload as { type: NoteType; title: string; body: string };
  const note = await createNote({ id: spec.id, type: p.type, title: p.title, body: p.body ?? '', x: spec.x, y: spec.y });
  const l = await createLink({ from: s.noteId, to: note.id, label: 'follow-up' }, 'claude');
  await setSuggestionStatus(id, 'accepted');
  return { ok: true, note, link: l.ok ? l.link : undefined };
}

export async function dismissSuggestion(id: string): Promise<'ok' | 'not_found' | 'resolved'> {
  const s = await getSuggestion(id);
  if (!s) return 'not_found';
  if (s.status !== 'open') return 'resolved';
  await setSuggestionStatus(id, 'dismissed');
  return 'ok';
}
