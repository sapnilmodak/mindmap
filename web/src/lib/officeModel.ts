// Pure model for the realistic digital worker office. Folds the strategy
// pipeline's real worker events (see DigitalWorkerEvent in strategyStream.ts)
// into what the view shows. No rendering and no clocks: the same events
// always produce the same state, which is what makes replay repeatable.
import type { DigitalWorkerEvent } from './strategyStream';
import { workerTitle } from './workerPersonas';

export const HUB_WORKER = 'chief_of_staff';   // orchestrates the others, so it is the hub, not a desk

export type OfficeStatus = 'idle' | 'waiting' | 'working' | 'blocked' | 'done';
export type LineKind = 'assign' | 'handoff' | 'result' | 'ask';

export interface WorkerView {
  id: string;
  status: OfficeStatus;
  wave: number;
  task: string;
  why?: string;         // why this worker is on the team (only when ADEO picked it)
  confidence?: number;
  verdict?: 'support' | 'concern' | 'neutral';
  analysis?: string;
  question?: string;
  startedAt?: number;   // event index
}
export interface LineEvent { idx: number; from: string; to: string; kind: LineKind }
export interface FeedItem { idx: number; worker: string; text: string }

export interface OfficeState {
  roster: string[];
  workers: Record<string, WorkerView>;
  lines: LineEvent[];
  feed: FeedItem[];
  step: number;            // 0 intake, 1 process, 2 review, 3 approve, 4 complete
  total: number;
  active: number;
  done: number;
  blocked: number;
}

export const HUB = 'hub';
const NAME_OVERRIDE: Record<string, string> = { devops_sre: 'DevOps SRE', qa_tester: 'QA Tester', sdr: 'SDR', dba: 'DBA', growth_hacker: 'Growth Hacker' };
const label = (id: string) => NAME_OVERRIDE[id] ?? id.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
export const workerName = label;

export function initialState(): OfficeState {
  return { roster: [], workers: {}, lines: [], feed: [], step: 0, total: 0, active: 0, done: 0, blocked: 0 };
}

function ensure(s: OfficeState, id: string): WorkerView {
  if (!s.workers[id]) s.workers[id] = { id, status: 'idle', wave: 1, task: workerTitle(id) };
  return s.workers[id];
}

export function reduceEvent(prev: OfficeState, ev: DigitalWorkerEvent, idx: number): OfficeState {
  const s: OfficeState = { ...prev, workers: { ...prev.workers }, lines: prev.lines, feed: prev.feed, roster: prev.roster };
  const touch = (id: string) => { s.workers[id] = { ...ensure(s, id) }; return s.workers[id]; };
  const say = (worker: string, text: string) => { s.feed = [...s.feed, { idx, worker, text }].slice(-60); };
  const line = (from: string, to: string, kind: LineKind) => { s.lines = [...s.lines, { idx, from, to, kind }]; };
  const hubOr = (id: string) => (id === HUB_WORKER ? HUB : id);

  switch (ev.type) {
    case 'worker_roster': {
      s.roster = ev.workers.slice();
      s.workers = {};
      const seat = (w: string) => ev.seats?.find((x) => x.worker === w);
      for (const w of ev.workers) {
        const st = seat(w);
        s.workers[w] = { id: w, status: ev.wave2.includes(w) ? 'waiting' : 'idle', wave: ev.wave2.includes(w) ? 2 : 1,
          task: st?.title?.trim() || workerTitle(w), ...(st?.why ? { why: st.why } : {}) };
      }
      say('hub', `${ev.workers.length} digital workers joined: ${ev.wave1.length} start now, ${ev.wave2.length} wait for their findings.`);
      if (ev.seats?.length) say('hub', 'The team was chosen for this question; select a worker to see why.');
      break;
    }
    case 'worker_start': {
      const w = touch(ev.worker);
      w.status = 'working'; w.wave = ev.wave; w.startedAt = idx; w.question = undefined;
      line(HUB, hubOr(ev.worker), 'assign');
      say(ev.worker, `${label(ev.worker)} started ${w.task.toLowerCase()}.`);
      break;
    }
    case 'worker_message': {
      const from = hubOr(ev.from); const to = ev.to === 'wave2' || !s.workers[ev.to] ? HUB : hubOr(ev.to);
      line(from, to, 'handoff');
      say(ev.from, `${label(ev.from)} handed findings to ${ev.to === 'wave2' ? 'the next wave' : label(ev.to)}.`);
      break;
    }
    case 'worker_end': {
      const w = touch(ev.worker);
      w.status = 'done'; w.confidence = ev.confidence; w.verdict = ev.verdict; w.analysis = ev.analysis; w.question = undefined;
      line(hubOr(ev.worker), HUB, 'result');
      const pct = Math.round((ev.confidence ?? 0) * 100);
      say(ev.worker, `${label(ev.worker)} finished${ev.verdict ? ` (${ev.verdict})` : ''}${pct ? ` with ${pct}% confidence` : ''}.`);
      break;
    }
    case 'worker_question': {
      const w = touch(ev.worker);
      w.status = 'blocked'; w.question = ev.question;
      line(hubOr(ev.worker), HUB, 'ask');
      say(ev.worker, `${label(ev.worker)} needs an answer: ${ev.question}`);
      break;
    }
    case 'worker_question_answered':
    case 'worker_question_timeout': {
      const w = touch(ev.worker);
      w.status = 'working'; w.question = undefined;
      say(ev.worker, ev.type === 'worker_question_answered' ? `${label(ev.worker)} got an answer and carried on.` : `${label(ev.worker)} continued without an answer.`);
      break;
    }
  }

  const ws = Object.values(s.workers);
  s.total = s.roster.length || ws.length;
  s.active = ws.filter((w) => w.status === 'working').length;
  s.blocked = ws.filter((w) => w.status === 'blocked').length;
  s.done = ws.filter((w) => w.status === 'done').length;
  const anyStart = ws.some((w) => w.startedAt !== undefined);
  const wave2Started = ws.some((w) => w.wave === 2 && w.startedAt !== undefined);
  s.step = s.total > 0 && s.done === s.total ? 4 : s.blocked > 0 ? 3 : wave2Started ? 2 : anyStart ? 1 : 0;
  return s;
}

export function reduceAll(events: DigitalWorkerEvent[], upTo: number = events.length): OfficeState {
  let s = initialState();
  for (let i = 0; i < Math.min(upTo, events.length); i++) s = reduceEvent(s, events[i], i);
  return s;
}

// Preferred desk for each known worker (so a desk always means the same job);
// anyone else takes the next free desk, and the orchestrator is the hub.
export const DESK_COUNT = 9;
export const PREFERRED_DESK: Record<string, number> = {
  scribe: 0, growth_hacker: 1, quant: 2,
  warden: 3, red_teamer: 4, scout: 5, devops_sre: 6,
  auditor: 7, economist: 8,
};

export function assignDesks(roster: string[]): { desks: (string | null)[]; overflow: string[] } {
  const desks: (string | null)[] = Array(DESK_COUNT).fill(null);
  const rest: string[] = [];
  for (const w of roster) {
    if (w === HUB_WORKER) continue;
    const d = PREFERRED_DESK[w];
    if (d !== undefined && desks[d] === null) desks[d] = w; else rest.push(w);
  }
  const overflow: string[] = [];
  for (const w of rest) {
    const free = desks.indexOf(null);
    if (free >= 0) desks[free] = w; else overflow.push(w);
  }
  return { desks, overflow };
}
