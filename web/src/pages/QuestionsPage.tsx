import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Question } from '@wb/shared';
import { Quote } from '@/components/PdfQuestions';
import { QuestionRow } from '@/components/Questions';
import { Empty, Spinner } from '@/components/ui';
import { useCourses, useOutline, useQuestions } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';

/** The item or text a workbook question is about. */
const placeOf = (a: Exclude<Question['anchor'], { kind: 'page' | 'none' }>) => (a.kind === 'text' ? a.target : a.id);

interface Group {
  key: string;
  title: string;
  /** Pages for a material, items for a workbook. */
  parts: { key: string; title: string; href: string | null; items: Question[] }[];
}

/** All the questions, open ones first: by material and page, then by workbook and item in reading order. */
export function QuestionsPage() {
  const t = useT();
  const all = useQuestions().data;
  const outline = useOutline().data;
  const courses = useCourses().data;
  const resources = useResources(null).data?.resources;
  const [showDone, setShowDone] = useState(false);

  const { materials, workbooks, loose } = useMemo(() => {
    const shown = (all ?? []).filter((q) => (showDone || q.status === 'open') && !q.unplaced);
    const byResource = new Map<string, Question[]>();
    const byCourse = new Map<string, Question[]>();
    const loose: Question[] = [];
    for (const q of shown) {
      const a = q.anchor;
      if (a.kind === 'page') (byResource.get(a.resource) ?? byResource.set(a.resource, []).get(a.resource)!).push(q);
      else if (a.kind === 'none') loose.push(q);
      else (byCourse.get(a.course) ?? byCourse.set(a.course, []).get(a.course)!).push(q);
    }
    const materials: Group[] = [...byResource].map(([id, qs]) => {
      const pages = new Map<number, Question[]>();
      for (const q of qs) if (q.anchor.kind === 'page') (pages.get(q.anchor.pageIndex) ?? pages.set(q.anchor.pageIndex, []).get(q.anchor.pageIndex)!).push(q);
      return {
        key: id,
        title: resources?.find((r) => r.id === id)?.title ?? id,
        parts: [...pages].sort((a, b) => a[0] - b[0]).map(([n, items]) => ({ key: String(n), title: t.questionPageLabel(n + 1), href: `/resources/${encodeURIComponent(id)}/${encodeURIComponent(items[0]!.id)}`, items })),
      };
    });
    materials.sort((a, b) => a.title.localeCompare(b.title));
    const order = new Map<string, number>();
    outline?.chapters.forEach((c, ci) => {
      order.set(`chapter/${c.id}`, ci * 1000);
      c.items.forEach((i, n) => order.set(i.id, ci * 1000 + n + 1));
    });
    const titleOf = (id: string) => outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id)?.title ?? outline?.chapters.find((c) => `chapter/${c.id}` === id)?.title ?? id;
    const workbooks: Group[] = [...byCourse].map(([course, qs]) => {
      const here = !!courses?.activeId && courses.activeId === course;
      const items = new Map<string, Question[]>();
      for (const q of qs) if (q.anchor.kind !== 'page' && q.anchor.kind !== 'none') (items.get(placeOf(q.anchor)) ?? items.set(placeOf(q.anchor), []).get(placeOf(q.anchor))!).push(q);
      const parts = [...items]
        .sort((a, b) => (here ? (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9) : 0) || a[0].localeCompare(b[0]))
        .map(([id, list]) => ({ key: id, title: here ? titleOf(id) : id, href: here ? (id.startsWith('chapter/') ? `/${id}` : `/item/${id}`) : null, items: list }));
      return { key: course, title: courses?.courses.find((c) => c.id === course)?.title ?? course, parts };
    });
    workbooks.sort((a, b) => (a.key === courses?.activeId ? -1 : b.key === courses?.activeId ? 1 : a.title.localeCompare(b.title)));
    return { materials, workbooks, loose };
  }, [all, showDone, resources, outline, courses, t]);

  if (!all) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const empty = materials.length + workbooks.length + loose.length === 0;
  const hasDone = all.some((q) => q.status === 'done');
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.questionsTitle}</h1>
        <p className="mt-2 text-ink-2">{t.questionsPageIntro}</p>
        {hasDone ? (
          <button type="button" onClick={() => setShowDone(!showDone)} aria-pressed={showDone} className="mt-3 text-[13px] text-ink-3 hover:text-ink">
            {showDone ? t.hideDoneQuestions : t.showDoneQuestions}
          </button>
        ) : null}
        {empty ? <Empty title={t.noQuestions}>{t.questionsNoneAnywhere}</Empty> : null}
        {[...materials, ...workbooks].map((g) => (
          <section key={g.key} className="mt-8">
            <h2 className="mb-2 text-[15px] font-semibold">{g.title}</h2>
            <div className="space-y-4">
              {g.parts.map((p) => (
                <div key={p.key}>
                  {p.href ? (
                    <Link href={p.href} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                      {p.title} <ArrowUpRight size={13} aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-[13px] font-medium text-ink-2" title={t.questionsOtherWorkbook}>
                      {p.title}
                    </span>
                  )}
                  <ul className="divide-y divide-line">
                    {p.items.map((q) => (
                      <QuestionRow key={q.id} item={q.anchor.kind === 'page' || q.anchor.kind === 'none' ? null : placeOf(q.anchor)} q={q} extra={<Quote q={q} />} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
        {loose.length ? (
          <section className="mt-8">
            <h2 className="mb-2 text-[15px] font-semibold">{t.questionsElsewhere}</h2>
            <ul className="divide-y divide-line">
              {loose.map((q) => (
                <QuestionRow key={q.id} item={null} q={q} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
