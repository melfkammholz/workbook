import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { Resource, ResourceFields, ResourcesResponse } from '@wb/shared';
import { ApiError, api } from './api';

export const resourceKeys = {
  all: ['resources'] as const,
  list: (course: string | null) => ['resources', course ?? '*'] as const,
};

/** The materials of one course, or of every course. */
export const useResources = (course: string | null, enabled = true) =>
  useQuery({
    queryKey: resourceKeys.list(course),
    queryFn: () => api.get<ResourcesResponse>(`/api/resources${course ? `?course=${encodeURIComponent(course)}` : ''}`),
    staleTime: 30_000,
    enabled,
  });

export const fileUrl = (r: Resource) => `/api/resources/${encodeURIComponent(r.id)}/file`;

export const MAX_FILE_BYTES = 500 * 1024 * 1024;

/** Uploads one file as the raw body; its details go in the query. */
export async function uploadResource(file: File, f: ResourceFields): Promise<Resource> {
  const q = new URLSearchParams({ filename: file.name, title: f.title, type: f.type, author: f.author, date: f.date, courses: f.courses.join(',') });
  if (f.newSeries) q.set('newSeries', f.newSeries);
  else if (f.series) q.set('series', f.series);
  const res = await fetch(`/api/resources/upload?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as Resource;
}

export const updateResource = (id: string, f: ResourceFields) => api.put<Resource>(`/api/resources/${encodeURIComponent(id)}`, f);
export const deleteResource = (id: string) => api.delete<ResourcesResponse>(`/api/resources/${encodeURIComponent(id)}`);
export const refreshResources = (qc: QueryClient) => qc.invalidateQueries({ queryKey: resourceKeys.all });

/** `Skript 3 (final).pdf` → `Skript 3 (final)`. */
export const titleFromFilename = (name: string) => name.replace(/\.[^.]{1,8}$/, '').replace(/[_]+/g, ' ').trim() || name;

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
