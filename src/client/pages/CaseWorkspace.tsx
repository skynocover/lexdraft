import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import { useCaseStore, type Case, type CaseFile } from '../stores/useCaseStore'
import { useBriefStore } from '../stores/useBriefStore'
import { api } from '../lib/api'
import { Header } from '../components/layout/Header'
import { StatusBar } from '../components/layout/StatusBar'
import { ChatPanel } from '../components/layout/ChatPanel'
import { RightSidebar } from '../components/layout/RightSidebar'
import { BriefEditor } from '../components/editor'

const mockBrief = {
  paragraphs: [
    {
      id: 'intro',
      section: '壹、前言',
      subsection: '',
      content_md: '為原告艾凡尼國際有限公司與被告朱立家間損害賠償事件，原告依民事訴訟法相關規定，提出本準備書狀，就被告答辯三狀之各項主張，逐一反駁如下。',
      dispute_id: null,
      citations: [],
    },
    {
      id: 'defect1',
      section: '貳、就被告各項抗辯之反駁',
      subsection: '一、關於貨物瑕疵之抗辯',
      content_md: '被告主張貨物存有隱藏性瑕疵，惟查被告於收受貨物時當場驗收簽認，有簽收單可稽。且被告遲至收貨後三個月始主張瑕疵，已逾民法第三百五十六條所定之從速檢查通知義務。',
      dispute_id: '1',
      citations: [
        { id: 'c1', label: '起訴狀 p.3', type: 'file' as const, file_id: 'f1', location: { page: 3, char_start: 120, char_end: 200 }, quoted_text: '被告於收受貨物時當場驗收簽認，有簽收單可稽。', status: 'confirmed' as const },
        { id: 'c2', label: '§356', type: 'law' as const, quoted_text: '買受人應按物之性質，依通常程序從速檢查其所受領之物。', status: 'confirmed' as const },
      ],
    },
    {
      id: 'cancel1',
      section: '貳、就被告各項抗辯之反駁',
      subsection: '二、關於解約通知之效力',
      content_md: '被告辯稱已於一月十五日口頭通知解約，然查被告於答辯二狀中自承係於二月底始發函通知，前後矛盾，顯見被告所辯不實。況且口頭通知並不符合契約約定之書面解約程序，依法不生解約效力。',
      dispute_id: '2',
      citations: [
        { id: 'c3', label: '答辯二狀 p.5', type: 'file' as const, file_id: 'f2', location: { page: 5, char_start: 200, char_end: 280 }, quoted_text: '被告於二月底以存證信函通知原告解除契約。', status: 'pending' as const },
      ],
    },
    {
      id: 'amount1',
      section: '參、請求金額之計算',
      subsection: '',
      content_md: '綜上所述，被告積欠貨款新臺幣參拾捌萬元整，加計自起訴狀繕本送達翌日起至清償日止，按年息百分之五計算之利息，原告之請求應屬有據。',
      dispute_id: null,
      citations: [],
    },
  ],
}

export function CaseWorkspace() {
  const { caseId } = useParams()
  const setCurrentCase = useCaseStore((s) => s.setCurrentCase)
  const setFiles = useCaseStore((s) => s.setFiles)
  const files = useCaseStore((s) => s.files)
  const currentBrief = useBriefStore((s) => s.currentBrief)
  const setCurrentBrief = useBriefStore((s) => s.setCurrentBrief)
  const pollingRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!caseId) return

    // 載入案件資料
    api.get<Case>(`/cases/${caseId}`).then(setCurrentCase).catch(console.error)

    // 載入檔案列表
    api.get<CaseFile[]>(`/cases/${caseId}/files`).then(setFiles).catch(console.error)

    // 載入 mock brief
    setCurrentBrief({
      id: 'mock-brief',
      case_id: caseId,
      brief_type: 'preparation',
      title: '民事準備二狀',
      content_structured: mockBrief,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    return () => {
      setCurrentCase(null)
      setCurrentBrief(null)
      setFiles([])
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [caseId])

  // Polling: 如果有 pending/processing 檔案，每 3 秒刷新
  useEffect(() => {
    const hasPending = files.some((f) => f.status === 'pending' || f.status === 'processing')

    if (hasPending && caseId) {
      pollingRef.current = setInterval(() => {
        api.get<CaseFile[]>(`/cases/${caseId}/files`).then(setFiles).catch(console.error)
      }, 3000)
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [files, caseId])

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <ChatPanel />

        <main className="flex flex-1 flex-col overflow-hidden bg-bg-0">
          <BriefEditor
            content={currentBrief?.content_structured ?? null}
            mode="preview"
            onContentChange={() => {}}
            onCitationClick={() => {}}
          />
        </main>

        <RightSidebar />
      </div>

      <StatusBar />
    </div>
  )
}
