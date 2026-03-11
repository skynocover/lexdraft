import { useState } from 'react';
import { useAnalysisStore, type AnalysisType } from '../stores/useAnalysisStore';
import { useCaseStore } from '../stores/useCaseStore';
import { useChatStore } from '../stores/useChatStore';

const selectProcessingCount = (s: { files: Array<{ status: string }> }) =>
  s.files.filter((f) => f.status === 'processing').length;

export const useAnalysisAction = (type: AnalysisType) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const analyzingType = useAnalysisStore((s) => s.analyzingType);
  const runAnalysis = useAnalysisStore((s) => s.runAnalysis);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentCase = useCaseStore((s) => s.currentCase);
  const processingCount = useCaseStore(selectProcessingCount);

  const isAnalyzing = analyzingType === type || isStreaming;

  const execute = () => {
    if (!currentCase) return;
    runAnalysis(currentCase.id, type);
  };

  const handleConfirm = () => {
    setDialogOpen(false);
    execute();
  };

  return {
    dialogOpen,
    setDialogOpen,
    isAnalyzing,
    processingCount,
    currentCase,
    execute,
    handleConfirm,
  };
};
