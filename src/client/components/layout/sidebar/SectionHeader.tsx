export function SectionHeader({
  label,
  count,
  countUnit,
  open,
  onToggle,
}: {
  label: string
  count: number
  countUnit: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between px-3 py-2 transition hover:bg-bg-h"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-t3">{open ? '▾' : '▸'}</span>
        <span className="text-xs font-medium text-t2">{label}</span>
      </div>
      <span className="text-[10px] text-t3">{count} {countUnit}</span>
    </button>
  )
}
