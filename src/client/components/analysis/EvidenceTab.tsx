import { useBriefStore } from '../../stores/useBriefStore'

type EvidenceStatus = 'ok' | 'warn' | 'miss'

interface EvidenceRow {
  claim: string
  evidence: string
  status: EvidenceStatus
  source: string
}

const STATUS_STYLE: Record<EvidenceStatus, { label: string; cls: string }> = {
  ok: { label: '充分', cls: 'bg-gr/20 text-gr' },
  warn: { label: '不足', cls: 'bg-yl/20 text-yl' },
  miss: { label: '缺漏', cls: 'bg-rd/20 text-rd' },
}

export function EvidenceTab() {
  const disputes = useBriefStore((s) => s.disputes)
  const damages = useBriefStore((s) => s.damages)

  // Build evidence rows from disputes and damages
  const rows: EvidenceRow[] = []

  for (const d of disputes) {
    const hasEvidence = d.evidence && d.evidence.length > 0
    const evidenceText = hasEvidence ? d.evidence!.join('、') : ''
    rows.push({
      claim: d.our_position || d.title || '未命名主張',
      evidence: evidenceText || '無',
      status: hasEvidence ? (d.evidence!.length >= 2 ? 'ok' : 'warn') : 'miss',
      source: `爭點 ${d.number}`,
    })
  }

  for (const d of damages) {
    const hasEvidence = d.evidence_refs && d.evidence_refs.length > 0
    rows.push({
      claim: `${d.category}：${d.description || ''}（NT$ ${d.amount.toLocaleString()}）`,
      evidence: hasEvidence ? d.evidence_refs.join('、') : '無',
      status: hasEvidence ? 'ok' : 'miss',
      source: '金額',
    })
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-t3">尚無主張與舉證資料，請先分析爭點或計算金額</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-bd text-left">
            <th className="px-2 py-1.5 font-medium text-t3">主張</th>
            <th className="px-2 py-1.5 font-medium text-t3">對應證據</th>
            <th className="px-2 py-1.5 font-medium text-t3 w-16">狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const style = STATUS_STYLE[row.status]
            return (
              <tr key={i} className="border-b border-bd/50">
                <td className="px-2 py-1.5 text-t1">{row.claim}</td>
                <td className="px-2 py-1.5 text-t2">{row.evidence}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.cls}`}>
                    {style.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
