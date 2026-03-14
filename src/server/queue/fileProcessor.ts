import { eq } from 'drizzle-orm';
import { getDocumentProxy, extractText } from 'unpdf';
import { getDB } from '../db';
import { files, cases } from '../db/schema';
import { callAI, callGeminiNative, type AIEnv } from '../agent/aiClient';
import type { AppEnv } from '../types';

const CMAP_BASE_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/';

const FLASH_LITE_MODEL = 'google-ai-studio/gemini-2.5-flash-lite';

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
    const url = this.baseUrl + name + (this.isCompressed ? '.bcmap' : '');
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load CMap at: ${url} (${response.status})`);
    }
    const cMapData = new Uint8Array(await response.arrayBuffer());
    return { cMapData, isCompressed: this.isCompressed };
  }
}

export interface FileMessage {
  fileId: string;
  caseId: string;
  r2Key: string;
  filename: string;
}

interface ClassificationResult {
  category: 'brief' | 'exhibit_a' | 'exhibit_b' | 'court' | 'other';
  doc_date: string | null;
  summary: string;
}

const CLASSIFICATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', enum: ['brief', 'exhibit_a', 'exhibit_b', 'court', 'other'] },
    doc_date: { type: 'STRING', nullable: true },
    summary: { type: 'STRING' },
  },
  required: ['category', 'doc_date', 'summary'],
};

const buildClassifyPrompt = (clientRole: 'plaintiff' | 'defendant'): string => {
  const ourSide = clientRole === 'plaintiff' ? 'exhibit_a' : 'exhibit_b';
  const theirSide = clientRole === 'plaintiff' ? 'exhibit_b' : 'exhibit_a';
  const roleLabel = clientRole === 'plaintiff' ? '原告' : '被告';

  return `你是法律文件分類助手。本案當事人為${roleLabel}方。根據以下檔案名稱和內容，判斷：

1. category: brief（書狀）| ${ourSide}（我方證物）| ${theirSide}（對方證物）| court（法院文件）| other
2. doc_date: 文件日期（YYYY-MM-DD），如無法判斷則 null
3. summary: 50-100 字繁體中文摘要，包含文件類型、當事人、核心主張、關鍵金額

分類依據：
- brief：起訴狀、準備狀、答辯狀、爭點整理狀等書狀（不論哪方）
- ${ourSide}：我方提出的證據（合約、發票、照片、診斷證明等）
- ${theirSide}：對方提出的證據
- court：筆錄、通知書、裁定、判決等法院文件
- other：無法分類

