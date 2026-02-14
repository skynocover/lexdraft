export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-72 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
        <p className="mb-4 text-sm text-t1">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-rd px-3 py-1 text-xs text-white transition hover:bg-rd/80"
          >
            刪除
          </button>
        </div>
      </div>
    </div>
  )
}
