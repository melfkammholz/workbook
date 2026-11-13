import type { BibEntry } from '@wb/shared';
import { Bookmark, Merge, Pencil, RefreshCw, Split } from 'lucide-react';
import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { Fix } from '@/lib/bibliography';
import { FoldSection } from './FoldSection';
import { IconButton, clsx } from './ui';

/**
 * The references of the PDF as it lists them. A click goes to the entry; the pages that cite it are chips; "want to
 * read" is a wish (never counted); a wrongly split entry is fixed in place (new text, join with the one above, split).
 */
export function PdfReferences({
  entries,
  current,
  labelOf,
  onGo,
  onWant,
  onFix,
  onReread,
}: {
  entries: BibEntry[];
  current: number;
  labelOf: (n: number) => string;
  onGo: (page: number) => void;
  onWant: (e: BibEntry, want: boolean) => void;
  onFix: (index: number, fix: Fix) => void;
  onReread: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <FoldSection
      id="pdf-references"
      defaultOpen
      title={`${t.pdfReferences} · ${t.pdfRefCount(entries.length)}`}
      className="mt-4"
      actions={
        <IconButton label={t.pdfRefReread} onClick={onReread} className="size-7">
          <RefreshCw size={14} />
        </IconButton>
      }
    >
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={e.id} data-here={e.pageIndex + 1 === current} className="[content-visibility:auto] [contain-intrinsic-size:auto_3.5rem]">
            {editing === e.id ? (
              <EntryEditor
                entry={e}
                first={i === 0}
                onDone={() => setEditing(null)}
                onFix={(fix) => {
                  onFix(i, fix);
                  setEditing(null);
                }}
              />
            ) : (
              <div className="group/r rounded-md px-1.5 py-1 hover:bg-sunk">
                <div className="flex items-start gap-1">
                  <button type="button" data-tip={t.pdfRefGo(labelOf(e.pageIndex + 1))} onClick={() => onGo(e.pageIndex + 1)} className="min-w-0 flex-1 text-left">
                    <span className="block break-words font-medium">{e.work.title || e.text}</span>
                    {e.work.title ? (
                      <span className="block break-words text-[12px] text-ink-2">
                        {[e.work.authors, e.work.year].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </button>
                  <IconButton label={e.work.wantToRead ? t.pdfRefWantOn : t.pdfRefWant} aria-pressed={e.work.wantToRead} onClick={() => onWant(e, !e.work.wantToRead)} className={clsx('size-6', e.work.wantToRead && 'text-accent')}>
                    <Bookmark size={13} fill={e.work.wantToRead ? 'currentColor' : 'none'} />
                  </IconButton>
                  <IconButton label={t.pdfRefEdit} onClick={() => setEditing(e.id)} className="size-6 opacity-0 focus-visible:opacity-100 group-hover/r:opacity-100">
                    <Pencil size={13} />
                  </IconButton>
                </div>
                <Cited entry={e} labelOf={labelOf} onGo={onGo} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </FoldSection>
  );
}

function Cited({ entry, labelOf, onGo }: { entry: BibEntry; labelOf: (n: number) => string; onGo: (page: number) => void }) {
  const t = useT();
  const pages = [...new Set(entry.citedAt.map((c) => c.pageIndex))].sort((a, b) => a - b);
  if (pages.length === 0) return <p className="mt-0.5 text-[12px] text-ink-3">{t.pdfRefNotCited}</p>;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
      <span>{t.pdfRefCited}</span>
      {pages.map((p) => (
        <button key={p} type="button" data-tip={t.pdfRefCitedGo(labelOf(p + 1))} onClick={() => onGo(p + 1)} className="rounded border border-line px-1.5 tabular-nums text-ink-2 hover:bg-sunk">
          {labelOf(p + 1)}
        </button>
      ))}
    </p>
  );
}

function EntryEditor({ entry, first, onDone, onFix }: { entry: BibEntry; first: boolean; onDone: () => void; onFix: (fix: Fix) => void }) {
  const t = useT();
  const [text, setText] = useState(entry.text);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="rounded-md border border-line p-1.5">
      <textarea
        ref={area}
        autoFocus
        aria-label={t.pdfRefText}
        value={text}
        rows={5}
        onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') onDone();
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) onFix({ kind: 'text', text });
        }}
        className="wb-field w-full resize-y p-1.5 text-[13px]"
      />
      <div className="mt-1 flex items-center gap-1">
        <button type="button" onClick={() => onFix({ kind: 'text', text })} disabled={!text.trim() || text === entry.text} className="rounded-md border border-line px-2 py-0.5 text-[13px] hover:bg-sunk disabled:opacity-50">
          {t.save}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-[13px] text-ink-2 hover:bg-sunk">
          {t.cancel}
        </button>
        <span className="flex-1" />
        <IconButton label={t.pdfRefJoin} disabled={first} onClick={() => onFix({ kind: 'join' })} className="size-6">
          <Merge size={13} />
        </IconButton>
        <IconButton
          label={t.pdfRefSplit}
          onClick={() => {
            const at = area.current?.selectionStart ?? 0;
            // Split what is typed so far: first save the text as shown if it changed, the split is on the stored text.
            if (text === entry.text) onFix({ kind: 'split', at });
          }}
          disabled={text !== entry.text}
          className="size-6"
        >
          <Split size={13} />
        </IconButton>
      </div>
    </div>
  );
}
