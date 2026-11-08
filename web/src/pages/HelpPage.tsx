import { useEffect } from 'react';
import { Link } from 'wouter';
import { CodeBlock } from '@/components/Dialogs';
import { Legend } from '@/components/Legend';
import { withCode } from '@/components/withCode';
import { clsx } from '@/components/ui';
import { useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';

/**
 * Everything worth knowing, on one page with a table of contents. Sections can be
 * linked to (`/help/flashcards`), e.g. "How to write good cards" from the flashcards.
 */
export function HelpPage({ section }: { section?: string }) {
  const t = useT();
  const settings = useSettings().data;
  const flashcards = !!settings?.showFlashcards;
  const ai = !!settings?.showAi;

  const sections: { id: string; title: string; body: React.ReactNode }[] = [
    { id: 'working', title: t.helpWorkingTitle, body: <p>{t.helpWorking}</p> },
    { id: 'interpreter', title: t.helpInterpreterTitle, body: <p>{t.helpInterpreter}</p> },
    { id: 'lessons', title: t.helpLessonsTitle, body: <p>{t.helpLessons}</p> },
    { id: 'review', title: t.helpReviewTitle, body: <p>{t.helpReview}</p> },
    { id: 'focus', title: t.helpFocusTitle, body: <p>{t.helpFocus}</p> },
    { id: 'timer', title: t.helpTimerTitle, body: <p>{t.helpTimer}</p> },
    ...(ai ? [{ id: 'ai', title: t.helpAiTitle, body: <p>{t.helpAi}</p> }] : []),
    {
      id: 'typst',
      title: t.helpTypstTitle,
      body: (
        <>
          <p>{t.helpTypst}</p>
          <dl className="mt-3 divide-y divide-line rounded-lg border border-line bg-sheet">
            {t.helpTypstRows.map(([what, how]) => (
              <div key={what} className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-ink-2">{what}</dt>
                <dd className="overflow-x-auto">
                  <pre className="font-mono text-[12.5px]">{how}</pre>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ),
    },
    ...(flashcards
      ? [
          {
            id: 'flashcards',
            title: t.flashcards,
            body: (
              <>
                <p>{t.helpFlashcards}</p>
                <h3 className="mt-5 font-semibold">{t.guideTitle}</h3>
                <ul className="mt-1 list-disc space-y-1.5 pl-5">
                  {t.guide.map((g) => (
                    <li key={g}>{withCode(g)}</li>
                  ))}
                </ul>
                <h3 className="mt-5 font-semibold">{t.syntaxTitle}</h3>
                <p className="mt-1">{t.syntaxBody}</p>
                <CodeBlock className="mt-2" language="typst" code={t.syntaxExample} />
                <h3 className="mt-5 font-semibold">{t.helpReviewingCardsTitle}</h3>
                <p className="mt-1">{t.helpReviewingCards}</p>
                <h3 className="mt-5 font-semibold">{t.cardsToLookAt}</h3>
                <p className="mt-1">{t.cardsToLookAtIntro}</p>
              </>
            ),
          },
        ]
      : []),
    {
      id: 'keys',
      title: t.helpKeysTitle,
      body: (
        <>
          <p>{t.helpKeysIntro}</p>
          {t.helpKeys.map(([where, keys]) => (
            <div key={where} className="mt-4">
              <h3 className="mb-1.5 font-semibold text-ink">{where}</h3>
              <dl className="divide-y divide-line rounded-lg border border-line bg-sheet">
                {keys.map(([key, what]) => (
                  <div key={key} className="grid items-baseline gap-x-4 gap-y-1 px-3 py-1.5 sm:grid-cols-[11rem_1fr]">
                    <dt>
                      <kbd className="rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-xs">{key}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </>
      ),
    },
    { id: 'data', title: t.helpDataTitle, body: <p>{t.helpData}</p> },
  ];

  useEffect(() => {
    if (section) requestAnimationFrame(() => document.getElementById(`help-${section}`)?.scrollIntoView({ block: 'start' }));
  }, [section]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl gap-10 px-6 pb-24 pt-6 sm:px-8">
        {/* Starts on the line of the heading next to it, below the way back. */}
        <nav aria-label={t.help} className="sticky top-12 mt-12 hidden w-48 shrink-0 self-start lg:block">
          <ul className="space-y-0.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <Link href={`/help/${s.id}`} replace className={clsx('block rounded-md px-2 py-1', section === s.id ? 'bg-sunk text-ink' : 'text-ink-2 hover:bg-sunk hover:text-ink')}>
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-2xl flex-1">
          {/* Where the other pages have it, and it stays in reach however far down the help goes. */}
          <div className="sticky top-0 z-10 -mx-2 mb-1 bg-paper px-2 py-2">
            <BackLink fallback="/" label={t.back}>
              {t.back}
            </BackLink>
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.help}</h1>
          <p className="mt-2 text-ink-2">{t.helpIntro}</p>
          <div className="mt-6">
            <Legend />
          </div>
          {sections.map((s) => (
            <section key={s.id} id={`help-${s.id}`} className="mt-10 scroll-mt-12 text-[14.5px] leading-relaxed text-ink-2">
              <h2 className="mb-2 text-lg font-semibold text-ink">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
