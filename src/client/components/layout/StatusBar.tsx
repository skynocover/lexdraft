import { useChatStore } from '../../stores/useChatStore'

export function StatusBar() {
  const tokenUsage = useChatStore((s) => s.tokenUsage)
  const isStreaming = useChatStore((s) => s.isStreaming)

  return (
    <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-bd bg-bg-1 px-4">
      <div className="flex items-center gap-4">
        <span className="text-[11px] text-t3">Model: Gemini 2.5 Flash</span>
        <span className="text-[11px] text-t3">
          Tokens: {tokenUsage ? tokenUsage.total_tokens.toLocaleString() : '—'}
        </span>
        <span className="text-[11px] text-t3">
          Cost: NT${tokenUsage ? tokenUsage.estimated_cost_ntd.toFixed(4) : '0'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isStreaming ? (
          <span className="flex items-center gap-1 text-[11px] text-yl">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yl" />
            Streaming
          </span>
        ) : (
          <span className="text-[11px] text-gr">Ready</span>
        )}
      </div>
    </footer>
  )
}
