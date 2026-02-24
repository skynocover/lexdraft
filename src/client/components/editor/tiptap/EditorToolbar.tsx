import { useMemo, useState, useCallback, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { Undo2, Redo2 } from 'lucide-react';
import { useBriefStore } from '../../../stores/useBriefStore';
import { exportBriefToDocx } from './exportDocx';
import type { PageInfo } from '../../../hooks/usePageInfo';

const countChars = (
  paragraphs: { content_md: string; segments?: { text: string }[] }[],
): number => {
  let total = 0;
  for (const p of paragraphs) {
    if (p.segments?.length) {
      for (const seg of p.segments) {
        total += seg.text.replace(/\s/g, '').length;
      }
    } else {
      total += p.content_md.replace(/\s/g, '').length;
    }
  }
  return total;
};

interface EditorToolbarProps {
  editor: Editor | null;
  stats: { confirmed: number; pending: number };
  dirty: boolean;
  saving: boolean;
  hasContent: boolean;
  versionPanelOpen: boolean;
  pageInfo: PageInfo;
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
  pageInfo,
  onCitationReview,
  onPrintPreview,
  onToggleVersionPanel,
}: EditorToolbarProps) => {
  const currentBrief = useBriefStore((s) => s.currentBrief);

  const detectBlockType = useCallback((): string => {
    if (!editor) return 'paragraph';
    if (editor.isActive('heading')) return 'heading';
    return 'paragraph';
  }, [editor]);

  const [blockType, setBlockType] = useState<string>(() => detectBlockType());

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = detectBlockType();
      setBlockType((prev) => (prev === next ? prev : next));
    };
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor, detectBlockType]);

  const handleBlockTypeChange = (value: string) => {
    if (!editor) return;
    if (value === 'heading') {
      editor.chain().focus().setHeading({ level: 2 }).run();
    } else {
      editor.chain().focus().setParagraph().run();
    }
  };

  const charCount = useMemo(() => {
    if (!currentBrief?.content_structured?.paragraphs) return 0;
    return countChars(currentBrief.content_structured.paragraphs);
  }, [currentBrief?.content_structured]);

  const handleDownloadWord = async () => {
    if (!currentBrief?.content_structured) return;
    const title = currentBrief.title || '書狀';
    await exportBriefToDocx(currentBrief.content_structured.paragraphs, title);
  };

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

      {/* Block type tabs */}
      <div className="flex rounded border border-bd bg-bg-2">
        {[
          { value: 'paragraph', label: '內文' },
          { value: 'heading', label: '標題' },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleBlockTypeChange(opt.value)}
            disabled={!editor}
            className={`px-2 py-0.5 text-xs transition ${
              blockType === opt.value ? 'bg-bg-3 text-t1 font-medium' : 'text-t3 hover:text-t1'
            } disabled:opacity-30`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <span className="mx-2 h-4 w-px bg-bd" />

      {/* Content status: Citation + Char count */}
      {stats.confirmed > 0 || stats.pending > 0 ? (
        <button
          onClick={() => stats.pending > 0 && onCitationReview()}
          className={`text-xs ${stats.pending > 0 ? 'cursor-pointer hover:text-t1' : ''} text-t3`}
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
        <span className="text-xs text-t3">引用審查</span>
      )}
      {charCount > 0 && (
        <>
          <span className="text-xs text-t3">·</span>
          <span className="text-xs text-t3">{charCount.toLocaleString()} 字</span>
          <span className="text-xs text-t3">·</span>
          <span className="text-xs text-t3">
            第 {pageInfo.currentPage} / {pageInfo.totalPages} 頁
          </span>
        </>
      )}

      {/* Document actions (right side) */}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onToggleVersionPanel}
          className={`rounded px-3 py-1 text-xs transition ${versionPanelOpen ? 'bg-bg-3 text-t1' : 'text-t3 hover:bg-bg-3 hover:text-t1'}`}
        >
          版本紀錄
        </button>
        <button
          onClick={onPrintPreview}
          className="rounded px-3 py-1 text-xs text-t3 hover:bg-bg-3 hover:text-t1"
        >
          列印預覽
        </button>
        {currentBrief?.content_structured && (
          <button
            onClick={handleDownloadWord}
            className="rounded px-3 py-1 text-xs text-t3 hover:bg-bg-3 hover:text-t1"
          >
            下載 Word
          </button>
        )}
        <span className="mx-1 h-4 w-px bg-bd" />
        <div className="text-xs">
          {saving ? (
            <span className="text-t3">儲存中...</span>
          ) : hasContent && !dirty ? (
            <span className="text-gr">&#10003; 已儲存</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
