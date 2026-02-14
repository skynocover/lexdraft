import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  cMapUrl: "/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/standard_fonts/",
};

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];
const DEFAULT_BASE_WIDTH = 680;
const ZOOM_STORAGE_KEY = "lexdraft:pdf-zoom";
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

export function FileViewer({
  filename,
  pdfUrl,
  loading,
}: {
  filename: string;
  pdfUrl: string | null;
  loading: boolean;
}) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState(false);
  const [zoom, setZoomRaw] = useState(readZoom);

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

  const pageWidth = Math.round(DEFAULT_BASE_WIDTH * (zoom / 100));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        <span className="rounded bg-rd/20 px-2 py-0.5 text-[10px] font-semibold text-rd">
          PDF
        </span>
        <span className="truncate text-xs font-medium text-t1">{filename}</span>
        {numPages > 0 && (
          <span className="text-[10px] text-t3">{numPages} 頁</span>
        )}

        {/* Zoom controls */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_LEVELS[0]}
            className="rounded p-1 text-t3 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-30"
            title="縮小"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="min-w-8 text-center text-[11px] text-t2">
            {zoom}%
          </span>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            className="rounded p-1 text-t3 transition hover:bg-bg-3 hover:text-t1 disabled:opacity-30"
            title="放大"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* PDF Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-t3">載入 PDF 中...</p>
        </div>
      ) : pdfUrl && !error ? (
        <div className="flex-1 overflow-auto bg-[#525659]">
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
