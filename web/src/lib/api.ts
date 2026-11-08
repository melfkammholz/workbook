import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AchievementsResponse,
  AnswerVersion,
  CheckRun,
  CoursesResponse,
  ItemDetail,
  NoteDoc,
  NoteFormat,
  OpenQuestion,
  Outline,
  RenderedItem,
  ProgressEntry,
  Reflection,
  ReviewData,
  Settings,
  Stats,
  Status,
  StudentState,
  ThreadInfo,
  TypstDiagnostic,
  HowSolved,
} from '@wb/shared';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
};

// ───────────────────────── shapes ─────────────────────────

export type SuggestionReason = 'review-due' | 'continue' | 'next-up' | 'similar' | 'start-here' | 'ready';
export interface Suggestion {
  id: string;
  reason: SuggestionReason;
}
export interface StateResponse {
  state: StudentState;
  suggestions: Suggestion[];
}
export interface Work {
  answers: Record<string, string>;
  note: NoteDoc | null;
  progress: ProgressEntry | null;
  stats: Stats;
  reflections: Reflection[];
  openQuestion: OpenQuestion | null;
}
export interface NotePreview {
  html: string;
  css: string;
  /** Laid out as a page and shown as a picture: HTML export would have lost part of it. */
  asPicture?: boolean;
  diagnostics: TypstDiagnostic[];
}
export interface SearchResponse {
  items: { id: string; title: string; href: string; snippet: string | null }[];
  mine: { exerciseId: string; source: 'note' | 'answer'; snippet: string }[];
  cards: { deckId: string; deckTitle: string; cardId: string; title: string; snippet: string | null }[];
}

// ───────────────────────── queries ─────────────────────────

export const keys = {
  outline: ['outline'] as const,
  state: ['state'] as const,
  item: (id: string, version: string) => ['item', id, version] as const,
  work: (id: string) => ['work', id] as const,
  settings: ['settings'] as const,
  info: ['info'] as const,
  mine: ['mine'] as const,
  courses: ['courses'] as const,
  achievements: ['achievements'] as const,
};

export const useCourses = () => useQuery({ queryKey: keys.courses, queryFn: () => api.get<CoursesResponse>('/api/courses'), staleTime: Infinity });

export const useOutline = () => {
  const courseOpen = !!useCourses().data?.activeId;
  return useQuery({
    queryKey: keys.outline,
    queryFn: () => api.get<Outline>('/api/outline'),
    enabled: courseOpen,
    // Authors edit content while students read: pick up changes when the tab regains focus.
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
};

export const useState_ = () =>
  useQuery({ queryKey: keys.state, queryFn: () => api.get<StateResponse>('/api/state'), placeholderData: keepPreviousData });

export const useItem = (id: string, version: string | undefined) =>
  useQuery({
    queryKey: keys.item(id, version ?? ''),
    queryFn: () => api.get<ItemDetail>(`/api/items/${encodeURIComponent(id)}`),
    enabled: version !== undefined,
    staleTime: Infinity,
  });

/** A text that is not an item. Follows the content, like items do. */
export const useDoc = (url: string) => {
  const version = useOutline().data?.version;
  return useQuery({ queryKey: ['doc', url, version ?? ''], queryFn: () => api.get<RenderedItem>(url), enabled: version !== undefined, staleTime: Infinity });
};

export const useWork = (id: string) =>
  useQuery({ queryKey: keys.work(id), queryFn: () => api.get<Work>(`/api/work/${encodeURIComponent(id)}`), staleTime: 0, gcTime: 0 });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<Settings>('/api/settings'), staleTime: Infinity });

/** The student's own work, for the review page. */
export const useReviewData = () => useQuery({ queryKey: keys.mine, queryFn: () => api.get<ReviewData>('/api/review'), staleTime: 0 });

export const useAchievements = () => {
  const on = !!useSettings().data?.showAchievements;
  // Changes with the student's state; CourseShell asks for it again when that does.
  return useQuery({ queryKey: keys.achievements, queryFn: () => api.get<AchievementsResponse>('/api/achievements'), enabled: on, staleTime: Infinity });
};
export const acknowledgeAchievements = () => api.post('/api/achievements/seen');

export type CourseAction = { type: 'add'; url: string } | { type: 'activate' | 'update' | 'remove' | 'reset'; id: string };

const courseRequest = (a: CourseAction) => {
  if (a.type === 'add') return api.post<CoursesResponse>('/api/courses', { url: a.url });
  const url = `/api/courses/${encodeURIComponent(a.id)}`;
  return a.type === 'remove' ? api.delete<CoursesResponse>(url) : api.post<CoursesResponse>(`${url}/${a.type}`);
};

