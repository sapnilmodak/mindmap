import { describe, expect, it } from 'vitest';
import { PROMPTS, buildTurnMessages, candidateIds, parseSynthesis, speakerFor, summaryText, systemPrompt, tidyTurn } from './debateLogic.js';
import type { Context } from './retrieval.js';

const ctx: Context = {
  note: { id: 'N', type: 'business', title: 'Shared parking', body: 'Rent office parking by the hour' },
  linked: [{ id: 'L', type: 'problem', title: 'Parking pain', body: '', label: 'solves', direction: 'out' }],
  twoHop: [{ id: 'T', type: 'pattern', title: 'Airbnb', via: 'Parking pain' }],
  similar: [{ id: 'S', type: 'business', title: 'Valet app', body: '', score: 0.7 }, { id: 'L', type: 'problem', title: 'Parking pain', body: '', score: 0.9 }],
  pastDebates: [],
  outline: [{ id: 'O', type: 'question', title: 'Who pays?' }, { id: 'N', type: 'business', title: 'Shared parking' }],
};

describe('prompts', () => {
  it('load from the plain files, with a brief for every turn', () => {
    expect(PROMPTS.rules.length).toBeGreaterThan(100);
    expect(PROMPTS.briefs).toHaveLength(6);
    expect(PROMPTS.gpt).toMatch(/SCEPTIC/);
    expect(PROMPTS.synthesis).toMatch(/suggested_links/);
  });
  it('add the founder profile only when there is one', () => {
    expect(systemPrompt('claude', '')).not.toMatch(/About the founder/);
    expect(systemPrompt('gpt', ' Pune-based, B2C ')).toMatch(/About the founder[\s\S]*Pune-based, B2C/);
  });
  it('tell the models that notes are data, not instructions', () => {
    expect(PROMPTS.rules).toMatch(/DATA/);
  });
});

describe('speakerFor', () => {
  it('Claude opens and the two alternate', () => {
    expect([0, 1, 2, 3].map(speakerFor)).toEqual(['claude', 'gpt', 'claude', 'gpt']);
  });
});

describe('buildTurnMessages', () => {
  const t = [{ speaker: 'claude' as const, content: 'It is an Airbnb for parking.' }, { speaker: 'gpt' as const, content: 'Who pays?' }];
  const alternates = (m: { role: string }[]) => m.every((x, i) => i === 0 || x.role !== m[i - 1].role);

  it('first turn: just the context plus the brief, as one user message', () => {
    const m = buildTurnMessages('CTX', [], 'claude', 0, 4);
    expect(m).toHaveLength(1);
    expect(m[0].role).toBe('user');
    expect(m[0].content).toMatch(/^CTX/);
    expect(m[0].content).toMatch(/turn 1 of 4/);
    expect(m[0].content).toMatch(/Open the debate/);
  });
  it('GPT on turn 2 sees Claude\'s words as the other side and is told to challenge', () => {
    const m = buildTurnMessages('CTX', [t[0]], 'gpt', 1, 4);
    expect(m).toHaveLength(1);                                  // context, Claude's turn and the brief all merge into one user message
    expect(m[0].content).toMatch(/Claude said: It is an Airbnb for parking\./);
    expect(m[0].content).toMatch(/Challenge it/);
  });
  it('a speaker\'s own turns are "assistant" and roles always alternate, ending on a user message', () => {
    const m = buildTurnMessages('CTX', t, 'claude', 2, 4);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[1].content).toBe('It is an Airbnb for parking.');
    expect(m[2].content).toMatch(/GPT said: Who pays\?/);
    for (const [who, i] of [['claude', 2], ['gpt', 3]] as const) {
      const mm = buildTurnMessages('CTX', t, who, i, 4);
      expect(alternates(mm)).toBe(true);
      expect(mm[0].role).toBe('user');
      expect(mm[mm.length - 1].role).toBe('user');
    }
  });
  it('shows a founder interjection to both sides', () => {
    const m = buildTurnMessages('CTX', [...t, { speaker: 'user', content: 'What about colleges?' }], 'claude', 4, 6);
    expect(m[m.length - 1].content).toMatch(/The founder said: What about colleges\?/);
  });
});

