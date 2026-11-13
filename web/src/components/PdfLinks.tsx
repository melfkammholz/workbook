import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import { cropOf, CROP_H, CROP_W, linksOf, resolveDest, type PageLink, type Target } from '@/lib/pdfLinks';

/** What a click on an internal link does; the viewer keeps the way back. */
export type FollowLink = (target: Target) => void;

const HOVER_MS = 350;

/** A picture of the target, shown by the link, drawn once per target. */
function Peek({ doc, target, at }: { doc: PDFDocumentProxy; target: Target; at: DOMRect }) {
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

/** The links of one page, laid over it: they lead to places in the PDF or to addresses. */
export function PdfLinkLayer({ doc, page, follow }: { doc: PDFDocumentProxy; page: PDFPageProxy; follow: FollowLink }) {
  const label = useT().pdfLinkGo;
  const [list, setList] = useState<PageLink[]>([]);
  const [peek, setPeek] = useState<{ target: Target; at: DOMRect } | null>(null);
  const timer = useRef(0);
  const hovered = useRef<PageLink | null>(null);

  useEffect(() => {
    let live = true;
    void linksOf(page).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [page]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = (l: PageLink, el: HTMLElement) => {
    if (!l.dest) return;
    hovered.current = l;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void resolveDest(doc, l.dest).then((target) => {
        if (target && hovered.current === l) setPeek({ target, at: el.getBoundingClientRect() });
      });
    }, HOVER_MS);
  };
  const leave = () => {
    hovered.current = null;
    clearTimeout(timer.current);
    setPeek(null);
  };
  const go = (l: PageLink) => {
    leave();
    void resolveDest(doc, l.dest).then((t) => t && follow(t));
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
            onMouseLeave={leave}
            onClick={() => go(l)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(l);
            }}
          />
        );
      })}
      {peek ? <Peek doc={doc} target={peek.target} at={peek.at} /> : null}
    </div>
  );
}
