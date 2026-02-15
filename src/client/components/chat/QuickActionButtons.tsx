import { Undo2 } from 'lucide-react';

interface SuggestedAction {
  label: string;
  prompt: string;
}

interface QuickActionButtonsProps {
  actions: SuggestedAction[];
  onAction: (prompt: string) => void;
  onRewind?: () => void;
  showRewind?: boolean;
}

export const QuickActionButtons = ({
  actions,
  onAction,
  onRewind,
  showRewind,
}: QuickActionButtonsProps) => {
  if (actions.length === 0 && !showRewind) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {showRewind && onRewind && (
        <button
          onClick={onRewind}
          className="flex items-center gap-1 rounded-full border border-rd/30 bg-rd/10 px-3 py-1 text-xs text-rd transition hover:bg-rd/20"
        >
          <Undo2 size={12} />
          回復變更
        </button>
      )}
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          className="rounded-full border border-bd bg-bg-2 px-3 py-1 text-xs text-t2 transition hover:bg-bg-3 hover:text-t1"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
};
