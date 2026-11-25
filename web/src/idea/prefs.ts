// Preferences that belong to this browser (not the founder's wall): saved in localStorage.
import { useCallback, useMemo, useState } from 'react';

export interface LocalPrefs { reducedMotion: boolean; sfx: boolean; ambience: boolean }
export const DEFAULT_PREFS: LocalPrefs = { reducedMotion: false, sfx: true, ambience: false };
const KEY = 'idea-office.prefs';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const safeStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };   // blocked storage must not break the app

// Only booleans are accepted; anything else (old versions, hand edits, broken JSON) falls back to the default for that field.
export function loadPrefs(store: Store | null = safeStore()): LocalPrefs {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<Record<keyof LocalPrefs, unknown>> | null;
    const pick = (k: keyof LocalPrefs) => (typeof raw?.[k] === 'boolean' ? (raw[k] as boolean) : DEFAULT_PREFS[k]);
    return { reducedMotion: pick('reducedMotion'), sfx: pick('sfx'), ambience: pick('ambience') };
  } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p: LocalPrefs, store: Store | null = safeStore()) { try { store?.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ } }

export const osPrefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useLocalPrefs() {
  const [prefs, set] = useState<LocalPrefs>(() => loadPrefs());
  const update = useCallback((patch: Partial<LocalPrefs>) => set((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);
  // Reduced motion is on if either the operating system or the founder asks for it.
  const reduced = useMemo(() => prefs.reducedMotion || osPrefersReducedMotion(), [prefs.reducedMotion]);
  return { prefs, update, reduced };
}
