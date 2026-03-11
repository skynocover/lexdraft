import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  ANALYSIS_LABELS,
  ANALYSIS_REANALYZE_LABELS,
  type AnalysisType,
} from '../../../shared/types';
import { useAnalysisAction } from '../../hooks/useAnalysisAction';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface ReanalyzeButtonProps {
  type: AnalysisType;
  hasData: boolean;
}

export const ReanalyzeButton = ({ type, hasData }: ReanalyzeButtonProps) => {
  const {
    dialogOpen,
    setDialogOpen,
    isAnalyzing,
    processingCount,
    currentCase,
    execute,
    handleConfirm,
  } = useAnalysisAction(type);
  const tooltip = ANALYSIS_REANALYZE_LABELS[type];
  const label = ANALYSIS_LABELS[type];

  const handleClick = () => {
    if (!currentCase || isAnalyzing) return;
    setDialogOpen(true);
  };

  const buildDialogMessage = (): string => {
    const parts: string[] = [];
    if (processingCount > 0) {
      parts.push(`有 ${processingCount} 個檔案仍在處理中，分析結果可能不完整。`);
    }
    if (hasData) {
      parts.push('現有的分析結果會被覆蓋。');
    }
    parts.push('是否仍要進行分析？');
    return parts.join('\n');
  };

  // Only show as icon button when there is data
  if (!hasData) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleClick}
            disabled={isAnalyzing || !currentCase}
          >
            <RefreshCw className={isAnalyzing ? 'animate-spin' : ''} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirm}
        title={`確認${label}分析`}
        description={buildDialogMessage()}
        confirmLabel="繼續分析"
        variant="primary"
      />
    </>
  );
};
