import { useState, useEffect, useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useAnalysisStore, type ClaimGraph, type Dispute } from '../../stores/useAnalysisStore';
import { cleanText } from '../../lib/textUtils';
import { FactList } from './FactList';

type EvidenceStatus = 'ok' | 'warn' | 'miss';

const STATUS_STYLE: Record<EvidenceStatus, { label: string; cls: string }> = {
  ok: { label: '充分', cls: 'bg-gr/20 text-gr' },
  warn: { label: '不足', cls: 'bg-yl/20 text-yl' },
  miss: { label: '缺漏', cls: 'bg-rd/20 text-rd' },
};

const CLAIM_TYPE_LABEL: Record<ClaimGraph['claim_type'], string> = {
  primary: '主張',
  rebuttal: '反駁',
  supporting: '輔助',
};

const SIDE_STYLE: Record<'ours' | 'theirs', string> = {
  ours: 'bg-ac/20 text-ac',
  theirs: 'bg-or/20 text-or',
};

const getEvidenceStatus = (evidence: string[] | null): EvidenceStatus => {
  if (!evidence || evidence.length === 0) return 'miss';
  return evidence.length >= 2 ? 'ok' : 'warn';
};

/** 根據 responds_to 攻防鏈排序：我方主張 → 輔助 → 對方主張 → 我方反駁 → … */
const sortClaimsByThread = (claims: ClaimGraph[]): ClaimGraph[] => {
  const idSet = new Set(claims.map((c) => c.id));
  const childrenMap = new Map<string, ClaimGraph[]>();
  const roots: ClaimGraph[] = [];

  for (const c of claims) {
    if (c.responds_to && idSet.has(c.responds_to)) {
      if (!childrenMap.has(c.responds_to)) childrenMap.set(c.responds_to, []);
      childrenMap.get(c.responds_to)!.push(c);
    } else {
      roots.push(c);
    }
  }

  // 根節點排序：我方 primary → 我方 supporting → 對方 primary → 對方 supporting
  const rootOrder = (c: ClaimGraph) => {
    const s = c.side === 'ours' ? 0 : 2;
    const t = c.claim_type === 'primary' ? 0 : 1;
    return s + t;
  };
  roots.sort((a, b) => rootOrder(a) - rootOrder(b));

  const result: ClaimGraph[] = [];
  const visited = new Set<string>();

  const traverse = (claim: ClaimGraph) => {
    if (visited.has(claim.id)) return;
    visited.add(claim.id);
    result.push(claim);
    const children = childrenMap.get(claim.id) ?? [];
    for (const child of children) {
      traverse(child);
    }
  };

  for (const root of roots) {
    traverse(root);
  }

  return result;
};

