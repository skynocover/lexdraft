export function ConfirmDialog({
  message,
  children,
  confirmLabel = '刪除',
  variant = 'danger',
  onConfirm,
  onCancel,
}: {
  message: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmCls =
    variant === 'danger' ? 'bg-rd text-white hover:bg-rd/80' : 'bg-ac text-bg-0 hover:opacity-90';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
        <p className="text-sm text-t1">{message}</p>
        {children && <div className="mt-1">{children}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`rounded px-3 py-1 text-xs transition ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