/** Everything below the course list and the settings depends on the course. */
const isCourseData = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== keys.courses[0] && q.queryKey[0] !== keys.settings[0];

export const useCourseAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: CourseAction) => {
      // Leaving the page first: what an open exercise still has to save must not arrive after a reset.
      if (action.type === 'reset' && action.id === qc.getQueryData<CoursesResponse>(keys.courses)?.activeId) {
        location.hash = '#/';
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return courseRequest(action);
    },
    onSuccess: (data, action) => {
      const before = qc.getQueryData<CoursesResponse>(keys.courses)?.activeId;
      const emptied = action.type === 'reset' && action.id === data.activeId;
      if (emptied) forgetBrowserMemory(qc.getQueryData<Outline>(keys.outline));
      if (before !== data.activeId || emptied) {
        // Exercises and tags of the previous course mean nothing in this one.
        location.hash = '#/';
        try {
          localStorage.removeItem('wb-filters');
        } catch {
          /* only a convenience */
        }
        void qc.resetQueries({ predicate: isCourseData });
      } else {
        void qc.invalidateQueries({ predicate: isCourseData });
      }
      qc.setQueryData(keys.courses, data);
    },
  });
};

/** What this browser remembers per exercise, which a reset should not leave behind. */
function forgetBrowserMemory(outline: Outline | undefined) {
  try {
    for (const item of outline?.chapters.flatMap((c) => c.items) ?? []) {
      localStorage.removeItem(`wb-help-dismissed-${item.id}`);
      localStorage.removeItem(`wb-timer-paused-${item.id}`);
    }
  } catch {
    /* only a convenience */
  }
}

/** Quietly looks for news; without a network nothing changes. */
export const checkCourseUpdates = () => api.post<CoursesResponse>('/api/courses/check');

export const useSaveSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>('/api/settings', patch),
    // Shown at once, so a checkbox does not snap back until the server has answered.
    onMutate: (patch) => {
      const prev = qc.getQueryData<Settings>(keys.settings);
      if (prev) qc.setQueryData<Settings>(keys.settings, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.settings, ctx.prev);
    },
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
};

export const useSetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => api.put<ProgressEntry>(`/api/progress/${encodeURIComponent(id)}`, { status }),
    // The outline is the main place status shows; update it at once and confirm after.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: keys.state });
      const prev = qc.getQueryData<StateResponse>(keys.state);
      if (prev) {
        const old = prev.state.progress[id];
        qc.setQueryData<StateResponse>(keys.state, {
          ...prev,
          state: { ...prev.state, progress: { ...prev.state.progress, [id]: { reviewCount: 0, reviewDueAt: null, ...old, status, updatedAt: Date.now() } } },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.state, ctx.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.state }),
  });
};

export const saveAnswer = (id: string, slot: string, content: string, reason: 'autosave' | 'run' | 'check' | 'done' | 'reset' | 'restore' | 'retry' = 'autosave') =>
  api.put(`/api/work/${encodeURIComponent(id)}/answer`, { slot, content, reason });
export const saveNote = (id: string, format: NoteFormat, content: string) => api.put(`/api/work/${encodeURIComponent(id)}/note`, { format, content });
export const fetchVersions = (id: string, slot: string) => api.get<AnswerVersion[]>(`/api/work/${encodeURIComponent(id)}/versions?slot=${encodeURIComponent(slot)}`);
export const runChecks = (id: string, files: Record<string, string>) => api.post<CheckRun>(`/api/work/${encodeURIComponent(id)}/check`, { files });
export const stopChecks = (id: string) => api.post<{ ok: boolean }>(`/api/work/${encodeURIComponent(id)}/check/stop`);
export const fetchSolution = (id: string) => api.post<{ files: Record<string, string> }>(`/api/work/${encodeURIComponent(id)}/solution`);
export const fetchSample = (id: string) => api.post<{ samples: string[]; css: string }>(`/api/work/${encodeURIComponent(id)}/sample`);
export const recordHints = (id: string, count: number) => api.post(`/api/work/${encodeURIComponent(id)}/hints`, { count });
export const recordOpen = (id: string) => api.post(`/api/work/${encodeURIComponent(id)}/open`);
/** `keepalive`, so that it still arrives when it is sent while the page is closing. */
export const recordTick = (id: string, seconds: number) =>
  fetch(`/api/work/${encodeURIComponent(id)}/tick`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds }) });
export const postReflection = (id: string, confidence: number, how: HowSolved[], comment: string) =>
  api.post<Reflection>(`/api/work/${encodeURIComponent(id)}/reflection`, { confidence, how, comment });
