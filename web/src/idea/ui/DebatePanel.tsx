import { useEffect, useRef, useState } from 'react';
import type { Note } from '@idea-office/shared';
import { isRunning, statusLine } from '../debate/debateModel';
import type { DebateState, SuggestionView } from '../debate/debateModel';
import { TYPE_LABEL } from '../wall/wallGeometry';

const NAMES = { claude: 'Claude', gpt: 'GPT', user: 'You' } as const;
const VERDICT: Record<string, string> = { promising: 'Promising', needs_work: 'Needs work', weak: 'Weak' };

interface Props {
  state: DebateState;
  note: Note | null;
  noteTitleOf: (id: string) => string;
  demo: boolean;
  lost: boolean;
  mode: 'walk' | 'wall';
  onClose: () => void;
  onCancel: () => void;
  onSay: (text: string) => Promise<void> | void;
  onRetry: () => void;
  onAccept: (s: SuggestionView) => void;
  onDismiss: (s: SuggestionView) => void;
}

// The live debate as a transcript: who is speaking, what was said, the founder's own input box, and at the end the verdict,
// risks, next steps and suggestions the founder can accept with one click.
export default function DebatePanel({ state, note, noteTitleOf, demo, lost, mode, onClose, onCancel, onSay, onRetry, onAccept, onDismiss }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const running = isRunning(state);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [state.turns, state.summary, state.phase]);

  const send = async () => { const t = text.trim(); if (!t) return; setText(''); await onSay(t); };
  const s = state.summary;

  return (
    <aside className={`io-debate ${mode === 'wall' ? 'low' : ''}`} onPointerDown={(e) => e.stopPropagation()} aria-label="Debate">
      <header>
        <div>
          <div className="io-debate-title">{note ? note.title : 'Debate'}</div>
          <div className={`io-debate-status ${state.phase}`}>{running && <i className="io-pulse" />}{statusLine(state)}</div>
        </div>
        <button className="io-x" onClick={onClose} aria-label="Hide the debate panel" title="Hide (the debate keeps going)">×</button>
      </header>
      {demo && <div className="io-demo">Demo colleagues: scripted words. Add your API keys to <b>.env</b> for real debates.</div>}

      {lost && running && <div className="io-lost" role="status">Connection lost. Reconnecting…</div>}

      <div className="io-transcript" role="log" aria-live="polite">
        {state.turns.map((t) => (
          <div key={t.seq} className={`io-turn ${t.speaker}`}>
            <b>{NAMES[t.speaker]}</b>
            <p>{t.text}{!t.done && <span className="io-caret" />}</p>
          </div>
        ))}
        {running && state.turns.length === 0 && <div className="io-wait">The colleagues are walking over…</div>}

        {s && (
          <section className="io-summary">
            <div className={`io-verdict ${s.verdict}`}>{VERDICT[s.verdict] ?? s.verdict}</div>
            <p>{s.summary}</p>
            {s.key_points.length > 0 && <><h4>Key points</h4><ul>{s.key_points.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            {s.risks.length > 0 && <><h4>Risks</h4><ul>{s.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            {s.next_steps.length > 0 && <><h4>Next steps</h4><ul>{s.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          </section>
        )}

        {state.suggestions.length > 0 && (
          <section className="io-suggest">
            <h4>Suggestions</h4>
            {state.suggestions.map((g) => (
              <div key={g.id} className={`io-sug ${g.status}`}>
                <div className="io-sug-text">
                  {g.kind === 'link'
                    ? <>Link to <b>{noteTitleOf(g.payload.target_note_id)}</b>{g.payload.label ? <em> ({g.payload.label})</em> : null}{g.payload.reason ? <small>{g.payload.reason}</small> : null}</>
                    : <>New {TYPE_LABEL[g.payload.type as keyof typeof TYPE_LABEL]?.toLowerCase()} note: <b>{g.payload.title}</b>{g.payload.body ? <small>{g.payload.body}</small> : null}</>}
                </div>
                {g.status === 'open'
                  ? <div className="io-sug-actions"><button className="io-btn" onClick={() => onAccept(g)}>Accept</button><button className="io-btn ghost" onClick={() => onDismiss(g)}>Dismiss</button></div>
                  : <div className="io-sug-done">{g.status === 'accepted' ? 'Added' : 'Dismissed'}</div>}
              </div>
            ))}
          </section>
        )}

        {state.phase === 'failed' && (
          <div className="io-failed" role="alert">
            {state.error?.provider === 'system' ? 'The debate hit a problem' : `${state.error?.provider === 'gpt' ? 'GPT' : 'Claude'} stepped out`}: <span>{state.error?.reason}</span>
            <div><button className="io-btn" onClick={onRetry}>Try again</button></div>
          </div>
        )}
        {state.phase === 'cancelled' && <div className="io-failed soft">You stopped the debate. <button className="io-btn ghost" onClick={onRetry}>Start again</button></div>}
        <div ref={endRef} />
      </div>

      <footer>
        {running ? (
          <>
            <input value={text} maxLength={500} placeholder="Say something to them…" aria-label="Say something to the colleagues"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); e.stopPropagation(); }} />
            <button className="io-btn" onClick={() => void send()} disabled={!text.trim()}>Say</button>
            <button className="io-btn ghost" onClick={onCancel}>Stop</button>
          </>
        ) : (
          <button className="io-btn ghost" onClick={onRetry}>Debate again</button>
        )}
      </footer>
    </aside>
  );
}
