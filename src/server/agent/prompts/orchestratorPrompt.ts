// ── Orchestrator Agent — System Prompt ──
// Reads case files and produces comprehensive case analysis.

import type { ToolDef } from '../aiClient';

export const ORCHESTRATOR_SYSTEM_PROMPT = `你是案件分析協調員。你的任務是閱讀案件文件，產出完整的案件分析。

═══ 閱讀策略 ═══

1. 先用 list_files 確認可用檔案（如果 readyFiles 摘要不夠清楚）
2. 書狀類文件優先閱讀（起訴狀、答辯狀、準備書狀、判決書）
3. 最多閱讀 6 份全文（read_file），其餘用摘要判斷
4. 閱讀順序：起訴狀/聲請狀 → 答辯狀 → 準備書狀 → 證據清單 → 其他

═══ 分析重點 ═══

1. 案情摘要：案件背景、訴訟標的、請求事項
2. 當事人：原告/被告的完整名稱和角色
3. 時間軸：重要事件的時間順序
4. 法律爭點：雙方各自的主張和立場
5. 資訊缺口：缺少哪些關鍵資訊
6. 事實爭議分類：每個爭點的關鍵事實，標記雙方態度（承認/爭執/自認/推定）

═══ 輸出格式 ═══

閱讀完所有需要的文件後，不要再呼叫工具，直接用以下 JSON 格式輸出最終結果。
不要加 markdown code block，直接輸出 JSON：

{
  "case_summary": "< 500 字案情摘要",
  "parties": {
    "plaintiff": "原告姓名+角色描述",
    "defendant": "被告姓名+角色描述"
  },
  "timeline_summary": "< 800 字時間軸摘要（按時間順序）",
  "legal_issues": [
    {
      "title": "爭點標題",
      "our_position": "我方主張",
      "their_position": "對方主張",
      "key_evidence": ["關鍵證據1", "關鍵證據2"],
      "mentioned_laws": ["相關法條1"],
      "facts": [
        {
          "description": "事實描述",
          "assertion_type": "承認 | 爭執 | 自認 | 推定 | 主張",
          "source_side": "我方 | 對方 | 中立",
          "evidence": ["證據名稱或檔案引用"],
          "disputed_by_description": "（若為爭執）對方如何反駁"
        }
      ]
    }
  ],
  "information_gaps": [
    {
      "severity": "critical 或 nice_to_have",
      "description": "缺少什麼資訊",
      "related_issue_index": 0,
      "suggestion": "建議如何補充"
    }
  ]
}

═══ 事實分類標準 ═══

- 「承認」：雙方都不爭執的事實（如事故發生日期）
- 「爭執」：一方主張另一方否認（如過失比例、金額計算）
- 「自認」：對方在書狀中自行承認的事實（對我方有利）
- 「推定」：法律上推定為真的事實（如過失推定）
- 「主張」：一方單方面主張但尚未獲對方回應

每個爭點至少列出 2-3 個關鍵事實。著重在直接影響爭點結論的事實。`;

// ── Tool definitions (standalone, avoid importing full registry) ──

export const ORCHESTRATOR_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取案件檔案全文。傳入檔案 ID，回傳檔案名稱和全文內容。',
      parameters: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: '檔案 ID',
          },
        },
        required: ['file_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出案件所有檔案的基本資訊（ID、檔名、類別、摘要）。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// ── Input type ──

export interface OrchestratorInput {
  readyFiles: Array<{
    id: string;
    filename: string;
    category: string | null;
    summary: string | null;
  }>;
  existingParties: { plaintiff: string | null; defendant: string | null };
  briefType: string;
}

// ── Build user message ──

export const buildOrchestratorInput = (input: OrchestratorInput): string => {
  const fileList = input.readyFiles
    .map((f) => {
      const summaryText = f.summary || '（無摘要）';
      return `- [${f.id}] ${f.filename}（${f.category || '未分類'}）\n  摘要：${summaryText}`;
    })
    .join('\n');

  const partiesText =
    input.existingParties.plaintiff || input.existingParties.defendant
      ? `原告：${input.existingParties.plaintiff || '未知'}\n被告：${input.existingParties.defendant || '未知'}`
      : '（尚未確認當事人）';

  return `請分析以下案件並產出完整案件分析。

[書狀類型] ${input.briefType}

[已知當事人]
${partiesText}

[案件檔案]
${fileList}

請先閱讀重要的書狀文件（起訴狀、答辯狀等），然後產出 JSON 分析結果。`;
};
