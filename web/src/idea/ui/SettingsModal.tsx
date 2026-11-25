import { useEffect, useState } from 'react';
import type { LocalPrefs } from '../prefs';
import { api } from '../wall/api';
import type { Settings, UsageReport } from '../wall/api';

interface Props {
  settings: Settings;
  prefs: LocalPrefs;
  osReduced: boolean;
  onPrefs: (patch: Partial<LocalPrefs>) => void;
  onSave: (patch: Partial<Pick<Settings, 'autoDebate' | 'founderProfile' | 'turnsPerDebate' | 'dailyTokenBudget'>>) => Promise<void>;
  onClose: () => void;
}

const fmt = (n: number) => n.toLocaleString();

// Everything the founder can change: how the colleagues behave, the daily token budget (with today's usage), this browser's comfort
// settings, and getting the whole wall out as a file.
export default function SettingsModal({ settings, prefs, osReduced, onPrefs, onSave, onClose }: Props) {
  const [profile, setProfile] = useState(settings.founderProfile);
  const [turns, setTurns] = useState(settings.turnsPerDebate);
  const [budget, setBudget] = useState(String(settings.dailyTokenBudget));
  const [auto, setAuto] = useState(settings.autoDebate);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { let live = true; api.usage().then((u) => live && setUsage(u), () => undefined); return () => { live = false; }; }, []);

  const budgetNum = Number(budget);
  const budgetOk = budget.trim() !== '' && Number.isInteger(budgetNum) && budgetNum >= 0 && budgetNum <= 10_000_000;
  const dirty = profile.trim() !== settings.founderProfile || turns !== settings.turnsPerDebate || (budgetOk && budgetNum !== settings.dailyTokenBudget) || auto !== settings.autoDebate;

  const save = async () => {
    setSaving(true); setMsg('');
    try { await onSave({ founderProfile: profile.trim(), turnsPerDebate: turns, dailyTokenBudget: budgetNum, autoDebate: auto }); setMsg('Saved.'); }
    catch (e) { setMsg((e as Error).message); }
    setSaving(false);
  };
  const maxDay = Math.max(1, ...(usage?.days.map((d) => d.tokens) ?? [1]));
  const pct = usage && usage.budget > 0 ? Math.min(100, Math.round((usage.today.tokens / usage.budget) * 100)) : 0;

  return (
    <div className="io-modal-wrap" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="io-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header><h2>Settings</h2><button className="io-x" onClick={onClose} aria-label="Close settings">×</button></header>

        <section>
          <h3>The colleagues</h3>
          <p className="io-note">Claude: <b>{settings.models.claude}</b> · GPT: <b>{settings.models.gpt}</b>{settings.demo && <span className="io-demochip"> demo: no API keys set</span>}. Models and keys are set in <code>.env</code> and never leave the server.</p>
          <label className="io-row"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Debate every new note automatically</label>
          <label className="io-row">Turns per debate
            <select value={turns} onChange={(e) => setTurns(Number(e.target.value))}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label className="io-col">About you and your business (the colleagues read this to judge fit)
            <textarea rows={4} maxLength={2000} value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="e.g. Pune-based founder, B2C first, small budget, background in logistics…" />
          </label>
        </section>

        <section>
          <h3>Daily token budget</h3>
          <label className="io-row">Tokens per day
            <input className="io-num" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} aria-invalid={!budgetOk} />
            <small>0 = no limit</small>
          </label>
          {!budgetOk && <div className="io-err">Enter a whole number from 0 to 10,000,000.</div>}
          {usage ? (
            <>
              <div className="io-meter" aria-label={`${pct}% of today's budget used`}><i style={{ width: `${usage.budget > 0 ? pct : 0}%` }} className={pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''} /></div>
              <div className="io-note">Today: <b>{fmt(usage.today.tokens)}</b> tokens in {usage.today.debates} debate{usage.today.debates === 1 ? '' : 's'}{usage.budget > 0 ? ` of ${fmt(usage.budget)} (${fmt(usage.remaining ?? 0)} left)` : ' (no limit)'}.</div>
              <div className="io-days" aria-label="Tokens used over the last 7 days">
                {usage.days.map((d) => <div key={d.date} title={`${d.date}: ${fmt(d.tokens)} tokens`}><i style={{ height: `${Math.max(2, Math.round((d.tokens / maxDay) * 100))}%` }} /><span>{d.date.slice(8)}</span></div>)}
              </div>
            </>
          ) : <div className="io-note">Loading usage…</div>}
        </section>

        <div className="io-savebar">
          <span className={msg === 'Saved.' ? 'ok' : 'bad'}>{msg}</span>
          <button className="io-btn" onClick={() => void save()} disabled={!dirty || saving || !budgetOk}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>

        <section>
          <h3>This browser</h3>
          <label className="io-row"><input type="checkbox" checked={prefs.reducedMotion || osReduced} disabled={osReduced} onChange={(e) => onPrefs({ reducedMotion: e.target.checked })} /> Reduce motion (no flying papers, no head bob, no fades){osReduced && <small> set by your system</small>}</label>
          <label className="io-row"><input type="checkbox" checked={prefs.sfx} onChange={(e) => onPrefs({ sfx: e.target.checked })} /> Sound effects (paper, pins, a chime when a debate ends)</label>
          <label className="io-row"><input type="checkbox" checked={prefs.ambience} onChange={(e) => onPrefs({ ambience: e.target.checked })} /> Quiet office hush</label>
        </section>

        <section>
          <h3>Your wall</h3>
          <p className="io-note">Download everything: notes, links and every debate. A copy is also saved automatically once a day in the <code>backups</code> folder next to the app.</p>
          <div className="io-row"><a className="io-btn" href="/api/export" download>Download JSON</a><a className="io-btn ghost" href="/api/export?format=md" download>Download as a document (Markdown)</a></div>
        </section>
      </div>
    </div>
  );
}
