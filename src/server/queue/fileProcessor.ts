import { eq } from "drizzle-orm";
import { getDocumentProxy, extractText } from "unpdf";
import { getDB } from "../db";
import { files } from "../db/schema";

const CMAP_BASE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/";

/**
 * Workers 環境用的 CMap reader。
 * 預設的 NodeCMapReaderFactory 會用 fs.readFile 讀 URL 路徑，在 Workers 中必定失敗。
 * 這個類別改用 fetch() 從 CDN 下載 CMap 二進位檔。
 */
class WorkersCMapReaderFactory {
  baseUrl: string;
  isCompressed: boolean;

  constructor({ baseUrl = CMAP_BASE_URL, isCompressed = true } = {}) {
    this.baseUrl = baseUrl;
    this.isCompressed = isCompressed;
  }

  async fetch({ name }: { name: string }) {
    const url = this.baseUrl + name + (this.isCompressed ? ".bcmap" : "");
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load CMap at: ${url} (${response.status})`);
    }
    const cMapData = new Uint8Array(await response.arrayBuffer());
    return { cMapData, isCompressed: this.isCompressed };
  }
}

interface FileMessage {
  fileId: string;
  caseId: string;
  r2Key: string;
  filename: string;
}

interface ClassificationResult {
  category: "ours" | "theirs" | "court" | "evidence" | "other";
  doc_type: string;
  doc_date: string | null;
  summary: {
    type: string;
    party: string | null;
    summary: string;
    key_claims: string[];
    key_dates: string[];
    key_amounts: number[];
    contradictions: string[];
    judge_focus: string | null;
  };
}

const CLASSIFY_PROMPT = `你是法律文件分類助手。根據以下檔案名稱和內容，判斷：

1. category: ours（我方書狀）| theirs（對方書狀）| court（法院文件）| evidence（證據）| other
2. doc_type: complaint | defense | preparation | transcript | ruling | notice | evidence | other
3. doc_date: 文件日期（YYYY-MM-DD），如無法判斷則 null
4. summary: 結構化摘要

分類依據：
- ours：包含「起訴狀」「準備狀」「準備○狀」且為我方
- theirs：包含「答辯」「答辯○狀」「爭點整理狀」且為對方
- court：包含「筆錄」「通知書」「裁定」「判決」
- evidence：合約、發票、照片、診斷證明等獨立證據
- other：無法分類

如果是對方書狀，特別注意提取所有抗辯要點和前後矛盾之處。
如果是法院筆錄，特別注意提取法官詢問的問題和關注的重點。

所有欄位內容一律使用繁體中文撰寫（party 欄位除外）。
回傳純 JSON，不要包含 markdown 標記。格式：
{
  "category": "...",
  "doc_type": "...",
  "doc_date": "..." or null,
  "summary": {
    "type": "文件類型（繁體中文，如「民事起訴狀」「答辯狀」「言詞辯論筆錄」）",
    "party": "plaintiff" | "defendant" | null,
    "summary": "繁體中文摘要",
    "key_claims": ["繁體中文主張1", ...],
    "key_dates": ["繁體中文日期描述1", ...],
    "key_amounts": [數字金額, ...],
    "contradictions": ["繁體中文矛盾點1", ...],
    "judge_focus": null or "繁體中文法官關注重點"
  }
}`;

const MARKDOWN_PROMPT = `你是文件格式轉換助手。將以下從 PDF 提取的純文字轉換為結構化的 Markdown 格式。

轉換規則：
1. 識別文件的標題、章節標題、子章節標題，使用 ## 和 ### 標記
2. 表格資料整理成清晰的段落或列表，不需要用 markdown 表格語法
3. 保留所有原始文字內容，不要省略、摘要或改寫任何內容
4. key-value 格式（如「姓名：王小明」）保持原樣，不需要轉換
5. 如果文件已經有清晰結構（如 一、二、三），保持原有編號，只在主要段落前加 ## 標題
6. 不要加入任何原文沒有的內容
7. 每個 ## 標題應該代表文件中一個語意獨立的段落或區塊

目標：產出的 Markdown 可以用 ## 作為分割點，將文件切成有意義的段落。`;

async function convertToMarkdown(
  text: string,
  env: { CF_ACCOUNT_ID: string; CF_GATEWAY_ID: string; CF_AIG_TOKEN: string },
): Promise<string> {
  const truncated = text.slice(0, 15000);

  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
    },
    body: JSON.stringify({
      model: "google-ai-studio/gemini-2.0-flash-lite",
      messages: [
        { role: "system", content: MARKDOWN_PROMPT },
        {
          role: "user",
          content:
            text.length > 15000
              ? `以下是文件內容（前 15000 字）：\n\n${truncated}`
              : `以下是文件內容：\n\n${truncated}`,
        },
      ],
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `AI Gateway error (markdown): ${response.status} - ${errText}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { role: string; content: string } }>;
  };

  return data.choices?.[0]?.message?.content || text;
}

async function classifyWithAI(
  filename: string,
  text: string,
  env: { CF_ACCOUNT_ID: string; CF_GATEWAY_ID: string; CF_AIG_TOKEN: string },
): Promise<ClassificationResult> {
  // 截取前 8000 字元（避免 token 爆量）
  const truncated = text.slice(0, 8000);

  // Cloudflare AI Gateway Unified API（OpenAI 相容），使用 Unified Billing 不需要 provider API key
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
    },
    body: JSON.stringify({
      model: "google-ai-studio/gemini-2.0-flash-lite",
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        {
          role: "user",
          content: `檔案名稱：${filename}\n\n文件內容（前 8000 字）：\n${truncated}`,
        },
      ],
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { role: string; content: string } }>;
  };
  const text_content = data.choices?.[0]?.message?.content || "{}";

  return JSON.parse(text_content) as ClassificationResult;
}

export async function processFileMessage(
  message: FileMessage,
  env: {
    DB: D1Database;
    BUCKET: R2Bucket;
    CF_ACCOUNT_ID: string;
    CF_GATEWAY_ID: string;
    CF_AIG_TOKEN: string;
  },
) {
  const db = getDB(env.DB);

  // 標記為 processing
  await db
    .update(files)
    .set({ status: "processing", updated_at: new Date().toISOString() })
    .where(eq(files.id, message.fileId));

  try {
    // 1. 從 R2 讀取 PDF
    const object = await env.BUCKET.get(message.r2Key);
    if (!object) {
      throw new Error("R2 object not found");
    }
    const pdfBuffer = await object.arrayBuffer();

    // 2. 提取文字（需提供 CMap 支援中文 PDF 字型解碼）
    //    Workers 環境下 pdfjs 誤判為 Node.js，會用 fs.readFile 讀 CMap 而失敗，
    //    因此傳入自訂 CMapReaderFactory 改用 fetch() 下載。
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer), {
      CMapReaderFactory: WorkersCMapReaderFactory as any,
      cMapUrl: CMAP_BASE_URL,
      cMapPacked: true,
    });
    const result = await extractText(pdf);
    const fullText = Array.isArray(result.text)
      ? result.text.join("\n")
      : String(result.text || "");

    if (!fullText.trim()) {
      throw new Error("PDF 文字提取失敗，可能為純圖片掃描檔");
    }

    // 3. AI 分類 + 摘要 + Markdown 轉換（透過 Cloudflare AI Gateway）
    let classification: ClassificationResult;
    let contentMd: string | null = null;
    if (env.CF_ACCOUNT_ID && env.CF_GATEWAY_ID && env.CF_AIG_TOKEN) {
      const [classResult, mdResult] = await Promise.all([
        classifyWithAI(message.filename, fullText, env),
        convertToMarkdown(fullText, env).catch((err) => {
          console.error(
            `Markdown conversion failed for ${message.fileId}:`,
            err,
          );
          return null;
        }),
      ]);
      classification = classResult;
      contentMd = mdResult;
    } else {
      // 無 AI Gateway 設定時用 fallback 分類
      classification = fallbackClassify(message.filename);
    }

    // 4. 更新 D1
    await db
      .update(files)
      .set({
        status: "ready",
        full_text: fullText,
        content_md: contentMd,
        category: classification.category,
        doc_type: classification.doc_type,
        doc_date: classification.doc_date,
        summary: JSON.stringify(classification.summary),
        extracted_claims: JSON.stringify(
          classification.summary.key_claims || [],
        ),
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId));
  } catch (err) {
    // 處理失敗
    await db
      .update(files)
      .set({
        status: "error",
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId));
    console.error(`File processing failed for ${message.fileId}:`, err);
    throw err; // 讓 Queue 重試
  }
}

/** 無 API key 時的 fallback 分類（純靠檔名） */
function fallbackClassify(filename: string): ClassificationResult {
  const name = filename.toLowerCase();
  let category: ClassificationResult["category"] = "other";
  let doc_type = "other";

  if (name.includes("起訴") || name.includes("準備")) {
    category = "ours";
    doc_type = name.includes("起訴") ? "complaint" : "preparation";
  } else if (name.includes("答辯") || name.includes("爭點")) {
    category = "theirs";
    doc_type = "defense";
  } else if (name.includes("筆錄")) {
    category = "court";
    doc_type = "transcript";
  } else if (name.includes("裁定") || name.includes("判決")) {
    category = "court";
    doc_type = "ruling";
  } else if (name.includes("通知")) {
    category = "court";
    doc_type = "notice";
  }

  return {
    category,
    doc_type,
    doc_date: null,
    summary: {
      type: doc_type,
      party:
        category === "ours"
          ? "plaintiff"
          : category === "theirs"
            ? "defendant"
            : null,
      summary: "（無 AI API Key，僅依檔名分類）",
      key_claims: [],
      key_dates: [],
      key_amounts: [],
      contradictions: [],
      judge_focus: null,
    },
  };
}
