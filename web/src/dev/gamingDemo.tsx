// Dev-only: plays a recorded run (public/dev-data/worker-events.json) through the 3D gaming office.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import GamingOffice from '../components/office/gaming/GamingOffice';

function pending(evs: any[]) {
  const open = new Map<string, any>();
  for (const e of evs) {
    if (e.type === 'worker_question') open.set(e.questionId, e);
    if (e.type === 'worker_question_answered' || e.type === 'worker_question_timeout') open.delete(e.questionId);
  }
  return Array.from(open.values());
}

function Demo() {
  const [all, setAll] = useState<any[]>([]);
  const [shown, setShown] = useState(0);
  const q = new URLSearchParams(location.search);
  const upTo = q.get('n') ? Number(q.get('n')) : null;
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}dev-data/worker-events.json`).then((r) => r.json()).then(setAll); }, []);
  useEffect(() => {
    if (!all.length) return;
    if (upTo !== null) { setShown(upTo); return; }
    const t = setInterval(() => setShown((s) => Math.min(all.length, s + 1)), 1400);
    return () => clearInterval(t);
  }, [all, upTo]);
  useEffect(() => { (window as any).__setShown = setShown; }, []);
  useEffect(() => { (window as any).__office = { shown, total: all.length }; }, [shown, all]);
  return <div style={{ maxWidth: 1700, margin: '0 auto', padding: 12 }}><GamingOffice events={all.slice(0, shown)} questions={pending(all.slice(0, shown))} onAnswer={() => undefined} /></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
