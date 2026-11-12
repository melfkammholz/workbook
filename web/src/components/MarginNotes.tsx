import { isCustomColor, type Annotation } from '@wb/shared';
import { StickyNote } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { paintedRange, useAnnotations } from '@/lib/annotations';
import { useSettings } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { clsx } from './ui';

const WIDTH = 168;
/** A slip narrower than this is not worth it: then the highlight gets a small note icon instead. */
const MIN_WIDTH = 132;
const GAP = 16;
const ICON = 16;

type Found = Annotation & { found: boolean };
/** Slips in the free margin right of the page, or icons beside each passage's last line when there is no margin. */
/** Notes whose passages end at the same spot share one icon. */
type IconGroup = { key: string; ids: string[]; left: number; top: number; gutter: boolean };
type Place = { mode: 'slips'; left: number; width: number; tops: Map<string, number> } | { mode: 'icons'; groups: IconGroup[] };

/**
 * The student's comments on highlights. Where the page has free space to its right, they are slips there, each level
 * with its passage; they never cover the page and the page never shrinks for them. Without that space, the highlight
 * stays and a small icon beside it shows the comment on hover, focus or click.
 */
export function MarginNotes({ target, page }: { target: string; page: React.RefObject<HTMLElement | null> }) {
  const t = useT();
  const on = !!useSettings().data?.showAnnotations;
  const all = useAnnotations().data;
  const notes = useMemo(() => (on ? (all ?? []).filter((a) => a.target === target && a.comment.trim() && a.found !== false) : []), [all, on, target]);
  const [place, setPlace] = useState<Place | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const slips = useRef(new Map<string, HTMLElement>());

  // A passive effect on purpose: a layout effect runs before the parent <article> has its ref, and before `Prose` (an
  // earlier sibling) has painted the highlights in its own passive effect.
  useEffect(() => {
    const article = page.current;
    if (!article || !notes.length) {
      setPlace(null);
      return;
    }
    const scroller = article.closest<HTMLElement>('.overflow-y-auto, .overflow-auto') ?? article.parentElement!;
    const measure = () => {
      const a = article.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const ranges = notes
        .map((n) => ({ n, r: paintedRange(n.id) }))
        .filter((x): x is { n: Found; r: Range } => !!x.r && x.r.getBoundingClientRect().height > 0)
        // Top to bottom; passages that start on the same line in text order.
        .sort((x, y) => x.r.getBoundingClientRect().top - y.r.getBoundingClientRect().top || x.r.compareBoundaryPoints(Range.START_TO_START, y.r));
      // The free space between the page's right edge and the scroller's, less a gap on both sides.
      // Without the scrollbar's width, which a classic scrollbar takes from the right.
      const room = s.left + scroller.clientLeft + scroller.clientWidth - a.right - 2 * GAP;
      if (room >= MIN_WIDTH) {
        const tops = new Map<string, number>();
        let below = -Infinity;
        for (const { n, r } of ranges) {
          // One under the other where passages are close together.
          const top = Math.max(r.getBoundingClientRect().top - a.top - 4, below);
          tops.set(n.id, top);
          below = top + (slips.current.get(n.id)?.offsetHeight ?? 60) + 8;
        }
        setPlace({ mode: 'slips', left: a.width + GAP, width: Math.min(WIDTH, room), tops });
        return;
      }
      // In the page's left padding, level with the passage's last line, so the icon never covers text; at the
      // passage's end only when the padding is too narrow.
      const pad = parseFloat(getComputedStyle(article).paddingLeft) || 0;
      const groups = new Map<string, IconGroup>();
      const gutter = pad >= ICON + 6;
      for (const { n, r } of ranges) {
        const rects = [...r.getClientRects()].filter((x) => x.width > 0);
        const last = rects[rects.length - 1];
        if (!last) continue;
        const left = Math.round(gutter ? (pad - ICON) / 2 : last.right - a.left + 1);
        const top = Math.round(last.top - a.top + (last.height - ICON) / 2);
        const key = `${left}:${top}`;
        const g = groups.get(key);
        if (g) g.ids.push(n.id);
        else groups.set(key, { key, ids: [n.id], left, top, gutter });
      }
      setPlace({ mode: 'icons', groups: [...groups.values()] });
    };
    measure();
    // Again once the slips have their heights, and whenever the page changes size (widgets, fonts, the window).
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(article);
    ro.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [notes, page]);

  if (!place || !notes.length) return null;
  const colorOf = (n: Annotation) => (isCustomColor(n.color) ? n.color : `var(--ann-${n.color})`);
  const slipStyle = (n: Annotation) => ({ background: `color-mix(in srgb, ${colorOf(n)} 22%, var(--sheet))`, borderColor: `color-mix(in srgb, ${colorOf(n)} 55%, transparent)` });
  const slip = 'rounded-lg border px-[11px] py-2 text-[13px] leading-[1.45] text-ink-2 shadow-[0_2px_8px_rgb(60_50_30/0.08)] whitespace-pre-line [overflow-wrap:anywhere]';

  if (place.mode === 'slips') {
    return (
      <div aria-label={t.yourNotes} role="complementary">
        {notes.map((n) => {
          const top = place.tops.get(n.id);
          if (top === undefined) return null;
          return (
            <aside
              key={n.id}
              ref={(el) => {
                if (el) slips.current.set(n.id, el);
                else slips.current.delete(n.id);
              }}
              className={clsx('absolute z-[5]', slip)}
              style={{ left: place.left, top, width: place.width, ...slipStyle(n) }}
            >
              {n.comment}
            </aside>
          );
        })}
      </div>
    );
  }

  const byId = new Map(notes.map((n) => [n.id, n]));
  return (
    <div aria-label={t.yourNotes} role="complementary">
      {place.groups.map((g) => {
        const group = g.ids.map((id) => byId.get(id)).filter((n): n is Found => !!n);
        const first = group[0];
        if (!first) return null;
        const shown = open === g.key;
        return (
          <span key={g.key} className="absolute z-[6]" style={{ left: g.left, top: g.top }} onMouseEnter={() => setOpen(g.key)} onMouseLeave={() => setOpen((o) => (o === g.key ? null : o))}>
            <button
              type="button"
              aria-label={group.length > 1 ? t.yourNotesCount(group.length) : t.yourNote}
              aria-expanded={shown}
              // Focus has opened it already, so a click (or a tap, with no hover) only keeps it open.
              onClick={() => setOpen(g.key)}
              onFocus={() => setOpen(g.key)}
              onBlur={() => setOpen((o) => (o === g.key ? null : o))}
              className="grid size-4 place-items-center rounded-[4px] text-ink-3 hover:text-ink"
              style={{ background: `color-mix(in srgb, ${colorOf(first)} 45%, var(--sheet))` }}
            >
              <StickyNote size={11} aria-hidden />
            </button>
            {shown ? (
              <span className={clsx('absolute top-[22px]', g.gutter ? 'left-0' : 'right-0', 'flex w-[min(260px,70vw)] flex-col gap-1.5')}>
                {group.map((n) => (
                  <span key={n.id} role="note" className={clsx('block', slip)} style={{ ...slipStyle(n), background: `color-mix(in srgb, ${colorOf(n)} 14%, var(--sheet))` }}>
                    {n.comment}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
