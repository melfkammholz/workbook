import { useMemo } from 'react';
import { Link } from 'wouter';
import { RenderedText } from '@/components/RenderedText';
import { Empty, Spinner } from '@/components/ui';
import { useOutline, useReviewData } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';

/** Every note in one place and in the order of the course, for going over them before an exam. */
export function NotesPage() {
  const t = useT();
  const outline = useOutline().data;
  const data = useReviewData().data;
  const notes = data?.notes;
  const { chapters, count, orphans } = useMemo(() => {
    const known = new Set(outline?.chapters.flatMap((c) => c.items.map((i) => i.id)));
    const chapters = (outline?.chapters ?? []).map((c) => ({ chapter: c, items: c.items.filter((i) => notes?.[i.id]) })).filter((g) => g.items.length > 0);
    return {
      chapters,
      count: chapters.reduce((n, g) => n + g.items.length, 0),
      // A course update can remove an exercise. What was written about it is still the student's.
      orphans: Object.keys(notes ?? {}).filter((id) => !known.has(id)),
    };
  }, [outline, notes]);

  if (!outline || !notes) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/review" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.allNotes}</h1>
        {count + orphans.length === 0 ? (
          <Empty title={t.noNotesYet}>{t.noNotesYetBody}</Empty>
        ) : (
          <p className="mt-2 text-ink-2">{t.notesCount(count + orphans.length)}</p>
        )}
        {chapters.map(({ chapter, items }) => (
          <section key={chapter.id} className="mt-8">
            <h2 className="mb-3 text-[15px] font-semibold">{chapter.title}</h2>
            <div className="space-y-5">
              {items.map((item) => (
                <article key={item.id}>
                  <Link href={`/item/${item.id}`} className="mb-1.5 block text-sm font-medium text-accent hover:underline">
                    {item.title}
                  </Link>
                  <RenderedText source={notes[item.id]!.content} full />
                </article>
              ))}
            </div>
          </section>
        ))}
        {orphans.length ? (
          <section className="mt-8">
            <h2 className="mb-1 text-[15px] font-semibold">{t.notesOrphaned}</h2>
            <p className="mb-3 text-[13.5px] text-ink-2">{t.notesOrphanedBody}</p>
            <div className="space-y-5">
              {orphans.map((id) => (
                <article key={id}>
                  <p className="mb-1.5 font-mono text-xs text-ink-3">{id}</p>
                  <RenderedText source={notes[id]!.content} full />
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
