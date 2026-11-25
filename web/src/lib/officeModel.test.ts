import { describe, expect, it } from 'vitest';
import { assignDesks, reduceAll, HUB, HUB_WORKER } from './officeModel';
import type { DigitalWorkerEvent } from './strategyStream';

const ROSTER = ['quant', 'warden', 'scout', 'scribe', 'devops_sre', 'red_teamer', 'auditor', 'economist', 'chief_of_staff', 'growth_hacker'];
const roster = (): DigitalWorkerEvent => ({ type: 'worker_roster', workers: ROSTER, wave1: ROSTER.slice(0, 5), wave2: ROSTER.slice(5) });

describe('officeModel', () => {
  it('waits wave 2 and idles wave 1 from the roster', () => {
    const s = reduceAll([roster()]);
    expect(s.total).toBe(10);
    expect(s.workers.quant.status).toBe('idle');
    expect(s.workers.auditor.status).toBe('waiting');
    expect(s.step).toBe(0);
  });
  it('start sets working with a hub line and the real task', () => {
    const s = reduceAll([roster(), { type: 'worker_start', worker: 'quant', wave: 1 }]);
    expect(s.workers.quant).toMatchObject({ status: 'working', task: 'Financial Modeling' });
    expect(s.lines.at(-1)).toMatchObject({ from: HUB, to: 'quant', kind: 'assign' });
    expect(s.active).toBe(1);
    expect(s.step).toBe(1);
  });
  it('maps the orchestrator to the hub, not a desk', () => {
    const s = reduceAll([roster(), { type: 'worker_start', worker: HUB_WORKER, wave: 1 }]);
    expect(s.lines.at(-1)).toMatchObject({ from: HUB, to: HUB });
    expect(assignDesks(ROSTER).desks).not.toContain(HUB_WORKER);
  });
  it('question blocks, answer resumes, and approval step shows while blocked', () => {
    const base: DigitalWorkerEvent[] = [roster(), { type: 'worker_start', worker: 'scout', wave: 1 }, { type: 'worker_question', questionId: 'q1', worker: 'scout', wave: 1, question: 'Which region?' }];
    const blocked = reduceAll(base);
    expect(blocked.workers.scout).toMatchObject({ status: 'blocked', question: 'Which region?' });
    expect(blocked.step).toBe(3);
    const resumed = reduceAll([...base, { type: 'worker_question_answered', questionId: 'q1', worker: 'scout', answer: 'EU' }]);
    expect(resumed.workers.scout.status).toBe('working');
    expect(resumed.step).toBe(1);
  });
  it('end marks done with verdict and everyone done completes the workflow', () => {
    const evs: DigitalWorkerEvent[] = [roster()];
    ROSTER.forEach((w) => evs.push({ type: 'worker_start', worker: w, wave: 1 }, { type: 'worker_end', worker: w, wave: 1, status: 'ok', confidence: 0.8, analysis: 'x', verdict: 'support' }));
    const s = reduceAll(evs);
    expect(s.done).toBe(10);
    expect(s.step).toBe(4);
    expect(s.workers.quant.verdict).toBe('support');
  });
  it('wave 2 start moves the workflow to review', () => {
    const s = reduceAll([roster(), { type: 'worker_start', worker: 'quant', wave: 1 }, { type: 'worker_start', worker: 'auditor', wave: 2 }]);
    expect(s.step).toBe(2);
  });
  it('is deterministic and prefix-consistent (replay)', () => {
    const evs: DigitalWorkerEvent[] = [roster(), { type: 'worker_start', worker: 'quant', wave: 1 }, { type: 'worker_message', from: 'quant', to: 'wave2', snippet: 's' }];
    expect(JSON.stringify(reduceAll(evs))).toBe(JSON.stringify(reduceAll(evs)));
    expect(reduceAll(evs, 2).lines).toHaveLength(1);
  });
  it('desk assignment is stable, fills free desks and reports overflow', () => {
    const { desks } = assignDesks(ROSTER);
    expect(desks[2]).toBe('quant');
    expect(desks.filter(Boolean)).toHaveLength(9);
    const extra = assignDesks([...ROSTER, 'dba', 'qa_tester']);
    expect(extra.overflow).toEqual(['dba', 'qa_tester']);
    expect(assignDesks(['dba']).desks[0]).toBe('dba');
  });

  it('shows the seat title and reason when ADEO chose the team, and the usual title otherwise', () => {
    const seats = [{ worker: 'quant', title: 'Workforce Cost Modeler', why: 'analyst modeler seat, people analytics' }];
    const s = reduceAll([{ ...roster(), seats } as DigitalWorkerEvent]);
    expect(s.workers.quant).toMatchObject({ task: 'Workforce Cost Modeler', why: 'analyst modeler seat, people analytics' });
    expect(s.workers.warden.why).toBeUndefined();
    expect(s.workers.warden.task).not.toBe('');
    const plain = reduceAll([roster()]);
    expect(plain.workers.quant).toMatchObject({ task: 'Financial Modeling' });
    expect(plain.workers.quant.why).toBeUndefined();
  });
  it('ignores a blank seat title', () => {
    const s = reduceAll([{ ...roster(), seats: [{ worker: 'quant', title: '  ', why: '' }] } as DigitalWorkerEvent]);
    expect(s.workers.quant.task).toBe('Financial Modeling');
  });
});
