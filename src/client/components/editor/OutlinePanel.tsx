import { useState, useMemo, useCallback } from "react";
import { useBriefStore } from "../../stores/useBriefStore";

const STORAGE_KEY = "lexdraft:outline-open";

const readOpen = (): boolean => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
};

const writeOpen = (val: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, val ? "1" : "0");
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
        items.push({ id: p.id, section: p.section, subsection: "", level: 0 });
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

  if (outlineItems.length === 0) return null;

  const handleClick = (item: (typeof outlineItems)[number]) => {
    // Try heading first, fall back to paragraph
    let el: Element | null = null;
    if (item.level === 0) {
      el = document.querySelector(
        `[data-section-name="${CSS.escape(item.section)}"]`,
      );
    } else {
      el = document.querySelector(
        `[data-subsection-name="${CSS.escape(item.subsection)}"]`,
      );
    }
    // Fallback: find the paragraph by ID
    if (!el) {
      el = document.querySelector(
        `[data-paragraph-id="${CSS.escape(item.id)}"]`,
      );
    }
    if (el) {
      // Scroll to 1/3 from the top of the scroll container
      const container = el.closest(".a4-editor-container");
      if (container) {
        const elTop = (el as HTMLElement).offsetTop;
        const offset = container.clientHeight / 3;
        container.scrollTo({ top: elTop - offset, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      el.classList.add("highlight-paragraph");
      setTimeout(() => el.classList.remove("highlight-paragraph"), 2000);
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
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            收合目錄
          </button>
          <div className="max-h-64 overflow-y-auto border-t border-bd px-1 py-1">
            {outlineItems.map((item, i) => (
              <button
                key={`${item.section}-${item.subsection}-${i}`}
                onClick={() => handleClick(item)}
                className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition hover:bg-bg-h ${
                  item.level === 0 ? "text-t1 font-medium" : "pl-4 text-t2"
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
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="15" y2="12" />
            <line x1="3" y1="18" x2="18" y2="18" />
          </svg>
          目錄
        </button>
      )}
    </div>
  );
}
