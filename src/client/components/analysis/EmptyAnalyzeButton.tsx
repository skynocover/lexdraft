import { Button } from '../ui/button';
import { ANALYSIS_ACTION_LABELS, type AnalysisType } from '../../../shared/types';
import { useAnalysisAction } from '../../hooks/useAnalysisAction';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface EmptyAnalyzeButtonProps {
  type: AnalysisType;
}

export const EmptyAnalyzeButton = ({ type }: EmptyAnalyzeButtonProps) => {
  const {
    dialogOpen,
    setDialogOpen,
    isAnalyzing,
    processingCount,
    currentCase,
    execute,
    handleConfirm,
  } = useAnalysisAction(type);

  const handleClick = () => {
    if (!currentCase || isAnalyzing) return;

    if (processingCount > 0) {
      setDialogOpen(true);
      return;
    }

    execute();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!currentCase || isAnalyzing}
        onClick={handleClick}
      >
        {isAnalyzing ? 'AI 分析中...' : ANALYSIS_ACTION_LABELS[type]}
      </Button>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirm}
        title="檔案處理中"
        description={`有 ${processingCount} 個檔案仍在處理中，分析結果可能不完整。是否仍要進行分析？`}
        confirmLabel="繼續分析"
        variant="primary"
      />
    </>
  );
};
