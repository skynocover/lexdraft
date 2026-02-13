import { useCallback, useEffect, useRef } from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { DisputesTab } from './DisputesTab'
import { DamagesTab } from './DamagesTab'

const COLLAPSED_HEIGHT = 32
const MIN_HEIGHT = 100
const MAX_HEIGHT = 500

type TabKey = 'disputes' | 'damages'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'disputes', label: '爭點分析' },
  { key: 'damages', label: '金額計算' },
]

export function AnalysisPanel() {
  const open = useUIStore((s) => s.bottomPanelOpen)
  const height = useUIStore((s) => s.bottomPanelHeight)
  const tab = useUIStore((s) => s.bottomPanelTab)
  const toggle = useUIStore((s) => s.toggleBottomPanel)
  const setHeight = useUIStore((s) => s.setBottomPanelHeight)
  const setTab = useUIStore((s) => s.setBottomPanelTab)

  const resizing = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!resizing.current) return
    const delta = startY.current - e.clientY
    const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH.current + delta))
    setHeight(newH)
  }, [setHeight])

  const onMouseUp = useCallback(() => {
    resizing.current = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onMouseMove])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    startY.current = e.clientY
    startH.current = height
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [height, onMouseMove, onMouseUp])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  return (
    <div
      style={{ height: open ? height : COLLAPSED_HEIGHT }}
      className="flex shrink-0 flex-col border-t border-bd bg-bg-1"
    >
      {/* Resize handle — only when open */}
      {open && (
        <div
          onMouseDown={startResize}
          className="h-1 shrink-0 cursor-row-resize bg-bg-3 transition-colors hover:bg-ac"
        />
      )}

      {/* Toggle bar + Tabs */}
      <div className="flex shrink-0 items-center border-b border-bd px-2">
        <button
          onClick={toggle}
          className="mr-2 rounded p-1 text-[10px] text-t3 transition hover:bg-bg-h hover:text-t1"
          title={open ? '收合面板' : '展開面板'}
        >
          {open ? '▼' : '▲'}
        </button>

        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key)
              if (!open) toggle()
            }}
            className={`px-2.5 py-1.5 text-xs transition ${
              tab === t.key
                ? 'border-b-2 border-ac font-medium text-ac'
                : 'text-t3 hover:text-t1'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content area — only when open */}
      {open && (
        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'disputes' && <DisputesTab />}
          {tab === 'damages' && <DamagesTab />}
        </div>
      )}
    </div>
  )
}
