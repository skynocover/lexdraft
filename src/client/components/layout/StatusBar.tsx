import { useChatStore } from '../../stores/useChatStore';

export const StatusBar = () => {
  const tokenUsage = useChatStore((s) => s.tokenUsage);

  return (
    <footer className="flex h-[26px] shrink-0 items-center border-t border-bd bg-bg-1 px-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-t3">
          Tokens: {tokenUsage ? tokenUsage.total_tokens.toLocaleString() : '—'}
        </span>
        <span className="text-[11px] text-t3">
          Cost: NT${tokenUsage ? tokenUsage.estimated_cost_ntd.toFixed(4) : '0'}
        </span>
      </div>
    </footer>
  );
};
