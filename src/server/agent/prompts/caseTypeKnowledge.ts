// ── 案型攻防知識庫 ──
// 按案型注入 Step 2 reasoning prompt，引導 AI 思考常見攻防角度。
// 偵測邏輯：從 caseSummary 計算每個案型的關鍵字命中數，取所有 ≥ MIN_SCORE 的案型（multi-label）。
// 關鍵字只放高辨識度詞，通用詞（工資、薪資、勞基法等）不放，避免跨案型誤判。
// 根據 clientRole 選擇原告或被告視角。
// 新增案型：在 caseTypes/ 建立檔案，然後加入下方 REGISTRY。

import type { ClientRole } from '../../../shared/caseConstants';
import type { CaseTypeEntry } from './caseTypes/types';
import { trafficAccident } from './caseTypes/trafficAccident';
import { loanDispute } from './caseTypes/loanDispute';
import { leaseDispute } from './caseTypes/leaseDispute';
import { laborDismissal } from './caseTypes/laborDismissal';
import { laborOvertime } from './caseTypes/laborOvertime';
import { laborInjury } from './caseTypes/laborInjury';

// ── Registry ──
// 加新案型只要：1) 在 caseTypes/ 新增檔案  2) import + 加一行到這裡
const REGISTRY: CaseTypeEntry[] = [
  trafficAccident,
  loanDispute,
  leaseDispute,
  laborDismissal,
  laborOvertime,
  laborInjury,
];

/** 最低命中關鍵字數，低於此門檻視為未匹配 */
const MIN_SCORE = 2;
/** 最多回傳幾個案型指南（避免 prompt 過長） */
const MAX_MATCHES = 2;

/**
 * 根據案件摘要偵測案型 + clientRole 選擇視角，回傳對應的攻防指南文字。
 *
 * 計分制：計算每個案型命中的關鍵字數。
 * Multi-label：所有 ≥ MIN_SCORE 的案型依分數排序，取前 MAX_MATCHES 個。
 * 回傳 null 表示無對應指南（未匹配或分數不足）。
 */
export const getCaseTypeGuidance = (
  caseSummary: string,
  clientRole?: ClientRole | '',
): string | null => {
  const scored: { entry: CaseTypeEntry; score: number }[] = [];

  for (const entry of REGISTRY) {
    const score = entry.keywords.filter((kw) => caseSummary.includes(kw)).length;
    if (score >= MIN_SCORE) {
      scored.push({ entry, score });
    }
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, MAX_MATCHES);

  const guidances = topMatches.map(({ entry }) =>
    clientRole === 'defendant' ? entry.defendantGuidance : entry.plaintiffGuidance,
  );

  return guidances.join('\n\n');
};
