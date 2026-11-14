import { Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import type { Anchor, CardPayload, Change, HighlightPayload, QuestionPayload } from '@wb/shared';
import { decideChange } from '@/lib/api';
import { useAnchorLink } from '@/lib/cardAnchor';
import { useT } from '@/lib/i18n';
import { ChangeValue, ProposalList, useChangeText } from './Proposals';
import { Title } from './Title';
import { Button } from './ui';

const DAY = 86_400_000;
/** Accepted proposals can be taken back for this long. */
export const UNDO_DAYS = 7;

/** The place a proposal points to: the page of a highlight, or the anchor of a proposed question. */
export function whereOf(c: Change): Anchor | null {
  if (c.field !== 'create') return null;
  if (c.ref.kind === 'highlight') {
    const h = c.after as HighlightPayload;
    return { kind: 'page', resource: h.resource, version: '', pageIndex: h.pageIndex, fingerprint: '' };
  }
  return (c.after as Partial<CardPayload & QuestionPayload>).anchor ?? null;
}

function Where({ c }: { c: Change }) {
  const link = useAnchorLink(whereOf(c));
  if (!link?.label) return null;
  return link.href ? (
    <Link href={link.href} className="text-accent hover:underline">
      <Title text={link.label} />
    </Link>
  ) : (
    <Title text={link.label} />
  );
}

/** The ticket for a proposal that stands on its own: what it would make or change, and a decision. Decided ones keep their undo for a week. */
export function ProposalDetail({ c, onClose }: { c: Change; onClose: () => void }) {
  const t = useT();
  const { fieldName } = useChangeText();
  const [error, setError] = useState(false);
  const now = Date.now();
  const left = c.status === 'applied' && c.decidedAt ? UNDO_DAYS - Math.floor((now - c.decidedAt) / DAY) : 0;
  return (
    <aside aria-label={t.detailProposal} className="flex min-h-full flex-col gap-4 px-[18px] pb-[18px] pt-4 text-[14px]">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">
          {t.detailProposal} · {fieldName(c)}
          {whereOf(c) ? (
            <>
              {' · '}
              <Where c={c} />
            </>
          ) : null}
        </span>
        <button type="button" onClick={onClose} aria-label={t.detailClose} title={t.detailClose} className="rounded-md p-1 hover:bg-sunk hover:text-ink">
          <X size={15} />
        </button>
      </div>
      {c.status === 'pending' ? (
        <ProposalList changes={[c]} wide onDecided={onClose} />
      ) : (
        <>
          <div className="text-[13.5px]">
            <ChangeValue c={c} />
            {c.reason ? <p className="mt-1 text-[12.5px] text-ink-3">{c.reason}</p> : null}
          </div>
          <p className="text-[13px] text-ink-2">
            {t.inboxStatus[c.status]}
            {c.decidedAt ? ` · ${new Date(c.decidedAt).toLocaleDateString()}` : ''}
            {c.feedback ? <span className="text-ink-3"> · {c.feedback}</span> : null}
          </p>
          {left > 0 ? (
            <div>
              <Button
                size="sm"
                title={t.histUndoLeft(left)}
                onClick={() => {
                  setError(false);
                  decideChange(c.id, 'undo').catch(() => setError(true));
                }}
              >
                <Undo2 size={14} aria-hidden /> {t.inboxUndo}
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {t.inboxFailed}
            </p>
          ) : null}
        </>
      )}
    </aside>
  );
}
