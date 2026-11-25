import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Maximize, Minimize, MessageCircleQuestion, Send } from 'lucide-react';
import type { DigitalWorkerEvent } from '../../../lib/strategyStream';
import { renderMarkdown } from '../../../lib/markdown';
import { workerTitle } from '../../../lib/workerPersonas';
import { HUB_WORKER, assignDesks, reduceAll, workerName } from '../../../lib/officeModel';
import type { OfficeState, OfficeStatus } from '../../../lib/officeModel';
import type { WorkerQuestion } from '../../graph/DigitalWorkerOffice';
import { OFFICE_TEXT as T } from '../officeText';

// The 3D "gaming" digital worker office. Same events and questions as the other
// two styles; what differs is that every worker is a person you can see walk,
// sit, type and wave in a room you can turn and zoom.

const GamingScene = lazy(() => import('./GamingScene'));
type View = 'inside' | 'overview';

const RING: Record<OfficeStatus | 'handoff', string> = { idle: '#9AA3B2', waiting: '#F5A524', working: '#3DDC84', handoff: '#4C8DFF', blocked: '#FF6B6B', done: '#5ED8C8' };
const HANDOFF_MS = 2600;
const REPLAY_MS = 450;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="gw-fallback">{T.gaming.failed}</div>;
    return this.props.children;
  }
}

interface Props {
  events: DigitalWorkerEvent[];
  questions?: WorkerQuestion[];
  onAnswer?: (questionId: string, answer: string) => void | Promise<void>;
}

