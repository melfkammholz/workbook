import { useEffect, type ReactNode } from 'react';
import { Link } from 'wouter';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

export interface PageSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * A long page in sections with a table of contents beside it (help, settings). Each section can be linked to
 * (`/help/flashcards`, `/settings/editor`); the link scrolls to it.
 */
export function SectionedPage({
  base,
  title,
  intro,
  section,
  sections,
  children,
}: {
  /** The page's route, e.g. `/help`. */
  base: string;
  title: string;
  intro?: ReactNode;
  section?: string | undefined;
  sections: PageSection[];
  /** Between the intro and the first section. */
  children?: ReactNode;
}) {
  const t = useT();
  const prefix = base.replace(/^\//, '');

  useEffect(() => {
    if (section) requestAnimationFrame(() => document.getElementById(`${prefix}-${section}`)?.scrollIntoView({ block: 'start' }));
  }, [section, prefix]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl gap-10 px-6 pb-24 pt-6 sm:px-8">
        {/* Starts on the line of the heading next to it, below the way back. */}
        <nav aria-label={title} className="sticky top-12 mt-12 hidden w-48 shrink-0 self-start lg:block">
          <ul className="space-y-0.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <Link href={`${base}/${s.id}`} replace className={clsx('block rounded-md px-2 py-1', section === s.id ? 'bg-sunk text-ink' : 'text-ink-2 hover:bg-sunk hover:text-ink')}>
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-2xl flex-1">
          {/* Where the other pages have it, and it stays in reach however far down the page goes. */}
          <div className="sticky top-0 z-10 -mx-2 mb-1 bg-paper px-2 py-2">
            <BackLink fallback="/" label={t.back}>
              {t.back}
            </BackLink>
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{title}</h1>
          {intro ? <div className="mt-2 text-ink-2">{intro}</div> : null}
          {children}
          {sections.map((s) => (
            <section key={s.id} id={`${prefix}-${s.id}`} className="mt-10 scroll-mt-12 text-[14.5px] leading-relaxed text-ink-2">
              <h2 className="mb-2 text-lg font-semibold text-ink">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
