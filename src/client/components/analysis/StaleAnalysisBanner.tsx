import { FilePlus2 } from 'lucide-react';
import { Button } from '../ui/button';

interface StaleAnalysisBannerProps {
  count: number;
  onReanalyze: () => void;
  isAnalyzing: boolean;
}

export const StaleAnalysisBanner = ({
  count,
  onReanalyze,
  isAnalyzing,
}: StaleAnalysisBannerProps) => {
  if (count <= 0) return null;

  return (
    <div className="flex items-center gap-2 rounded border border-ac/20 bg-ac/5 px-3 py-2">
      <FilePlus2 size={14} className="shrink-0 text-ac" />
      <span className="flex-1 text-xs text-t2">{count} 個新檔案尚未納入分析</span>
      <Button variant="outline" size="xs" onClick={onReanalyze} disabled={isAnalyzing}>
        重新分析
      </Button>
    </div>
  );
};
