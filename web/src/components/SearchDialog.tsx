import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { indexItems, search, useCourseAction, useCourses, useOutline, useSettings, useState_, type SearchResponse } from '@/lib/api';
import { focusOf, itemInFocus } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { fileUrl, useResources } from '@/lib/resources';
import { Dialog } from './ui';
import { Title } from '@/components/Title';

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [, nav] = useLocation();
  const seq = useRef(0);
  // Search finds everything, and says what is outside the focus.
  const outline = useOutline().data;
  const focus = focusOf(useState_().data?.state);
  const { map } = useMemo(() => indexItems(outline), [outline]);
  const outside = (id: string) => {
    const item = map.get(id);
    return !!item && !itemInFocus(item, focus);
  };

  useEffect(() => {
    if (!open) {
      setQ('');
      setRes(null);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setRes(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      search(q).then(
        (r) => mine === seq.current && setRes(r),
        () => undefined,
      );
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  // A hit in another workbook opens that workbook first.
  const activeId = useCourses().data?.activeId;
  const action = useCourseAction();
  const go = (href: string, course?: string | null) => {
    onClose();
    if (course && course !== activeId) action.mutateAsync({ type: 'activate', id: course }).then(() => nav(href), () => undefined);
    else nav(href);
  };
  const flashcards = !!useSettings().data?.showFlashcards;
  // Lessons are not exercises: a group of their own. Pages and the rest stay with the exercises.
  const isLesson = (id: string) => map.get(id)?.type === 'lesson';
  const lessons = res?.items.filter((i) => isLesson(i.id)) ?? [];
  const others = res?.items.filter((i) => !isLesson(i.id)) ?? [];
  const cards = flashcards ? (res?.cards ?? []) : [];
  // Materials are found here, in the browser: a short list with titles, authors and series.
  const materialsOn = !!useSettings().data?.showMaterials;
  const library = useResources(null, materialsOn && open).data;
  const needle = q.trim().toLowerCase();
  const materials = materialsOn && needle && library ? library.resources.filter((r) => [r.title, r.author, library.series.find((s) => s.id === r.series)?.title ?? ''].some((x) => x.toLowerCase().includes(needle))).slice(0, 8) : [];
  const first = others[0] ?? lessons[0];
  const showMaterials = materialsOn && !!res?.materials.length;
  const mine = (res?.mine ?? []).filter((m) => materialsOn || !m.href.startsWith('/resources/'));
  const itemList = (list: typeof others) => (
    <ul>
      {list.map((i) => (
        <li key={i.id}>
          <button type="button" onClick={() => go(i.href, i.course)} className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-sunk">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 font-medium">
                <Title text={i.title} />
              </span>
              {i.course !== activeId ? <span className="ml-auto shrink-0 text-xs text-ink-3">{i.courseTitle}</span> : outside(i.id) ? <span className="ml-auto shrink-0 text-xs text-ink-3">{t.outsideFocus}</span> : null}
            </span>
            {i.snippet ? <Snippet text={i.snippet} /> : null}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.searchLabel} width="max-w-xl">
      <label className="relative block">
        <span className="sr-only">{t.searchPlaceholder}</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (first ? go(first.href, first.course) : mine[0] ? go(mine[0].href, mine[0].course) : undefined)}
          placeholder={t.searchPlaceholder}
          className="h-10 w-full wb-field pl-9 pr-3"
        />
      </label>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {res && res.items.length === 0 && mine.length === 0 && cards.length === 0 && materials.length === 0 && !showMaterials ? <p className="px-1 py-6 text-center text-sm text-ink-2">{t.searchNothing(q)}</p> : null}
        {others.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-2 text-xs font-semibold text-ink-2">{t.searchExercises}</h3>
            {itemList(others)}
          </section>
        ) : null}
        {lessons.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchLessons}</h3>
            {itemList(lessons)}
          </section>
        ) : null}
        {mine.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchMine}</h3>
            <ul>
              {mine.map((m, i) => (
                <li key={i}>
                  <button type="button" onClick={() => go(m.href, m.course)} className="w-full rounded-md px-2 py-2 text-left hover:bg-sunk">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title ? <Title text={m.title} /> : t.searchSourceQuestion}</span>
                      <span className="shrink-0 text-xs text-ink-3">
                        {m.source === 'note' ? t.searchSourceNote : m.source === 'annotation' ? t.searchSourceAnnotation : m.source === 'question' ? t.searchSourceQuestion : t.searchSourceAnswer}
                        {m.course && m.course !== activeId ? ` · ${m.courseTitle}` : ''}
                      </span>
                    </span>
                    <Snippet text={m.snippet} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {showMaterials ? (
          <section>
            <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchMaterials}</h3>
            <ul>
              {res!.materials.map((m, i) => (
                <li key={i}>
                  <button type="button" onClick={() => go(m.href)} className="w-full rounded-md px-2 py-2 text-left hover:bg-sunk">
                    <span className="block truncate text-sm font-medium">{t.searchPageIn(m.title, m.page)}</span>
                    <Snippet text={m.snippet} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {materials.length ? (
          <section>
            {showMaterials ? null : <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchMaterials}</h3>}
            <ul>
              {materials.map((m) => (
                <li key={m.id}>
                  <a href={fileUrl(m)} target="_blank" rel="noreferrer" onClick={onClose} className="block w-full rounded-md px-2 py-2 text-left hover:bg-sunk">
                    <span className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
                      <span className="shrink-0 text-[12px] text-ink-3">{t.resourceTypes[m.type]}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {cards.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchCards}</h3>
            <ul>
              {cards.map((c) => (
                <li key={`${c.deckId}/${c.cardId}`}>
                  <button type="button" onClick={() => go(`/flashcards/deck/${c.deckId}/card/${c.cardId}`)} className="w-full rounded-md px-2 py-2 text-left hover:bg-sunk">
                    <span className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium"><Title text={c.title} /></span>
                      <span className="shrink-0 text-[12px] text-ink-3">{c.deckTitle}</span>
                    </span>
                    {c.snippet ? <Snippet text={c.snippet} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/** A piece of text with the found word marked: the server sends it as «this». */
function Snippet({ text }: { text: string }) {
  return (
    <span className="mt-0.5 block text-[13px] text-ink-2">
      {text.split(/[«»]/).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded bg-review-soft px-0.5 text-ink">{part}</mark> : part))}
    </span>
  );
}
