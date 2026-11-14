import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { entryAt, findCitations, textItems, type BibEntry } from '@wb/shared';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import { sure, WorkStateButtons } from '@/components/WorkBits';
import { cropOf, CROP_H, CROP_W, linksOf, resolveDest, type PageLink, type Target } from '@/lib/pdfLinks';

/** What a click on an internal link does; the viewer keeps the way back. */
export type FollowLink = (target: Target) => void;

export const HOVER_MS = 350;

/** The entries to link plain-text citations to (V6, a setting of the viewer); undefined when it is off or there are none. */
export const CitationContext = createContext<readonly BibEntry[] | undefined>(undefined);

/** The PDF's reference entries, so a link into them shows the paper's card (V6b); the card has the sorting buttons. */
export const BibliographyContext = createContext<{ entries: readonly BibEntry[] } | undefined>(undefined);

const CARD_W = 340;
const CARD_H = 190;

/** What a link into the bibliography shows: the paper's data, kept open while the pointer is on it; the crop is one click away. */
function CitationCard({ doc, target, entry, at, onEnter, onLeave }: { doc: PDFDocumentProxy; target: Target; entry: BibEntry; at: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const t = useT();
  const w = entry.work;
  const card = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<DOMRect | null>(null);
  const below = at.bottom + CARD_H + 16 < window.innerHeight || at.top < CARD_H + 16;
  const left = Math.max(8, Math.min(at.left, window.innerWidth - CARD_W - 12));
  const meta = [w.authors, w.year].filter(Boolean).join(' · ');
  return (
    <>
      {createPortal(
        <div
          ref={card}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className="fixed z-50 rounded-lg border border-line-strong bg-sheet p-3 text-[13px] shadow-lg"
          style={{ left, width: CARD_W, ...(below ? { top: at.bottom + 2 } : { bottom: window.innerHeight - at.top + 2 }) }}
        >
          <p className={sure(w) ? 'break-words font-medium' : 'break-words'}>{sure(w) ? w.title : w.raw || entry.text}</p>
          {sure(w) && meta ? <p className="mt-0.5 break-words text-[12px] text-ink-2">{meta}</p> : null}
          {sure(w) && w.venue ? <p className="break-words text-[12px] text-ink-2">{w.venue}</p> : null}
          {w.doi ? <p className="break-all text-[12px] text-ink-3">DOI {w.doi}</p> : null}
          <p className="mt-1 text-[12px] text-ink-2">{w.resource ? t.workHave.replace(/:$/, '') : t.pdfCardMissing}</p>
          <div className="mt-2 flex items-center gap-2">
            <WorkStateButtons work={w} labels />
            <button type="button" onClick={() => setCrop(card.current?.getBoundingClientRect() ?? null)} className="text-ink-2 hover:text-ink hover:underline">
              {t.pdfCardShowText}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {crop ? <Peek doc={doc} target={target} at={crop} /> : null}
    </>
  );
}

const overlaps = (a: PageLink, b: PageLink) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A picture of the target, shown by the link, drawn once per target. */
export function Peek({ doc, target, at }: { doc: PDFDocumentProxy; target: Target; at: DOMRect }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void cropOf(doc, target).then((c) => {
      if (!live || !c || !host.current) return;
      host.current.replaceChildren(c);
      setReady(true);
    });
    return () => {
      live = false;
      host.current?.replaceChildren();
    };
  }, [doc, target]);
  const below = at.bottom + CROP_H + 16 < window.innerHeight || at.top < CROP_H + 16;
  const left = Math.max(8, Math.min(at.left, window.innerWidth - CROP_W - 12));
  return createPortal(
    <div
      ref={host}
      aria-hidden
      className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-line-strong bg-white shadow-lg"
      style={{ left, top: below ? at.bottom + 6 : at.top - CROP_H - 6, width: CROP_W, height: CROP_H, visibility: ready ? 'visible' : 'hidden' }}
    />,
    document.body,
  );
}

const targetOf = (doc: PDFDocumentProxy, l: PageLink): Promise<Target | null> => (l.target ? Promise.resolve(l.target) : resolveDest(doc, l.dest));

/** The links of one page, laid over it: they lead to places in the PDF or to addresses. */
export function PdfLinkLayer({ doc, page, follow }: { doc: PDFDocumentProxy; page: PDFPageProxy; follow: FollowLink }) {
  const label = useT().pdfLinkGo;
  const entries = useContext(CitationContext);
  const bib = useContext(BibliographyContext);
  const [list, setList] = useState<PageLink[]>([]);
  const [peek, setPeek] = useState<{ target: Target; at: DOMRect; entry?: BibEntry } | null>(null);
  const timer = useRef(0);
  const hovered = useRef<PageLink | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const real = await linksOf(page);
      if (!live) return;
      setList(real);
      if (!entries?.length) return;
      const content = await page.getTextContent().catch(() => null);
      if (!live || !content) return;
      const first = entries[0]!;
      const here = page.pageNumber - 1;
      // Not in the references themselves, and not where the PDF links already.
      if (here > first.pageIndex) return;
      const cites = findCitations(textItems(content.items, page.getViewport({ scale: 1 })), entries)
        .filter((c) => here < first.pageIndex || c.y < first.y - 0.01)
        .map((c): PageLink => ({ x: c.x, y: c.y, w: c.w, h: c.h, target: { page: entries[c.entry]!.pageIndex + 1, y: entries[c.entry]!.y } }))
        .filter((c) => !real.some((r) => overlaps(c, r)));
      if (cites.length) setList([...real, ...cites]);
    })();
    return () => {
      live = false;
    };
  }, [page, entries]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = (l: PageLink, el: HTMLElement) => {
    if (!l.dest && !l.target) return;
    hovered.current = l;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void targetOf(doc, l).then((target) => {
        if (!target || hovered.current !== l) return;
        const i = bib?.entries.length ? entryAt(bib.entries, target.page - 1, target.y) : -1;
        setPeek({ target, at: el.getBoundingClientRect(), ...(i >= 0 ? { entry: bib!.entries[i]! } : {}) });
      });
    }, HOVER_MS);
  };
  const leave = () => {
    hovered.current = null;
    clearTimeout(timer.current);
    setPeek(null);
  };
  // Leaving a link towards its card must not close it: closing waits a moment, and the card cancels it.
  const leaveSoon = () => {
    clearTimeout(timer.current);
    hovered.current = null;
    timer.current = window.setTimeout(() => setPeek(null), 200);
  };
  const go = (l: PageLink) => {
    leave();
    void targetOf(doc, l).then((t) => t && follow(t));
  };

  if (!list.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {list.map((l, i) => {
        const style = { left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` };
        const cls = 'pointer-events-auto absolute cursor-pointer rounded-sm hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
        return l.url ? (
          <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" aria-label={l.url} className={cls} style={style} />
        ) : (
          <a
            key={i}
            role="link"
            tabIndex={0}
            aria-label={label}
            className={cls}
            style={style}
            onMouseEnter={(e) => enter(l, e.currentTarget)}
            onMouseLeave={leaveSoon}
            onClick={() => go(l)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(l);
            }}
          />
        );
      })}
      {peek?.entry && bib ? (
        <CitationCard
          doc={doc}
          target={peek.target}
          entry={peek.entry}
          at={peek.at}
          onEnter={() => clearTimeout(timer.current)}
          onLeave={leaveSoon}
        />
      ) : peek ? (
        <Peek doc={doc} target={peek.target} at={peek.at} />
      ) : null}
    </div>
  );
}
