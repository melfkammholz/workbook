import { targetHref } from '@wb/shared';
import type { Content } from '../content/loader.js';
import { fold, snippetOf } from '../content/search.js';
import type { SearchSource } from '../db/store.js';
import type { CourseManager } from './manager.js';

export interface SearchResponse {
  /** Text of the workbooks. `course` is the workbook's id; `courseTitle` says which one when there are several. */
  items: { id: string; title: string; href: string; snippet: string | null; course: string; courseTitle: string }[];
  /** The student's own text, wherever it is. `course` is null for what belongs to no workbook. */
  mine: { source: SearchSource; title: string; snippet: string; href: string; course: string | null; courseTitle: string | null }[];
  /** Text of the materials, by page (1-based). */
  materials: { resource: string; title: string; page: number; snippet: string; href: string }[];
  cards: { deckId: string; deckTitle: string; cardId: string; title: string; snippet: string | null }[];
}

const folded = new WeakMap<object, { t: { id: string; title: string; href: string; text: string }; title: string; text: string }[]>();
const foldedTexts = (c: Content) => {
  const texts = c.searchTexts();
  let f = folded.get(texts);
  if (!f) folded.set(texts, (f = texts.map((t) => ({ t, title: fold(t.title), text: fold(t.text) }))));
  return f;
};

/** One search over the text of every workbook, the student's own text and the materials' text, in the shown workbooks. */
export function searchEverything(m: CourseManager, q: string): SearchResponse {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { items: [], mine: [], materials: [], cards: [] };
  const scope = m.searchScope();
  const activeId = m.list().activeId;
  const byKey = new Map(scope.map((s) => [s.key, s]));
  // Every word has to be there, somewhere. Titles count for more than the text; the open workbook comes first.
  const items = scope
    .flatMap((s) =>
      foldedTexts(s.content)
        .filter(({ t, title, text }) => terms.every((w) => title.includes(w) || text.includes(w) || t.id.includes(w)))
        .map((f) => ({ ...f, s, rank: Number(s.id !== activeId) * 2 + Number(!terms.every((w) => f.title.includes(w))) })),
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 20)
    .map(({ t, s }) => ({ id: t.id, title: t.title, href: t.href, snippet: snippetOf(t.text, terms), course: s.id, courseTitle: s.title }));

  const visible = m.resources.visibleIds(m.courseRefs().map((c) => c.id));
  const resourceTitle = (id: string) => {
    try {
      return visible.has(id) ? m.resources.get(id).title : null;
    } catch {
      return null;
    }
  };
  const mine: SearchResponse['mine'] = [];
  for (const hit of m.global.search(q, { courses: scope.map((s) => s.key), limit: 30 })) {
    const a = hit.anchor;
    const base = { source: hit.source, snippet: hit.snippet };
    if (a.kind === 'page' || a.kind === 'material') {
      const title = a.resource ? resourceTitle(a.resource) : null;
      if (!title) continue;
      const href = `/resources/${encodeURIComponent(a.resource!)}${a.questionId || a.id ? `/${encodeURIComponent((a.questionId ?? a.id)!)}` : a.pageIndex !== undefined ? `/page:${a.pageIndex + 1}` : ''}`;
      mine.push({ ...base, title: a.pageIndex !== undefined ? `${title}, ${a.pageIndex + 1}` : title, href, course: null, courseTitle: null });
    } else if (a.kind === 'none') {
      mine.push({ ...base, title: '', href: '/questions', course: null, courseTitle: null });
    } else {
      // An item or a passage of a workbook's text; shared files' work is stored under their adventure.
      const s = byKey.get(hit.course ?? a.course ?? '');
      if (!s) continue;
      const rawId = a.target ?? a.id ?? '';
      const id = a.kind === 'exercise' ? s.content.exerciseOfOwner(rawId) : rawId;
      if (!id || !(s.content.get(id) ?? s.content.doc(id) ?? foldedTexts(s.content).find((f) => f.t.id === id))) continue;
      const title = foldedTexts(s.content).find((f) => f.t.id === id)?.t.title ?? id;
      mine.push({ ...base, title, href: targetHref(id), course: s.id, courseTitle: s.title });
    }
  }
  const materials = m.global
    .search(q, { materials: true, courses: [], limit: 40 })
    .flatMap((hit) => {
      const title = resourceTitle(hit.anchor.resource!);
      return title ? [{ resource: hit.anchor.resource!, title, page: hit.anchor.pageIndex! + 1, snippet: hit.snippet, href: `/resources/${encodeURIComponent(hit.anchor.resource!)}/page:${hit.anchor.pageIndex! + 1}` }] : [];
    })
    .slice(0, 10);
  const cards = m.flashcards.search(terms, fold, snippetOf);
  return { items, mine, materials, cards };
}
