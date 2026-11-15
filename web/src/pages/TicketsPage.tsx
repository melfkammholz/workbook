import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { TicketDetail } from '@/components/TicketDetail';
import { ProposalDetail } from '@/components/ProposalDetail';
import { useChangeText } from '@/components/Proposals';
import { ConnectAssistant } from '@/components/ConnectAssistant';
import { AssistantStrip } from '@/components/AssistantStrip';
import { AskDialog, BulkBar, itemOf } from '@/components/TicketsBulk';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Title } from '@/components/Title';
import { Link } from 'wouter';
import { RESOURCE_TYPES, type Change, type Ticket, type ResourceType } from '@wb/shared';
import { Empty, Spinner } from '@/components/ui';
import { useTags } from '@/lib/tags';
import { acceptChanges, isStandalone, updateTicket, useChanges, useCourses, useOutline, useAssistant, usePendingProposals, useTickets, useSettings } from '@/lib/api';
import { BackLink } from '@/lib/history';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';


const placeOf = (a: Exclude<Ticket['anchor'], { kind: 'page' | 'none' | 'material' }>) => (a.kind === 'text' ? a.target : a.id);

interface Entry {
  q: Ticket;
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
  age: string;
  labels: string[];
  answered: boolean;
  unseen: boolean;
  tab: '' | 'all' | 'unread' | 'archive';
}

const NO_FILTERS: Filters = { text: '', where: '', age: '', labels: [], answered: false, unseen: false, tab: '' };
const DAY = 86_400_000;

const readUrl = (): Filters => {
  const p = new URLSearchParams(location.search);
  return { text: p.get('q') ?? '', where: p.get('in') ?? '', age: p.get('age') ?? '', labels: (p.get('labels') ?? '').split(',').filter(Boolean), answered: p.get('answer') === '1', unseen: p.get('unseen') === '1', tab: p.get('tab') === 'unread' ? 'unread' : p.get('tab') === 'archive' ? 'archive' : p.get('tab') === 'all' ? 'all' : '' };
};

const writeUrl = (f: Filters) => {
  const p = new URLSearchParams();
  if (f.text) p.set('q', f.text);
  if (f.where) p.set('in', f.where);
  if (f.age) p.set('age', f.age);
  if (f.labels.length) p.set('labels', f.labels.join(','));
  if (f.answered) p.set('answer', '1');
  if (f.unseen) p.set('unseen', '1');
  if (f.tab) p.set('tab', f.tab);
  const search = p.toString() ? `?${p}` : '';
  if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
};

const selectClass = (on: boolean) => clsx('h-[30px] w-full rounded-lg border px-2 text-[13.5px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-sheet text-ink-2');

