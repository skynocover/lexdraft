import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface SelectionToolbarProps {
  isVisible: boolean;
  position: { top: number; left: number } | null;
  isLoading: boolean;
  onTransform: (operation: string) => Promise<void>;
  onDiscussInChat: () => void;
}

const OPERATIONS = [
  { key: 'condense', label: '精簡' },
  { key: 'strengthen', label: '加強論述' },
] as const;

export const SelectionToolbar = ({
  isVisible,
  position,
  isLoading,
  onTransform,
  onDiscussInChat,
}: SelectionToolbarProps) => {
  const [activeOp, setActiveOp] = useState<string | null>(null);

  const handleOperation = useCallback(
    async (operation: string) => {
      setActiveOp(operation);
      await onTransform(operation);
      setActiveOp(null);
    },
    [onTransform],
  );

  if (!isVisible || !position) return null;

  const toolbarWidth = 240;
  const viewportWidth = window.innerWidth;
  let left = position.left;

  if (left + toolbarWidth > viewportWidth - 16) {
    left = viewportWidth - toolbarWidth - 16;
  }
  if (left < 16) {
    left = 16;
  }

  const top = position.top - 48;

  return createPortal(
    <div
      className="fixed z-50"
      style={{ top: `${top}px`, left: `${left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1 rounded-lg border border-bd bg-bg-1 px-1.5 py-1 shadow-lg backdrop-blur-sm">
        {OPERATIONS.map((op) => (
          <button
            key={op.key}
            onClick={() => handleOperation(op.key)}
            disabled={isLoading}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-t2 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-t2"
          >
            {isLoading && activeOp === op.key && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.25"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {op.label}
          </button>
        ))}
        <span className="h-4 w-px bg-bd" />
        <button
          onClick={onDiscussInChat}
          disabled={isLoading}
          className="rounded-md px-2.5 py-1 text-xs text-t3 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-40"
        >
          傳送到對話
        </button>
      </div>

      {/* Arrow */}
      <div
        className="ml-6 h-0 w-0"
        style={{
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid var(--color-bd)',
        }}
      />
    </div>,
    document.body,
  );
};
