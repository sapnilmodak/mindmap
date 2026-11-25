import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebateEvent } from '@idea-office/shared';
import { initialDebate, reduceDebate, resolveSuggestion } from './debateModel';
import type { DebateState } from './debateModel';

const isTerminal = (e: DebateEvent) => e.type === 'debate_done' || e.type === 'debate_failed' || e.type === 'debate_cancelled';

// Owns the connection to a debate's event stream and folds its events into DebateState.
// The server replays a debate from its first event on every (re)connect, and the model restarts on 'debate_started',
// so a dropped connection or opening an old debate needs no special handling.
export function useDebate() {
  const [state, setState] = useState<DebateState>(initialDebate);
  const [lost, setLost] = useState(false);               // the stream dropped and the browser is reconnecting
  const source = useRef<EventSource | null>(null);

  const close = useCallback(() => { source.current?.close(); source.current = null; setLost(false); }, []);
  useEffect(() => close, [close]);

  // Watch a debate that is running or finished (both come through the same stream).
  const watch = useCallback((debateId: string) => {
    close();
    setState(initialDebate());
    const es = new EventSource(`/api/debates/${debateId}/stream`);
    source.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as DebateEvent;
      setLost(false);
      setState((s) => reduceDebate(s, e));
      if (isTerminal(e)) { es.close(); if (source.current === es) source.current = null; }
    };
    // On a network error the browser reconnects by itself and the server replays from the start. A 404 or a server that is gone
    // closes the stream for good, which is the only case where we stop.
    es.onerror = () => {
      if (source.current !== es) return;
      if (es.readyState === EventSource.CLOSED) { source.current = null; setLost(false); } else setLost(true);
    };
  }, [close]);

  const resolve = useCallback((id: string, status: 'accepted' | 'dismissed') => setState((s) => resolveSuggestion(s, id, status)), []);
  const reset = useCallback(() => { close(); setState(initialDebate()); }, [close]);

  return { state, lost, watch, resolve, reset };
}
