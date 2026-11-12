import type { Anchor } from '@wb/shared';
import { targetHref } from '@wb/shared';
import { useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useResources } from '@/lib/resources';

/** What a card's anchor reads as, and where it opens. No `href` when the place is in a workbook that is not open. */
export function useAnchorLink(anchor: Anchor | null | undefined): { label: string; href: string | null } | null {
  const t = useT();
  const resources = useResources(null).data?.resources;
  const outline = useOutline().data;
  if (!anchor || anchor.kind === 'none') return null;
  if (anchor.kind === 'page' || anchor.kind === 'material') {
    const title = resources?.find((r) => r.id === anchor.resource)?.title;
    if (!title) return { label: resources ? t.cardReferenceGone : '…', href: null };
    const base = `/resources/${encodeURIComponent(anchor.resource)}`;
    // A page is opened by its number in the file as it is now, so a changed file still opens at the page.
    return anchor.kind === 'page' ? { label: t.cardAnchorPage(anchor.pageIndex + 1, title), href: `${base}/page:${anchor.pageIndex + 1}` } : { label: title, href: base };
  }
  // The open workbook's stable id, as the anchor was written with (a folder's id would not match).
  const here = !!outline && outline.id === anchor.course;
  const id = anchor.kind === 'text' ? anchor.target : anchor.id;
  const title = here ? (outline?.chapters.flatMap((c) => c.items).find((i) => i.id === id)?.title ?? outline?.chapters.find((c) => `chapter/${c.id}` === id)?.title ?? null) : null;
  const href = here ? (anchor.kind === 'text' ? targetHref(anchor.target) : id.startsWith('chapter/') ? `/${id}` : `/item/${id}`) : null;
  return { label: title ?? (here ? id : `${id} · ${anchor.course}`), href };
}

/** One source line for a card: the place it points at, as a link when it can be opened. */
export function CardAnchorLink({ anchor, className = '' }: { anchor: Anchor | null | undefined; className?: string }) {
  const link = useAnchorLink(anchor);
  if (!link) return null;
  return link.href ? (
    <a href={link.href} className={`text-accent hover:underline ${className}`}>
      {link.label}
    </a>
  ) : (
    <span className={className}>{link.label}</span>
  );
}
