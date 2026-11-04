import { useCallback, useEffect, useRef, useState } from 'react';
import { recordTick } from './api';
import { readPref, writePref } from './shell';

/**
 * Counts time spent actually working on an exercise: the tab is visible and
 * there was keyboard or pointer activity in the last minute. Reported in
 * small slices so a crashed tab loses almost nothing. Returns the seconds
 * counted since the page was opened, a way to start counting from zero, and a
 * pause the student controls, remembered per exercise in this browser. While
 * `stopped` (the exercise is finished) nothing is counted, whatever the pause says.
 */
export function useActiveTime(id: string, stopped: boolean): { session: number; reset: () => void; paused: boolean; togglePaused: () => void } {
  const [session, setSession] = useState(0);
  const pending = useRef(0);
  const pauseKey = `wb-timer-paused-${id}`;
  const [paused, setPaused] = useState(() => readPref(pauseKey, ['1', '0'], '0') === '1');
  const pausedNow = useRef(paused);
  const saveNow = useRef<() => void>(() => undefined);
  const stoppedNow = useRef(stopped);
  stoppedNow.current = stopped;
  useEffect(() => {
    setSession(0);
    pending.current = 0;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
    events.forEach((e) => addEventListener(e, bump, { passive: true }));
    const save = () => {
      if (pending.current > 0) void recordTick(id, pending.current).catch(() => undefined);
      pending.current = 0;
    };
    saveNow.current = save;
    // A reload or a closed tab never unmounts anything, so this is the only chance to keep those seconds.
    addEventListener('pagehide', save);
    const timer = setInterval(() => {
      if (!pausedNow.current && !stoppedNow.current && document.visibilityState === 'visible' && Date.now() - last < 60_000) {
        pending.current += 1;
        setSession((s) => s + 1);
      }
      if (pending.current >= 30) save();
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => removeEventListener(e, bump));
      removeEventListener('pagehide', save);
      save();
    };
  }, [id]);

  // When counting stops, what was counted so far is final, so it should not wait for anything else.
  useEffect(() => {
    if (stopped) saveNow.current();
  }, [stopped]);
  const reset = useCallback(() => {
    pending.current = 0;
    setSession(0);
  }, []);
  const togglePaused = useCallback(() => {
    pausedNow.current = !pausedNow.current;
    if (pausedNow.current) saveNow.current();
    setPaused(pausedNow.current);
    writePref(pauseKey, pausedNow.current ? '1' : '0');
  }, [pauseKey]);
  return { session, reset, paused, togglePaused };
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false);
  const [value, setValue] = useState(get);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setValue(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query, setValue]);
  return value;
}
