import type { ToolDef } from "../aiClient";

// Tool definitions in OpenAI function calling format
export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "列出案件所有檔案，包含 id、filename、category、status、summary。用於了解案件有哪些卷宗文件。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "讀取指定檔案的全文內容（截斷 15000 字）。需要先用 list_files 取得檔案 id。",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description: "要讀取的檔案 ID",
          },
        },
        required: ["file_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_brief_section",
      description:
        "撰寫書狀的一個段落。使用 Claude Citations API 從來源文件中提取引用。需要先用 list_files 找到相關檔案。",
      parameters: {
        type: "object",
        properties: {
          brief_id: {
            type: "string",
            description: "書狀 ID",
          },
          section: {
            type: "string",
            description:
              "段落所屬章節（如「壹、前言」、「貳、就被告各項抗辯之反駁」）",
          },
          subsection: {
            type: "string",
            description:
              "子章節標題（如「一、關於貨物瑕疵之抗辯」），無則留空字串",
          },
          instruction: {
            type: "string",
            description: "撰寫指示，說明這個段落要表達什麼論點",
          },
          relevant_file_ids: {
            type: "array",
            items: { type: "string" },
            description: "相關來源檔案的 ID 列表",
          },
          relevant_law_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "相關法條的 ID 列表（來自 search_law 結果，格式如 A0000001-第184條）",
          },
          dispute_id: {
            type: "string",
            description: "關聯的爭點 ID（可選）",
          },
        },
        required: [
          "brief_id",
          "section",
          "subsection",
          "instruction",
          "relevant_file_ids",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_brief",
      description:
        "建立一份新的書狀。撰寫書狀前必須先呼叫此工具取得 brief_id，再用 write_brief_section 逐段撰寫。",
      parameters: {
        type: "object",
        properties: {
          brief_type: {
            type: "string",
            enum: ["complaint", "defense", "preparation", "appeal"],
            description:
              "書狀類型：complaint 起訴狀、defense 答辯狀、preparation 準備書狀、appeal 上訴狀",
          },
          title: {
            type: "string",
            description: "書狀標題（如「民事準備二狀」、「民事答辯狀」）",
          },
        },
        required: ["brief_type", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_disputes",
      description:
        "分析案件所有檔案，識別雙方爭點。會自動載入所有已處理完成的檔案摘要和主張，分析後寫入爭點資料庫。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_damages",
      description:
        "分析案件文件，計算各項請求金額明細。會自動載入所有已處理完成的檔案摘要（含 key_amounts），分析後寫入金額資料庫。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_law",
      description:
        "搜尋法規條文。支援法規名稱（如「民法」）、特定條號（如「民法第184條」）、法律概念（如「損害賠償」）等搜尋方式。搜尋結果會自動寫入案件法條引用列表。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜尋關鍵字，例如「民法第184條」或「損害賠償」",
          },
          limit: {
            type: "number",
            description: "回傳筆數上限，預設 10",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_timeline",
      description:
        "分析案件所有檔案，產生時間軸事件列表。自動載入所有已處理完成的檔案摘要，分析日期、事件等時間相關資訊，產生時間軸供律師參考。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];