/** All the questions, open ones first: by material and page, then by workbook and item in reading order. Filters live in the address. */
export function TicketsPage() {
  const t = useT();
  const all = useTickets().data;
  const outline = useOutline().data;
  const courses = useCourses().data;
  const activeKey = courses?.courses.find((c) => c.id === courses.activeId)?.key;
  const resources = useResources(null).data?.resources;
  const labelDefs = useTags().data;
  const settings = useSettings().data;
  const bridgeOn = !!(settings?.showAi && settings.assistantBridge);
  const [f, setF] = useState<Filters>(readUrl);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Ticket[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const lastPicked = useRef<string | null>(null);
  const proposals = usePendingProposals();
  const helper = useAssistant(bridgeOn).data;
  /** Questions a queued or running request is about: the row says wartet or liest. */
  const asked = useMemo(() => {
    const m = new Map<string, 'queued' | 'running'>();
    for (const r of helper?.requests ?? []) if (r.status === 'queued' || r.status === 'running') for (const id of r.params.tickets) if (m.get(id) !== 'running') m.set(id, r.status);
    return m;
  }, [helper]);
  const changes = useChanges(bridgeOn).data;
  const { show, fieldName } = useChangeText();
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
      // By default this page is about the open workbook and the student's materials; other workbooks' questions show under All.
      if (f.tab !== 'all') {
        if (a.kind === 'page' || a.kind === 'material') {
          // A material belongs here when this workbook lists it (its `courses` hold workbook ids, not the app's course ids).
          const r = resources?.find((x) => x.id === a.resource);
          if (!outline?.id || !r?.courses.includes(outline.id)) continue;
        } else if (a.kind !== 'none' && a.course !== activeKey) continue;
      }
      if (a.kind === 'none') out.push({ q, gKey: '', gTitle: t.ticketsElsewhere, mtype: null, pKey: '', pTitle: '', pHref: null, pOrder: 0 });
      else if (a.kind === 'page' || a.kind === 'material') {
        const r = resources?.find((x) => x.id === a.resource);
        const n = a.kind === 'page' ? a.pageIndex : -1;
        out.push({ q, gKey: `m:${a.resource}`, gTitle: r?.title ?? a.resource, mtype: r?.type ?? 'other', pKey: String(n), pTitle: n < 0 ? t.pdfQuestionWhole : t.ticketPageLabel(n + 1), pHref: n < 0 ? `/resources/${encodeURIComponent(a.resource)}` : `/resources/${encodeURIComponent(a.resource)}/${encodeURIComponent(q.id)}`, pOrder: n });
      } else {
        const id = placeOf(a);
        const here = !!activeKey && activeKey === a.course;
        out.push({ q, gKey: `c:${a.course}`, gTitle: courses?.courses.find((c) => c.key === a.course)?.title ?? a.course, mtype: null, pKey: id, pTitle: here ? titleOf(id) : id, pHref: here ? (id.startsWith('chapter/') ? `/${id}` : `/item/${id}`) : null, pOrder: here ? (order.get(id) ?? 1e9) : 0 });
      }
    }
    return out;
  }, [all, resources, outline, courses, activeKey, t, f.tab]);

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
      if (f.tab === 'archive' ? !q.archived : q.archived || (f.tab === 'unread' && q.read)) return false;
      if (f.where) {
        const [k, v = ''] = [f.where.slice(0, f.where.indexOf(':')), f.where.slice(f.where.indexOf(':') + 1)];
        if (f.where === 'materials' ? !gKey.startsWith('m:') : f.where === 'workbooks' ? !gKey.startsWith('c:') : k === 'mt' ? mtype !== v : k === 'g' ? gKey !== v : false) return false;
      }
      if (f.answered && !q.answer) return false;
      if (f.unseen && q.fetched) return false;
      if (f.age) {
        const days = (now - q.createdAt) / DAY;
        if (f.age === 'old' ? days <= 30 : days > Number(f.age)) return false;
      }
      if (f.labels.length && !f.labels.every((l) => q.labels.includes(l))) return false;
      if (needle && !`${q.text} ${q.anchor.kind === 'text' ? q.anchor.quote : ''} ${q.answer ?? ''} ${gTitle} ${pTitle}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, f]);

  const proposalText = (c: Change) => (c.field === 'merge' ? (all?.find((q) => q.id === c.ref.id)?.text ?? '') : show(c, c.after));
  /** Proposals that stand on their own: waiting ones with All and Unread, decided ones in the archive. */
  const standalone = useMemo(() => {
    const needle = f.text.trim().toLowerCase();
    const now = Date.now();
    // Filters about questions (place, type, labels, answers) leave proposals out; only age and text apply to both.
    if (!bridgeOn || f.where || f.labels.length || f.answered || f.unseen) return [];
    return (changes ?? []).filter((c) => {
      if (!isStandalone(c)) return false;
      if (f.tab === 'archive' ? c.status !== 'applied' && c.status !== 'rejected' : c.status !== 'pending') return false;
      if (f.age) {
        const days = (now - c.createdAt) / DAY;
        if (f.age === 'old' ? days <= 30 : days > Number(f.age)) return false;
      }
      if (needle && !`${fieldName(c)} ${proposalText(c)}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [changes, f, bridgeOn, all]);
  const openChange = openId ? standalone.find((c) => c.id === openId) : undefined;

  const groups = useMemo(() => {
    const gs = new Map<string, { key: string; title: string; mtype: ResourceType | null; parts: Map<string, { title: string; href: string | null; order: number; items: Ticket[] }> }>();
    for (const e of filtered) {
      const g = gs.get(e.gKey) ?? gs.set(e.gKey, { key: e.gKey, title: e.gTitle, mtype: e.mtype, parts: new Map() }).get(e.gKey)!;
      (g.parts.get(e.pKey) ?? g.parts.set(e.pKey, { title: e.pTitle, href: e.pHref, order: e.pOrder, items: [] }).get(e.pKey)!).items.push(e.q);
    }
    // Questions with an open proposal go first in their list (stable, so the rest keeps its order).
    for (const g of gs.values()) for (const p of g.parts.values()) p.items.sort((a, b) => Number(!!proposals.get(b.id)?.length) - Number(!!proposals.get(a.id)?.length));
    const rank = (k: string) => (k === '' ? 2 : k.startsWith('m:') ? 0 : 1);
    const active = activeKey ? `c:${activeKey}` : null;
    return [...gs.values()].sort((a, b) => rank(a.key) - rank(b.key) || (a.key === active ? -1 : b.key === active ? 1 : 0) || a.title.localeCompare(b.title));
  }, [filtered, activeKey, proposals]);

  /** Ids in the order the list shows them, for shift-click ranges. */
  const ordered = useMemo(() => groups.flatMap((g) => [...g.parts.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).flatMap((p) => p.items.map((q) => q.id))), [groups]);
  const entryOf = useMemo(() => new Map(entries.map((e) => [e.q.id, e])), [entries]);
  const openEntry = openId ? entryOf.get(openId) : undefined;
  const waitingStandalone = standalone.filter((c) => c.status === 'pending');

  const pick = (id: string, range: boolean) => {
    setPicked((cur) => {
      const next = new Set(cur);
      const from = lastPicked.current ? ordered.indexOf(lastPicked.current) : -1;
      const to = ordered.indexOf(id);
      if (range && from >= 0 && to >= 0) for (const x of ordered.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(x);
      else if (!next.delete(id)) next.add(id);
      return next;
    });
    lastPicked.current = id;
  };
  const pickMany = (ids: string[]) =>
    setPicked((cur) => {
      const next = new Set(cur);
      const all = ids.every((i) => next.has(i));
      for (const i of ids) all ? next.delete(i) : next.add(i);
      return next;
    });
  const openQuestion = (q: Ticket) => {
    setOpenId(q.id);
    if (!q.read) void updateTicket(itemOf(q), q.id, { read: true });
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (picked.size) setPicked(new Set());
      else if (openId) setOpenId(null);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [picked.size, openId]);
  // Questions that left the list (archived, filtered away) leave the selection.
  useEffect(() => {
    setPicked((cur) => (cur.size && [...cur].some((i) => !ordered.includes(i)) ? new Set([...cur].filter((i) => ordered.includes(i))) : cur));
  }, [ordered]);

  if (!all) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  const active = !!(f.text || f.where || f.age || f.labels.length || f.answered || f.unseen);
  const count = [f.where, f.age].filter(Boolean).length + f.labels.length + (f.answered ? 1 : 0) + (f.unseen ? 1 : 0);
  const names = groups.map((g) => g.key);
  const nothing = filtered.length === 0 && standalone.length === 0;
  const allClosed = names.length > 0 && names.every((n) => closed.has(n));
  const searching = !!f.text.trim();
  const anyPicked = picked.size > 0;
  const rowOf = (q: Ticket) => {
    const days = Math.floor((Date.now() - q.createdAt) / DAY);
    const waiting = proposals.get(q.id)?.length ?? 0;
    const raw = q.anchor.kind === 'text' ? q.anchor.quote : q.anchor.kind === 'page' ? q.anchor.quote?.trim() || q.anchor.snippet : '';
    const quote = raw?.trim().replace(/\s+/g, ' ') || null;
    const on = picked.has(q.id);
    const names = q.labels.flatMap((l) => labelDefs?.find((d) => d.id === l)?.name ?? []);
    return (
      <li key={q.id} onClick={(e) => (e.shiftKey ? pick(q.id, true) : openQuestion(q))} className={clsx('group grid cursor-pointer grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2.5 rounded-md px-2 py-1', on || openId === q.id ? 'bg-accent-soft' : 'hover:bg-sunk')}>
        <span className="relative grid size-4 place-items-center self-center">
          <input type="checkbox" checked={on} aria-label={t.ticketsSelectOne} onClick={(e) => { e.stopPropagation(); pick(q.id, e.shiftKey); }} onChange={() => undefined} className={clsx('wb-check absolute inset-0', anyPicked ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100')} />
          {q.read ? null : <span role="img" aria-label={t.ticketUnreadDot} title={t.ticketUnreadDot} className={clsx('size-[9px] rounded-full bg-accent', anyPicked ? 'hidden' : 'group-hover:hidden')} />}
        </span>
        <p className={clsx('min-w-0 truncate text-[14px] leading-[1.4]', q.archived && 'text-ink-3', !q.read && 'font-semibold')} title={q.text || undefined}>
          {q.text || (quote ? <span className="italic text-ink-3">{quote}</span> : <span className="text-ink-3">{t.inboxNoText}</span>)}
        </p>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-3">
          {q.who ? <span title={t.inboxFromAssistant}>{t.assistantMark}</span> : null}
          {names.map((l) => (
            <span key={l} className="rounded-[3px] bg-sunk px-1.5 text-ink-2">
              {l}
            </span>
          ))}
          {asked.get(q.id) ? <span className="text-[11.5px] italic text-ink-3">{asked.get(q.id) === 'running' ? t.reqReading : t.reqWaiting}</span> : null}
          {waiting ? <span className="rounded-full bg-accent-soft px-2 text-[11.5px] text-accent">{t.ticketsProposals(waiting)}</span> : null}
          <span className="min-w-[5.2rem] text-right tabular-nums" title={new Date(q.createdAt).toLocaleString()}>
            {t.ticketAge(days)}
          </span>
        </div>
      </li>
    );
  };
  const proposalSection = (
    <section className="mt-3">
      <div className="flex items-baseline gap-1.5 border-b border-line-strong">
        <h2 className="min-w-0 flex-1 py-1 text-[14px] font-semibold">{t.ticketsProposalGroup}</h2>
        {waitingStandalone.length > 1 ? (
          <button type="button" onClick={() => void acceptChanges(waitingStandalone.map((c) => c.id)).catch(() => undefined)} className="px-0.5 py-1 text-[13px] text-accent hover:underline">
            {t.detailAcceptAll}
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-dotted divide-line">
        {standalone.map((c) => {
          const pending = c.status === 'pending';
          const text = proposalText(c);
          return (
            <li key={c.id} onClick={() => setOpenId(c.id)} className={clsx('group grid cursor-pointer grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2.5 rounded-md px-2 py-1', openId === c.id ? 'bg-accent-soft' : 'hover:bg-sunk')}>
              <span className="grid size-4 place-items-center self-center">{pending ? <span role="img" aria-label={t.ticketUnreadDot} title={t.ticketUnreadDot} className="size-[9px] rounded-full bg-accent" /> : null}</span>
              <p className={clsx('min-w-0 truncate text-[14px] leading-[1.4]', pending ? 'font-semibold' : 'text-ink-3')} title={text || undefined}>
                {text || <span className="text-ink-3">{t.inboxNoText}</span>}
              </p>
              <div className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-3">
                <span className="rounded-[3px] bg-review-soft px-1.5 text-review">{fieldName(c)}</span>
                {pending ? null : <span>{t.inboxStatus[c.status]}</span>}
                <span className="min-w-[5.2rem] text-right tabular-nums" title={new Date(c.createdAt).toLocaleString()}>
                  {t.ticketAge(Math.floor((Date.now() - (c.decidedAt ?? c.createdAt)) / DAY))}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
  const filterSelect = (key: 'where' | 'age', label: string, children: React.ReactNode) => (
    <select value={f[key]} onChange={(e) => set({ [key]: e.target.value })} aria-label={label} className={selectClass(!!f[key])}>
      {children}
    </select>
  );
  return (
    <div className="flex h-full">
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-4xl px-6 pb-12 pt-8 sm:px-8">
        <BackLink fallback="/" label={t.back} className="mb-3">
          {t.back}
        </BackLink>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.ticketsTitle}</h1>
        <p className="mt-2 text-ink-2">{t.ticketsPageIntro}</p>
        {settings?.showAi ? (
          <p className="mt-2 flex items-center gap-2 text-[13.5px]">
            <span aria-hidden className={clsx('inline-block size-2 rounded-full', helper?.connected ? 'bg-done' : 'border border-ink-3')} />
            <span className="text-ink-2">{helper?.connected ? t.helperConnected : t.helperNotConnected}</span>
            <button type="button" onClick={() => setConnecting(true)} className="text-accent hover:underline">
              {helper?.connected ? t.connectManage : t.connectOpen}
            </button>
          </p>
        ) : null}
        <ConnectAssistant open={connecting} onClose={() => setConnecting(false)} />

        <div role="tablist" aria-label={t.ticketsTitle} className="mt-4 flex gap-1 border-b border-line">
          {([['', t.ticketsTabHere], ['all', t.ticketsTabAll], ['unread', t.ticketsTabUnread], ['archive', t.ticketsTabArchive]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={f.tab === id} onClick={() => set({ tab: id })} className={clsx('-mb-px border-b-2 px-3 py-1.5 text-[14px]', f.tab === id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>

        <div role="search" className="sticky top-0 z-[5] mt-2 flex flex-wrap items-center gap-2 border-b border-line bg-sheet pb-2 pt-2.5">
          <label className="flex h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-transparent bg-sunk px-2.5 focus-within:border-accent">
            <Search size={15} className="shrink-0 text-ink-3" aria-hidden />
            <input type="search" value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder={t.ticketsSearch} aria-label={t.ticketsSearch} className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13.5px]', count ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-sheet text-ink-2 hover:border-ink-3')}>
                <SlidersHorizontal size={14} aria-hidden />
                {count ? t.ticketsFilterN(count) : t.ticketsFilter}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} aria-label={t.ticketsFilter} className="wb-menu w-[19rem] p-0 text-[13.5px]">
                <div className="grid gap-3 px-3.5 py-3">
                  <div>
                    <div className="mb-1 text-[12.5px] text-ink-3">{t.ticketsWhere}</div>
                    {filterSelect(
                      'where',
                      t.ticketsWhere,
                      <>
                        <option value="">{t.ticketsEverywhere}</option>
                        {whereOptions.mats.length ? <option value="materials">{t.ticketsAllMaterials}</option> : null}
                        {whereOptions.types.map((ty) => (
                          <option key={ty} value={`mt:${ty}`}>
                            {t.resourceTypes[ty]}
                          </option>
                        ))}
                        {whereOptions.books.length ? <option value="workbooks">{t.ticketsAllWorkbooks}</option> : null}
                        {[...whereOptions.mats, ...whereOptions.books].map(([k, title]) => (
                          <option key={k} value={`g:${k}`}>
                            {title}
                          </option>
                        ))}
                      </>,
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[12.5px] text-ink-3">{t.ticketsAge}</div>
                    {filterSelect(
                      'age',
                      t.ticketsAge,
                      <>
                        <option value="">{t.ticketsAnyAge}</option>
                        <option value="1">{t.ticketsAgeDay}</option>
                        <option value="7">{t.ticketsAgeWeek}</option>
                        <option value="30">{t.ticketsAgeMonth}</option>
                        <option value="old">{t.ticketsAgeOlder}</option>
                      </>,
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={f.answered} onChange={(e) => set({ answered: e.target.checked })} className="wb-check" />
                      {t.ticketsHasAnswer}
                    </label>
                    {bridgeOn ? (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={f.unseen} onChange={(e) => set({ unseen: e.target.checked })} className="wb-check" />
                        {t.ticketsNotSeen}
                      </label>
                    ) : null}
                  </div>
                  {labelIds.length ? (
                    <div role="group" aria-label={t.ticketsLabels}>
                      <div className="mb-1 text-[12.5px] text-ink-3">{t.ticketsLabels}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {labelIds.map((id) => {
                          const on = f.labels.includes(id);
                          return (
                            <button key={id} type="button" aria-pressed={on} onClick={() => set({ labels: on ? f.labels.filter((x) => x !== id) : [...f.labels, id] })} className={clsx('h-[26px] rounded-full border px-2.5 text-[13px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink')}>
                              {labelName(id)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[13px]">
                  {filtered.length ? (
                    <Popover.Close asChild>
                      <button type="button" onClick={() => pickMany(ordered)} className="text-ink-2 hover:text-ink">
                        {t.ticketsSelectAll}
                      </button>
                    </Popover.Close>
                  ) : null}
                  <span className="flex-1" />
                  {active ? (
                    <button type="button" onClick={() => set({ ...NO_FILTERS, text: f.text, tab: f.tab })} className="text-accent hover:underline">
                      {t.ticketsClearFilters}
                    </button>
                  ) : null}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {groups.length > 1 ? (
            <button type="button" onClick={() => setClosed(allClosed ? new Set() : new Set(names))} className="px-0.5 py-1 text-[13px] text-ink-3 hover:text-ink">
              {allClosed ? t.ticketsExpandAll : t.ticketsCollapseAll}
            </button>
          ) : null}
        </div>

        <AssistantStrip enabled={bridgeOn} />

        {nothing ? (
          <Empty title={active ? t.ticketsNoMatch : t.noTickets}>{active ? t.ticketsNoMatchHint : t.ticketsNoneAnywhere}</Empty>
        ) : (
          <>
          {standalone.length ? proposalSection : null}
          {groups.map((g) => {
            const shut = closed.has(g.key) && !searching;
            return (
              <section key={g.key} className="mt-3">
                <div className="flex items-baseline gap-1.5 border-b border-line-strong">
                  <GroupCheck ids={[...g.parts.values()].flatMap((p) => p.items.map((q) => q.id))} picked={picked} onToggle={pickMany} label={t.ticketsSelectGroup} />
                  <button type="button" aria-expanded={!shut} onClick={() => setClosed((c) => { const n = new Set(c); if (!n.delete(g.key)) n.add(g.key); return n; })} className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1 text-left text-[14px] font-semibold">
                    <ChevronDown size={16} aria-hidden className={clsx('shrink-0 self-center text-ink-3 transition-transform', shut && '-rotate-90')} />
                    <Title text={g.title} />
                    {g.mtype ? <span className="rounded-[3px] bg-sunk px-1.5 text-[12px] font-normal text-ink-2">{t.resourceTypes[g.mtype]}</span> : null}
                    <span className="text-[12px] font-normal text-ink-3">{[...g.parts.values()].reduce((n, p) => n + p.items.length, 0)}</span>
                  </button>
                </div>
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
                              <Title text={p.title} />
                            </Link>
                          ) : (
                            <span className="pt-1.5 text-[12.5px] text-ink-3" title={t.ticketsOtherWorkbook}>
                              <Title text={p.title} />
                            </span>
                          )}
                          <ul className="min-w-0 divide-y divide-dotted divide-line">{p.items.map((q) => rowOf(q))}</ul>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            );
          })}
          </>
        )}
        {anyPicked ? <BulkBar picked={ordered.filter((i) => picked.has(i)).flatMap((i) => entryOf.get(i)?.q ?? [])} archive={f.tab === 'archive'} ai={!!settings?.showAi} onAsk={() => setAsking(ordered.filter((i) => picked.has(i)).flatMap((i) => entryOf.get(i)?.q ?? []))} onClear={() => setPicked(new Set())} /> : null}
      </div>
    </div>
    {openChange ? (
      <div className="w-[27rem] shrink-0 py-3 pr-3">
        <div className="h-full overflow-y-auto rounded-xl border border-line bg-sheet shadow-[var(--shadow)]">
        <ProposalDetail key={openChange.id} c={openChange} onClose={() => setOpenId(null)} />
        </div>
      </div>
    ) : null}
    {openEntry && !openChange ? (
      <div className="w-[27rem] shrink-0 py-3 pr-3">
        <div className="h-full overflow-y-auto rounded-xl border border-line bg-sheet shadow-[var(--shadow)]">
        <TicketDetail key={openEntry.q.id} q={openEntry.q} item={itemOf(openEntry.q)} where={[openEntry.gTitle, openEntry.pTitle].filter(Boolean).join(' · ')} href={openEntry.pHref} onClose={() => setOpenId(null)} onAsk={() => setAsking([openEntry.q])} />
        </div>
      </div>
    ) : null}
    {asking ? <AskDialog questions={asking} onClose={() => setAsking(null)} /> : null}
    </div>
  );
}

/** The checkbox in a group's header: all of its questions, or none. */
function GroupCheck({ ids, picked, onToggle, label }: { ids: string[]; picked: ReadonlySet<string>; onToggle: (ids: string[]) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const n = ids.filter((i) => picked.has(i)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = n > 0 && n < ids.length;
  });
  return <input ref={ref} type="checkbox" checked={ids.length > 0 && n === ids.length} aria-label={label} title={label} onChange={() => onToggle(ids)} className="wb-check shrink-0 self-center" />;
}
