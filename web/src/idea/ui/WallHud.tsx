import { useEffect, useRef, useState } from 'react';
import type { Link, Note, NoteType } from '@idea-office/shared';
import { NOTE_TYPES, TYPE_COLOR, TYPE_LABEL } from '../wall/wallGeometry';
import type { DebateListItem } from '../wall/api';

// "Debate every new note" switch, plus a badge when the colleagues are scripted because no API keys are set.
export function AutoToggle({ on, demo, onToggle }: { on: boolean; demo: boolean; onToggle: () => void }) {
  return (
    <div className="io-auto" onPointerDown={(e) => e.stopPropagation()}>
      <label><input type="checkbox" checked={on} onChange={onToggle} /> Auto-debate new notes</label>
      {demo && <span className="io-demochip" title="No API keys set: the colleagues use scripted words">demo colleagues</span>}
    </div>
  );
}

interface Props {
  maximized: boolean; onToggleMax: () => void;
  total: number;
  matches: number;
  query: string;
  types: Set<NoteType>;
  onQuery: (q: string) => void;
  onToggleType: (t: NoteType) => void;
  onGoToFirstMatch: () => void;
  onNew: () => void;
  onBack: () => void;
  autoDebate: boolean; demo: boolean; onToggleAuto: () => void;
  onSettings: () => void;
}

