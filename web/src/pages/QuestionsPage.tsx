import { ChevronDown, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { QUESTION_KINDS, RESOURCE_TYPES, type Question, type QuestionKind, type ResourceType } from '@wb/shared';
import { QuestionRow } from '@/components/Questions';
import { Empty, Spinner } from '@/components/ui';
import { useTags } from '@/lib/tags';
import { useCourses, useOutline, useQuestions, useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';


const placeOf = (a: Exclude<Question['anchor'], { kind: 'page' | 'none' | 'material' }>) => (a.kind === 'text' ? a.target : a.id);

interface Entry {
  q: Question;
  /** `m:<resource id>`, `c:<course id>` or '' for questions tied to nothing. */
  gKey: string;
  gTitle: string;
  mtype: ResourceType | null;
  pKey: string;
  pTitle: string;
  pHref: string | null;
  pOrder: number;
}

interface Filters {
  text: string;
  where: string;
  kind: string;
  age: string;
  labels: string[];
}

const NO_FILTERS: Filters = { text: '', where: '', kind: '', age: '', labels: [] };
const DAY = 86_400_000;

const readUrl = (): Filters => {
  const p = new URLSearchParams(location.search);
  return { text: p.get('q') ?? '', where: p.get('in') ?? '', kind: p.get('type') ?? '', age: p.get('age') ?? '', labels: (p.get('labels') ?? '').split(',').filter(Boolean) };
};

const writeUrl = (f: Filters) => {
  const p = new URLSearchParams();
  if (f.text) p.set('q', f.text);
  if (f.where) p.set('in', f.where);
  if (f.kind) p.set('type', f.kind);
  if (f.age) p.set('age', f.age);
  if (f.labels.length) p.set('labels', f.labels.join(','));
  const search = p.toString() ? `?${p}` : '';
  if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
};

const selectClass = (on: boolean) => clsx('h-[30px] rounded-lg border px-2 text-[13.5px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-sheet text-ink-2');

/** All the questions, open ones first: by material and page, then by workbook and item in reading order. Filters live in the address. */
export function QuestionsPage() {
  const t = useT();
  const all = useQuestions().data;
  const outline = useOutline().data;
  const courses = useCourses().data;
  const resources = useResources(null).data?.resources;
  const labelDefs = useTags().data;
  const [showDone, setShowDone] = useState(false);
  const [f, setF] = useState<Filters>(readUrl);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => {
    writeUrl(f);
  }, [f]);
  useEffect(
    () => () => {
      if (location.search) history.replaceState(history.state, '', `${location.pathname}${location.hash}`);
    },
    [],
  );

  const entries = useMemo(() => {
    const order = new Map<string, number>();
    outline?.chapters.forEach((c, ci) => {
      order.set(`chapter/${c.id}`, ci * 1000);
      c.items.forEach((i, n) => order.set(i.id, ci * 1000 + n + 1));
    });
    const titleOf = (id: string) => outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id)?.title ?? outline?.chapters.find((c) => `chapter/${c.id}` === id)?.title ?? id;
    const out: Entry[] = [];
    for (const q of all ?? []) {
      if (q.unplaced) continue;
      const a = q.anchor;
      if (a.kind === 'none') out.push({ q, gKey: '', gTitle: t.questionsElsewhere, mtype: null, pKey: '', pTitle: '', pHref: null, pOrder: 0 });
      else if (a.kind === 'page' || a.kind === 'material') {
        const r = resources?.find((x) => x.id === a.resource);
        const n = a.kind === 'page' ? a.pageIndex : -1;
        out.push({ q, gKey: `m:${a.resource}`, gTitle: r?.title ?? a.resource, mtype: r?.type ?? 'other', pKey: String(n), pTitle: n < 0 ? t.pdfQuestionWhole : t.questionPageLabel(n + 1), pHref: n < 0 ? `/resources/${encodeURIComponent(a.resource)}` : `/resources/${encodeURIComponent(a.resource)}/${encodeURIComponent(q.id)}`, pOrder: n });
      } else {
        const id = placeOf(a);
        const here = !!courses?.activeId && courses.activeId === a.course;
        out.push({ q, gKey: `c:${a.course}`, gTitle: courses?.courses.find((c) => c.id === a.course)?.title ?? a.course, mtype: null, pKey: id, pTitle: here ? titleOf(id) : id, pHref: here ? (id.startsWith('chapter/') ? `/${id}` : `/item/${id}`) : null, pOrder: here ? (order.get(id) ?? 1e9) : 0 });
      }
    }
    return out;
  }, [all, resources, outline, courses, t]);

  const whereOptions = useMemo(() => {
    const books = new Map<string, string>();
    const mats = new Map<string, string>();
    for (const e of entries) if (e.gKey.startsWith('c:')) books.set(e.gKey, e.gTitle);
    else if (e.gKey.startsWith('m:')) mats.set(e.gKey, e.gTitle);
    const byTitle = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
    return { books: [...books].sort(byTitle), mats: [...mats].sort(byTitle), types: RESOURCE_TYPES.filter((ty) => entries.some((e) => e.mtype === ty)) };
  }, [entries]);

  const labelName = (id: string) => labelDefs?.find((l) => l.id === id)?.name ?? id;
  const labelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const q of all ?? []) for (const l of q.labels) if (labelDefs?.some((d) => d.id === l)) ids.add(l);
    return [...ids];
  }, [all, labelDefs]);

  const filtered = useMemo(() => {
    const needle = f.text.trim().toLowerCase();
    const now = Date.now();
    return entries.filter(({ q, gKey, gTitle, mtype, pTitle }) => {
      if (!showDone && q.status !== 'open') return false;
      if (f.where) {
        const [k, v = ''] = [f.where.slice(0, f.where.indexOf(':')), f.where.slice(f.where.indexOf(':') + 1)];
        if (f.where === 'materials' ? !gKey.startsWith('m:') : f.where === 'workbooks' ? !gKey.startsWith('c:') : k === 'mt' ? mtype !== v : k === 'g' ? gKey !== v : false) return false;
      }
      if (f.kind && q.kind !== f.kind) return false;
      if (f.age) {
        const days = (now - q.createdAt) / DAY;
        if (f.age === 'old' ? days <= 30 : days > Number(f.age)) return false;
      }
      if (f.labels.length && !f.labels.every((l) => q.labels.includes(l))) return false;
      if (needle && !`${q.text} ${q.anchor.kind === 'text' ? q.anchor.quote : ''} ${q.answer ?? ''} ${gTitle} ${pTitle}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, f, showDone]);

  const groups = useMemo(() => {
    const gs = new Map<string, { key: string; title: string; mtype: ResourceType | null; parts: Map<string, { title: string; href: string | null; order: number; items: Question[] }> }>();
    for (const e of filtered) {
      const g = gs.get(e.gKey) ?? gs.set(e.gKey, { key: e.gKey, title: e.gTitle, mtype: e.mtype, parts: new Map() }).get(e.gKey)!;
      (g.parts.get(e.pKey) ?? g.parts.set(e.pKey, { title: e.pTitle, href: e.pHref, order: e.pOrder, items: [] }).get(e.pKey)!).items.push(e.q);
    }
    const rank = (k: string) => (k === '' ? 2 : k.startsWith('m:') ? 0 : 1);
    const active = courses?.activeId ? `c:${courses.activeId}` : null;
    return [...gs.values()].sort((a, b) => rank(a.key) - rank(b.key) || (a.key === active ? -1 : b.key === active ? 1 : 0) || a.title.localeCompare(b.title));
  }, [filtered, courses?.activeId]);

  if (!all) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const hasDone = all.some((q) => q.status === 'done');
  const active = !!(f.text || f.where || f.kind || f.age || f.labels.length);
  const names = groups.map((g) => g.key);
  const allClosed = names.length > 0 && names.every((n) => closed.has(n));
  const searching = !!f.text.trim();
  const rowOf = (q: Question, where?: string) => <QuestionRow dense where={where} key={q.id} item={q.anchor.kind === 'page' || q.anchor.kind === 'none' || q.anchor.kind === 'material' ? null : placeOf(q.anchor)} q={q} extra={null} />;
  const filterSelect = (key: 'where' | 'kind' | 'age', label: string, children: React.ReactNode) => (
    <select value={f[key]} onChange={(e) => set({ [key]: e.target.value })} aria-label={label} className={selectClass(!!f[key])}>
      {children}
    </select>
  );
  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-4xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.questionsTitle}</h1>
        <p className="mt-2 text-ink-2">{t.questionsPageIntro}</p>

        <div role="search" className="sticky top-0 z-[5] mt-2 grid gap-2 border-b border-line bg-sheet pb-2 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-transparent bg-sunk px-2.5 focus-within:border-accent">
              <Search size={15} className="shrink-0 text-ink-3" aria-hidden />
              <input type="search" value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder={t.questionsSearch} aria-label={t.questionsSearch} className="min-w-0 flex-1 bg-transparent outline-none" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filterSelect(
              'where',
              t.questionsWhere,
              <>
                <option value="">{t.questionsEverywhere}</option>
                {whereOptions.mats.length ? <option value="materials">{t.questionsAllMaterials}</option> : null}
                {whereOptions.types.map((ty) => (
                  <option key={ty} value={`mt:${ty}`}>
                    {t.resourceTypes[ty]}
                  </option>
                ))}
                {whereOptions.books.length ? <option value="workbooks">{t.questionsAllWorkbooks}</option> : null}
                {[...whereOptions.mats, ...whereOptions.books].map(([k, title]) => (
                  <option key={k} value={`g:${k}`}>
                    {title}
                  </option>
                ))}
              </>,
            )}
            {filterSelect(
              'kind',
              t.questionsKindFilter,
              <>
                <option value="">{t.questionsAnyKind}</option>
                {QUESTION_KINDS.map((k: QuestionKind) => (
                  <option key={k} value={k}>
                    {t.questionKinds[k]}
                  </option>
                ))}
              </>,
            )}
            {filterSelect(
              'age',
              t.questionsAge,
              <>
                <option value="">{t.questionsAnyAge}</option>
                <option value="1">{t.questionsAgeDay}</option>
                <option value="7">{t.questionsAgeWeek}</option>
                <option value="30">{t.questionsAgeMonth}</option>
                <option value="old">{t.questionsAgeOlder}</option>
              </>,
            )}
            <span className="flex-1" />
            {active ? (
              <button type="button" onClick={() => setF(NO_FILTERS)} className="px-0.5 py-1 text-[13px] text-accent hover:underline">
                {t.questionsClearFilters}
              </button>
            ) : null}
            {hasDone ? (
              <button type="button" onClick={() => setShowDone(!showDone)} aria-pressed={showDone} className="px-0.5 py-1 text-[13px] text-ink-3 hover:text-ink">
                {showDone ? t.hideDoneQuestions : t.showDoneQuestions}
              </button>
            ) : null}
            {groups.length > 1 ? (
              <button type="button" onClick={() => setClosed(allClosed ? new Set() : new Set(names))} className="px-0.5 py-1 text-[13px] text-ink-3 hover:text-ink">
                {allClosed ? t.questionsExpandAll : t.questionsCollapseAll}
              </button>
            ) : null}
          </div>
          {labelIds.length ? (
            <div role="group" aria-label={t.questionsLabels} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] text-ink-3">{t.questionsLabels}</span>
              {labelIds.map((id) => {
                const on = f.labels.includes(id);
                return (
                  <button key={id} type="button" aria-pressed={on} onClick={() => set({ labels: on ? f.labels.filter((x) => x !== id) : [...f.labels, id] })} className={clsx('h-[30px] rounded-full border px-3 text-[13.5px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink')}>
                    {labelName(id)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {filtered.length === 0 ? (
          <Empty title={active ? t.questionsNoMatch : t.noQuestions}>{active ? t.questionsNoMatchHint : t.questionsNoneAnywhere}</Empty>
        ) : (
          groups.map((g) => {
            const shut = closed.has(g.key) && !searching;
            return (
              <section key={g.key} className="mt-3">
                <button type="button" aria-expanded={!shut} onClick={() => setClosed((c) => { const n = new Set(c); if (!n.delete(g.key)) n.add(g.key); return n; })} className="flex w-full items-baseline gap-1.5 border-b border-line-strong py-1 text-left text-[14px] font-semibold">
                  <ChevronDown size={16} aria-hidden className={clsx('shrink-0 self-center text-ink-3 transition-transform', shut && '-rotate-90')} />
                  {g.title}
                  {g.mtype ? <span className="rounded-[3px] bg-sunk px-1.5 text-[12px] font-normal text-ink-2">{t.resourceTypes[g.mtype]}</span> : null}
                  <span className="text-[12px] font-normal text-ink-3">{[...g.parts.values()].reduce((n, p) => n + p.items.length, 0)}</span>
                </button>
                {shut ? null : (
                  <div>
                    {[...g.parts.entries()]
                      .sort((a, b) => a[1].order - b[1].order || a[1].title.localeCompare(b[1].title))
                      .map(([pk, p]) => (
                        <div key={pk} className="grid gap-x-3 border-b border-line py-0.5 last:border-b-0 sm:grid-cols-[9rem_1fr]">
                          {g.key === '' ? (
                            <span />
                          ) : p.href ? (
                            <Link href={p.href} className="inline-flex h-fit w-fit items-center gap-1 pt-1.5 text-[12.5px] font-medium text-accent hover:underline">
                              {p.title}
                            </Link>
                          ) : (
                            <span className="pt-1.5 text-[12.5px] text-ink-3" title={t.questionsOtherWorkbook}>
                              {p.title}
                            </span>
                          )}
                          <ul className="min-w-0 divide-y divide-dotted divide-line">{p.items.map((q) => rowOf(q))}</ul>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
