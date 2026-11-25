import { useEffect, useRef, useState } from 'react';
import type { NoteType } from '@idea-office/shared';
import { NOTE_TYPES, TYPE_COLOR, TYPE_LABEL } from '../wall/wallGeometry';

export interface PadDraft { type: NoteType; title: string; body: string }
interface Props {
  initial?: PadDraft;
  editing: boolean;
  error: string | null;
  busy: boolean;
  onSubmit: (d: PadDraft) => void;
  onCancel: () => void;
}

// The paper pad: write a note, pick what kind it is, stick it on the wall. Ctrl+Enter sticks; Esc cancels.
export default function NotePad({ initial, editing, error, busy, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<NoteType>(initial?.type ?? 'business');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const ok = title.trim().length > 0 && !busy;
  const submit = () => { if (ok) onSubmit({ type, title: title.trim(), body: body.trim() }); };

  return (
    <div className="io-pad-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <form className="io-pad" onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
        <div className="io-pad-head">{editing ? 'Edit note' : 'New note'}</div>
        <div className="io-types" role="radiogroup" aria-label="Note type">
          {NOTE_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className={type === t ? 'on' : ''}
              style={{ ['--c' as string]: TYPE_COLOR[t] }} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
        <input ref={titleRef} className="io-title" value={title} maxLength={120} placeholder="The idea in one line" onChange={(e) => setTitle(e.target.value)} />
        <textarea className="io-body" value={body} maxLength={4000} rows={7} placeholder="Details: the problem, the pattern, who pays, what it reminds you of…" onChange={(e) => setBody(e.target.value)} />
        {error && <div className="io-err" role="alert">{error}</div>}
        <div className="io-pad-actions">
          <span className="io-hint">Ctrl+Enter to {editing ? 'save' : 'stick'}</span>
          <button type="button" className="io-btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="io-btn" disabled={!ok}>{busy ? 'Saving…' : editing ? 'Save' : 'Stick on wall'}</button>
        </div>
      </form>
    </div>
  );
}