// Top-left controls in wall close-up mode: search, type filters, new note, back.
export function WallHud({ maximized, onToggleMax, total, matches, query, types, onQuery, onToggleType, onGoToFirstMatch, onNew, onBack, autoDebate, demo, onToggleAuto, onSettings }: Props) {
  const filtering = query.trim() !== '' || types.size > 0;
  const maxBtn = (
    <button className="io-btn ghost io-maxbtn" onClick={onToggleMax} aria-pressed={maximized} title="F"
      aria-label={maximized ? 'Minimize the board' : 'Maximize the board'}>{maximized ? '⤡ Minimize' : '⤢ Maximize'}</button>
  );
  if (maximized) {            // slim toolbar: the board gets the whole screen
    return (
      <div className="io-hudbar" onPointerDown={(e) => e.stopPropagation()}>
        {maxBtn}
        <button className="io-btn" onClick={onNew} title="N">+ New</button>
        <input className="io-search" type="search" value={query} placeholder="Search…" aria-label="Search notes"
          onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onGoToFirstMatch(); e.stopPropagation(); }} />
        <div className="io-chips">
          {NOTE_TYPES.map((t) => (
            <button key={t} className={types.has(t) ? 'on' : ''} style={{ ['--c' as string]: TYPE_COLOR[t] }} aria-pressed={types.has(t)} onClick={() => onToggleType(t)}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
        <span className="io-count">{filtering ? `${matches} of ${total}` : `${total} note${total === 1 ? '' : 's'}`}</span>
      </div>
    );
  }
  return (
    <>
      <div className="io-hud" onPointerDown={(e) => e.stopPropagation()}>
        <div className="io-hud-row">
          <button className="io-btn ghost" onClick={onBack} title="Esc">← Back to office</button>
          <button className="io-btn" onClick={onNew} title="N">+ New note</button>
        </div>
        {maxBtn}
        <input className="io-search" type="search" value={query} placeholder="Search notes…" aria-label="Search notes"
          onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onGoToFirstMatch(); e.stopPropagation(); }} />
        <div className="io-chips">
          {NOTE_TYPES.map((t) => (
            <button key={t} className={types.has(t) ? 'on' : ''} style={{ ['--c' as string]: TYPE_COLOR[t] }} aria-pressed={types.has(t)} onClick={() => onToggleType(t)}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
        <div className="io-autorow"><AutoToggle on={autoDebate} demo={demo} onToggle={onToggleAuto} /><button className="io-gear" onClick={onSettings} aria-label="Settings" title="Settings">⚙</button></div>
        <div className="io-count">{filtering ? `${matches} of ${total} notes match` : `${total} note${total === 1 ? '' : 's'}`}</div>
      </div>
      <div className="io-wallhint">drag a note to move it · pull a thread from a note's red pin onto another note to link them · drag the wall to pan · scroll to zoom · <kbd>F</kbd> maximize · <kbd>N</kbd> new · <kbd>Esc</kbd> back</div>
    </>
  );
}

interface CardProps {
  note: Note;
  linked: { link: Link; other: Note }[];
  onEdit: () => void; onDelete: () => void; onClose: () => void;
  onUnlink: (linkId: string) => void;
  onJump: (noteId: string) => void;
  debating: boolean;
  past: DebateListItem[];
  onDebate: () => void;
  onReplay: (debateId: string) => void;
}

// The selected note, in readable type, with Edit and Delete.
export function NoteCard({ note, linked, onEdit, onDelete, onClose, onUnlink, onJump, debating, past, onDebate, onReplay }: CardProps) {
  const [confirm, setConfirm] = useState(false);
  return (
    <aside className="io-card" onPointerDown={(e) => e.stopPropagation()} style={{ ['--c' as string]: TYPE_COLOR[note.type] }}>
      <button className="io-x" onClick={onClose} aria-label="Close">×</button>
      <div className="io-card-type">{TYPE_LABEL[note.type]}</div>
      <h3>{note.title}</h3>
      {note.body && <p>{note.body}</p>}
      <div className="io-links">
        <div className="io-links-head">Linked notes ({linked.length})</div>
        {linked.length === 0 && <div className="io-links-empty">None yet. Pull a thread from the red pin onto another note.</div>}
        {linked.map(({ link, other }) => (
          <div className="io-linkrow" key={link.id} style={{ ['--c' as string]: TYPE_COLOR[other.type] }}>
            <button className="io-linkjump" onClick={() => onJump(other.id)} title="Go to this note">
              <b>{other.title}</b>{link.label && <em>{link.label}</em>}
            </button>
            <button className="io-x2" onClick={() => onUnlink(link.id)} aria-label={`Unlink ${other.title}`} title="Remove this link">×</button>
          </div>
        ))}
      </div>
      <div className="io-links">
        <div className="io-links-head">Debates ({past.length})</div>
        <button className="io-btn" onClick={onDebate} disabled={debating}>{debating ? 'They are debating…' : 'Debate this note'}</button>
        {past.slice(0, 3).map((d) => (
          <button key={d.id} className="io-pastdebate" onClick={() => onReplay(d.id)} title="Watch it again">
            <b>{new Date(d.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
            <em>{d.status === 'done' ? (d.verdict ?? 'done').replace('_', ' ') : d.status}</em>
          </button>
        ))}
      </div>
      <div className="io-card-actions">
        <button className="io-btn ghost" onClick={onEdit}>Edit</button>
        {confirm
          ? <button className="io-btn danger" onClick={onDelete} onBlur={() => setConfirm(false)} autoFocus>Really delete?</button>
          : <button className="io-btn ghost" onClick={() => setConfirm(true)}>Delete</button>}
      </div>
    </aside>
  );
}

interface LinkCardProps { link: Link; from: Note; to: Note; onLabel: (label: string) => void; onDelete: () => void; onClose: () => void }

// A selected thread: which two notes it joins, its label (the relationship in words), and Delete.
export function LinkCard({ link, from, to, onLabel, onDelete, onClose }: LinkCardProps) {
  const [label, setLabel] = useState(link.label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setLabel(link.label); }, [link.id, link.label]);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [link.id]);
  const save = () => { if (label.trim() !== link.label) onLabel(label.trim()); };
  return (
    <aside className="io-card io-linkcard" onPointerDown={(e) => e.stopPropagation()} style={{ ['--c' as string]: '#b3261e' }}>
      <button className="io-x" onClick={onClose} aria-label="Close">×</button>
      <div className="io-card-type">Link</div>
      <div className="io-linkends"><b>{from.title}</b><span>→</span><b>{to.title}</b></div>
      <input ref={ref} className="io-linklabel" value={label} maxLength={60} placeholder="How are they related? (e.g. same pattern, solves)"
        onChange={(e) => setLabel(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') { save(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); if (e.key === 'Escape') onClose(); }} />
      <div className="io-card-actions"><button className="io-btn ghost" onClick={onDelete}>Delete link</button></div>
    </aside>
  );
}
