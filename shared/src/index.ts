import { z } from 'zod';

export const NoteType = z.enum(['pattern', 'problem', 'business', 'question']);
export type NoteType = z.infer<typeof NoteType>;

// Board limits in metres (the wall is 8.4 x 2.9 centred at y 1.75); the client clamps tighter, the server only rejects nonsense.
const X = z.number().min(-4.5).max(4.5), Y = z.number().min(0).max(3.5);

export const NoteCreate = z.object({
  id: z.string().uuid().optional(),     // the client makes the id first: a note's size on the wall is derived from it
  type: NoteType,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(4000).default(''),
  x: X.optional(),
  y: Y.optional(),
});
export type NoteCreate = z.infer<typeof NoteCreate>;

export const NotePatch = z.object({
  type: NoteType.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().max(4000).optional(),
  x: X.optional(),
  y: Y.optional(),
  rotation: z.number().min(-45).max(45).optional(),
  z: z.number().int().min(0).max(1000000).optional(),
});
export type NotePatch = z.infer<typeof NotePatch>;

export interface Note {
  id: string; type: NoteType; title: string; body: string;
  x: number; y: number; rotation: number; z: number;
  createdAt: string; updatedAt: string;
}

export const LinkCreate = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().trim().max(60).default(''),
});
export type LinkCreate = z.infer<typeof LinkCreate>;

export const LinkPatch = z.object({ label: z.string().trim().max(60) });
export type LinkPatch = z.infer<typeof LinkPatch>;

export interface Link {
  id: string; from: string; to: string; label: string;
  createdBy: 'user' | 'claude' | 'gpt'; createdAt: string;
}

// The summary Claude writes at the end of a debate (validated on the server).
export interface DebateSummary {
  verdict: 'promising' | 'needs_work' | 'weak';
  summary: string; key_points: string[]; risks: string[]; next_steps: string[];
  suggested_links: { target_note_id: string; label: string; reason: string }[];
  suggested_notes: { type: NoteType; title: string; body: string }[];
}

export type Speaker = 'claude' | 'gpt' | 'user';

export type DebateEvent =
  | { type: 'debate_started'; debateId: string; noteId: string; turns?: number }   // turns = how many spoken turns are planned
  | { type: 'turn_started'; speaker: Speaker; seq: number }
  | { type: 'turn_delta'; speaker: Speaker; seq: number; text: string }
  | { type: 'turn_done'; speaker: Speaker; seq: number }
  | { type: 'synthesis_ready'; summary: unknown }
  | { type: 'suggestions_ready'; suggestions: { id: string; kind: 'link' | 'note'; payload: unknown; status?: 'open' | 'accepted' | 'dismissed' }[] }
  | { type: 'debate_failed'; provider: 'claude' | 'gpt' | 'system'; reason: string }
  | { type: 'debate_cancelled'; debateId: string }
  | { type: 'debate_done'; debateId: string };
