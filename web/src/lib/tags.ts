import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Tag, TagKind } from '@wb/shared';
import { api, useOutline } from './api';

export const tagsKey = ['tags'] as const;

/** All of the student's tags, in their order. Read by the picker anywhere, so it stays cached until a tag changes. */
export const useTags = () => useQuery({ queryKey: tagsKey, queryFn: () => api.get<Tag[]>('/api/tags'), staleTime: Infinity });

/** Id to tag, for showing names. */
export function useTagMap(): Map<string, Tag> {
  const tags = useTags().data;
  return useMemo(() => new Map((tags ?? []).map((t) => [t.id, t])), [tags]);
}

/** The names of the course's topics, which can be put on the student's own things like any tag (read-only here). */
export function useCourseTagNames(): string[] {
  const outline = useOutline().data;
  return useMemo(() => (outline ? outline.tags.filter((t) => t.type === 'topic').map((t) => t.label) : []), [outline]);
}

/** The tag of this name, made if there is none; the cache learns it at once. */
export async function ensureTag(qc: QueryClient, name: string): Promise<Tag> {
  const have = qc.getQueryData<Tag[]>(tagsKey)?.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  if (have) return have;
  const tag = await api.post<Tag>('/api/tags', { name: name.trim(), color: '' });
  qc.setQueryData<Tag[]>(tagsKey, (cur) => (cur?.some((t) => t.id === tag.id) ? cur : [...(cur ?? []), tag]));
  return tag;
}

/** Puts exactly these tags on one thing. Callers refresh what shows them. */
export const setTagsOn = (kind: TagKind, ref: string, ids: string[]) => api.put<string[]>(`/api/tags/on/${kind}/${encodeURIComponent(ref)}`, { ids });

const fresh = (qc: QueryClient) => {
  // Names and colors show in questions, materials, pages and highlights.
  void qc.invalidateQueries({ queryKey: tagsKey });
  for (const k of ['questions', 'resources', 'library', 'pdf-pages', 'pdf-annotations', 'annotations']) void qc.invalidateQueries({ queryKey: [k] });
};

export function useTagActions() {
  const qc = useQueryClient();
  const set = (tags: Tag[]) => qc.setQueryData(tagsKey, tags);
  return {
    rename: useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<Tag[]>(`/api/tags/${id}`, { name }), onSuccess: set }),
    recolor: useMutation({ mutationFn: ({ id, color }: { id: string; color: string }) => api.patch<Tag[]>(`/api/tags/${id}`, { color }), onSuccess: set }),
    merge: useMutation({ mutationFn: ({ id, into }: { id: string; into: string }) => api.post<Tag[]>(`/api/tags/${id}/merge`, { into }), onSuccess: (t) => { set(t); fresh(qc); } }),
    remove: useMutation({ mutationFn: (id: string) => api.delete<Tag[]>(`/api/tags/${id}`), onSuccess: (t) => { set(t); fresh(qc); } }),
  };
}
