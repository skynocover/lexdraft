import { useState, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, AlignLeft } from 'lucide-react';
import { useBriefStore } from '../../stores/useBriefStore';

const STORAGE_KEY = 'lexdraft:outline-open';

const readOpen = (): boolean => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
};

const writeOpen = (val: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, val ? '1' : '0');
  } catch {
    /* noop */
  }
};

export function OutlinePanel() {
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const [open, setOpenRaw] = useState(readOpen);

  const setOpen = useCallback((val: boolean) => {
    setOpenRaw(val);
    writeOpen(val);
  }, []);

  const outlineItems = useMemo(() => {
    if (!currentBrief?.content_structured?.paragraphs) return [];
    const items: {
      id: string;
      section: string;
      subsection: string;
      level: number;
    }[] = [];
    const seenSections = new Set<string>();
    for (const p of currentBrief.content_structured.paragraphs) {
      if (p.section && !seenSections.has(p.section)) {
        seenSections.add(p.section);
        items.push({ id: p.id, section: p.section, subsection: '', level: 0 });
      }
      if (p.subsection && !seenSections.has(`${p.section}/${p.subsection}`)) {
        seenSections.add(`${p.section}/${p.subsection}`);
        items.push({
          id: p.id,
          section: p.section,
          subsection: p.subsection,
          level: 1,
        });
      }
    }
    return items;
  }, [currentBrief?.content_structured]);

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (outlineItems.length === 0) return null;

  const handleClick = (item: (typeof outlineItems)[number]) => {
    // Try heading first, fall back to paragraph
    let el: Element | null = null;
    if (item.level === 0) {
      el = document.querySelector(`[data-section-name="${CSS.escape(item.section)}"]`);
    } else {
      el = document.querySelector(`[data-subsection-name="${CSS.escape(item.subsection)}"]`);
    }
    // Fallback: find the paragraph by ID
    if (!el) {
      el = document.querySelector(`[data-paragraph-id="${CSS.escape(item.id)}"]`);
    }
    if (el) {
      // ProseMirror strips externally-added classes on view updates,
      // so use a temporary overlay div outside its DOM management.
      // Use offsetTop/offsetLeft (layout-relative) instead of getBoundingClientRect
      // to avoid race with scrollIntoView animation.
      const container = el.closest('.a4-editor-container') as HTMLElement | null;
      if (container) {
        // Clean up previous overlay
        if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
        container.querySelector('.outline-highlight-overlay')?.remove();

        const htmlEl = el as HTMLElement;
        const overlay = document.createElement('div');
        overlay.className = 'outline-highlight-overlay';
        Object.assign(overlay.style, {
          position: 'absolute',
          top: `${htmlEl.offsetTop - 2}px`,
          left: `${htmlEl.offsetLeft - 2}px`,
          width: `${htmlEl.offsetWidth + 4}px`,
          height: `${htmlEl.offsetHeight + 4}px`,
        });
        container.appendChild(overlay);
        overlayTimerRef.current = setTimeout(() => overlay.remove(), 2300);
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="absolute left-3 top-14 z-20">
      {open ? (
        <div className="w-48 rounded-lg border border-bd bg-bg-1/95 shadow-lg backdrop-blur-sm">
          <button
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-t2 transition hover:bg-bg-h"
          >
            <ChevronLeft size={12} />
            收合目錄
          </button>
          <div className="max-h-64 overflow-y-auto border-t border-bd px-1 py-1">
            {outlineItems.map((item, i) => (
              <button
                key={`${item.section}-${item.subsection}-${i}`}
                onClick={() => handleClick(item)}
                className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition hover:bg-bg-h ${
                  item.level === 0 ? 'text-t1 font-medium' : 'pl-4 text-t2'
                }`}
              >
                <span className="truncate">
                  {item.level === 0 ? item.section : item.subsection}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-bd bg-bg-1/95 px-3 py-2 text-xs text-t2 shadow-lg backdrop-blur-sm transition hover:bg-bg-h hover:text-t1"
        >
          <AlignLeft size={12} />
          目錄
        </button>
      )}
    </div>
  );
}
