import { CodeBlock } from '@/components/Dialogs';
import { Legend } from '@/components/Legend';
import { withCode } from '@/components/withCode';
import { SectionedPage, type PageSection } from '@/components/SectionedPage';
import { useSettings } from '@/lib/api';
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

  const sections: PageSection[] = [
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

  return (
    <SectionedPage base="/help" title={t.help} intro={<p>{t.helpIntro}</p>} section={section} sections={sections}>
      <div className="mt-6">
        <Legend />
      </div>
    </SectionedPage>
  );
}
