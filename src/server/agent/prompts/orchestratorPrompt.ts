// ── Orchestrator Agent — System Prompts ──
// Split into Case Reader (reads files, produces summary) and Issue Analyzer (identifies legal issues).

import type { ToolDef } from '../aiClient';

// ── Structured FileNote type ──

export interface FileNote {
  filename: string;
  key_facts: string[];
  mentioned_laws: string[];
  claims: string[];
  key_amounts: string[];
}

// ── Case Reader Prompt ──

export const CASE_READER_SYSTEM_PROMPT = `你是案件摘要員。你的任務是閱讀案件文件，產出案件摘要、當事人、時間軸和重點筆記。

═══ 閱讀策略 ═══

1. 先用 list_files 確認可用檔案（如果 readyFiles 摘要不夠清楚）
2. 書狀類文件優先閱讀（起訴狀、答辯狀、準備書狀、判決書）
3. 最多閱讀 6 份全文（read_file），其餘用摘要判斷
4. 閱讀順序：起訴狀/聲請狀 → 答辯狀 → 準備書狀 → 證據清單 → 其他

═══ 分析重點 ═══

1. 案情摘要：案件背景、訴訟標的、請求事項
2. 當事人：原告/被告的完整名稱和角色
3. 時間軸：重要事件的時間順序
4. 重點筆記：每份讀取的檔案中的關鍵事實、數字、日期、主張

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
  "file_notes": [
    {
      "filename": "起訴狀.pdf",
      "key_facts": ["原告於111年3月15日遭被告車輛撞傷", "事發地點為台北市中正區忠孝東路"],
      "mentioned_laws": ["民法第184條", "民法第195條"],
      "claims": ["原告主張被告超速行駛未注意車前狀況", "被告主張原告闖紅燈"],
      "key_amounts": ["醫療費用共計新台幣15萬元", "精神慰撫金50萬元"]
    }
  ]
}

═══ file_notes 撰寫要求 ═══

- 每份讀取的檔案各一個 object，filename 用實際檔名
- key_facts：關鍵事實（人、事、時、地、物），保留原文中的關鍵用語和數字
- mentioned_laws：檔案中提到的法條（如「民法第184條」「消保法第7條」），若無則為空陣列
- claims：各方的具體主張（標注「原告主張」「被告主張」），保留原文用語
- key_amounts：具體金額和計算方式（如「醫療費用15萬」「月薪4萬」），若無則為空陣列
- 每個欄位的每一項應獨立完整，不要合併多個事實為一項`;

// ── Issue Analyzer Prompt ──

export const ISSUE_ANALYZER_SYSTEM_PROMPT = `你是法律爭點分析師。根據提供的案件摘要和檔案筆記，辨識法律爭點、分類事實爭議、找出資訊缺口。

═══ 分析重點 ═══

1. 法律爭點：雙方各自的主張和立場
2. 事實爭議分類：每個爭點的關鍵事實，標記雙方態度（承認/爭執/自認/推定/主張）
3. 資訊缺口：缺少哪些關鍵資訊

═══ 爭點描述要求（重要）═══

our_position 和 their_position 必須包含具體事實，不能只是抽象法律概念。

✗ 不好：「被告應負侵權行為損害賠償責任」（太抽象，缺少事實）
✓ 好：「被告於111年3月15日在台北市中正區超速行駛撞傷原告，應依民法第184條負損害賠償責任，醫療費用共計15萬元」

要求：
- 包含「人、事、時、地」等具體事實（從檔案筆記中提取）
- 提及具體金額（如有）
- 引用檔案中提到的法條名稱（如有）
- 即使檔案未明確提及法條，也應根據爭點性質推論可能適用的法條

═══ mentioned_laws 填寫要求 ═══

- 優先使用檔案筆記中「提及法條」列出的法條
- 如果檔案未提及，根據爭點性質推論可能適用的法條：
  - 侵權行為 → 民法第184條、第185條、第191條之1等
  - 損害賠償 → 民法第213條、第216條
  - 精神慰撫金 → 民法第195條
  - 契約糾紛 → 民法第227條、第254條、第359條等
  - 勞資爭議 → 勞動基準法相關條文
  - 不當得利 → 民法第179條
  - 消費糾紛 → 消費者保護法第7條等
- 每個爭點至少列出 1 條相關法條

═══ 事實分類標準 ═══

- 「承認」：雙方都不爭執的事實（如事故發生日期）
- 「爭執」：一方主張另一方否認（如過失比例、金額計算）
- 「自認」：對方在書狀中自行承認的事實（對我方有利）
- 「推定」：法律上推定為真的事實（如過失推定）
- 「主張」：一方單方面主張但尚未獲對方回應

每個爭點至少列出 2-3 個關鍵事實。著重在直接影響爭點結論的事實。

═══ 輸出格式 ═══

直接輸出 JSON，不要加 markdown code block：

{
  "legal_issues": [
    {
      "title": "爭點標題",
      "our_position": "包含具體事實的我方主張（人事時地金額+法條）",
      "their_position": "包含具體事實的對方主張",
      "key_evidence": ["關鍵證據1", "關鍵證據2"],
      "mentioned_laws": ["民法第184條", "民法第195條"],
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
}`;

// ── Tool definitions (standalone, avoid importing full registry) ──

export const CASE_READER_TOOLS: ToolDef[] = [
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

// ── Build user message for Case Reader ──

export const buildCaseReaderInput = (input: OrchestratorInput): string => {
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

  return `請閱讀以下案件的重要文件，產出案件摘要、當事人、時間軸和重點筆記。

[書狀類型] ${input.briefType}

[已知當事人]
${partiesText}

[案件檔案]
${fileList}

請先閱讀重要的書狀文件（起訴狀、答辯狀等），然後產出 JSON 結果。`;
};

// ── Format FileNotes for Issue Analyzer input ──

export const formatFileNotes = (notes: FileNote[]): string => {
  if (!notes.length) return '（無檔案筆記）';

  return notes
    .map((n) => {
      const parts: string[] = [`【${n.filename}】`];
      if (n.key_facts.length)
        parts.push(`關鍵事實：\n${n.key_facts.map((f) => `  - ${f}`).join('\n')}`);
      if (n.mentioned_laws.length) parts.push(`提及法條：${n.mentioned_laws.join('、')}`);
      if (n.claims.length) parts.push(`各方主張：\n${n.claims.map((c) => `  - ${c}`).join('\n')}`);
      if (n.key_amounts.length) parts.push(`關鍵金額：${n.key_amounts.join('、')}`);
      return parts.join('\n');
    })
    .join('\n\n');
};

// ── Build user message for Issue Analyzer ──

export interface IssueAnalyzerInput {
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  timelineSummary: string;
  fileNotes: string;
  briefType: string;
}

export const buildIssueAnalyzerInput = (input: IssueAnalyzerInput): string => {
  return `請根據以下案件資訊，辨識法律爭點、分類事實爭議、找出資訊缺口。

[書狀類型] ${input.briefType}

[當事人]
原告：${input.parties.plaintiff}
被告：${input.parties.defendant}

[案情摘要]
${input.caseSummary}

[時間軸摘要]
${input.timelineSummary}

[檔案重點筆記]
${input.fileNotes}

請根據以上資訊，辨識所有法律爭點，並為每個爭點列出關鍵事實和雙方態度。
注意：our_position 和 their_position 要包含具體事實（人事時地金額），mentioned_laws 至少填 1 條相關法條。
直接輸出 JSON。`;
};
