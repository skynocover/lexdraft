import { useAnalysisStore } from '../../stores/useAnalysisStore';

type EvidenceStatus = 'ok' | 'warn' | 'miss';

interface EvidenceRow {
  claim: string;
  evidence: string;
  status: EvidenceStatus;
  source: string;
}

const STATUS_STYLE: Record<EvidenceStatus, { label: string; cls: string }> = {
  ok: { label: '充分', cls: 'bg-gr/20 text-gr' },
  warn: { label: '不足', cls: 'bg-yl/20 text-yl' },
  miss: { label: '缺漏', cls: 'bg-rd/20 text-rd' },
};

export function EvidenceTab() {
  const disputes = useAnalysisStore((s) => s.disputes);
  const damages = useAnalysisStore((s) => s.damages);

  // Build evidence rows from disputes and damages
  const rows: EvidenceRow[] = [];

  for (const d of disputes) {
    const hasEvidence = d.evidence && d.evidence.length > 0;
    const evidenceText = hasEvidence ? d.evidence!.join('、') : '';
    rows.push({
      claim: d.our_position || d.title || '未命名主張',
      evidence: evidenceText || '無',
      status: hasEvidence ? (d.evidence!.length >= 2 ? 'ok' : 'warn') : 'miss',
      source: `爭點 ${d.number}`,
    });
  }

  for (const d of damages) {
    const hasEvidence = d.evidence_refs && d.evidence_refs.length > 0;
    rows.push({
      claim: `${d.category}：${d.description || ''}（NT$ ${d.amount.toLocaleString()}）`,
      evidence: hasEvidence ? d.evidence_refs.join('、') : '無',
      status: hasEvidence ? 'ok' : 'miss',
      source: '金額',
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚無主張與舉證資料，透過 AI 助理分析爭點或計算金額</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => {
        const style = STATUS_STYLE[row.status];
        return (
          <div key={i} className="rounded border border-bd bg-bg-2 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 text-xs text-t1">{row.claim}</p>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${style.cls}`}
              >
                {style.label}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-t2">證據：{row.evidence}</p>
            <p className="text-[11px] text-t3">來源：{row.source}</p>
          </div>
        );
      })}
    </div>
  );
}
