import type { Link, LinkCreate, Note, NoteCreate, NotePatch } from '@idea-office/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  duplicate: 'Those notes are already linked.',
  busy: 'They are already debating this note.',
  budget: "Today's token budget is used up. Raise it in Settings (or set it to 0 for no limit).",
  not_running: 'That debate has already finished.',
  resolved: 'That suggestion was already handled.',
  target_missing: 'The note that suggestion points to is gone.',
  invalid_input: 'The server rejected that (too long, or not valid).',
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'unreachable', 'Cannot reach the server. Start it with "npm run dev:server" (and "npm run db:up" for the database).');
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `http_${res.status}`;
    throw new ApiError(res.status, code, MESSAGES[code] ?? `Server error (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export interface Settings {
  autoDebate: boolean; founderProfile: string; demo: boolean;
  turnsPerDebate: number; dailyTokenBudget: number;
  models: { claude: string; gpt: string };
}
export interface UsageReport {
  budget: number; remaining: number | null;
  today: { date: string; tokens: number; debates: number };
  days: { date: string; tokens: number; debates: number }[];
}
export interface DebateListItem { id: string; status: 'running' | 'done' | 'failed' | 'cancelled'; startedAt: string; verdict: string | null }

export const api = {
  wall: () => call<{ notes: Note[]; links: Link[] }>('GET', '/api/wall'),
  createNote: (b: NoteCreate) => call<Note>('POST', '/api/notes', b),
  patchNote: (id: string, b: NotePatch) => call<Note>('PATCH', `/api/notes/${id}`, b),
  deleteNote: (id: string) => call<{ ok: true }>('DELETE', `/api/notes/${id}`),
  createLink: (b: LinkCreate) => call<Link>('POST', '/api/links', b),
  patchLink: (id: string, label: string) => call<Link>('PATCH', `/api/links/${id}`, { label }),
  deleteLink: (id: string) => call<{ ok: true }>('DELETE', `/api/links/${id}`),

  settings: () => call<Settings>('GET', '/api/settings'),
  putSettings: (b: Partial<Pick<Settings, 'autoDebate' | 'founderProfile' | 'turnsPerDebate' | 'dailyTokenBudget'>>) => call<Settings>('PUT', '/api/settings', b),
  usage: () => call<UsageReport>('GET', '/api/usage'),

  startDebate: (noteId: string) => call<{ debateId: string; demo: boolean }>('POST', `/api/notes/${noteId}/debate`),
  debatesFor: (noteId: string) => call<DebateListItem[]>('GET', `/api/notes/${noteId}/debates`),
  cancelDebate: (id: string) => call<{ ok: true }>('POST', `/api/debates/${id}/cancel`),
  say: (id: string, text: string) => call<{ ok: true }>('POST', `/api/debates/${id}/message`, { text }),
  acceptSuggestion: (id: string, note?: { id: string; x: number; y: number }) =>
    call<{ ok: true; link?: Link; note?: Note; alreadyLinked?: boolean }>('POST', `/api/suggestions/${id}/accept`, note ? { note } : {}),
  dismissSuggestion: (id: string) => call<{ ok: true }>('POST', `/api/suggestions/${id}/dismiss`),
};
