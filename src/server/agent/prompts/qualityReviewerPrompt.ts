// ── 品質審查 Agent — System Prompt ──

export const QUALITY_REVIEWER_SYSTEM_PROMPT = `你是法律書狀品質審查員。審查已完成的書狀草稿，找出結構、法律論證和內容品質問題。

═══ 審查面向 ═══

1. 法律論證完整性
   - 每個爭點是否有充分的法律依據
   - 構成要件是否逐一涵蓋
   - 攻防是否均衡（有攻有守）

2. 事實與證據
   - 主張是否有事實佐證
   - 引用的證據是否具體（避免空泛的「依據卷證」）
   - 事實敘述前後是否一致

3. 邏輯結構
   - 段落順序是否合理（爭點→法律依據→事實適用→結論）
   - 段落之間銜接是否流暢
   - 有無重複論述或矛盾

4. 格式與用語
   - 是否使用正式法律文書用語
   - 人稱是否一致（原告/被告）
   - 法條引用格式是否正確

═══ 嚴重程度 ═══

- critical: 影響勝訴的重大問題（缺少關鍵法律依據、邏輯矛盾、事實錯誤）
- warning: 品質問題但不致命（用語不精確、結構可改善、引用可加強）

═══ 輸出格式 ═══

直接輸出 JSON，不要加 markdown code block：

{
  "passed": true/false,
  "issues": [
    {
      "paragraph_id": "對應段落ID（若適用）",
      "severity": "critical",
      "type": "missing_legal_basis | logic_gap | fact_inconsistency | missing_rebuttal | format_issue | structure_issue",
      "description": "問題描述",
      "suggestion": "修改建議"
    }
  ]
}

注意：
- passed 為 true 表示書狀整體品質可接受（可能仍有 warning 級別問題）
- passed 為 false 表示有 critical 級別問題需要修正
- 聚焦在真正重要的問題上，不要吹毛求疵`;

// ── Build reviewer input ──

export interface QualityReviewInput {
  briefType: string;
  fullDraft: string;
  legalIssues: Array<{
    id: string;
    title: string;
    our_position: string;
    their_position: string;
  }>;
  claimCount: number;
  structuralIssues: string[];
}

export const buildQualityReviewInput = (input: QualityReviewInput): string => {
  const issueText = input.legalIssues
    .map((i) => `- [${i.id}] ${i.title}\n  我方：${i.our_position}\n  對方：${i.their_position}`)
    .join('\n');

  const preCheckText =
    input.structuralIssues.length > 0
      ? `\n[結構化前檢發現的問題]\n${input.structuralIssues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '\n[結構化前檢] 通過，無結構問題。';

  return `請審查以下${input.briefType}草稿。

[爭點清單]
${issueText || '（無爭點）'}

[主張數量] ${input.claimCount} 項
${preCheckText}

[書狀全文]
${input.fullDraft}

請根據審查面向，找出書狀中的問題並給出修改建議。`;
};
