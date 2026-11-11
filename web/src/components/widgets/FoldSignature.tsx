import { Check } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { asArgument, distractors, mix, planFold, type FoldPlan } from '@/lib/foldSignature';
import { useT, type Strings } from '@/lib/i18n';
import { clsx } from '../ui';
import { Code, Frame, Message, Reveal, StepBar, shake } from './index';
import { useDrag } from './useDrag';

type FoldStrings = Strings['widget']['fold'];
/** A message is worked out when it is shown, so it follows a change of language. */
type Say = (t: FoldStrings) => string;

/**
 * From a data declaration to the signature of its fold, in three steps the student does:
 * write the constructors' types, replace the declared type by `r`, assemble the signature.
 * Everything, including the wrong pieces offered, is worked out from the declaration.
 */
export function FoldSignature({ decl, fold, given }: { decl: string; fold?: string | undefined; given: boolean }) {
  const t = useT().widget;
  const plan = useMemo(() => planFold(decl, fold), [decl, fold]);
  if ('error' in plan) {
    return (
      <Frame>
        <Code>{decl}</Code>
        <p className="text-sm text-danger">{t.badDecl(plan.error)}</p>
      </Frame>
    );
  }
  return <Machine plan={plan} given={given} />;
}

interface Tile {
  id: number;
  text: string;
  used: boolean;
}

