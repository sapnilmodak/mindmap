import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import type { Link, Note, NoteType } from '@idea-office/shared';
import IdeaScene from './IdeaScene';
import type { ZoneId } from './ideaLayout';
import NotePad from './ui/NotePad';
import type { PadDraft } from './ui/NotePad';
import { AutoToggle, LinkCard, NoteCard, WallHud } from './ui/WallHud';
import DebatePanel from './ui/DebatePanel';
import SettingsModal from './ui/SettingsModal';
import { osPrefersReducedMotion, useLocalPrefs } from './prefs';
import { setSoundPrefs, sfx, unlockAudio } from './sound';
import { useDebate } from './debate/useDebate';
import { bubbleFor, isRunning } from './debate/debateModel';
import type { SuggestionView } from './debate/debateModel';
import { workerSpots } from './debate/debateStage';
import type { Outline } from './wall/NoteMesh';
import type { PendingLink } from './wall/Threads';
import { canLink, linksOf } from './wall/linkGeometry';
import { api } from './wall/api';
import type { DebateListItem, Settings } from './wall/api';
import { matchNote, placeNote } from './wall/wallGeometry';
import './idea.css';
import './debate.css';
import './polish.css';

const isTyping = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'TEXTAREA' || e.tagName === 'INPUT' || e.isContentEditable); };

