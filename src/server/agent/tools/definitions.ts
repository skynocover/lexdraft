import type { ToolDef } from '../aiClient';

// Tool definitions in OpenAI function calling format
export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        '列出案件所有檔案，包含 id、filename、category、status、summary。用於了解案件有哪些卷宗文件。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取指定檔案的全文內容（截斷 15000 字）。需要先用 list_files 取得檔案 id。',
      parameters: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: '要讀取的檔案 ID',
          },
        },
        required: ['file_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_brief_section',
      description:
        '撰寫或修改書狀的一個段落。使用 Claude Citations API 從來源文件中提取引用。需要先用 list_files 找到相關檔案。如果提供 paragraph_id 則修改該段落，否則新增段落。',
      parameters: {
        type: 'object',
        properties: {
          brief_id: {
            type: 'string',
            description: '書狀 ID',
          },
          paragraph_id: {
            type: 'string',
            description:
              '要修改的段落 ID（可選）。提供時會原地更新該段落，不提供則新增段落到書狀末尾。',
          },
          section: {
            type: 'string',
            description: '段落所屬章節（如「壹、前言」、「貳、就被告各項抗辯之反駁」）',
          },
          subsection: {
            type: 'string',
            description: '子章節標題（如「一、關於貨物瑕疵之抗辯」），無則留空字串',
          },
          instruction: {
            type: 'string',
            description: '撰寫指示，說明這個段落要表達什麼論點',
          },
          relevant_file_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '相關來源檔案的 ID 列表',
          },
          relevant_law_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '相關法條的 ID 列表（來自 search_law 結果，格式如 A0000001-第184條）',
          },
          dispute_id: {
            type: 'string',
            description: '關聯的爭點 ID（可選）',
          },
        },
        required: ['brief_id', 'section', 'subsection', 'instruction', 'relevant_file_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_brief',
      description:
        '建立一份新的書狀。撰寫書狀前必須先呼叫此工具取得 brief_id，再用 write_brief_section 逐段撰寫。',
      parameters: {
        type: 'object',
        properties: {
          brief_type: {
            type: 'string',
            enum: ['complaint', 'defense', 'preparation', 'appeal'],
            description:
              '書狀類型：complaint 起訴狀、defense 答辯狀、preparation 準備書狀、appeal 上訴狀',
          },
          title: {
            type: 'string',
            description: '書狀標題（如「民事準備二狀」、「民事答辯狀」）',
          },
        },
        required: ['brief_type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_disputes',
      description:
        '分析案件所有檔案，識別雙方爭點。會自動載入所有已處理完成的檔案摘要和主張，分析後寫入爭點資料庫。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_damages',
      description:
        '分析案件文件，計算各項請求金額明細。會自動載入所有已處理完成的檔案摘要（含 key_amounts），分析後寫入金額資料庫。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_law',
      description: `搜尋法規條文。三種搜尋模式：
1. 特定條號（最精準）：「民法第184條」「消保法第7條」「民事訴訟法第277條」→ 直接定位單一條文
2. 法規+概念：「民法 損害賠償」「勞基法 工時」→ 在特定法規中搜尋相關條文
3. 純概念：「侵權行為」「不當得利」→ 跨法規全文搜尋

格式要點：
- 支援常見縮寫：消保法、勞基法、個資法、國賠法、民訴法、刑訴法、強執法、證交法等
- 每次只搜尋一個條文，多條分次搜尋（例如需要民法第184條和第195條，應分兩次呼叫）
- 搜尋結果會自動寫入案件法條引用列表`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              '搜尋關鍵字。範例：「民法第184條」「消保法第7條」「民法 損害賠償」「侵權行為」',
          },
          law_name: {
            type: 'string',
            description:
              '指定搜尋的法規名稱（如「民法」「刑法」「勞動基準法」），支援縮寫。指定後會在該法規範圍內搜尋。',
          },
          limit: {
            type: 'number',
            description: '回傳筆數上限，預設 10',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_timeline',
      description:
        '分析案件所有檔案，產生時間軸事件列表。自動載入所有已處理完成的檔案摘要，分析日期、事件等時間相關資訊，產生時間軸供律師參考。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_full_brief',
      description: `撰寫一份完整的法律書狀。內部自動執行完整 pipeline：載入案件資料 → 分析爭點（如尚未分析）→ 規劃書狀結構 → 平行搜尋法條 → 逐段撰寫（含引用）。

使用時機：使用者明確要求撰寫一份完整書狀（如「幫我寫民事準備書狀」「撰寫答辯狀」「幫我寫書狀」）。
不要用於：修改單段內容、補充法條引用、微調特定段落、回答法律問題。這些情境應使用 write_brief_section。`,
      parameters: {
        type: 'object',
        properties: {
          brief_type: {
            type: 'string',
            enum: ['complaint', 'defense', 'preparation', 'appeal'],
            description:
              '書狀類型：complaint 起訴狀、defense 答辯狀、preparation 準備書狀、appeal 上訴狀',
          },
          title: {
            type: 'string',
            description: '書狀標題（如「民事準備二狀」、「民事答辯狀」）',
          },
        },
        required: ['brief_type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'review_brief',
      description: `審查書狀品質。對案件最新的書狀進行全面品質審查，包含：
1. 結構檢查：主張覆蓋、爭點對應、段落完整性
2. 法律論證完整性：法律依據是否充分、構成要件是否涵蓋
3. 事實與證據：主張是否有事實佐證、引用是否具體
4. 邏輯結構：段落順序、銜接流暢度、有無重複矛盾
5. 格式與用語：法律文書用語、人稱一致性、法條引用格式

使用時機：使用者要求審查書狀品質、檢查書狀、品質審查時呼叫此工具。`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
