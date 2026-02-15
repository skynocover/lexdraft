import { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Minus, Plus } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
};

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];
const DEFAULT_BASE_WIDTH = 680;
const ZOOM_STORAGE_KEY = 'lexdraft:pdf-zoom';
const DEFAULT_ZOOM = 150;

const readZoom = (): number => {
  try {
    const v = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (v === null) return DEFAULT_ZOOM;
    const n = Number(v);
    return ZOOM_LEVELS.includes(n) ? n : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
};

const writeZoom = (val: number) => {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(val));
  } catch {
    /* noop */
  }
};

/** Normalize whitespace for fuzzy text matching */
const normalizeText = (text: string): string =>
  text.replace(/\s+/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '');

/**
 * Find and highlight matching text in the PDF text layer.
 * Walks all text layer spans, builds a combined string, finds the match range,
 * then wraps matched characters with <mark> elements.
 */
const highlightTextInContainer = (
  container: HTMLElement,
  searchText: string,
): HTMLElement | null => {
  // Clear previous highlights
  container.querySelectorAll('mark[data-citation-hl]').forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
  });

  if (!searchText) return null;

  const textLayers = container.querySelectorAll('.textLayer');
  const normalizedSearch = normalizeText(searchText);
  // Use a shorter substring for matching (first 30 chars) to improve fuzzy hit rate
  const searchSnippet =
    normalizedSearch.length > 30 ? normalizedSearch.slice(0, 30) : normalizedSearch;

  let firstHighlight: HTMLElement | null = null;

  textLayers.forEach((textLayer) => {
    const spans = Array.from(textLayer.querySelectorAll('span'));
    if (spans.length === 0) return;

    // Build map: normalizedIndex → { spanIdx, charIdx }
    type CharMap = { spanIdx: number; charIdx: number };
    const charMap: CharMap[] = [];
    let combined = '';

    spans.forEach((span, spanIdx) => {
      const text = span.textContent || '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        // Skip whitespace and zero-width chars in the normalized version
        if (/\s/.test(ch) || /[\u200B-\u200D\uFEFF]/.test(ch)) continue;
        charMap.push({ spanIdx, charIdx: i });
        combined += ch;
      }
    });

    const matchIdx = combined.indexOf(searchSnippet);
    if (matchIdx === -1) return;

    // Determine full match length (use full search if it fits, else snippet)
    const fullMatchIdx = combined.indexOf(normalizedSearch);
    const actualMatchStart = fullMatchIdx !== -1 ? fullMatchIdx : matchIdx;
    const actualMatchLen = fullMatchIdx !== -1 ? normalizedSearch.length : searchSnippet.length;

    // Group matched char positions by span
    const spanRanges = new Map<number, { start: number; end: number }[]>();
    for (let i = actualMatchStart; i < actualMatchStart + actualMatchLen; i++) {
      if (i >= charMap.length) break;
      const { spanIdx, charIdx } = charMap[i];
      if (!spanRanges.has(spanIdx)) {
        spanRanges.set(spanIdx, []);
      }
      const ranges = spanRanges.get(spanIdx)!;
      const last = ranges[ranges.length - 1];
      if (last && last.end === charIdx) {
        last.end = charIdx + 1;
      } else {
        ranges.push({ start: charIdx, end: charIdx + 1 });
      }
    }

    // Apply highlights
    spanRanges.forEach((ranges, spanIdx) => {
      const span = spans[spanIdx];
      const text = span.textContent || '';
      const frag = document.createDocumentFragment();
      let pos = 0;

      ranges.forEach(({ start, end }) => {
        if (start > pos) {
          frag.appendChild(document.createTextNode(text.slice(pos, start)));
        }
        const mark = document.createElement('mark');
        mark.setAttribute('data-citation-hl', 'true');
        mark.style.backgroundColor = 'rgba(250, 204, 21, 0.4)';
        mark.style.color = 'inherit';
        mark.style.borderRadius = '2px';
        mark.style.padding = '0';
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        if (!firstHighlight) firstHighlight = mark;
        pos = end;
      });

      if (pos < text.length) {
        frag.appendChild(document.createTextNode(text.slice(pos)));
      }

      span.textContent = '';
      span.appendChild(frag);
    });
  });

  return firstHighlight;
};

export function FileViewer({
  filename,
  pdfUrl,
  loading,
  highlightText,
  onClearHighlight,
}: {
  filename: string;
  pdfUrl: string | null;
  loading: boolean;
  highlightText?: string | null;
  onClearHighlight?: () => void;
}) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState(false);
  const [zoom, setZoomRaw] = useState(readZoom);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightAppliedRef = useRef<string | null>(null);

  const setZoom = (val: number) => {
    setZoomRaw(val);
    writeZoom(val);
  };

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(false);
  }, []);

  const onLoadError = useCallback(() => {
    setError(true);
  }, []);

  const handleZoomIn = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx < ZOOM_LEVELS.length - 1) {
      setZoom(ZOOM_LEVELS[idx + 1]);
    }
  };

  const handleZoomOut = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx > 0) {
      setZoom(ZOOM_LEVELS[idx - 1]);
    }
  };

  // Apply highlight after pages render
  useEffect(() => {
    if (!highlightText || !containerRef.current || numPages === 0) return;
    if (highlightAppliedRef.current === highlightText) return;

    // Wait for text layers to render
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      const firstMark = highlightTextInContainer(containerRef.current, highlightText);
      highlightAppliedRef.current = highlightText;
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [highlightText, numPages]);

  // Clear highlights when highlightText is removed
  useEffect(() => {
    if (!highlightText && highlightAppliedRef.current && containerRef.current) {
      highlightTextInContainer(containerRef.current, '');
      highlightAppliedRef.current = null;
    }
  }, [highlightText]);

  const pageWidth = Math.round(DEFAULT_BASE_WIDTH * (zoom / 100));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        <span className="rounded bg-rd/20 px-2 py-0.5 text-[10px] font-semibold text-rd">PDF</span>
        <span className="truncate text-xs font-medium text-t1">{filename}</span>
        {numPages > 0 && <span className="text-[10px] text-t3">{numPages} 頁</span>}

        {/* Highlight indicator */}
        {highlightText && (
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-yl/20 px-2 py-0.5 text-[10px] text-yl">引用定位</span>
            {onClearHighlight && (
              <button
                onClick={onClearHighlight}
                className="rounded p-0.5 text-t3 transition hover:bg-bg-3 hover:text-t1"
                title="清除標記"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Zoom controls */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_LEVELS[0]}
            className="rounded p-1 text-t3 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-30"
            title="縮小"
          >
            <Minus size={14} />
          </button>
          <span className="min-w-8 text-center text-[11px] text-t2">{zoom}%</span>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            className="rounded p-1 text-t3 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-30"
            title="放大"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* PDF Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-t3">載入 PDF 中...</p>
        </div>
      ) : pdfUrl && !error ? (
        <div ref={containerRef} className="flex-1 overflow-auto bg-[#525659]">
          <Document
            file={pdfUrl}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            options={PDF_OPTIONS}
            loading={
              <div className="flex items-center justify-center py-20">
                <p className="text-sm text-white/60">載入 PDF 中...</p>
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="mx-auto my-3 flex justify-center">
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </div>
            ))}
          </Document>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-t3">無法載入 PDF</p>
        </div>
      )}
    </div>
  );
}