export default function App() {
  const [mode, setMode] = useState<'walk' | 'wall'>('walk');
  const [maximized, setMaximized] = useState(false);
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [load, setLoad] = useState<{ state: 'loading' | 'ok' | 'error'; message: string }>({ state: 'loading', message: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pad, setPad] = useState<{ editing: Note | null } | null>(null);
  const [padBusy, setPadBusy] = useState(false);
  const [padError, setPadError] = useState<string | null>(null);
  const [landingId, setLandingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<NoteType>>(new Set());
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [toast, setToast] = useState('');
  const [settings, setSettings] = useState<Settings>({ autoDebate: true, founderProfile: '', demo: false, turnsPerDebate: 4, dailyTokenBudget: 200000, models: { claude: '', gpt: '' } });
  const [panelOpen, setPanelOpen] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [past, setPast] = useState<DebateListItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphicsLost, setGraphicsLost] = useState(false);
  const debate = useDebate();
  const modeRef = useRef(mode); modeRef.current = mode;
  const timers = useRef<number[]>([]);
  const notesRef = useRef(notes); notesRef.current = notes;
  const { prefs, update: updatePrefs, reduced } = useLocalPrefs();

  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const say = useCallback((m: string) => { setToast(m); later(() => setToast((cur) => (cur === m ? '' : cur)), 4200); }, [later]);

  const reload = useCallback(async () => {
    setLoad({ state: 'loading', message: '' });
    try { const w = await api.wall(); setNotes(w.notes); setLinks(w.links); setLoad({ state: 'ok', message: '' }); }
    catch (e) { setLoad({ state: 'error', message: (e as Error).message }); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { api.settings().then(setSettings, () => undefined); }, []);

  // sound: browsers allow audio only after a first click or key press
  useEffect(() => { setSoundPrefs({ sfx: prefs.sfx, ambience: prefs.ambience }); }, [prefs.sfx, prefs.ambience]);
  useEffect(() => {
    const go = () => unlockAudio();
    window.addEventListener('pointerdown', go, { once: true }); window.addEventListener('keydown', go, { once: true });
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, []);
  const prevPhase = useRef(debate.state.phase);
  useEffect(() => { if (prevPhase.current === 'running' && debate.state.phase === 'done') sfx.chime(); prevPhase.current = debate.state.phase; }, [debate.state.phase]);
  const saveSettings = useCallback(async (patch: Parameters<typeof api.putSettings>[0]) => { setSettings(await api.putSettings(patch)); }, []);

  // Handwriting font: redraw the notes once Kalam (Latin + Devanagari) is really loaded, with a timeout so a missing font never blocks.
  useEffect(() => {
    const done = () => setFontsReady(true);
    Promise.all([document.fonts.load("700 22px Kalam", 'Ab अआ'), document.fonts.load("400 16px Kalam", 'Ab अआ')]).then(done, done);
    later(done, 4000);
  }, [later]);

  // ---- wall actions ----
  const closePad = useCallback(() => { setPad(null); setPadError(null); setPadBusy(false); }, []);
  const enterWall = useCallback(() => { setMode('wall'); setPad({ editing: null }); if (load.state === 'error') void reload(); }, [load.state, reload]);
  // Maximize: the board fills the screen (tight fit, compact toolbar, real browser fullscreen when allowed). Minimize puts it all back.
  const setBoardMax = useCallback((on: boolean) => {
    setMaximized(on);
    try {
      if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch { /* fullscreen is a nicety; the tight fit works without it */ }
  }, []);
  useEffect(() => {      // leaving fullscreen with the browser's own Esc also minimizes the board
    const fs = () => { if (!document.fullscreenElement) setMaximized(false); };
    document.addEventListener('fullscreenchange', fs);
    return () => document.removeEventListener('fullscreenchange', fs);
  }, []);
  const exitWall = useCallback(() => { setBoardMax(false); closePad(); setSelectedId(null); setSelectedLinkId(null); setPending(null); setMode('walk'); }, [closePad, setBoardMax]);

  // a note and a thread are never selected together
  const selectNote = useCallback((id: string | null) => { setSelectedId(id); if (id) setSelectedLinkId(null); }, []);
  const selectLink = useCallback((id: string | null) => { setSelectedLinkId(id); if (id) setSelectedId(null); }, []);

  // ---- debates ----
  const running = isRunning(debate.state);
  const runningRef = useRef(running); runningRef.current = running;
  const watchInOffice = useCallback((delayMs = 0) => { later(() => { if (modeRef.current === 'wall') exitWall(); }, delayMs); }, [later, exitWall]);
  const startDebate = useCallback(async (noteId: string) => {
    try {
      const r = await api.startDebate(noteId);
      setSettings((s) => ({ ...s, demo: r.demo }));
      debate.watch(r.debateId); setPanelOpen(true);
      return true;
    } catch (e) { say((e as Error).message); return false; }
  }, [debate, say]);
  const debateNow = useCallback(async (noteId: string) => { if (await startDebate(noteId)) watchInOffice(250); }, [startDebate, watchInOffice]);
  const replay = useCallback((debateId: string) => { debate.watch(debateId); setPanelOpen(true); watchInOffice(250); }, [debate, watchInOffice]);
  const toggleAuto = useCallback(() => {
    const next = !settings.autoDebate;
    setSettings((s) => ({ ...s, autoDebate: next }));
    api.putSettings({ autoDebate: next }).catch((e) => { setSettings((s) => ({ ...s, autoDebate: !next })); say((e as Error).message); });
  }, [settings.autoDebate, say]);

  const submitPad = useCallback(async (d: PadDraft) => {
    setPadBusy(true); setPadError(null);
    try {
      if (pad?.editing) {
        const n = await api.patchNote(pad.editing.id, d);
        setNotes((ns) => ns.map((x) => (x.id === n.id ? n : x)));
      } else {
        const id = crypto.randomUUID();                           // made here first: the note's size on the wall depends on its id
        const pos = placeNote(notesRef.current, id);
        const n = await api.createNote({ id, ...d, ...pos });
        setNotes((ns) => [...ns, n]);
        sfx.rustle();
        setLandingId(n.id); later(() => setLandingId((cur) => (cur === n.id ? null : cur)), 1500);
        setSelectedId(null);
        if (settings.autoDebate) {
          if (runningRef.current) say('They are still busy with another debate. Use "Debate this note" when they finish.');
          else { void startDebate(n.id).then((ok) => { if (ok) watchInOffice(1400); }); }       // let the paper land first, then go and watch
        }
      }
      closePad();
    } catch (e) { setPadError((e as Error).message); setPadBusy(false); }     // the pad stays open with the text intact
  }, [pad, closePad, later, settings.autoDebate, say, startDebate, watchInOffice]);

  const onDragStart = useCallback((id: string) => {
    setNotes((ns) => { const top = Math.max(0, ...ns.map((n) => n.z)) + 1; return ns.map((n) => (n.id === id ? { ...n, z: top } : n)); });
  }, []);
  const onDrag = useCallback((id: string, x: number, y: number) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, x, y } : n))), []);
  const onDrop = useCallback(async (id: string, x: number, y: number) => {
    const z = notesRef.current.find((n) => n.id === id)?.z;
    try { await api.patchNote(id, { x, y, ...(z !== undefined ? { z } : {}) }); }
    catch (e) { say(`Could not save the move: ${(e as Error).message}`); void reload(); }
  }, [say, reload]);

  const deleteSelected = useCallback(async () => {
    const id = selectedId; if (!id) return;
    try { await api.deleteNote(id); setNotes((ns) => ns.filter((n) => n.id !== id)); setLinks((ls) => ls.filter((l) => l.from !== id && l.to !== id)); setSelectedId(null); }
    catch (e) { say(`Could not delete: ${(e as Error).message}`); }
  }, [selectedId, say]);

  // ---- links ----
  const linksRef = useRef(links); linksRef.current = links;
  const createLink = useCallback(async (from: string, to: string) => {
    if (!canLink(linksRef.current, from, to)) { say('Those two notes are already linked.'); return; }
    try {
      const l = await api.createLink({ from, to, label: '' });
      setLinks((ls) => [...ls, l]);
      sfx.thread();
      selectLink(l.id);                                       // opens the label box straight away
    } catch (e) { say((e as Error).message); }
  }, [say, selectLink]);
  const relabelLink = useCallback(async (id: string, label: string) => {
    try { const l = await api.patchLink(id, label); setLinks((ls) => ls.map((x) => (x.id === id ? l : x))); }
    catch (e) { say(`Could not save the label: ${(e as Error).message}`); }
  }, [say]);
  const removeLink = useCallback(async (id: string) => {
    try { await api.deleteLink(id); setLinks((ls) => ls.filter((l) => l.id !== id)); setSelectedLinkId((cur) => (cur === id ? null : cur)); }
    catch (e) { say(`Could not remove the link: ${(e as Error).message}`); }
  }, [say]);
  const jumpTo = useCallback((id: string) => {
    const n = notesRef.current.find((x) => x.id === id);
    if (n) { selectNote(id); setFocus({ x: n.x, y: n.y, n: Date.now() }); }
  }, [selectNote]);

  const acceptSuggestion = useCallback(async (g: SuggestionView) => {
    try {
      if (g.kind === 'link') {
        const r = await api.acceptSuggestion(g.id);
        if (r.link) setLinks((ls) => [...ls, r.link!]); else if (r.alreadyLinked) say('Those notes were already linked.');
      } else {
        const id = crypto.randomUUID();                              // where it hangs is decided here, like a note you write yourself
        const r = await api.acceptSuggestion(g.id, { id, ...placeNote(notesRef.current, id) });
        if (r.note) { setNotes((ns) => [...ns, r.note!]); setLandingId(r.note.id); later(() => setLandingId((cur) => (cur === r.note!.id ? null : cur)), 1500); }
        if (r.link) setLinks((ls) => [...ls, r.link!]);
      }
      debate.resolve(g.id, 'accepted');
      sfx.pin();
    } catch (e) { say((e as Error).message); }
  }, [debate, say, later]);
  const dismissSuggestion = useCallback(async (g: SuggestionView) => {
    try { await api.dismissSuggestion(g.id); debate.resolve(g.id, 'dismissed'); } catch (e) { say((e as Error).message); }
  }, [debate, say]);
  const sayToThem = useCallback(async (text: string) => {
    if (!debate.state.debateId) return;
    try { await api.say(debate.state.debateId, text); } catch (e) { say((e as Error).message); }
  }, [debate.state.debateId, say]);
  const cancelDebate = useCallback(async () => {
    if (!debate.state.debateId) return;
    try { await api.cancelDebate(debate.state.debateId); } catch (e) { say((e as Error).message); }
  }, [debate.state.debateId, say]);

  // a note's past debates, for its card
  useEffect(() => {
    if (!selectedId) { setPast([]); return; }
    let live = true;
    api.debatesFor(selectedId).then((d) => live && setPast(d), () => live && setPast([]));
    return () => { live = false; };
  }, [selectedId, debate.state.phase]);

  // ---- search and filter ----
  const filtering = query.trim() !== '' || types.size > 0;
  const dimmedIds = useMemo(() => new Set(filtering ? notes.filter((n) => !matchNote(n, query, types)).map((n) => n.id) : []), [notes, query, types, filtering]);
  const matchCount = filtering ? notes.length - dimmedIds.size : notes.length;
  const goToFirstMatch = useCallback(() => {
    const first = [...notes].sort((a, b) => b.z - a.z).find((n) => !dimmedIds.has(n.id));
    if (first) setFocus({ x: first.x, y: first.y, n: Date.now() });
  }, [notes, dimmedIds]);
  const toggleType = useCallback((t: NoteType) => setTypes((s) => { const c = new Set(s); if (c.has(t)) c.delete(t); else c.add(t); return c; }), []);

  // ---- keys: Esc steps back one level (pad, then selection, then the wall); N opens a new note ----
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (mode !== 'wall' || settingsOpen) return;
      if (e.key === 'Escape') { if (pad) closePad(); else if (maximized && !selectedLinkId && !selectedId) setBoardMax(false); else if (selectedLinkId) setSelectedLinkId(null); else if (selectedId) setSelectedId(null); else exitWall(); }
      else if ((e.key === 'f' || e.key === 'F') && !pad && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setBoardMax(!maximized); }
      else if ((e.key === 'n' || e.key === 'N') && !pad && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setPad({ editing: null }); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [mode, pad, selectedId, selectedLinkId, settingsOpen, maximized, closePad, exitWall, setBoardMax]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const selectedLink = links.find((l) => l.id === selectedLinkId) ?? null;
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const linkedOfSelected = useMemo(
    () => (selected ? linksOf(links, selected.id).flatMap(({ link, otherId }) => { const other = noteById.get(otherId); return other ? [{ link, other }] : []; }) : []),
    [selected, links, noteById]);
  // Outlines: the selected note (or both ends of the selected thread), the notes linked to it, and the note a thread is being dropped on.
  const debateNoteId = debate.state.noteId;
  const staging = running || (panelOpen && debate.state.phase !== 'idle');      // the colleagues stay by the note while its panel is open
  const debatedNote = debateNoteId ? noteById.get(debateNoteId) ?? null : null;
  const outlines = useMemo(() => {
    const m = new Map<string, Outline>();
    if (staging && debateNoteId) m.set(debateNoteId, 'debating');
    if (selected) { for (const { other } of linkedOfSelected) m.set(other.id, 'neighbor'); m.set(selected.id, 'selected'); }
    if (selectedLink) { m.set(selectedLink.from, 'selected'); m.set(selectedLink.to, 'selected'); }
    if (pending) { m.set(pending.from, 'selected'); if (pending.target) m.set(pending.target, 'target'); }
    return m;
  }, [selected, selectedLink, linkedOfSelected, pending, staging, debateNoteId]);

  const failedWorker = debate.state.phase === 'failed' ? debate.state.error?.provider ?? null : null;
  const spots = workerSpots({ mode, staging, noteX: debatedNote?.x ?? null, failed: failedWorker });
  const empty = { text: '', speaking: false };
  const stage = {
    spots, debating: staging, speaker: debate.state.speaker, onArrive: setArrived,
    bubbles: arrived ? { claude: bubbleFor(debate.state, 'claude'), gpt: bubbleFor(debate.state, 'gpt') } : { claude: empty, gpt: empty },
  };

  return (
    <div className={`io-root${reduced ? ' io-reduced' : ''}`}>
      <IdeaScene
        stage={stage} mode={mode} reduced={reduced} maximized={maximized && mode === 'wall'} onZone={setZone}
        onInteract={(z) => z === 'wall' && enterWall()}
        notes={notes} links={links} dimmedIds={dimmedIds} selectedId={selectedId ?? (staging ? debateNoteId : null)} selectedLinkId={selectedLinkId} outlines={outlines} pending={pending}
        landingId={landingId} fontsReady={fontsReady} focus={focus}
        onSelect={selectNote} onSelectLink={selectLink} onLinkDrag={setPending} onLinkCreate={createLink} onDragStart={onDragStart} onDrag={onDrag} onDrop={onDrop}
        onGraphicsLost={setGraphicsLost}
      />

      {mode === 'walk' && (
        <div className="io-controls" aria-label="Controls">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>
          <span><kbd>Shift</kbd> run</span>
          <span>drag to look around</span>
          <span><kbd>E</kbd> interact</span>
        </div>
      )}
      {mode === 'walk' && <div className="io-chip-left"><AutoToggle on={settings.autoDebate} demo={settings.demo} onToggle={toggleAuto} /><button className="io-gear" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">⚙</button></div>}
      {mode === 'walk' && zone === 'wall' && <div className="io-prompt"><kbd>E</kbd> Write on the idea wall</div>}

      {mode === 'wall' && (
        <WallHud maximized={maximized} onToggleMax={() => setBoardMax(!maximized)} total={notes.length} matches={matchCount} query={query} types={types}
          onQuery={setQuery} onToggleType={toggleType} onGoToFirstMatch={goToFirstMatch}
          onNew={() => setPad({ editing: null })} onBack={exitWall}
          autoDebate={settings.autoDebate} demo={settings.demo} onToggleAuto={toggleAuto} onSettings={() => setSettingsOpen(true)} />
      )}
      {mode === 'wall' && selected && !pad && (
        <NoteCard key={selected.id} note={selected} linked={linkedOfSelected} onEdit={() => setPad({ editing: selected })} onDelete={deleteSelected}
          onClose={() => setSelectedId(null)} onUnlink={removeLink} onJump={jumpTo}
          debating={running && debate.state.noteId === selected.id} past={past} onDebate={() => void debateNow(selected.id)} onReplay={replay} />
      )}
      {mode === 'wall' && selectedLink && !pad && noteById.get(selectedLink.from) && noteById.get(selectedLink.to) && (
        <LinkCard link={selectedLink} from={noteById.get(selectedLink.from)!} to={noteById.get(selectedLink.to)!}
          onLabel={(label) => relabelLink(selectedLink.id, label)} onDelete={() => removeLink(selectedLink.id)} onClose={() => setSelectedLinkId(null)} />
      )}
      {mode === 'wall' && pad && (
        <NotePad key={pad.editing?.id ?? 'new'} editing={!!pad.editing} busy={padBusy} error={padError}
          initial={pad.editing ? { type: pad.editing.type, title: pad.editing.title, body: pad.editing.body } : undefined}
          onSubmit={submitPad} onCancel={closePad} />
      )}

      {panelOpen && debate.state.phase !== 'idle' && (
        <DebatePanel state={debate.state} note={debatedNote} noteTitleOf={(id) => noteById.get(id)?.title ?? 'a deleted note'} demo={settings.demo} lost={debate.lost} mode={mode}
          onClose={() => setPanelOpen(false)} onCancel={() => void cancelDebate()} onSay={sayToThem}
          onRetry={() => debate.state.noteId && void debateNow(debate.state.noteId)} onAccept={(g) => void acceptSuggestion(g)} onDismiss={(g) => void dismissSuggestion(g)} />
      )}

      {settingsOpen && (
        <SettingsModal settings={settings} prefs={prefs} osReduced={osPrefersReducedMotion()} onPrefs={updatePrefs} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
      {graphicsLost && <div className="io-banner soft" role="alert">The browser reset the graphics. It usually recovers by itself; if the scene stays blank, reload the page.</div>}

      {load.state === 'error' && (
        <div className="io-banner" role="alert">{load.message} <button className="io-btn" onClick={() => void reload()}>Retry</button></div>
      )}
      {toast && <div className="io-toast" role="status">{toast}</div>}
    </div>
  );
}
