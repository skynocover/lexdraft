import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CitationNode } from "./tiptap/extensions/CitationNode";
import { LegalHeading } from "./tiptap/extensions/LegalHeading";
import { LegalParagraph } from "./tiptap/extensions/LegalParagraph";
import { contentStructuredToTiptapDoc } from "./tiptap/converters";
import type { Paragraph } from "../../stores/useBriefStore";

interface VersionPreviewEditorProps {
  content: { paragraphs: Paragraph[] } | null;
  briefTitle: string;
  label: string;
  loading: boolean;
  onRestore: () => void;
}

export const VersionPreviewEditor = ({
  content,
  briefTitle,
  label,
  loading,
  onRestore,
}: VersionPreviewEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
      }),
      LegalHeading,
      LegalParagraph,
      CitationNode,
    ],
    content: contentStructuredToTiptapDoc(content),
    editable: false,
    editorProps: {
      attributes: {
        class: "a4-editor-prose",
      },
    },
  });

  // Sync content when loaded
  useEffect(() => {
    if (!editor || !content) return;
    const newDoc = contentStructuredToTiptapDoc(content);
    editor.commands.setContent(newDoc);
  }, [content, editor]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        <span className="text-[11px] text-t3">唯讀預覽</span>
        <span className="mx-2 h-4 w-px bg-bd" />
        <span className="truncate text-xs font-medium text-t1">{label}</span>
        <div className="ml-auto">
          <button
            onClick={onRestore}
            className="rounded bg-ac px-3 py-1 text-xs font-medium text-bg-0 hover:opacity-90"
          >
            還原到此版本
          </button>
        </div>
      </div>

      {/* A4 Editor Area */}
      <div className="a4-editor-container min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">載入中...</p>
          </div>
        ) : !content || content.paragraphs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">此版本無內容</p>
          </div>
        ) : (
          <div className="a4-editor-content">
            {/* Title — same as A4PageEditor */}
            <div className="a4-title">
              <span>{briefTitle}</span>
            </div>

            {/* Tiptap readonly content */}
            <div>
              <EditorContent editor={editor} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
