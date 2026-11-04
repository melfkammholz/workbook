import { ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** GHC's errors have codes, and the Haskell Error Index has a page for them. */
export function ExplainError({ code }: { code: string | null }) {
  const t = useT();
  if (!code || !/^GHC-\d+$/.test(code)) return null;
  return (
    <a href={`https://errors.haskell.org/messages/${code}/`} target="_blank" rel="noreferrer" title={t.explainErrorHint} className="mt-1 inline-flex items-center gap-1 font-sans text-xs font-medium text-accent hover:underline">
      {t.explainError} <ExternalLink size={11} />
    </a>
  );
}
