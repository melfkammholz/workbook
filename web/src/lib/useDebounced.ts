import { useEffect, useRef } from 'react';

/** A stable callback that runs `fn` once `ms` after the last call; `flush()` runs it now. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const args = useRef<A | null>(null);
  const api = useRef({
    call(...a: A) {
      args.current = a;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(api.current.flush, ms);
    },
    flush() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const a = args.current;
      args.current = null;
      if (a) fnRef.current(...a);
    },
    cancel() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      args.current = null;
    },
  });
  // Pending work is written out when the component goes away.
  useEffect(() => () => api.current.flush(), []);
  return api.current;
}
