import type { Editor } from '@tiptap/react';
import { Undo2, Redo2 } from 'lucide-react';

interface EditorToolbarProps {
  editor: Editor | null;
  stats: { confirmed: number; pending: number };
  dirty: boolean;
  saving: boolean;
  hasContent: boolean;
  versionPanelOpen: boolean;
  onCitationReview: () => void;
  onPrintPreview: () => void;
  onToggleVersionPanel: () => void;
}

export const EditorToolbar = ({
  editor,
  stats,
  dirty,
  saving,
  hasContent,
  versionPanelOpen,
  onCitationReview,
  onPrintPreview,
  onToggleVersionPanel,
}: EditorToolbarProps) => {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
      {/* Undo / Redo */}
      <button
        onClick={() => editor?.chain().focus().undo().run()}
        disabled={!editor?.can().undo()}
        className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
        title="復原 (Ctrl+Z)"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={() => editor?.chain().focus().redo().run()}
        disabled={!editor?.can().redo()}
        className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
        title="重做 (Ctrl+Shift+Z)"
      >
        <Redo2 size={14} />
      </button>
      <span className="mx-2 h-4 w-px bg-bd" />

      {/* Citation stats / review button */}
      {stats.confirmed > 0 || stats.pending > 0 ? (
        <button
          onClick={() => stats.pending > 0 && onCitationReview()}
          className={`text-[11px] ${stats.pending > 0 ? 'hover:text-t1 cursor-pointer' : ''} text-t3`}
        >
          引用：<span className="text-gr">{stats.confirmed} 確認</span>
          {stats.pending > 0 && (
            <>
              {' '}
              · <span className="text-yl">{stats.pending} 待確認</span>
            </>
          )}
        </button>
      ) : (
        <span className="text-[11px] text-t3">引用審查</span>
      )}

      <span className="mx-2 h-4 w-px bg-bd" />

      {/* Print preview button */}
      <button
        onClick={onPrintPreview}
        className="rounded px-3 py-1 text-xs text-t3 hover:text-t1 hover:bg-bg-3"
      >
        列印預覽
      </button>

      {/* Version history button */}
      <button
        onClick={onToggleVersionPanel}
        className={`rounded px-3 py-1 text-xs transition ${versionPanelOpen ? 'bg-bg-3 text-t1' : 'text-t3 hover:text-t1 hover:bg-bg-3'}`}
      >
        版本紀錄
      </button>

      {/* Save status (right side) */}
      <div className="ml-auto text-[11px]">
        {saving ? (
          <span className="text-t3">儲存中...</span>
        ) : hasContent && !dirty ? (
          <span className="text-gr">&#10003; 已儲存</span>
        ) : null}
      </div>
    </div>
  );
};
