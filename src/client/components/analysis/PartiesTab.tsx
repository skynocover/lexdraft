import { useCaseStore } from '../../stores/useCaseStore'

export function PartiesTab() {
  const currentCase = useCaseStore((s) => s.currentCase)

  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-t3">尚未載入案件資料</p>
      </div>
    )
  }

  const hasParties = currentCase.plaintiff || currentCase.defendant

  if (!hasParties) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-t3">案件尚未設定當事人資料</p>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      {/* Plaintiff */}
      {currentCase.plaintiff && (
        <div className="flex-1 rounded border border-ac/30 bg-ac/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-ac/20 px-1.5 py-0.5 text-[10px] font-medium text-ac">
              原告
            </span>
          </div>
          <p className="text-sm font-medium text-t1">{currentCase.plaintiff}</p>
          {currentCase.case_type && (
            <p className="mt-1 text-[11px] text-t3">案件類型：{currentCase.case_type}</p>
          )}
        </div>
      )}

      {/* Defendant */}
      {currentCase.defendant && (
        <div className="flex-1 rounded border border-or/30 bg-or/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-or/20 px-1.5 py-0.5 text-[10px] font-medium text-or">
              被告
            </span>
          </div>
          <p className="text-sm font-medium text-t1">{currentCase.defendant}</p>
          {currentCase.court && (
            <p className="mt-1 text-[11px] text-t3">管轄法院：{currentCase.court}</p>
          )}
        </div>
      )}
    </div>
  )
}
