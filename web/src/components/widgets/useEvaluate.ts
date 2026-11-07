import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Evaluation = { ok: true; value: string } | { ok: false; error: string };

/** Results for a widget, computed by the server's interpreter. Asked once per page and kept. */
export function useEvaluate(setup: string, exprs: string[], enabled = true) {
  return useQuery({
    queryKey: ['evaluate', setup, exprs],
    queryFn: () => api.post<{ results: Evaluation[] }>('/api/evaluate', { language: 'haskell', setup, exprs }).then((r) => r.results),
    enabled: enabled && exprs.length > 0,
    staleTime: Infinity,
    retry: 1,
  });
}
