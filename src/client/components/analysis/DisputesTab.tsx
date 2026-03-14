import { useMemo, type FC } from 'react';
import { ChevronRight, Search, AlertTriangle } from 'lucide-react';
import { useAnalysisStore, type Damage } from '../../stores/useAnalysisStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { useDamageCrud } from '../../hooks/useDamageCrud';
import { cleanText, formatAmount, DAMAGE_FALLBACK_LABEL } from '../../lib/textUtils';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { DamageFormDialog } from './DamageFormDialog';
import { DisputeCard } from './DisputeCard';
import { ReanalyzeButton } from './ReanalyzeButton';
import { EmptyAnalyzeButton } from './EmptyAnalyzeButton';
import { UndisputedFactsBlock } from './UndisputedFactsBlock';
import { UndisputedDamagesBlock } from './UndisputedDamagesBlock';
import { StaleAnalysisBanner } from './StaleAnalysisBanner';
import { useNewFileCount } from '../../hooks/useNewFileCount';
import { useAnalysisAction } from '../../hooks/useAnalysisAction';

// ── Information Gaps Block ──

const InformationGapsBlock: FC<{ gaps: string[] }> = ({ gaps }) => {
  if (gaps.length === 0) return null;

  return (
    <Collapsible className="rounded border border-bd bg-bg-2 px-3 py-2.5">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
        <ChevronRight
          size={14}
          className="shrink-0 text-t3 transition-transform duration-200 [[data-state=open]>&]:rotate-90"
        />
        <AlertTriangle className="size-3.5 shrink-0 text-or" />
        <span className="text-xs font-medium text-t2">資訊缺口</span>
        <span className="text-xs text-t3">({gaps.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1 pl-5">
        {gaps.map((gap, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div className="rounded bg-bg-1 px-2.5 py-1.5">
                <p className="line-clamp-2 text-sm text-or/80">{gap}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-72">
              {gap}
            </TooltipContent>
          </Tooltip>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

const EMPTY_DAMAGES: Damage[] = [];

// ── DisputesTab (main container) ──

export const DisputesTab = () => {
  const disputes = useAnalysisStore((s) => s.disputes);
  const damages = useAnalysisStore((s) => s.damages);
  const undisputedFacts = useAnalysisStore((s) => s.undisputedFacts);
  const informationGaps = useAnalysisStore((s) => s.informationGaps);
  const caseId = useCaseStore((s) => s.currentCase?.id);
  const files = useCaseStore((s) => s.files);
  const fileByName = useMemo(() => new Map(files.map((f) => [f.filename, f])), [files]);
  const newFileCount = useNewFileCount('disputes');
  const { isAnalyzing, execute: reanalyze } = useAnalysisAction('disputes');

  // Single damage CRUD instance for all children (DisputeCard + UndisputedFactsBlock)
  const dmg = useDamageCrud(caseId);

  // Group damages by dispute_id + compute totals in single pass
  const {
    damagesByDispute,
    damageTotalByDispute,
    unassignedDamages,
    unassignedTotal,
    totalAmount,
  } = useMemo(() => {
    const grouped = new Map<string, Damage[]>();
    const totals = new Map<string, number>();
    const unassigned: Damage[] = [];
    let total = 0;
    let unassignedSum = 0;
    for (const d of damages) {
      total += d.amount;
      if (d.dispute_id) {
        const list = grouped.get(d.dispute_id) ?? [];
        list.push(d);
        grouped.set(d.dispute_id, list);
        totals.set(d.dispute_id, (totals.get(d.dispute_id) ?? 0) + d.amount);
      } else {
        unassigned.push(d);
        unassignedSum += d.amount;
      }
    }
    return {
      damagesByDispute: grouped,
      damageTotalByDispute: totals,
      unassignedDamages: unassigned,
      unassignedTotal: unassignedSum,
      totalAmount: total,
    };
  }, [damages]);

  if (disputes.length === 0 && undisputedFacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
        <Search className="h-8 w-8 text-t3" />
        <p className="text-center text-xs text-t3">尚未分析爭點</p>
        <EmptyAnalyzeButton type="disputes" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto">
        <div className="flex items-center text-xs text-t3">
          <span>{disputes.length} 個爭點</span>
          <span className="flex-1" />
          <ReanalyzeButton type="disputes" hasData={disputes.length > 0} />
        </div>

        <StaleAnalysisBanner
          count={newFileCount}
          onReanalyze={reanalyze}
          isAnalyzing={isAnalyzing}
        />

        <InformationGapsBlock gaps={informationGaps} />

        {disputes.map((d) => (
          <DisputeCard
            key={d.id}
            dispute={d}
            caseId={caseId!}
            fileByName={fileByName}
            damages={damagesByDispute.get(d.id) ?? EMPTY_DAMAGES}
            damageTotal={damageTotalByDispute.get(d.id) ?? 0}
            onAddDamage={dmg.openAdd}
            onEditDamage={dmg.openEdit}
            onDeleteDamage={dmg.stageDelete}
          />
        ))}

        {caseId && <UndisputedFactsBlock facts={undisputedFacts} caseId={caseId} />}

        {caseId && (
          <UndisputedDamagesBlock
            damages={unassignedDamages}
            total={unassignedTotal}
            fileByName={fileByName}
            onAddDamage={dmg.openAdd}
            onEditDamage={dmg.openEdit}
            onDeleteDamage={dmg.stageDelete}
          />
        )}
      </div>

      {/* 請求總額 sticky bar */}
      {totalAmount > 0 && (
        <div className="shrink-0 border-t border-bd bg-bg-0 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ac">請求總額</span>
            <span className="text-sm font-bold text-ac">{formatAmount(totalAmount)}</span>
          </div>
        </div>
      )}

      {/* Shared damage dialogs — single instance for all DisputeCards + UndisputedFactsBlock */}
      <DamageFormDialog
        open={dmg.formOpen}
        onOpenChange={(open) => !open && dmg.closeForm()}
        damage={dmg.editing}
        onSubmit={dmg.handleSubmit}
        loading={dmg.loading}
      />

      <ConfirmDialog
        open={!!dmg.deleting}
        onOpenChange={(open) => !open && dmg.clearDelete()}
        description={`確定刪除金額項目「${cleanText(dmg.deleting?.description || DAMAGE_FALLBACK_LABEL)}」？`}
        onConfirm={dmg.handleConfirmDelete}
      />
    </div>
  );
};
