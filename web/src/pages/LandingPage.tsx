import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'wouter';
import { CourseText } from '@/components/CourseText';
import { Empty } from '@/components/ui';
import { keys, markLandingSeen, useOutline } from '@/lib/api';
import { READING_COLUMN } from '@/components/TaskColumn';
import { useT } from '@/lib/i18n';

/** How the author introduces the course. It opens once by itself; the home page stays the place to start from. */
export function LandingPage() {
  const t = useT();
  const qc = useQueryClient();
  const outline = useOutline().data;
  const hasLanding = !!outline?.landing;

  useEffect(() => {
    if (hasLanding) void markLandingSeen().then(() => qc.invalidateQueries({ queryKey: keys.state }));
  }, [hasLanding, qc]);

  if (!outline) return null;
  if (!hasLanding) {
    return (
      <div className="grid h-full place-items-center">
        <Empty title={t.pageNotFound}>{t.pageNotFoundBody}</Empty>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <article className={`settle pb-24 pt-10 ${READING_COLUMN}`}>
        <h1 className="mb-6 text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em]">{outline.title}</h1>
        <CourseText url="/api/landing" target="landing" />
        <Link href="/" className="mt-10 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-ink hover:brightness-110">
          {t.landingContinue} <ArrowRight size={16} />
        </Link>
      </article>
    </div>
  );
}
