// The debate orchestrator: gather context from the graph, let the two Claude colleagues take turns, then have Claude write a validated
// summary with suggested links and notes. Every step is saved as it happens, so a failed debate keeps what was already said.
import type { DebateEvent } from '@idea-office/shared';
import { buildContext, renderContext } from './retrieval.js';
import { collect } from './providers.js';
import type { ChatMsg, Provider, Usage } from './providers.js';
import { MAX_TURNS, NAME, PROMPTS, buildTurnMessages, candidateIds, parseSynthesis, speakerFor, summaryText, systemPrompt, tidyTurn } from './debateLogic.js';
import type { Speaker, Synthesis, TurnRec } from './debateLogic.js';
import * as store from './debateStore.js';
import { getFounderProfile } from './settings.js';

export interface DebateOptions {
  noteId: string;
  providers: { claude: Provider; gpt: Provider };
  turns?: number;                          // 2 to 6, default 4
  tokenBudget?: number;                    // stop once a debate has used this many tokens (default 40000)
  turnMaxTokens?: number;                  // per spoken turn (default 700: about 80 Hindi words with headroom, also a hard stop)
  turnTimeoutMs?: number;                  // per model call (default 60 s)
  signal?: AbortSignal;
  pullInterjection?: () => string | undefined;   // the founder speaking mid-debate: asked for before every turn and before the summary
  onEvent?: (e: DebateEvent) => void;
  founderProfile?: string;                 // default: the saved setting
}
export interface DebateResult {
  debateId: string;
  status: 'done' | 'failed' | 'cancelled';
  summary?: Synthesis;
  error?: { provider: 'claude' | 'gpt' | 'system'; reason: string };
}

class Stop extends Error { constructor(public kind: 'cancelled' | 'failed', public provider: 'claude' | 'gpt' | 'system' = 'system', public reason: string = kind) { super(reason); } }

const reasonOf = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 200 ? `${m.slice(0, 200)}…` : m;
};

