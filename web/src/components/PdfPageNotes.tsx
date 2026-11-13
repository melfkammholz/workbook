import type { PdfPageItem } from "@wb/shared";
import { TagPicker } from "./TagPicker";
import { Check, Layers, Plus, RotateCcw, X } from "lucide-react";
import { useRef, useState } from "react";
import { useSaveSettings, useSettings } from "@/lib/api";
import { FoldSection } from "./FoldSection";
import { useT } from "@/lib/i18n";
import { pageHasContent, useAllPdfPages, type PagePatch } from "@/lib/pdfPages";
import { useDebouncedCallback } from "@/lib/useDebounced";
import { IconAction } from "./AnnotationLayer";
import { CopyTextButton } from "./PdfHighlights";
import { TypstEditor } from "./TypstEditor";
import { clsx } from "./ui";

/**
 * What the student keeps on the page or slide in view: come back to it, their own marks, a note in Typst, a reference
 * to copy and a card. The item is made with the first change, so a page nobody touched costs nothing. Keyed by page by its owner.
 */
export function PdfPageNotes({
  heading,
  item,
  save,
  copyRef,
  onCard,
}: {
  heading: string;
  item: PdfPageItem | undefined;
  save: (patch: PagePatch) => void;
  copyRef: () => Promise<string>;
  onCard?: (() => void) | undefined;
}) {
  const t = useT();
  const review = item?.review ?? null;
  return (
    <FoldSection
      id="pdf-page"
      title={heading}
      defaultOpen
      actions={
        <>
          {review === "open" ? (
            <IconAction
              pressed
              onClick={() => save({ review: "resolved" })}
              label={`${t.annMarked}: ${t.annClearUp}`}
            >
              <RotateCcw size={15} />
            </IconAction>
          ) : review === "resolved" ? (
            <IconAction
              onClick={() => save({ review: "open" })}
              label={`${t.annIsClearedUp}: ${t.annReopen}`}
            >
              <Check size={15} className="text-done" />
            </IconAction>
          ) : (
            <IconAction
              onClick={() => save({ review: "open" })}
              label={t.annComeBack}
            >
              <RotateCcw size={15} />
            </IconAction>
          )}
          <CopyTextButton text={copyRef} />
          {onCard ? (
            <IconAction onClick={onCard} label={t.annMakeCard}>
              <Layers size={15} />
            </IconAction>
          ) : null}
        </>
      }
    >
      {review === "open" ? (
        <p className="mt-0.5 text-[12px] font-medium text-review">
          {t.annMarked}
        </p>
      ) : null}
      <PageMarks
        active={item?.marks ?? []}
        onChange={(marks) => save({ marks })}
      />
      <PageNote initial={item?.note ?? ""} onSave={(note) => save({ note })} />
    </FoldSection>
  );
}

/** The student's own tags on this page, found while typing; a new one is made by typing it. */
function PageMarks({ active, onChange }: { active: string[]; onChange: (marks: string[]) => void }) {
  const t = useT();
  return (
    <>
      <p className="mt-1 text-[12px] text-ink-3">{t.pdfMarksCaption}</p>
      <div className="mt-2" role="group" aria-label={t.pdfMarks}>
        <TagPicker size="sm" value={active} onChange={onChange} />
      </div>
    </>
  );
}

/** The note, saved as it is typed. Made anew for every page, so what is typed always goes to the page it was typed on. */
function PageNote({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (note: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const persist = useDebouncedCallback((v: string) => {
    onSave(v);
    setSaved(true);
  }, 600);
  return (
    <div className="mt-2 h-[28rem] overflow-hidden rounded-md border border-line">
      <TypstEditor
        compact="switch"
        variant="notes"
        value={text}
        onChange={(v) => {
          setText(v);
          setSaved(false);
          persist.call(v);
        }}
        label={t.pdfPageNote}
        placeholder={t.pdfPageNotePlaceholder}
        status={saved ? t.saved : ""}
      />
    </div>
  );
}

/** The pages that have something on them, in page order: a way back to them. Can be narrowed to one mark. */
export function PagesWithNotes({
  items,
  marks,
  current,
  labelOf,
  onGo,
  chapterAt,
}: {
  items: PdfPageItem[];
  marks: { id: string; name: string }[];
  current: number;
  labelOf: (n: number) => string;
  onGo: (page: number) => void;
  /** The title of the chapter a page (1-based) is in, if the file has contents. */
  chapterAt?: ((page: number) => string | null) | undefined;
}) {
  const t = useT();
  const [filter, setFilter] = useState<string | null>(null);
  const withContent = items.filter(pageHasContent);
  if (!withContent.length) return null;
  const name = new Map(marks.map((m) => [m.id, m.name]));
  const used = marks.filter((m) =>
    withContent.some((p) => p.marks.includes(m.id)),
  );
  const active = filter && used.some((m) => m.id === filter) ? filter : null;
  const shown = active
    ? withContent.filter((p) => p.marks.includes(active))
    : withContent;
  return (
    <FoldSection
      id="pdf-pages-with-notes"
      title={t.pdfPagesWithNotes}
      className="mt-5"
      defaultOpen
    >
      {used.length ? (
        <div
          className="mb-1.5 flex flex-wrap gap-1"
          role="group"
          aria-label={t.pdfMarks}
        >
          {[{ id: null, name: t.pdfMarkFilterAll }, ...used].map((m) => (
            <button
              key={m.id ?? "all"}
              type="button"
              aria-pressed={active === m.id}
              onClick={() => setFilter(m.id)}
              className={clsx(
                "rounded-full border px-2 py-0.5 text-[12px]",
                active === m.id
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-line text-ink-3 hover:bg-sunk",
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {shown.map((p, i) => {
          const n = p.pageIndex + 1;
          const ch = chapterAt?.(n) ?? null;
          const heading = ch && ch !== (i > 0 ? (chapterAt?.(shown[i - 1]!.pageIndex + 1) ?? null) : null);
          const first = p.note.trim().split("\n")[0] ?? "";
          const tags = p.marks.map((id) => name.get(id)).filter(Boolean);
          return (
            <li key={p.id}>
              {heading ? <h4 className="mb-0.5 mt-1.5 truncate px-1.5 text-[12px] font-semibold text-ink-2">{ch}</h4> : null}
              <button
                type="button"
                onClick={() => onGo(n)}
                aria-current={n === current}
                className="flex w-full min-w-0 flex-col rounded-md px-1.5 py-1 text-left hover:bg-sunk aria-[current=true]:bg-sunk"
              >
                <span
                  className={clsx(
                    "text-[12px] font-medium",
                    n === current ? "text-accent" : "text-ink-3",
                  )}
                >
                  {t.pdfPageN(n)}
                  {labelOf(n) !== String(n) ? ` (${labelOf(n)})` : ""}
                  {p.review === "open" ? (
                    <span className="ml-2 text-review">{t.annMarked}</span>
                  ) : null}
                </span>
                {tags.length ? (
                  <span className="text-[12.5px] text-ink-2">
                    {tags.join(" · ")}
                  </span>
                ) : null}
                {first ? (
                  <span className="line-clamp-2 break-words text-[13px] text-ink-2">
                    {first}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </FoldSection>
  );
}