export default function GamingOffice({ events, questions = [], onAnswer }: Props) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('inside');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [replay, setReplay] = useState<{ cursor: number; speed: 1 | 2 | 4 } | null>(null);
  const [, setTick] = useState(0);

  const cursor = replay ? Math.min(replay.cursor, events.length) : events.length;
  const state: OfficeState = useMemo(() => reduceAll(events, cursor), [events, cursor]);
  const { desks, overflow } = useMemo(() => assignDesks(state.roster), [state.roster]);

  useEffect(() => {
    if (!replay) return;
    if (replay.cursor >= events.length) { const t = setTimeout(() => setReplay(null), 600); return () => clearTimeout(t); }
    const t = setTimeout(() => setReplay((r) => (r ? { ...r, cursor: r.cursor + 1 } : r)), REPLAY_MS / replay.speed);
    return () => clearTimeout(t);
  }, [replay, events.length]);

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // A worker shows "handing off" for a moment after it sends something on.
  const seenRef = useRef<Map<number, number>>(new Map());
  const firstRef = useRef(true);
  useEffect(() => {
    const seen = seenRef.current; const now = performance.now();
    if (state.lines.length < seen.size) seen.clear();
    for (const l of state.lines) if (!seen.has(l.idx)) seen.set(l.idx, firstRef.current ? -1e9 : now);
    firstRef.current = false;
    const t = setTimeout(() => setTick((x) => x + 1), HANDOFF_MS + 50);
    return () => clearTimeout(t);
  }, [state.lines]);
  const statusOf = (id: string): OfficeStatus | 'handoff' => {
    const w = state.workers[id];
    if (!w) return 'idle';
    if (w.status === 'working') {
      const now = performance.now();
      if (state.lines.some((l) => l.kind === 'handoff' && l.from === id && now - (seenRef.current.get(l.idx) ?? -1e9) < HANDOFF_MS)) return 'handoff';
    }
    return w.status;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => undefined);
    else document.exitFullscreen();
  };
  const submit = async (q: WorkerQuestion) => {
    const text = (answers[q.questionId] || '').trim();
    if (!text || !onAnswer) return;
    setAnswers((p) => { const n = { ...p }; delete n[q.questionId]; return n; });
    await onAnswer(q.questionId, text);
  };

  const sel = selected ? state.workers[selected] : undefined;
  const paused = questions.length > 0;
  const lastFeed = state.feed.slice(-1)[0];

  return (
    <div ref={containerRef} className={`gw-root ${isFullscreen ? 'is-full' : ''}`}>
      <style>{CSS}</style>
      <div className="gw-stage">
        <SceneBoundary>
          <Suspense fallback={<div className="gw-fallback">{T.gaming.loading}</div>}>
            <GamingScene state={state} desks={desks} statusOf={statusOf} selected={selected} onSelect={setSelected} reduced={reduced} view={view} />
          </Suspense>
        </SceneBoundary>

        <div className="gw-hud" aria-live="polite">
          <div className="gw-stat"><b>{state.total}</b><span>{T.header.workers}</span></div>
          <div className="gw-stat"><b style={{ color: '#3DDC84' }}>{state.active}</b><span>{T.header.active}</span></div>
          <div className="gw-stat"><b>{state.done}/{state.total}</b><span>{T.header.done}</span></div>
          {state.blocked > 0 && <div className="gw-stat"><b style={{ color: '#FF9B9B' }}>{state.blocked}</b><span>{T.header.blocked}</span></div>}
          <ol className="gw-steps">
            {T.exec.steps.map((s, i) => <li key={s} className={`${i < state.step ? 'is-past' : ''} ${i === state.step ? (state.step === 3 ? 'is-alert' : 'is-now') : ''}`}>{s}</li>)}
          </ol>
        </div>
        <div className="gw-ticker">{lastFeed ? lastFeed.text : T.header.empty}</div>
        <div className="gw-hint">{view === 'inside' ? T.gaming.hintInside : T.gaming.hintOverview}</div>

        <div className="gw-controls">
          <button type="button" onClick={() => setView(view === 'inside' ? 'overview' : 'inside')} aria-label={view === 'inside' ? T.gaming.toOverview : T.gaming.toInside}>{view === 'inside' ? T.gaming.toOverview : T.gaming.toInside}</button>
          {replay ? (
            <>
              {([1, 2, 4] as const).map((s) => <button key={s} type="button" onClick={() => setReplay({ ...replay, speed: s })} className={replay.speed === s ? 'is-on' : ''}>{s}x</button>)}
              <button type="button" onClick={() => setReplay(null)}>{T.controls.live}</button>
            </>
          ) : (
            <button type="button" onClick={() => setReplay({ cursor: 0, speed: 1 })} disabled={events.length === 0}>{T.controls.replay}</button>
          )}
          <button type="button" onClick={toggleFullscreen} title={isFullscreen ? T.controls.exitFullscreen : T.controls.fullscreen} aria-label={isFullscreen ? T.controls.exitFullscreen : T.controls.fullscreen}>
            {isFullscreen ? <Minimize width={14} height={14} /> : <Maximize width={14} height={14} />}
          </button>
        </div>
      </div>

      <aside className="gw-side">
        {paused && (
          <section aria-label={T.questions.title}>
            <div className="gw-h"><MessageCircleQuestion width={16} height={16} color="#E5B84A" /> {questions.length === 1 ? T.questions.one : `${questions.length} ${T.questions.many}`}</div>
            <p className="gw-muted">{T.questions.hint}</p>
            {questions.map((q) => (
              <div key={q.questionId} className="gw-card">
                <div className="gw-name">{workerName(q.worker)}</div>
                <div className="gw-muted">{workerTitle(q.worker)} · wave {q.wave}</div>
                <p className="gw-q">{q.question}</p>
                <textarea
                  value={answers[q.questionId] || ''} rows={3} placeholder={T.questions.placeholder}
                  onChange={(e) => setAnswers((p) => ({ ...p, [q.questionId]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(q); }}
                />
                <div className="gw-row">
                  <span className="gw-muted">{T.questions.shortcut}</span>
                  <button type="button" className="gw-send" disabled={!(answers[q.questionId] || '').trim()} onClick={() => void submit(q)}><Send width={12} height={12} /> {T.questions.send}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {sel && selected && selected !== HUB_WORKER && (
          <section aria-label={T.detail.title} className="gw-card">
            <div className="gw-row">
              <div><div className="gw-name">{workerName(sel.id)}</div><div className="gw-muted">{sel.task} · wave {sel.wave}</div></div>
              <button type="button" className="gw-x" onClick={() => setSelected(null)} aria-label={T.detail.close}>✕</button>
            </div>
            <div className="gw-status" style={{ color: RING[sel.status] }}>{T.status[sel.status]}</div>
            {sel.status === 'done' && sel.analysis ? (
              <>
                <div className="dark gw-md">{renderMarkdown(sel.analysis)}</div>
                {typeof sel.confidence === 'number' && <div className="gw-conf">{Math.round(sel.confidence * 100)}% {T.detail.confidence}{sel.verdict ? ` · ${sel.verdict}` : ''}</div>}
              </>
            ) : sel.status === 'blocked' ? <p className="gw-q" style={{ color: '#E5B84A' }}>{sel.question}</p>
              : <p className="gw-muted" style={{ fontStyle: 'italic' }}>{sel.status === 'working' ? T.detail.working : sel.status === 'waiting' ? T.detail.waiting : T.detail.idle}</p>}
          </section>
        )}

        <section aria-label={T.feed.title}>
          <h4 className="gw-feed-h">{T.feed.title}{replay ? ` · ${T.feed.replaying}` : ''}</h4>
          {state.feed.length === 0 ? <p className="gw-muted">{T.feed.empty}</p> : (
            <ul className="gw-feed">
              {state.feed.slice(-14).reverse().map((f) => <li key={f.idx} style={{ borderColor: f.worker === 'hub' ? '#4C8DFF' : RING[state.workers[f.worker]?.status ?? 'idle'] }}>{f.text}</li>)}
            </ul>
          )}
        </section>
        {overflow.length > 0 && <p className="gw-muted">{T.overflow(overflow.map(workerName).join(', '))}</p>}
      </aside>
    </div>
  );
}

const CSS = `
.gw-root { display: flex; flex-direction: column; width: 100%; background: #0b0f19; border: 1px solid #2E2829; border-radius: 8px; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
@media (min-width: 1280px) { .gw-root { flex-direction: row; } }
.gw-root.is-full { border: 0; border-radius: 0; width: 100vw; height: 100vh; position: relative; }
.gw-stage { position: relative; flex: 1 1 auto; min-width: 0; aspect-ratio: 16 / 9; background: #bcd3ee; }
.gw-root.is-full .gw-stage { aspect-ratio: auto; height: 100%; }
.gw-stage canvas { display: block; }
.gw-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #1d2b44; font-size: 14px; background: #cfe0f3; }
.gw-hud { position: absolute; left: 12px; top: 12px; display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; pointer-events: none; max-width: calc(100% - 24px); }
.gw-stat { display: flex; flex-direction: column; justify-content: center; min-width: 64px; padding: 6px 12px; border-radius: 10px; background: rgba(12,18,32,.82); border: 1px solid rgba(94,216,200,.35); color: #EAF1FF; }
.gw-stat b { font-size: 20px; line-height: 1.1; font-weight: 700; }
.gw-stat span { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: #8FA4C8; }
.gw-steps { display: flex; gap: 4px; list-style: none; margin: 0; padding: 6px 8px; border-radius: 10px; background: rgba(12,18,32,.82); border: 1px solid rgba(76,141,255,.45); align-items: center; }
.gw-steps li { font-size: 10.5px; padding: 4px 8px; border-radius: 6px; color: #8FA4C8; background: rgba(76,141,255,.12); border: 1px solid rgba(76,141,255,.25); }
.gw-steps li.is-past { color: #CFE2FF; background: rgba(76,141,255,.38); }
.gw-steps li.is-now { color: #fff; background: #3A74E8; border-color: #8DB4FF; }
.gw-steps li.is-alert { color: #1A1416; background: #F5A524; border-color: #FFD27A; }
.gw-ticker { position: absolute; left: 12px; bottom: 12px; max-width: calc(100% - 200px); padding: 7px 12px; border-radius: 8px; background: rgba(12,18,32,.82); color: #D3DDF0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.gw-hint { position: absolute; right: 12px; top: 12px; padding: 5px 10px; border-radius: 8px; background: rgba(12,18,32,.6); color: #B7C0D0; font-size: 10.5px; pointer-events: none; }
.gw-controls { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 6px; }
.gw-controls button { background: rgba(12,16,28,.85); border: 1px solid rgba(255,255,255,.18); color: #E6ECF8; border-radius: 6px; padding: 4px 9px; font-size: 11px; font-weight: 500; cursor: pointer; }
.gw-controls button:hover:not(:disabled) { background: rgba(30,42,68,.95); }
.gw-controls button:disabled { opacity: .4; cursor: not-allowed; }
.gw-controls button.is-on { background: #3A74E8; border-color: #8DB4FF; }
.gw-tag { position: relative; transform: translateY(-4px); white-space: nowrap; pointer-events: auto; }
.gw-tag button { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px 4px 8px; border-radius: 99px; cursor: pointer; border: 1.5px solid var(--ring); background: linear-gradient(180deg, rgba(30,38,56,.92), rgba(14,18,30,.92)); box-shadow: 0 2px 10px rgba(0,0,0,.35); text-align: left; }
.gw-tag.is-selected button { box-shadow: 0 0 0 2px var(--ring), 0 2px 10px rgba(0,0,0,.35); }
.gw-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ring); box-shadow: 0 0 8px var(--ring); flex: none; }
.gw-tag.is-working .gw-dot, .gw-tag.is-handoff .gw-dot, .gw-tag.is-blocked .gw-dot { animation: gw-pulse 1.4s ease-in-out infinite; }
@keyframes gw-pulse { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
.gw-tag b { display: block; font-size: 11.5px; font-weight: 600; color: #F2F5FA; line-height: 1.15; }
.gw-tag em { display: block; font-style: normal; font-size: 9.5px; color: #B7C0D0; line-height: 1.15; }
.gw-tag:not(.is-selected) em { display: none; }
.gw-tag.is-compact:not(.is-selected) b { display: none; }
.gw-tag.is-compact:not(.is-selected) button { padding: 4px; }
.gw-tag.is-compact:not(.is-selected):hover b { display: block; }
.gw-tag.is-compact:hover { z-index: 5; }
.gw-tag:not(.is-selected) button { padding: 3px 10px 3px 8px; }
.gw-ask { position: absolute; left: 50%; top: -30px; transform: translateX(-50%); width: 24px; height: 24px; border-radius: 50%; background: #F5A524; color: #1A1416; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(245,165,36,.8); animation: gw-bob 1s ease-in-out infinite; }
@keyframes gw-bob { 0%,100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -5px); } }
.gw-side { flex: none; background: #120F10; color: #D8CBC9; padding: 12px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; max-height: 640px; border-top: 1px solid #2E2829; }
@media (min-width: 1280px) { .gw-side { width: 320px; border-top: 0; border-left: 1px solid #2E2829; } }
.gw-root.is-full .gw-side { position: absolute; right: 12px; top: 12px; bottom: 12px; width: 340px; z-index: 30; border: 1px solid #2E2829; border-radius: 8px; background: rgba(18,15,16,.96); }
.gw-root.is-full .gw-side:not(:has(.gw-card)) { display: none; }
.gw-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #F2ECEC; }
.gw-card { border: 1px solid #2E2829; border-radius: 6px; background: #161213; padding: 12px; margin-top: 8px; }
.gw-name { font-size: 13px; font-weight: 600; color: #F2ECEC; }
.gw-muted { font-size: 11px; color: #8A7E80; margin: 2px 0 0; line-height: 1.4; }
.gw-q { font-size: 13px; line-height: 1.5; margin: 8px 0; color: #D8CBC9; }
.gw-side textarea { width: 100%; resize: none; box-sizing: border-box; background: #0A0809; border: 1px solid #2E2829; border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #F2ECEC; }
.gw-side textarea:focus { outline: none; border-color: rgba(229,184,74,.6); }
.gw-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
.gw-send { display: inline-flex; gap: 6px; align-items: center; padding: 6px 12px; border-radius: 6px; border: 0; background: #E5B84A; color: #1A1416; font-size: 12px; font-weight: 600; cursor: pointer; }
.gw-send:disabled { opacity: .4; cursor: not-allowed; }
.gw-x { background: none; border: 0; color: #8A7E80; cursor: pointer; padding: 2px 6px; }
.gw-status { font-size: 11px; margin-top: 8px; }
.gw-md { font-size: 12px; color: #A79CA0; line-height: 1.5; max-height: 190px; overflow-y: auto; margin-top: 8px; }
.gw-conf { font-size: 10px; color: #8FCC9E; margin-top: 8px; }
.gw-feed-h { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8A7E80; margin: 0 0 6px; font-weight: 500; }
.gw-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.gw-feed li { font-size: 12px; line-height: 1.4; border-left: 2px solid; padding-left: 8px; color: #D8CBC9; }
@media (prefers-reduced-motion: reduce) { .gw-dot, .gw-ask { animation: none !important; } }
`;