/** Code in a message. */
const q = (s: string) => `\`${s}\``;
export const kClass = (i: number) => `wb-k${(i % 4) + 1}`;
/** A field as it reads after its constructor's name: `Cons a (List a)`. */
export const atomic = (f: string) => (/\s/.test(f) && !/^[[(]/.test(f) ? `(${f})` : f);
const tilesOf = (texts: string[]): Tile[] => mix(texts).map((text, id) => ({ id, text, used: false }));

/** The declaration with one colour per constructor. */
export function Declaration({ plan }: { plan: FoldPlan }) {
  return (
    <div className="overflow-x-auto whitespace-pre rounded-lg border border-line bg-sunk px-3.5 py-[9px] font-mono text-[13.5px] leading-relaxed">
      <Code>{`data ${plan.self} =`}</Code>{' '}
      {plan.constructors.map((c, i) => (
        <span key={c.name}>
          {i ? <span className="text-ink-3"> | </span> : null}
          <span className={clsx(kClass(i), 'rounded px-1 font-medium')} style={{ background: 'var(--ks)', color: 'var(--k)' }}>
            {c.infix ? `${atomic(c.fields[0]!)} ${c.name.slice(1, -1)} ${atomic(c.fields[1]!)}` : [c.name, ...c.fields.map(atomic)].join(' ')}
          </span>
        </span>
      ))}
    </div>
  );
}

function Machine({ plan, given }: { plan: FoldPlan; given: boolean }) {
  const all = useT().widget;
  const t = all.fold;
  const cons = plan.constructors;
  const need = useMemo(() => cons.map((c) => [...c.fields.map(asArgument), plan.self]), [cons, plan.self]);
  const tokens = useMemo(
    () => cons.map((c) => [...c.fields.map((f, k) => ({ text: asArgument(f), folded: asArgument(c.folded[k]!), self: c.recursive[k]! })), { text: plan.self, folded: 'r', self: true }]),
    [cons, plan.self],
  );
  const extra = useMemo(() => distractors(plan), [plan]);

  const [step, setStep] = useState(0);
  const [built, setBuilt] = useState<boolean[][]>(() => need.map((n) => n.map(() => given)));
  const [buildPool, setBuildPool] = useState<Tile[]>(() => (given ? [] : tilesOf([...need.flat(), 'r'])));
  const [flipped, setFlipped] = useState<boolean[][]>(() => tokens.map((ts) => ts.map(() => false)));
  const [sigFilled, setSigFilled] = useState<boolean[]>(() => plan.signature.map(() => false));
  const [sigPool, setSigPool] = useState<Tile[]>(() => tilesOf([...plan.signature, ...extra]));
  const complete = [
    built.every((row) => row.every(Boolean)),
    tokens.every((ts, ci) => ts.every((x, k) => !x.self || flipped[ci]![k])),
    sigFilled.every(Boolean),
  ];
  /** A step can be visited once every step before it is done. */
  const reachable = (i: number) => complete.slice(0, i).every(Boolean);

  // Only a wrong try gets words; a right one gets a tick where it landed.
  const [hint, setHint] = useState<{ m: Say } | null>(null);
  const message = (m: Say) => setHint({ m });
  const [tick, setTick] = useState<{ key: string; n: number } | null>(null);
  const correct = (key: string | null) => {
    setHint(null);
    if (key) setTick((x) => ({ key, n: (x?.n ?? 0) + 1 }));
  };
  const ticked = (key: string) => (tick?.key === key ? <Tick key={tick.n} /> : null);

  const pool = step === 0 && !complete[0] ? buildPool : step === 2 && !complete[2] ? sigPool : null;
  const drag = useDrag((id, key, el) => {
    const [a, b] = key.split(':').map(Number) as [number, number];
    if (step === 0) place(id, a, b, el);
    else if (step === 2) fill(id, a, el);
  });
  const go = (i: number) => {
    if (i < 0 || i > 2 || !reachable(i)) return;
    drag.setSelected(null);
    setHint(null);
    setTick(null);
    setStep(i);
  };

  // ── step 1: the constructors' types
  const place = (id: number, ci: number, k: number, el: HTMLElement) => {
    const tile = buildPool.find((x) => x.id === id);
    if (!tile || built[ci]![k]) return;
    const c = cons[ci]!;
    const piece = tile.text;
    if (piece !== need[ci]![k]) {
      shake(el);
      const last = k === need[ci]!.length - 1;
      message(
        piece === 'r' ? (t) => t.wrongR
        : last ? (t) => t.wrongResult(q(c.name), q(plan.self))
        : need[ci]!.slice(0, -1).includes(piece) ? (t) => t.wrongOrder(q(piece), q(c.name))
        : piece === plan.self ? (t) => t.wrongSelf(q(plan.self), q(c.name))
        : (t) => t.notAField(q(piece), q(c.name)),
      );
      return;
    }
    setBuilt(built.map((row, i) => (i === ci ? row.map((v, j) => v || j === k) : row)));
    setBuildPool((p) => p.map((x) => (x.id === id ? { ...x, used: true } : x)));
    correct(`b${ci}:${k}`);
  };

  // ── step 2: the declared type becomes r
  const flip = (ci: number, k: number, el: HTMLElement) => {
    const tok = tokens[ci]![k]!;
    if (!tok.self) {
      shake(el);
      message((t) => t.keep(q(tok.text)));
      return;
    }
    if (flipped[ci]![k]) return;
    el.classList.add('wb-flip');
    setFlipped(flipped.map((row, i) => (i === ci ? row.map((v, j) => v || j === k) : row)));
    correct(`r${ci}:${k}`);
  };

  // ── step 3: the signature
  const fill = (id: number, i: number, el: HTMLElement) => {
    const tile = sigPool.find((x) => x.id === id);
    if (!tile || sigFilled[i]) return;
    const piece = tile.text;
    if (piece !== plan.signature[i]) {
      shake(el);
      message(
        piece === extra[0] && piece.startsWith('(r ->') ? (t) => t.reversed
        : extra.includes(piece) ? (t) => t.wrapped
        : i < cons.length ? (t) => t.wrongParam(q(cons[i]!.name))
        : i === cons.length ? (t) => t.wrongValue
        : (t) => t.wrongResultSlot,
      );
      return;
    }
    setSigFilled(sigFilled.map((v, j) => v || j === i));
    setSigPool((p) => p.map((x) => (x.id === id ? { ...x, used: true } : x)));
    // A parameter gets its arrow; that says enough.
    correct(i < cons.length ? null : `s${i}`);
  };

  /** Does the open step for the student. */
  const doForMe = () => {
    setHint(null);
    if (step === 0) setBuilt(need.map((n) => n.map(() => true)));
    if (step === 1) setFlipped(tokens.map((ts) => ts.map((x) => x.self)));
    if (step === 2) setSigFilled(plan.signature.map(() => true));
    drag.setSelected(null);
  };

  // ── arrows from each constructor to its parameter
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const slots = useRef<(HTMLButtonElement | null)[]>([]);
  const [arrows, setArrows] = useState<{ i: number; d: string; head: string }[]>([]);
  const [resized, setResized] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setResized((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (step !== 2) return setArrows([]);
    const b = el.getBoundingClientRect();
    const out: { i: number; d: string; head: string }[] = [];
    cons.forEach((_, i) => {
      const from = cards.current[i]?.getBoundingClientRect();
      const to = slots.current[i]?.getBoundingClientRect();
      if (!sigFilled[i] || !from || !to) return;
      const x1 = from.left + from.width / 2 - b.left;
      const y1 = from.bottom - b.top + 2;
      const x2 = to.left + to.width / 2 - b.left;
      const y2 = to.top - b.top - 7;
      if (y2 <= y1 + 8) return; // stacked on a narrow screen: the colours say enough
      const my = (y1 + y2) / 2;
      out.push({ i, d: `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`, head: `${x2},${y2 + 7} ${x2 - 5},${y2} ${x2 + 5},${y2}` });
    });
    setArrows(out);
  }, [sigFilled, resized, step, cons]);

  const done = complete[step]!;
  const instruction =
    step === 0
      ? given ? t.given(q(plan.self)) : done ? t.builtAll : t.build
      : step === 1
        ? done ? t.replacedAll : t.replace(q(plan.self))
        : done ? t.done : t.assemble;
  const forMe = done ? null : step === 0 ? t.buildForMe : step === 1 ? t.replaceForMe : t.assembleForMe;
  /** Gaps and types have the same height and at least the same width, so nothing moves when one becomes the other. */
  const box7 = 'relative inline-flex h-[30px] items-center rounded-[7px] whitespace-nowrap';
  const gap = clsx(box7, 'min-w-[58px] justify-center border border-dashed bg-sheet px-2 data-[hot]:border-solid data-[hot]:border-accent data-[hot]:bg-accent-soft');
  const active = drag.selected !== null || drag.dragging;

  return (
    <Frame>
      <StepBar
        at={step}
        count={3}
        label={t.steps[step]}
        labels={t.steps}
        onGo={go}
        canNext={done}
        extra={forMe ? <Reveal label={forMe} onClick={doForMe} /> : null}
      />

      <Declaration plan={plan} />

      <p className="text-[14px] leading-normal text-ink-2" aria-live="polite">
        <Message text={instruction} />
      </p>

      <div className="overflow-x-auto pb-1 pt-1">
        <div ref={box} className="relative flex min-w-0 flex-col">
          <div className="relative flex flex-wrap justify-center gap-2.5">
            {cons.map((c, ci) => (
              <div
                key={c.name}
                ref={(el) => {
                  cards.current[ci] = el;
                }}
                className={clsx(kClass(ci), 'inline-flex min-w-[150px] max-w-full flex-col gap-1.5 rounded-[10px] border px-3 pb-2.5 pt-2')}
                style={{ background: 'var(--ks)', borderColor: 'color-mix(in srgb, var(--k) 35%, transparent)' }}
              >
                <span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--k)' }}>
                  {c.name} ::
                </span>
                <span className="flex min-h-[30px] flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[13px]">
                  {step === 0
                    ? need[ci]!.map((n, k) => (
                        <Piece key={k} first={k === 0}>
                          {built[ci]![k] ? (
                            <span className={clsx(box7, 'min-w-[58px] justify-center border border-[color-mix(in_srgb,var(--k)_45%,transparent)] bg-sheet px-2')}>
                              <Code>{n}</Code>
                              {ticked(`b${ci}:${k}`)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`${c.name}: ${k === need[ci]!.length - 1 ? t.builds : t.field(k + 1)}`}
                              {...drag.target(`${ci}:${k}`)}
                              className={clsx(gap, active ? 'cursor-pointer border-accent bg-[color-mix(in_srgb,var(--accent-soft)_50%,var(--sheet))]' : 'border-[color-mix(in_srgb,var(--k)_50%,transparent)]')}
                            />
                          )}
                        </Piece>
                      ))
                    : tokens[ci]!.map((tok, k) => {
                        const isR = flipped[ci]![k];
                        return (
                          <Piece key={k} first={k === 0}>
                            <button
                              type="button"
                              disabled={step !== 1 || isR}
                              onClick={(e) => flip(ci, k, e.currentTarget)}
                              onAnimationEnd={(e) => e.currentTarget.classList.remove('wb-flip')}
                              className={clsx(
                                box7,
                                'justify-center px-1.5 transition-colors',
                                isR ? 'min-w-7 bg-accent font-semibold text-accent-ink' : 'bg-sheet/70',
                                step === 1 && !isR && 'hover:bg-sheet hover:ring-1 hover:ring-line-strong',
                              )}
                            >
                              {isR ? tok.folded : <Code>{tok.text}</Code>}
                              {step === 1 ? ticked(`r${ci}:${k}`) : null}
                            </button>
                          </Piece>
                        );
                      })}
                </span>
              </div>
            ))}
          </div>

          <div className={clsx('relative flex flex-wrap items-start justify-center gap-1.5 font-mono text-[14px]', step === 2 ? 'mt-12' : 'mt-[18px]')}>
            <span className="mr-1 font-semibold leading-[30px]">{plan.fold} ::</span>
            {plan.signature.map((sig, i) => {
              const k = i < cons.length ? kClass(i) : i === cons.length + 1 ? 'wb-kr' : null;
              const label = i < cons.length ? cons[i]!.name : i === cons.length ? t.value : t.result;
              const filled = step === 2 && sigFilled[i];
              return (
                <span key={i} className="flex items-start gap-1.5">
                  {i ? <span className="leading-[30px] text-ink-3">-&gt;</span> : null}
                  <span className="flex flex-col items-center gap-[3px]">
                    <button
                      type="button"
                      ref={(el) => {
                        slots.current[i] = el;
                      }}
                      aria-label={filled ? `${label}: ${sig}` : label}
                      disabled={step !== 2 || filled}
                      {...(step === 2 && !filled ? drag.target(`${i}:0`) : {})}
                      className={clsx(
                        'relative h-[30px] min-w-[58px] whitespace-nowrap rounded-[7px] border px-2 text-center text-[13px]',
                        filled ? clsx(k, 'border-solid text-ink') : 'border-dashed bg-sheet data-[hot]:border-solid data-[hot]:border-accent data-[hot]:bg-accent-soft',
                        !filled && (step === 2 && active ? 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_50%,var(--sheet))]' : 'border-line-strong'),
                        step !== 2 && 'opacity-60',
                      )}
                      style={filled ? { borderColor: k ? 'var(--k)' : 'var(--line-strong)', background: k ? 'var(--ks)' : 'var(--sunk)' } : undefined}
                    >
                      {filled ? <Code>{sig}</Code> : null}
                      {filled ? ticked(`s${i}`) : null}
                    </button>
                    <span className="font-sans text-[11.5px] text-ink-3">{label}</span>
                  </span>
                </span>
              );
            })}
          </div>

          <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible">
            {arrows.map((a) => (
              <g key={a.i} className={kClass(a.i)}>
                <path d={a.d} pathLength={1} className="wb-arrow" fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: 'var(--k)' }} />
                <polygon points={a.head} className="wb-arrow-head" style={{ fill: 'var(--k)' }} />
              </g>
            ))}
          </svg>
        </div>
      </div>

      {pool && pool.some((x) => !x.used) ? (
        <div role="group" aria-label={t.pieces} className="flex flex-wrap justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-stage p-2.5">
          {pool
            .filter((x) => !x.used)
            .map((x) => (
              <button
                key={x.id}
                type="button"
                {...drag.piece(x.id)}
                className={clsx(
                  'cursor-grab select-none rounded-[7px] border bg-sheet px-2.5 py-1 font-mono text-[13px] data-[dragging]:opacity-30',
                  drag.selected === x.id ? 'border-accent ring-3 ring-accent-soft' : 'border-line-strong hover:border-accent',
                )}
              >
                <Code>{x.text}</Code>
              </button>
            ))}
        </div>
      ) : null}
      {drag.layer}

      <p aria-live="polite" className={clsx('text-[14.5px] leading-normal text-ink-2', !hint && 'sr-only')}>
        {hint ? <Message text={hint.m(t)} /> : null}
      </p>
    </Frame>
  );
}

/** A tick that pops up in the corner of what was placed right, and floats away. */
function Tick() {
  return (
    <span aria-hidden className="wb-tick pointer-events-none absolute -right-2 -top-2.5 z-10 grid size-[18px] place-items-center rounded-full bg-done text-sheet shadow-sm">
      <Check size={11} strokeWidth={3.5} />
    </span>
  );
}

function Piece({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <>
      {first ? null : <span className="text-ink-2">-&gt;</span>}
      {children}
    </>
  );
}
