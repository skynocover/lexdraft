import { useEffect, useRef, useState } from 'react'

interface PrintPreviewModalProps {
  html: string
  title: string
  onClose: () => void
}

const PRINT_CSS = `
@page {
  size: A4;
  margin: 2.5cm;
  @bottom-center {
    content: counter(page);
    font-family: "DFKai-SB", serif;
    font-size: 12pt;
  }
}
body {
  font-family: "DFKai-SB","BiauKai","標楷體","Noto Serif TC",serif;
  font-size: 14pt;
  line-height: 25pt;
  color: #1a1a1a;
}
h2 {
  font-size: 16pt;
  font-weight: bold;
  break-after: avoid;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h3 {
  font-size: 14pt;
  font-weight: bold;
  break-after: avoid;
  margin-top: 1em;
  margin-bottom: 0.3em;
}
p {
  text-indent: 2em;
  orphans: 2;
  widows: 2;
  margin: 0.3em 0;
}
`

/** Styles injected into the preview container to make Paged.js pages look like white A4 sheets */
const PREVIEW_CONTAINER_CSS = `
.pagedjs_pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}
.pagedjs_page {
  background: white;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  margin: 0 auto;
}
`

export function PrintPreviewModal({ html, title, onClose }: PrintPreviewModalProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const pagedjs = await import('pagedjs')
      if (cancelled || !previewRef.current) return

      previewRef.current.innerHTML = ''

      // Inject preview styles
      const styleEl = document.createElement('style')
      styleEl.textContent = PREVIEW_CONTAINER_CSS
      previewRef.current.appendChild(styleEl)

      const previewer = new pagedjs.Previewer()

      const fullHtml = `<h1 style="text-align:center;font-size:18pt;font-weight:bold;margin-bottom:1em;">${title}</h1>${html}`

      const flow = await previewer.preview(
        fullHtml,
        [{ text: PRINT_CSS }],
        previewRef.current,
      )

      if (!cancelled) {
        setPageCount(flow.total ?? flow.pages?.length ?? 0)
        setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [html, title])

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <h1 style="text-align:center;font-size:18pt;font-weight:bold;margin-bottom:1em;">${title}</h1>
  ${html}
</body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 300)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex h-[90vh] w-[80vw] max-w-5xl flex-col rounded-lg bg-bg-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bd px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-t1">列印預覽</h2>
            {!loading && (
              <span className="text-xs text-t3">共 {pageCount} 頁</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="rounded bg-ac px-3 py-1.5 text-xs font-medium text-bg-0 hover:opacity-90"
            >
              列印 / 存為 PDF
            </button>
            <button
              onClick={onClose}
              className="rounded border border-bd px-3 py-1.5 text-xs text-t2 hover:bg-bg-3"
            >
              關閉
            </button>
          </div>
        </div>

        {/* Preview area — gray background with white A4 page sheets */}
        <div className="flex-1 overflow-y-auto p-6" style={{ background: '#525659' }}>
          {loading && (
            <div className="flex items-center justify-center py-20">
              <span className="text-sm text-t3">正在生成預覽...</span>
            </div>
          )}
          <div
            ref={previewRef}
            style={{ visibility: loading ? 'hidden' : 'visible' }}
          />
        </div>
      </div>
    </div>
  )
}
