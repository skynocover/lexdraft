import { useChatStore } from '../../stores/useChatStore';
import { formatDuration } from '../../lib/formatDuration';

export const StatusBar = () => {
  const pipelineTiming = useChatStore((s) => s.pipelineTiming);

  return (
    <footer className="flex h-6.5 shrink-0 items-center border-t border-bd bg-bg-1 px-3">
      {pipelineTiming !== null && (
        <span className="text-[11px] text-t3">Pipeline: {formatDuration(pipelineTiming)}</span>
      )}
    </footer>
  );
};