export const saveOpenQuestion = (id: string, content: string) => api.put(`/api/work/${encodeURIComponent(id)}/question`, { content });
export const saveChecklistAnswer = (id: string, question: string, confidence: number | null, note: string) =>
  api.put(`/api/checklists/${encodeURIComponent(id)}/${encodeURIComponent(question)}`, { confidence, note });
export const markLandingSeen = () => api.post('/api/landing/seen');
export const resetTimer = (id: string) => api.post(`/api/work/${encodeURIComponent(id)}/timer/reset`);
export interface PromptRequest {
  answer: string;
  tests: { name: string; status: string; message: string }[] | null;
  lang: 'de' | 'en';
}
export const fetchAiPrompt = (id: string, body: PromptRequest) => api.post<{ text: string }>(`/api/work/${encodeURIComponent(id)}/ai/prompt`, body);
export const previewNote = (source: string, width?: number) => api.post<NotePreview>('/api/preview/note', width ? { source, width } : { source });
export const search = (q: string) => api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);

// ───────────────────────── helpers ─────────────────────────

import { focusOf, inFocus, isReading, type ExerciseMeta, type ItemMeta } from '@wb/shared';

export const isExercise = (i: ItemMeta | undefined): i is ExerciseMeta => i?.type === 'exercise';

export function indexItems(outline: Outline | undefined) {
  const map = new Map<string, ItemMeta>();
  const chapterOf = new Map<string, number>();
  outline?.chapters.forEach((c, ci) =>
    c.items.forEach((i) => {
      map.set(i.id, i);
      chapterOf.set(i.id, ci);
    }),
  );
  const flat = outline?.chapters.flatMap((c) => c.items) ?? [];
  return { map, chapterOf, flat };
}

/** How many steps are finished. A step with several options counts once, when any of them is done. */
export function threadProgress(thread: ThreadInfo, state: StudentState | undefined) {
  const done = thread.steps.filter((step) => step.some((id) => statusOf(state, id) === 'done')).length;
  return { done, total: thread.steps.length };
}

/** Out of the focus and not worked on: folded away in the outline, and passed over when moving through the course. */
function folded(item: ItemMeta, state: StudentState | undefined): boolean {
  const focus = focusOf(state);
  const outside = isExercise(item) ? !inFocus(item, focus) : isReading(item) && item.extra && focus !== 'everything';
  return outside && statusOf(state, item.id) === 'todo';
}

/** The items around one, in the order of the course, passing over what the focus folds away. */
/** Where an item is, optionally as a step of a group (session, sheet, exam): then that is the order to go in. */
export const itemHref = (id: string, group?: string | null) => (group ? `/item/${id}/in/${encodeURIComponent(group)}` : `/item/${id}`);

export function neighbours(outline: Outline, id: string, state: StudentState | undefined, group?: string | null): { previous: ItemMeta | undefined; next: ItemMeta | undefined } {
  const all = outline.chapters.flatMap((c) => c.items);
  const thread = group ? outline.threads.find((x) => x.id === group && x.kind) : undefined;
  // Visited from coursework: previous and next follow the group, in its order.
  const flat = thread && thread.steps.some((s) => s.includes(id)) ? thread.steps.flat().flatMap((x) => all.find((i) => i.id === x) ?? []) : all;
  const at = flat.findIndex((i) => i.id === id);
  if (at < 0) return { previous: undefined, next: undefined };
  const shown = (i: ItemMeta) => !folded(i, state);
  return { previous: flat.slice(0, at).findLast(shown), next: flat.slice(at + 1).find(shown) };
}

/**
 * Where to go after finishing an exercise: on along its adventure, else what the author
 * says builds on it, else the next unfinished exercise. Null when nothing is left.
 * Only exercises in the focus, or ones already started.
 */
export function whatsNext(outline: Outline, state: StudentState | undefined, id: string): ItemMeta | null {
  const { map, flat } = indexItems(outline);
  const open = (itemId: string) => {
    const item = map.get(itemId);
    return isExercise(item) && !folded(item, state) && statusOf(state, itemId) !== 'done' && itemId !== id;
  };
  for (const thread of outline.threads) {
    if (!thread.adventure || !thread.steps.some((s) => s.includes(id))) continue;
    const step = thread.steps.find((s) => !s.some((x) => x !== id && statusOf(state, x) === 'done') && s.some(open));
    const target = step?.find(open);
    if (target) return map.get(target)!;
  }
  const self = map.get(id);
  const follow = isExercise(self) ? self.next.find(open) : undefined;
  if (follow) return map.get(follow)!;
  const at = flat.findIndex((i) => i.id === id);
  return [...flat.slice(at + 1), ...flat.slice(0, Math.max(at, 0))].find((i) => open(i.id)) ?? null;
}

export function statusOf(state: StudentState | undefined, id: string): Status {
  return state?.progress[id]?.status ?? 'todo';
}