const ClaimCard = ({ claim, side }: { claim: ClaimGraph; side?: 'ours' | 'theirs' }) => {
  const sideLabel =
    claim.claim_type === 'supporting'
      ? ''
      : side === 'ours'
        ? '我方'
        : side === 'theirs'
          ? '對方'
          : '';
  const typeLabel = CLAIM_TYPE_LABEL[claim.claim_type];
  const badgeCls = side ? SIDE_STYLE[side] : 'bg-bg-3 text-t2';
  const borderCls = side === 'ours' ? 'border-l-ac' : side === 'theirs' ? 'border-l-or' : '';

  return (
    <div className={`rounded border-l-2 bg-bg-1 px-2.5 py-1.5 ${borderCls}`}>
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-0.5 inline-flex shrink-0 ${sideLabel ? 'flex-col items-center' : 'items-center'} rounded px-1.5 py-0.5 text-xs font-medium leading-tight ${badgeCls}`}
        >
          {sideLabel && <span>{sideLabel}</span>}
          <span>{typeLabel}</span>
        </span>
        <p className="flex-1 text-sm leading-relaxed text-t1">{claim.statement}</p>
      </div>
    </div>
  );
};

export const DisputesTab = () => {
  const disputes = useAnalysisStore((s) => s.disputes);
  const claims = useAnalysisStore((s) => s.claims);
  const highlightDisputeId = useAnalysisStore((s) => s.highlightDisputeId);

  const claimsByDispute = useMemo(() => {
    const map = new Map<string | null, ClaimGraph[]>();
    for (const c of claims) {
      const key = c.dispute_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [claims]);

  const unclassifiedClaims = claimsByDispute.get(null) ?? [];

  const summary = useMemo(() => {
    let ok = 0,
      warn = 0,
      miss = 0;
    for (const d of disputes) {
      const status = getEvidenceStatus(d.evidence);
      if (status === 'ok') ok++;
      else if (status === 'warn') warn++;
      else miss++;
    }
    return { ok, warn, miss };
  }, [disputes]);

  if (disputes.length === 0 && claims.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚未分析爭點，透過 AI 助理分析</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {disputes.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-t3">
          <span>{disputes.length} 個爭點</span>
          <span className="text-gr">充分 {summary.ok}</span>
          <span className="text-yl">不足 {summary.warn}</span>
          <span className="text-rd">缺漏 {summary.miss}</span>
        </div>
      )}

      {disputes.map((d) => (
        <DisputeCard
          key={d.id}
          dispute={d}
          claims={claimsByDispute.get(d.id) ?? []}
          isHighlighted={d.id === highlightDisputeId}
        />
      ))}

      {unclassifiedClaims.length > 0 && (
        <div className="rounded border border-bd bg-bg-2">
          <div className="px-3 py-2.5 text-sm font-medium text-t3">未分類主張</div>
          <div className="space-y-1.5 border-t border-bd px-3 py-2.5">
            {unclassifiedClaims.map((c) => (
              <ClaimCard key={c.id} claim={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DisputeCard = ({
  dispute,
  claims,
  isHighlighted,
}: {
  dispute: Dispute;
  claims: ClaimGraph[];
  isHighlighted?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const setHighlightDisputeId = useAnalysisStore((s) => s.setHighlightDisputeId);

  const evidenceStatus = getEvidenceStatus(dispute.evidence);
  const statusStyle = STATUS_STYLE[evidenceStatus];

  const ourClaims = claims.filter((c) => c.side === 'ours');
  const theirClaims = claims.filter((c) => c.side === 'theirs');
  const sortedClaims = useMemo(() => sortClaimsByThread(claims), [claims]);

  useEffect(() => {
    if (isHighlighted) {
      setExpanded(true);
      const timer = setTimeout(() => {
        setHighlightDisputeId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted, setHighlightDisputeId]);

  const handleJumpToParagraph = () => {
    const el = document.querySelector(`[data-dispute-id="${dispute.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-paragraph');
      setTimeout(() => el.classList.remove('highlight-paragraph'), 3000);
    }
  };

  return (
    <div
      className={`rounded border bg-bg-2 transition-colors ${
        isHighlighted ? 'border-yl bg-yl/10' : 'border-bd'
      }`}
      data-dispute-card={dispute.id}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-bg-h"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1 truncate text-sm font-medium text-t1">
                {cleanText(dispute.title || '未命名爭點')}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72">
              {cleanText(dispute.title || '未命名爭點')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="shrink-0 text-xs text-t3">
          我方 {ourClaims.length} / 對方 {theirClaims.length}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusStyle.cls}`}>
          {statusStyle.label}
        </span>
        <span className="shrink-0 text-xs text-t3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-bd px-3 py-2.5">
          {/* 主張列表 — 依攻防鏈排序，左色條區分我方/對方 */}
          {sortedClaims.length > 0 && (
            <div className="space-y-1.5">
              {sortedClaims.map((c) => (
                <div key={c.id} className={c.claim_type === 'supporting' ? 'ml-4' : ''}>
                  <ClaimCard claim={c} side={c.side} />
                </div>
              ))}
            </div>
          )}

          {/* 事實爭議 */}
          {dispute.facts && dispute.facts.length > 0 && <FactList facts={dispute.facts} />}

          {/* 證據 + 法條合併 tag 列 */}
          {((dispute.evidence && dispute.evidence.length > 0) ||
            (dispute.law_refs && dispute.law_refs.length > 0)) && (
            <div className="flex flex-wrap gap-1">
              {dispute.evidence?.map((e, i) => (
                <span key={`ev-${i}`} className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2">
                  {cleanText(e)}
                </span>
              ))}
              {dispute.law_refs?.map((l, i) => (
                <span key={`law-${i}`} className="rounded bg-cy/10 px-1.5 py-0.5 text-xs text-cy">
                  {cleanText(l)}
                </span>
              ))}
            </div>
          )}

          <button onClick={handleJumpToParagraph} className="mt-1 text-xs text-t3 hover:text-ac">
            跳到段落 →
          </button>
        </div>
      )}
    </div>
  );
};
