import { useState, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
}

export function FileViewer({
  filename,
  pdfUrl,
  loading,
}: {
  filename: string
  pdfUrl: string | null
  loading: boolean
}) {
  const [numPages, setNumPages] = useState<number>(0)
  const [error, setError] = useState(false)

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setError(false)
  }, [])

  const onLoadError = useCallback(() => {
    setError(true)
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        <span className="rounded bg-rd/20 px-2 py-0.5 text-[10px] font-semibold text-rd">PDF</span>
        <span className="truncate text-xs font-medium text-t1">{filename}</span>
        {numPages > 0 && (
          <span className="text-[10px] text-t3">{numPages} 頁</span>
        )}
      </div>

      {/* PDF Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-t3">載入 PDF 中...</p>
        </div>
      ) : pdfUrl && !error ? (
        <div className="flex-1 overflow-y-auto bg-[#525659]">
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
                  width={680}
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
  )
}
