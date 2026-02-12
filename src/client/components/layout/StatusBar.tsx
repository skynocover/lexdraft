export function StatusBar() {
  return (
    <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-bd bg-bg-1 px-4">
      <div className="flex items-center gap-4">
        <span className="text-[11px] text-t3">Model: Claude Sonnet</span>
        <span className="text-[11px] text-t3">Tokens: —</span>
        <span className="text-[11px] text-t3">Cost: NT$0</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gr">Citations API ✓</span>
      </div>
    </footer>
  )
}
