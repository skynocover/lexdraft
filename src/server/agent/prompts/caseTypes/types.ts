// ── 案型知識庫共用型別 ──

export interface CaseTypeEntry {
  /** 從 caseSummary 偵測案型用的關鍵字（只放高辨識度詞，通用詞不放） */
  keywords: string[];
  /** 原告方（我方為原告時）注入的攻防指南 */
  plaintiffGuidance: string;
  /** 被告方（我方為被告時）注入的攻防指南 */
  defendantGuidance: string;
}
