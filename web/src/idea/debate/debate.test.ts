import { describe, expect, it } from 'vitest';
import type { DebateEvent } from '@idea-office/shared';
import { bubbleFor, initialDebate, reduceDebate, resolveSuggestion, statusLine } from './debateModel';
import { FLANK_SEP, flankSpots, workerSpots } from './debateStage';
import { BREAK_SPOTS } from '../../components/office/gaming/gamingLayout';
import { WORKER_SPOTS, WORKER_SPOTS_WALL } from '../ideaLayout';

const fold = (events: DebateEvent[]) => events.reduce(reduceDebate, initialDebate());
const turn = (seq: number, speaker: 'claude' | 'gpt' | 'user', text: string): DebateEvent[] => [
  { type: 'turn_started', speaker, seq }, { type: 'turn_delta', speaker, seq, text: text.slice(0, 5) }, { type: 'turn_delta', speaker, seq, text: text.slice(5) }, { type: 'turn_done', speaker, seq },
];
const START: DebateEvent = { type: 'debate_started', debateId: 'd1', noteId: 'n1', turns: 2 };
const SUMMARY = { verdict: 'promising', summary: 's', key_points: [], risks: [], next_steps: [], suggested_links: [], suggested_notes: [] };

describe('reduceDebate', () => {
  it('builds turns from streamed deltas, in order, and tracks who is speaking', () => {
    let s = fold([START, { type: 'turn_started', speaker: 'claude', seq: 0 }, { type: 'turn_delta', speaker: 'claude', seq: 0, text: 'Hel' }]);
    expect(s).toMatchObject({ phase: 'running', speaker: 'claude', debateId: 'd1', noteId: 'n1' });
    expect(s.turns).toEqual([{ seq: 0, speaker: 'claude', text: 'Hel', done: false }]);
    s = [{ type: 'turn_delta', speaker: 'claude', seq: 0, text: 'lo.' }, { type: 'turn_done', speaker: 'claude', seq: 0 }, ...turn(1, 'gpt', 'Why now?')].reduce(reduceDebate, s);
    expect(s.turns.map((t) => [t.speaker, t.text, t.done])).toEqual([['claude', 'Hello.', true], ['gpt', 'Why now?', true]]);
    expect(s.speaker).toBeNull();
  });

  it('a full debate ends done with the summary and suggestions', () => {
    const s = fold([START, ...turn(0, 'claude', 'One.'), ...turn(1, 'gpt', 'Two.'),
      { type: 'synthesis_ready', summary: SUMMARY },
      { type: 'suggestions_ready', suggestions: [{ id: 's1', kind: 'link', payload: { target_note_id: 'x' } }, { id: 's2', kind: 'note', payload: {}, status: 'accepted' }] },
      { type: 'debate_done', debateId: 'd1' }]);
    expect(s.phase).toBe('done');
    expect(s.summary?.verdict).toBe('promising');
    expect(s.suggestions.map((x) => [x.id, x.status])).toEqual([['s1', 'open'], ['s2', 'accepted']]);
    expect(statusLine(s)).toBe('Debate finished');
  });

  it('says it is writing the summary only once every planned turn is done; before that the next colleague is thinking', () => {
    expect(statusLine(fold([START, ...turn(0, 'claude', 'One.')]))).toBe('Thinking…');
    expect(statusLine(fold([START, ...turn(0, 'claude', 'One.'), ...turn(1, 'gpt', 'Two.')]))).toBe('Writing the summary…');
    // a founder interjection is not a planned turn and must not trigger the summary early
    expect(statusLine(fold([START, ...turn(0, 'user', 'Hi.'), ...turn(1, 'claude', 'One.')]))).toBe('Thinking…');
    // an older server (or a replay) that does not say how many turns are planned never claims to be summarizing
    expect(statusLine(fold([{ type: 'debate_started', debateId: 'd1', noteId: 'n1' }, ...turn(0, 'claude', 'One.')]))).toBe('Thinking…');
    expect(statusLine(fold([START, { type: 'turn_started', speaker: 'gpt', seq: 1 }]))).toBe('Haiku is speaking…');
    expect(statusLine(fold([START]))).toBe('Reading the wall…');
  });

  it('records which colleague failed, and a cancel', () => {
    const f = fold([START, ...turn(0, 'claude', 'One.'), { type: 'debate_failed', provider: 'gpt', reason: '429' }]);
    expect(f).toMatchObject({ phase: 'failed', error: { provider: 'gpt', reason: '429' } });
    expect(statusLine(f)).toBe('Haiku stepped out');
    expect(f.turns).toHaveLength(1);                                   // what was said stays
    expect(fold([START, { type: 'debate_cancelled', debateId: 'd1' }]).phase).toBe('cancelled');
  });

  it('replaying the same events (a reconnect) gives the same state, not doubled text', () => {
    const evs = [START, ...turn(0, 'claude', 'Hello there.'), ...turn(1, 'gpt', 'Hmm.')];
    expect(fold([...evs, ...evs])).toEqual(fold(evs));
  });

  it('shows the founder\'s own words as a turn', () => {
    const s = fold([START, ...turn(0, 'claude', 'Hi.'), ...turn(1, 'user', 'What about colleges?')]);
    expect(s.turns[1]).toMatchObject({ speaker: 'user', text: 'What about colleges?', done: true });
  });

  it('resolves one suggestion without touching the others', () => {
    const s = resolveSuggestion(fold([START, { type: 'suggestions_ready', suggestions: [{ id: 'a', kind: 'link', payload: {} }, { id: 'b', kind: 'link', payload: {} }] }]), 'a', 'accepted');
    expect(s.suggestions.map((x) => x.status)).toEqual(['accepted', 'open']);
  });
});

