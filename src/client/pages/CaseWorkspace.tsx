import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import { useCaseStore, type Case, type CaseFile } from '../stores/useCaseStore'
import { useBriefStore } from '../stores/useBriefStore'
import { useChatStore } from '../stores/useChatStore'
import { api } from '../lib/api'
import { Header } from '../components/layout/Header'
import { StatusBar } from '../components/layout/StatusBar'
import { ChatPanel } from '../components/layout/ChatPanel'
import { RightSidebar } from '../components/layout/RightSidebar'
import { BriefEditor } from '../components/editor'

export function CaseWorkspace() {
  const { caseId } = useParams()
  const setCurrentCase = useCaseStore((s) => s.setCurrentCase)
  const setFiles = useCaseStore((s) => s.setFiles)
  const files = useCaseStore((s) => s.files)
  const currentBrief = useBriefStore((s) => s.currentBrief)
  const setCurrentBrief = useBriefStore((s) => s.setCurrentBrief)
  const loadBriefs = useBriefStore((s) => s.loadBriefs)
  const loadBrief = useBriefStore((s) => s.loadBrief)
  const loadDisputes = useBriefStore((s) => s.loadDisputes)
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    if (!caseId) return

    // 載入案件資料
    api.get<Case>(`/cases/${caseId}`).then(setCurrentCase).catch(console.error)

    // 載入檔案列表
    api.get<CaseFile[]>(`/cases/${caseId}/files`).then(setFiles).catch(console.error)

    // 載入聊天歷史
    useChatStore.getState().loadHistory(caseId)

    // 載入書狀列表，如有書狀則載入第一個
    loadBriefs(caseId).then(() => {
      const briefs = useBriefStore.getState().briefs
      if (briefs.length > 0) {
        loadBrief(briefs[0].id)
      }
    })

    // 載入爭點
    loadDisputes(caseId)

    return () => {
      setCurrentCase(null)
      setCurrentBrief(null)
      setFiles([])
      useChatStore.getState().clearMessages()
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
