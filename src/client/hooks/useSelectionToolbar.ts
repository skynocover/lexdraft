import { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/useChatStore';

interface SavedRange {
  from: number;
  to: number;
  text: string;
}

export const useSelectionToolbar = (editor: Editor | null) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const savedRange = useRef<SavedRange | null>(null);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    setPosition(null);
    savedRange.current = null;
  }, []);

  // Selection tracking
  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      if (isLoading) return;

      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, ' ');

      if (text.trim().length < 2) {
        if (!isLoading) dismiss();
        return;
      }

      savedRange.current = { from, to, text };

      const coords = editor.view.coordsAtPos(from);
      setPosition({ top: coords.top - 10, left: coords.left });
      setIsVisible(true);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, isLoading, dismiss]);

  // Scroll listener — hide toolbar on scroll
  useEffect(() => {
    if (!isVisible) return;

    const container = document.querySelector('.a4-editor-container');
    if (!container) return;

    container.addEventListener('scroll', dismiss, { passive: true });
    return () => {
      container.removeEventListener('scroll', dismiss);
    };
  }, [isVisible, dismiss]);

  const handleTransform = useCallback(
    async (operation: string) => {
      if (!editor || !savedRange.current) return;

      const { from, to, text } = savedRange.current;
      setIsLoading(true);

      try {
        const { result } = await api.post<{ result: string }>('/inline-ai/transform', {
          text,
          operation,
        });

        editor.chain().focus().insertContentAt({ from, to }, result).run();
        dismiss();
      } catch (err) {
        console.error('Inline AI transform error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [editor, dismiss],
  );

  const handleDiscussInChat = useCallback(() => {
    if (!savedRange.current) return;

    const text = savedRange.current.text;
    useChatStore.getState().setPrefillInput(`針對以下段落進行討論：\n\n「${text}」\n\n`);
    dismiss();
  }, [dismiss]);

  return { isVisible, position, isLoading, handleTransform, handleDiscussInChat };
};
