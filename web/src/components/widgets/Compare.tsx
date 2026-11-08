import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { Prose } from '../Prose';
import { clsx } from '../ui';
import { kClass } from './FoldSignature';
import { Choice, Frame, type Part } from './index';

/**
 * Marks `[[id|text]]` in code become the marks `Prose` already wraps for cloze gaps (U+E100 + n … U+E0FF),
 * so a mark survives highlighting even when it runs across several tokens.
 */
function marked(html: string, ids: string[]): string {
  return html.replace(/\[\[([\w-]+)\|([\s\S]*?)\]\]/g, (_all, id: string, text: string) => {
    const i = ids.indexOf(id);
    return i < 0 ? text : `${String.fromCharCode(0xe101 + i)}${text}\ue0ff`;
  });
}

/** Two pieces of code side by side: pick what to compare, and it lights up in both, with a line between. */
export function Compare({ parts, config }: { parts: Part[]; config: string }) {
  const t = useT().widget;
  const pairs = useMemo(() => (JSON.parse(config) as { pairs: Record<string, string> }).pairs ?? {}, [config]);
  const ids = Object.keys(pairs);
  const sides = parts.filter((p) => p.name === 'side').slice(0, 2);
  const notes = new Map(parts.filter((p) => p.name === 'note').map((p) => [p.attrs.id ?? '', p.html]));
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<{ d: string; head: string } | null>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // After the texts' own effects, which wrap the marks.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const gap = String(at + 1);
    const k = kClass(at);
    el.querySelectorAll<HTMLElement>('.wb-gap[data-gap]').forEach((span) => {
      const on = span.dataset.gap === gap;
      span.classList.remove('wb-k1', 'wb-k2', 'wb-k3', 'wb-k4');
      span.classList.toggle('wb-pair-on', on);
      if (on) span.classList.add(k);
    });
    // The line joins the first marked piece on the left with the first on the right.
    const [left, right] = [...el.querySelectorAll<HTMLElement>('[data-side]')].map((s) => s.querySelector<HTMLElement>(`.wb-gap[data-gap="${gap}"]`));
    if (!left || !right) return setLine(null);
    const b = el.getBoundingClientRect();
    const l = left.getBoundingClientRect();
    const r = right.getBoundingClientRect();
    // Between the two pieces of code only, at the height of each mark: the line never crosses code.
    const [lp, rp] = [left, right].map((x) => x.closest('pre')?.getBoundingClientRect() ?? x.getBoundingClientRect());
    const x1 = lp!.right - b.left + 2;
    const y1 = l.top + l.height / 2 - b.top;
    const x2 = rp!.left - b.left - 9;
    const y2 = r.top + r.height / 2 - b.top;
    if (x2 < x1 + 12) return setLine(null); // one above the other: the colours say enough
    const mx = (x1 + x2) / 2;
    setLine({ d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, head: `${x2 + 7},${y2} ${x2},${y2 - 5} ${x2},${y2 + 5}` });
  }, [at, tick]);

  return (
    <Frame>
      <Choice options={ids.map((id) => pairs[id]!)} at={at} onPick={setAt} label={t.compare} />
      <div ref={box} className="wb-compare relative grid gap-x-12 gap-y-3 sm:grid-cols-2">
        {sides.map((s, i) => (
          <div key={i} data-side={i} className="min-w-0">
            <Prose html={marked(s.html, ids)} />
          </div>
        ))}
        {line ? (
          <svg aria-hidden className={clsx(kClass(at), 'pointer-events-none absolute inset-0 z-10 size-full overflow-visible')}>
            <path key={at} d={line.d} pathLength={1} className="wb-arrow" fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: 'var(--k)' }} />
            <polygon key={`h${at}`} points={line.head} className="wb-arrow-head" style={{ fill: 'var(--k)' }} />
          </svg>
        ) : null}
      </div>
      {notes.get(ids[at] ?? '') ? <Prose key={at} html={notes.get(ids[at]!)!} className="settle text-[14.5px]" /> : null}
    </Frame>
  );
}
