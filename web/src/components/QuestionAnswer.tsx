import { useQuery } from '@tanstack/react-query';
import { Highlighter, Layers, MessageSquareText, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { targetHref, type Question, type QuestionLink } from '@wb/shared';
import { previewNote, updateQuestion } from '@/lib/api';
import { useAnnotations } from '@/lib/annotations';
import { useT } from '@/lib/i18n';
import { useAllPdfAnnotations } from '@/lib/pdfAnnotations';
import { useAllPdfPages } from '@/lib/pdfPages';
import { useDebouncedCallback } from '@/lib/useDebounced';
import { Prose } from './Prose';
import { TypstEditor } from './TypstEditor';
import { Button, IconButton, clsx } from './ui';

/** The answer button of a row: always there when there is an answer, among the hover actions otherwise. */
export function AnswerToggle({ q, open, onToggle, size = 'sm' }: { q: Question; open: boolean; onToggle: () => void; size?: 'sm' | 'md' }) {
  const t = useT();
  const has = !!q.answer;
  return (
    <span className={clsx('flex transition-opacity', !has && !open && 'opacity-0 focus-within:opacity-100 group-hover:opacity-100')}>
      <IconButton label={open ? t.questionAnswerHide : has ? t.questionAnswerShow : t.questionAnswerWrite} className={size === 'sm' ? 'size-5' : 'size-6'} onClick={onToggle}>
        <MessageSquareText size={size === 'sm' ? 12 : 13} className={clsx(has && 'text-accent')} aria-pressed={open} />
      </IconButton>
    </span>
  );
}

/** The rendered text of an answer; rendered once per text and kept. */
export function RenderedAnswer({ source }: { source: string }) {
  const r = useQuery({ queryKey: ['answer-preview', source], queryFn: () => previewNote(source), staleTime: Infinity, gcTime: 600_000 });
  if (!r.data) return <p className="text-[13px] text-ink-3">…</p>;
  return <Prose html={r.data.html} css={r.data.css} className="prose-note text-[14px]" />;
}

/** The Typst editor an answer is written in; the row's panel and an assistant's proposed answer share it. */
export function AnswerEditor({ value, onChange, status = '', height = 'h-60' }: { value: string; onChange: (v: string) => void; status?: string; height?: string }) {
  const t = useT();
  return (
    <div className={clsx(height, 'overflow-hidden rounded-md border border-line')}>
      <TypstEditor compact="switch" variant="notes" value={value} onChange={onChange} label={t.questionAnswer} placeholder={t.questionAnswerPlaceholder} status={status} />
    </div>
  );
}

/** Under a row: the answer with who wrote it, and a Typst editor for the student's own text (saved as they type). */
export function AnswerPanel({ item, q }: { item: string | null; q: Question }) {
  const t = useT();
  const [editing, setEditing] = useState(!q.answer);
  const [text, setText] = useState(q.answer ?? '');
  const [saved, setSaved] = useState(false);
  const persist = useDebouncedCallback((v: string) => {
    void updateQuestion(item, q.id, { answer: v }).then(() => setSaved(true));
  }, 600);
  if (editing)
    return (
      <div className="mt-1 mb-1.5">
        <AnswerEditor
          value={text}
          onChange={(v) => {
            setText(v);
            setSaved(false);
            persist.call(v);
          }}
          status={saved ? t.saved : ''}
        />
        {q.answer ? (
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => { persist.flush(); setEditing(false); }}>
            {t.close}
          </Button>
        ) : null}
      </div>
    );
  return (
    <div className="mt-1 mb-1.5 rounded-md bg-sunk/60 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[12px] text-ink-3">
        <span>{q.answerBy === 'assistant' ? t.assistantMark : t.answerByYou}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setEditing(true)} className="hover:text-ink">
          {t.editQuestion}
        </button>
      </div>
      <RenderedAnswer source={q.answer ?? ''} />
    </div>
  );
}

/** Small icons for what was made from a question; each opens its target. No counts. */
export function OutcomeIcons({ links }: { links: QuestionLink[] }) {
  const t = useT();
  const pages = useAllPdfPages().data;
  const texts = useAnnotations().data;
  const pdfs = useAllPdfAnnotations().data;
  return (
    <>
      {links.map((l) => {
        let href: string | null = null;
        let label: string = t.outcomeCard;
        let icon = <Layers size={12} />;
        if (l.kind === 'card') href = `/flashcards/deck/${encodeURIComponent(l.deck ?? '')}/card/${encodeURIComponent(l.ref)}`;
        else if (l.kind === 'note') {
          label = t.outcomeNote;
          icon = <StickyNote size={12} />;
          const p = pages?.find((x) => x.id === l.ref);
          if (p) href = `/resources/${encodeURIComponent(p.resource)}/page:${p.pageIndex + 1}`;
        } else {
          label = t.outcomeHighlight;
          icon = <Highlighter size={12} />;
          const a = texts?.find((x) => x.id === l.ref);
          const p = pdfs?.find((x) => x.id === l.ref);
          if (a) href = targetHref(a.target);
          else if (p) href = `/resources/${encodeURIComponent(p.resource)}/${encodeURIComponent(p.id)}`;
        }
        const cls = 'inline-flex size-5 items-center justify-center rounded text-ink-3 hover:bg-sunk hover:text-accent';
        return href ? (
          <Link key={`${l.kind}:${l.ref}`} href={href} title={label} aria-label={label} className={cls}>
            {icon}
          </Link>
        ) : (
          <span key={`${l.kind}:${l.ref}`} title={label} className={cls}>
            {icon}
          </span>
        );
      })}
    </>
  );
}
