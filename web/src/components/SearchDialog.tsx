import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { indexItems, search, useOutline, useState_, type SearchResponse } from '@/lib/api';
import { focusOf, itemInFocus } from '@/lib/focus';
import { useT } from '@/lib/i18n';
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

  const go = (href: string) => {
    onClose();
    nav(href);
  };
  const first = res?.items[0]?.href ?? (res?.mine[0] ? `/item/${res.mine[0].exerciseId}` : undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t.searchLabel} width="max-w-xl">
      <label className="relative block">
        <span className="sr-only">{t.searchPlaceholder}</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && first && go(first)}
          placeholder={t.searchPlaceholder}
          className="h-10 w-full rounded-md border border-line bg-paper pl-9 pr-3 focus:border-accent focus:outline-none"
        />
      </label>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {res && res.items.length === 0 && res.mine.length === 0 ? <p className="px-1 py-6 text-center text-sm text-ink-2">{t.searchNothing(q)}</p> : null}
        {res?.items.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-2 text-xs font-semibold text-ink-2">{t.searchExercises}</h3>
            <ul>
              {res.items.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => go(i.href)} className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-sunk">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 font-medium"><Title text={i.title} /></span>
                      {outside(i.id) ? <span className="ml-auto shrink-0 text-xs text-ink-3">{t.outsideFocus}</span> : null}
                    </span>
                    {i.snippet ? <Snippet text={i.snippet} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {res?.mine.length ? (
          <section>
            <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-ink-2">{t.searchMine}</h3>
            <ul>
              {res.mine.map((m, i) => (
                <li key={i}>
                  <button type="button" onClick={() => go(`/item/${m.exerciseId}`)} className="w-full rounded-md px-2 py-2 text-left hover:bg-sunk">
                    <span className="block text-sm font-medium">{m.exerciseId}</span>
                    <span className="block truncate text-[13px] text-ink-2">
                      {m.source === 'note' ? t.searchSourceNote : t.searchSourceAnswer}:{' '}
                      {m.snippet.replace(/[\[\]]/g, '')}
                    </span>
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
