import { useState, useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAnalysisStore, type ClaimGraph, type Dispute } from '../../stores/useAnalysisStore';
import { cleanText } from '../../lib/textUtils';
import { FactList } from './FactList';

type EvidenceStatus = 'ok' | 'warn' | 'miss';

const STATUS_STYLE: Record<EvidenceStatus, { label: string; cls: string }> = {
  ok: { label: '充分', cls: 'bg-gr/20 text-gr' },
  warn: { label: '不足', cls: 'bg-yl/20 text-yl' },
  miss: { label: '缺漏', cls: 'bg-rd/20 text-rd' },
};

const TYPE_BADGE: Record<ClaimGraph['claim_type'], { label: string; cls: string }> = {
  primary: { label: '主張', cls: 'bg-ac/20 text-ac' },
  rebuttal: { label: '反駁', cls: 'bg-or/20 text-or' },
  supporting: { label: '輔助', cls: 'bg-cy/20 text-cy' },
};

const getEvidenceStatus = (evidence: string[] | null): EvidenceStatus => {
  if (!evidence || evidence.length === 0) return 'miss';
  return evidence.length >= 2 ? 'ok' : 'warn';
};

const ClaimCard = ({ claim, allClaims }: { claim: ClaimGraph; allClaims: ClaimGraph[] }) => {
  const badge = TYPE_BADGE[claim.claim_type];
  const target = claim.responds_to ? allClaims.find((c) => c.id === claim.responds_to) : null;

  return (
    <div className="rounded border border-bd/50 bg-bg-1 px-2.5 py-1.5">
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}
        >
          {badge.label}
        </span>
        <p className="flex-1 text-sm leading-relaxed text-t1">{claim.statement}</p>
      </div>
      {target && (
        <div className="mt-1 flex items-center gap-1 pl-7 text-xs text-t3">
          <ArrowRight size={12} className="shrink-0" />
          <span className="truncate">
            回應：{target.id}「{target.statement.slice(0, 50)}」
          </span>
        </div>
      )}
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
          allClaims={claims}
          isHighlighted={d.id === highlightDisputeId}
        />
      ))}

      {unclassifiedClaims.length > 0 && (
        <div className="rounded border border-bd bg-bg-2">
          <div className="px-3 py-2.5 text-sm font-medium text-t3">未分類主張</div>
          <div className="space-y-1.5 border-t border-bd px-3 py-2.5">
            {unclassifiedClaims.map((c) => (
              <ClaimCard key={c.id} claim={c} allClaims={claims} />
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
  allClaims,
  isHighlighted,
}: {
  dispute: Dispute;
  claims: ClaimGraph[];
  allClaims: ClaimGraph[];
  isHighlighted?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const setHighlightDisputeId = useAnalysisStore((s) => s.setHighlightDisputeId);

  const evidenceStatus = getEvidenceStatus(dispute.evidence);
  const statusStyle = STATUS_STYLE[evidenceStatus];

  const ourClaims = claims.filter((c) => c.side === 'ours');
  const theirClaims = claims.filter((c) => c.side === 'theirs');

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
        <span className="shrink-0 rounded bg-ac/20 px-1.5 py-0.5 text-xs font-medium text-ac">
          {dispute.number}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-t1">
          {cleanText(dispute.title || '未命名爭點')}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusStyle.cls}`}>
          {statusStyle.label}
        </span>
        <span className="shrink-0 text-xs text-t3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-bd px-3 py-2.5">
          {/* 我方主張 */}
          {(dispute.our_position || ourClaims.length > 0) && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-ac">我方主張</span>
              {dispute.our_position && (
                <p className="text-sm leading-relaxed text-t2">{cleanText(dispute.our_position)}</p>
              )}
              {ourClaims.map((c) => (
                <ClaimCard key={c.id} claim={c} allClaims={allClaims} />
              ))}
            </div>
          )}

          {/* 對方主張 */}
          {(dispute.their_position || theirClaims.length > 0) && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-or">對方主張</span>
              {dispute.their_position && (
                <p className="text-sm leading-relaxed text-t2">
                  {cleanText(dispute.their_position)}
                </p>
              )}
              {theirClaims.map((c) => (
                <ClaimCard key={c.id} claim={c} allClaims={allClaims} />
              ))}
            </div>
          )}

          {/* 事實爭議 */}
          {dispute.facts && dispute.facts.length > 0 && <FactList facts={dispute.facts} />}

          {/* 證據 */}
          {dispute.evidence && dispute.evidence.length > 0 && (
            <div>
              <span className="text-xs font-medium text-t3">證據</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dispute.evidence.map((e, i) => (
                  <span key={i} className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2">
                    {cleanText(e)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 法條 */}
          {dispute.law_refs && dispute.law_refs.length > 0 && (
            <div>
              <span className="text-xs font-medium text-t3">法條</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dispute.law_refs.map((l, i) => (
                  <span key={i} className="rounded bg-cy/10 px-1.5 py-0.5 text-xs text-cy">
                    {cleanText(l)}
                  </span>
                ))}
              </div>
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
