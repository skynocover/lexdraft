import { useMemo, useState } from 'react';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { useAnalysisStore, type ClaimGraph } from '../../stores/useAnalysisStore';

const TYPE_BADGE: Record<ClaimGraph['claim_type'], { label: string; cls: string }> = {
  primary: { label: '主張', cls: 'bg-ac/20 text-ac' },
  rebuttal: { label: '反駁', cls: 'bg-or/20 text-or' },
  supporting: { label: '輔助', cls: 'bg-cy/20 text-cy' },
};

const ClaimCard = ({ claim, allClaims }: { claim: ClaimGraph; allClaims: ClaimGraph[] }) => {
  const badge = TYPE_BADGE[claim.claim_type];
  const target = claim.responds_to ? allClaims.find((c) => c.id === claim.responds_to) : null;

  return (
    <div className="rounded-lg border border-bd bg-bg-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}
        >
          {badge.label}
        </span>
        <p className="flex-1 text-sm leading-relaxed text-t1">{claim.statement}</p>
      </div>
      {target && (
        <div className="mt-1.5 flex items-center gap-1 pl-7 text-xs text-t3">
          <ArrowRight size={12} className="shrink-0" />
          <span className="truncate">
            回應：{target.id}「{target.statement.slice(0, 50)}」
          </span>
        </div>
      )}
    </div>
  );
};

interface DisputeGroup {
  disputeId: string | null;
  disputeTitle: string;
  ourClaims: ClaimGraph[];
  theirClaims: ClaimGraph[];
}

export const ClaimsTab = () => {
  const claims = useAnalysisStore((s) => s.claims);
  const disputes = useAnalysisStore((s) => s.disputes);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['all']));

  const groups = useMemo((): DisputeGroup[] => {
    const disputeMap = new Map(disputes.map((d) => [d.id, d]));
    const map = new Map<string | null, ClaimGraph[]>();
    for (const claim of claims) {
      const key = claim.dispute_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(claim);
    }

    return Array.from(map.entries()).map(([disputeId, groupClaims]) => {
      const dispute = disputeId ? disputeMap.get(disputeId) : null;
      return {
        disputeId,
        disputeTitle: dispute?.title || '未分類主張',
        ourClaims: groupClaims.filter((c) => c.side === 'ours'),
        theirClaims: groupClaims.filter((c) => c.side === 'theirs'),
      };
    });
  }, [claims, disputes]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (claims.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚無主張資料，透過 AI 助理撰寫書狀後自動產生</p>
      </div>
    );
  }

  const ourTotal = claims.filter((c) => c.side === 'ours').length;
  const theirTotal = claims.filter((c) => c.side === 'theirs').length;
  const rebuttalTotal = claims.filter((c) => c.claim_type === 'rebuttal').length;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-3 text-xs text-t3">
        <span>我方 {ourTotal}</span>
        <span>對方 {theirTotal}</span>
        <span>反駁 {rebuttalTotal}</span>
      </div>

      {/* Dispute groups */}
      {groups.map((group) => {
        const key = group.disputeId || '__ungrouped';
        const isExpanded = expandedGroups.has(key) || expandedGroups.has('all');

        return (
          <div key={key} className="rounded-lg border border-bd bg-bg-1">
            <button
              onClick={() => toggleGroup(key)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            >
              <ChevronDown
                size={14}
                className={`shrink-0 text-t3 transition-transform duration-150 ${
                  isExpanded ? '' : '-rotate-90'
                }`}
              />
              <span className="flex-1 text-sm font-medium text-t1">{group.disputeTitle}</span>
              <span className="text-xs text-t3">
                {group.ourClaims.length + group.theirClaims.length} 項
              </span>
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-2 px-3 pb-3">
                {/* Ours */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wider text-t3">我方</p>
                  {group.ourClaims.length > 0 ? (
                    group.ourClaims.map((c) => (
                      <ClaimCard key={c.id} claim={c} allClaims={claims} />
                    ))
                  ) : (
                    <p className="text-xs text-t3/50">（無）</p>
                  )}
                </div>
                {/* Theirs */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wider text-t3">對方</p>
                  {group.theirClaims.length > 0 ? (
                    group.theirClaims.map((c) => (
                      <ClaimCard key={c.id} claim={c} allClaims={claims} />
                    ))
                  ) : (
                    <p className="text-xs text-t3/50">（無）</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