export async function runDebate(o: DebateOptions): Promise<DebateResult> {
  const turns = Math.max(2, Math.min(MAX_TURNS, o.turns ?? 4));
  const budget = o.tokenBudget ?? 40000, turnMax = o.turnMaxTokens ?? 700, timeout = o.turnTimeoutMs ?? 60000;
  const emit = (e: DebateEvent) => { try { o.onEvent?.(e); } catch { /* a listener must never break a debate */ } };

  const ctx = await buildContext(o.noteId);
  if (!ctx) throw new Error(`note ${o.noteId} not found`);
  const debateId = await store.createDebate(o.noteId);
  if (!debateId) throw new Error(`note ${o.noteId} not found`);
  const contextText = renderContext(ctx);
  const profile = o.founderProfile ?? (await getFounderProfile());
  const transcript: TurnRec[] = [];
  let used = 0, seq = 0;
  emit({ type: 'debate_started', debateId, noteId: o.noteId, turns });

  // One model call with a timeout and the caller's abort signal; tokens are counted and saved.
  const call = async (p: Provider, system: string, messages: ChatMsg[], maxTokens: number, onDelta?: (t: string) => void): Promise<string> => {
    if (o.signal?.aborted) throw new Stop('cancelled');
    if (used >= budget) throw new Stop('failed', 'system', 'budget');
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    o.signal?.addEventListener('abort', onAbort);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeout);
    try {
      const { text, usage } = await collect(p.stream(system, messages, maxTokens, ac.signal), onDelta);
      used += usage.inputTokens + usage.outputTokens;
      await store.addTokens(debateId, usage.inputTokens, usage.outputTokens);
      return text;
    } catch (e) {
      if (o.signal?.aborted) throw new Stop('cancelled');
      throw new Stop('failed', p.name, timedOut ? 'timeout' : reasonOf(e));
    } finally { clearTimeout(timer); o.signal?.removeEventListener('abort', onAbort); }
  };

  // The founder's own words join the transcript like a third speaker, in the order they were said.
  const drain = async () => {
    for (let m = o.pullInterjection?.(); m !== undefined; m = o.pullInterjection?.()) {
      const content = m.trim().slice(0, 500);
      if (!content) continue;
      const s = seq++;
      transcript.push({ speaker: 'user', content });
      emit({ type: 'turn_started', speaker: 'user', seq: s }); emit({ type: 'turn_delta', speaker: 'user', seq: s, text: content }); emit({ type: 'turn_done', speaker: 'user', seq: s });
      await store.addTurn(debateId, s, 'user', content);
    }
  };

  try {
    for (let i = 0; i < turns; i++) {
      await drain();
      const speaker: Speaker = speakerFor(i);
      const mySeq = seq++;
      emit({ type: 'turn_started', speaker, seq: mySeq });
      const raw = await call(o.providers[speaker], systemPrompt(speaker, profile), buildTurnMessages(contextText, transcript, speaker, i, turns), turnMax,
        (text) => emit({ type: 'turn_delta', speaker, seq: mySeq, text }));
      const content = tidyTurn(raw);
      if (!content) throw new Stop('failed', speaker, 'empty reply');
      transcript.push({ speaker, content });
      await store.addTurn(debateId, mySeq, speaker, content);
      emit({ type: 'turn_done', speaker, seq: mySeq });
    }
    await drain();

    // ---- summary: Claude writes JSON; one retry with the exact problem if it does not validate ----
    const valid = candidateIds(ctx);
    const debateText = transcript.map((t) => `${NAME[t.speaker]}: ${t.content}`).join('\n\n');
    const msgs: ChatMsg[] = [{ role: 'user', content: `${contextText}\n\n## THE DEBATE\n${debateText}\n\nWrite the JSON summary now.` }];
    let parsed = parseSynthesis(await call(o.providers.claude, `${PROMPTS.rules}\n\n${PROMPTS.synthesis}`, msgs, 4000), valid);
    if (!parsed.ok) {
      const bad = parsed.error;
      msgs.push({ role: 'assistant', content: '(invalid summary)' }, { role: 'user', content: `That was not valid: ${bad}. Reply again with ONE valid JSON object only.` });
      parsed = parseSynthesis(await call(o.providers.claude, `${PROMPTS.rules}\n\n${PROMPTS.synthesis}`, msgs, 4000), valid);
    }
    if (!parsed.ok) throw new Stop('failed', 'claude', `summary_invalid: ${parsed.error}`);

    const s = parsed.value;
    await store.finishDebate(debateId, summaryText(s), s);
    emit({ type: 'synthesis_ready', summary: s });
    const saved = await store.addSuggestions(debateId, [
      ...s.suggested_links.map((l) => ({ kind: 'link' as const, payload: l })),
      ...s.suggested_notes.map((n) => ({ kind: 'note' as const, payload: n })),
    ]);
    if (saved.length) emit({ type: 'suggestions_ready', suggestions: saved });
    emit({ type: 'debate_done', debateId });
    return { debateId, status: 'done', summary: s };
  } catch (e) {
    if (!(e instanceof Stop)) { await store.endDebate(debateId, 'failed', 'system', reasonOf(e)); emit({ type: 'debate_failed', provider: 'system', reason: reasonOf(e) }); return { debateId, status: 'failed', error: { provider: 'system', reason: reasonOf(e) } }; }
    if (e.kind === 'cancelled') {
      await store.endDebate(debateId, 'cancelled', null, null);
      emit({ type: 'debate_cancelled', debateId });
      return { debateId, status: 'cancelled' };
    }
    await store.endDebate(debateId, 'failed', e.provider, e.reason);
    emit({ type: 'debate_failed', provider: e.provider, reason: e.reason });
    return { debateId, status: 'failed', error: { provider: e.provider, reason: e.reason } };
  }
}

export type { Usage };