回傳純 JSON，不要包含 markdown 標記。格式：
{
  "category": "${ourSide}",
  "doc_date": "2024-03-15",
  "summary": "原告民事起訴狀，主張被告於111年3月15日超速行駛致原告受傷，請求醫療費15萬元及精神慰撫金50萬元，合計65萬元"
}`;
};

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

const convertToMarkdown = async (text: string, aiEnv: AIEnv): Promise<string> => {
  const truncated = text.slice(0, 15000);
  const userContent =
    text.length > 15000
      ? `以下是文件內容（前 15000 字）：\n\n${truncated}`
      : `以下是文件內容：\n\n${truncated}`;

  const { content } = await callAI(
    aiEnv,
    [
      { role: 'system', content: MARKDOWN_PROMPT },
      { role: 'user', content: userContent },
    ],
    { model: FLASH_LITE_MODEL, maxTokens: 8192 },
  );

  return content || text;
};

const classifyWithAI = async (
  filename: string,
  text: string,
  clientRole: 'plaintiff' | 'defendant',
  aiEnv: AIEnv,
): Promise<ClassificationResult> => {
  const truncated = text.slice(0, 8000);

  const { content } = await callGeminiNative(
    aiEnv,
    buildClassifyPrompt(clientRole),
    `檔案名稱：${filename}\n\n文件內容（前 8000 字）：\n${truncated}`,
    {
      model: 'gemini-2.5-flash-lite',
      maxTokens: 1024,
      responseSchema: CLASSIFICATION_SCHEMA,
      temperature: 0,
      thinkingBudget: 0,
    },
  );

  return JSON.parse(content) as ClassificationResult;
};

export const processFileMessage = async (message: FileMessage, env: AppEnv['Bindings']) => {
  const db = getDB(env.DB);
  const aiEnv: AIEnv = {
    CF_ACCOUNT_ID: env.CF_ACCOUNT_ID,
    CF_GATEWAY_ID: env.CF_GATEWAY_ID,
    CF_AIG_TOKEN: env.CF_AIG_TOKEN,
  };

  // 標記為 processing
  await db
    .update(files)
    .set({ status: 'processing', updated_at: new Date().toISOString() })
    .where(eq(files.id, message.fileId));

  try {
    // 1. 從 R2 讀取 PDF
    const object = await env.BUCKET.get(message.r2Key);
    if (!object) {
      throw new Error('R2 object not found');
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
      ? result.text.join('\n')
      : String(result.text || '');

    if (!fullText.trim()) {
      throw new Error('PDF 文字提取失敗，可能為純圖片掃描檔');
    }

    // 3. AI 分類 + 摘要 + Markdown 轉換（透過 Cloudflare AI Gateway）
    // Get client_role from case for AI classification
    const [caseRow] = await db
      .select({ client_role: cases.client_role })
      .from(cases)
      .where(eq(cases.id, message.caseId));
    const clientRole =
      caseRow?.client_role === 'defendant' ? ('defendant' as const) : ('plaintiff' as const);

    let classification: ClassificationResult;
    let contentMd: string | null = null;
    if (env.CF_ACCOUNT_ID && env.CF_GATEWAY_ID && env.CF_AIG_TOKEN) {
      const [classResult, mdResult] = await Promise.all([
        classifyWithAI(message.filename, fullText, clientRole, aiEnv),
        convertToMarkdown(fullText, aiEnv).catch((err) => {
          console.error(`Markdown conversion failed for ${message.fileId}:`, err);
          return null;
        }),
      ]);
      classification = classResult;
      contentMd = mdResult;
    } else {
      // 無 AI Gateway 設定時用 fallback 分類
      classification = fallbackClassify(message.filename, clientRole);
    }

    // 4. 更新 D1
    await db
      .update(files)
      .set({
        status: 'ready',
        full_text: fullText,
        content_md: contentMd,
        category: classification.category,
        doc_date: classification.doc_date,
        summary: classification.summary,
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId));
  } catch (err) {
    // 處理失敗
    await db
      .update(files)
      .set({
        status: 'error',
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId));
    console.error(`File processing failed for ${message.fileId}:`, err);
    throw err; // 讓 Queue 重試
  }
};

/** 無 API key 時的 fallback 分類（純靠檔名） */
const fallbackClassify = (
  filename: string,
  clientRole: 'plaintiff' | 'defendant',
): ClassificationResult => {
  const name = filename.toLowerCase();
  let category: ClassificationResult['category'] = 'other';

  if (
    name.includes('起訴') ||
    name.includes('準備') ||
    name.includes('答辯') ||
    name.includes('爭點')
  ) {
    category = 'brief';
  } else if (
    name.includes('筆錄') ||
    name.includes('裁定') ||
    name.includes('判決') ||
    name.includes('通知') ||
    name.includes('調解')
  ) {
    category = 'court';
  } else if (
    name.includes('診斷') ||
    name.includes('收據') ||
    name.includes('發票') ||
    name.includes('合約') ||
    name.includes('照片') ||
    name.includes('證明')
  ) {
    // Evidence — assign to our side by default
    category = clientRole === 'plaintiff' ? 'exhibit_a' : 'exhibit_b';
  }

  return {
    category,
    doc_date: null,
    summary: '（無 AI API Key，僅依檔名分類）',
  };
};