describe('bubbleFor', () => {
  it('is empty before someone speaks and marks the current speaker', () => {
    expect(bubbleFor(fold([START]), 'claude')).toEqual({ text: '', speaking: false });
    const s = fold([START, { type: 'turn_started', speaker: 'gpt', seq: 0 }, { type: 'turn_delta', speaker: 'gpt', seq: 0, text: 'Who pays?' }]);
    expect(bubbleFor(s, 'gpt')).toEqual({ text: 'Who pays?', speaking: true });
    expect(bubbleFor(s, 'claude').text).toBe('');
  });
  it('keeps each colleague\'s last words after they stop, and shows only the tail of a long turn', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const s = fold([START, ...turn(0, 'claude', long), ...turn(1, 'gpt', 'Short.')]);
    const b = bubbleFor(s, 'claude', 100);
    expect(b.speaking).toBe(false);
    expect(b.text.startsWith('…')).toBe(true);
    expect(b.text.length).toBeLessThanOrEqual(102);
    expect(b.text.endsWith('word59')).toBe(true);
    expect(bubbleFor(s, 'gpt').text).toBe('Short.');
  });
});

describe('flankSpots / workerSpots', () => {
  it('puts the two colleagues either side of the note, the same distance apart', () => {
    const f = flankSpots(1.5);
    expect(f.gpt.x - f.claude.x).toBeCloseTo(FLANK_SEP * 2, 9);
    expect((f.claude.x + f.gpt.x) / 2).toBeCloseTo(1.5, 9);
  });
  it('keeps both inside the walkable strip when the note hangs at the edge of the board', () => {
    for (const x of [-4.2, 4.2, -99, 99]) {
      const f = flankSpots(x);
      expect(Math.abs(f.claude.x)).toBeLessThanOrEqual(Math.abs(WORKER_SPOTS_WALL.gpt.x) + 1e-9);
      expect(Math.abs(f.gpt.x)).toBeLessThanOrEqual(Math.abs(WORKER_SPOTS_WALL.gpt.x) + 1e-9);
      expect(f.gpt.x - f.claude.x).toBeCloseTo(FLANK_SEP * 2, 9);
    }
  });
  it('idle: beside the writing desk; wall close-up: at the ends of the board', () => {
    expect(workerSpots({ mode: 'walk', staging: false, noteX: 1, failed: null })).toEqual(WORKER_SPOTS);
    expect(workerSpots({ mode: 'wall', staging: false, noteX: null, failed: null })).toEqual(WORKER_SPOTS_WALL);
  });
  it('debating in the office: next to the note; with the wall open they stay out of the way', () => {
    expect(workerSpots({ mode: 'walk', staging: true, noteX: 2, failed: null })).toEqual(flankSpots(2));
    expect(workerSpots({ mode: 'wall', staging: true, noteX: 2, failed: null })).toEqual(WORKER_SPOTS_WALL);
  });
  it('a colleague whose model failed walks off to the coffee corner; the other stays', () => {
    const s = workerSpots({ mode: 'walk', staging: true, noteX: 0, failed: 'gpt' });
    expect(s.gpt).toEqual(BREAK_SPOTS[0]);
    expect(s.claude).toEqual(flankSpots(0).claude);
    expect(workerSpots({ mode: 'walk', staging: true, noteX: 0, failed: 'system' })).toEqual(flankSpots(0));
  });
});