describe('tidyTurn', () => {
  it('removes a name prefix and line breaks', () => {
    expect(tidyTurn('Claude: Good idea.\n\nBut hard.')).toBe('Good idea. But hard.');
  });
  it('cuts a turn that stopped mid-sentence back to the last full sentence', () => {
    expect(tidyTurn('This is the first complete point of the argument. And then it was cut off while sayi')).toBe('This is the first complete point of the argument.');
  });
  it('marks a cut with an ellipsis when there is no earlier sentence end', () => {
    expect(tidyTurn('one very long unfinished thought that just keeps going and going')).toMatch(/…$/);
  });
  it('keeps Hindi sentences ending in a danda', () => {
    expect(tidyTurn('यह एक अच्छा विचार है।')).toBe('यह एक अच्छा विचार है।');
  });
  it('caps runaway length', () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ') + '.';
    expect(tidyTurn(long).split(' ').length).toBeLessThanOrEqual(141);
  });
});

describe('candidateIds', () => {
  it('is similar + two-hop + outline, minus the note itself and already-linked notes', () => {
    expect([...candidateIds(ctx)].sort()).toEqual(['O', 'S', 'T']);
  });
});

describe('parseSynthesis', () => {
  const valid = candidateIds(ctx);
  const good = { verdict: 'needs_work', summary: 'A parking marketplace.', key_points: ['a'], risks: ['b'], next_steps: ['c'], suggested_links: [{ target_note_id: 'T', label: 'same pattern', reason: 'r' }], suggested_notes: [{ type: 'question', title: 'Who pays?', body: '' }] };

  it('accepts clean JSON, fenced JSON and JSON with chatter around it', () => {
    for (const raw of [JSON.stringify(good), '```json\n' + JSON.stringify(good) + '\n```', 'Here you go: ' + JSON.stringify(good) + ' Hope that helps!']) {
      const r = parseSynthesis(raw, valid);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.suggested_links).toHaveLength(1);
    }
  });
  it('drops invented ids, the note itself, already-linked notes and duplicates', () => {
    const raw = JSON.stringify({ ...good, suggested_links: [
      { target_note_id: 'T' }, { target_note_id: 'T' }, { target_note_id: 'made-up' }, { target_note_id: 'N' }, { target_note_id: 'L' }, { target_note_id: 'S', label: 'x' },
    ] });
    const r = parseSynthesis(raw, valid);
    expect(r.ok && r.value.suggested_links.map((l) => l.target_note_id)).toEqual(['T', 'S']);
    expect(r.ok && r.dropped).toBe(4);
  });
  it('rejects non-JSON, bad verdicts and missing fields with a readable reason', () => {
    expect(parseSynthesis('no json here', valid)).toMatchObject({ ok: false });
    expect(parseSynthesis('{"verdict":"great","summary":"x"}', valid)).toMatchObject({ ok: false, error: expect.stringMatching(/verdict/) });
    expect(parseSynthesis('{"verdict":"weak"}', valid)).toMatchObject({ ok: false, error: expect.stringMatching(/summary/) });
    expect(parseSynthesis('{ broken', valid)).toMatchObject({ ok: false });
  });
  it('fills defaults for optional lists', () => {
    const r = parseSynthesis('{"verdict":"weak","summary":"Nope."}', valid);
    expect(r.ok && r.value.risks).toEqual([]);
  });
  it('summaryText reads as one compact paragraph', () => {
    const r = parseSynthesis(JSON.stringify(good), valid);
    expect(r.ok && summaryText(r.value)).toBe('[needs_work] A parking marketplace. Risks: b. Next: c.');
  });
});
