import { eq } from 'drizzle-orm'
import { extractText } from 'unpdf'
import { getDB } from '../db'
import { files } from '../db/schema'

interface FileMessage {
  fileId: string
  caseId: string
  r2Key: string
  filename: string
}

interface ClassificationResult {
  category: 'ours' | 'theirs' | 'court' | 'evidence' | 'other'
  doc_type: string
  doc_date: string | null
  summary: {
    type: string
    party: string | null
    summary: string
    key_claims: string[]
    key_dates: string[]
    key_amounts: number[]
    contradictions: string[]
    judge_focus: string | null
  }
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

回傳純 JSON，不要包含 markdown 標記。格式：
{
  "category": "...",
  "doc_type": "...",
  "doc_date": "..." or null,
  "summary": {
    "type": "...",
    "party": "plaintiff" | "defendant" | null,
    "summary": "...",
    "key_claims": [...],
    "key_dates": [...],
    "key_amounts": [...],
    "contradictions": [...],
    "judge_focus": null or "..."
  }
}`

async function classifyWithAI(
  filename: string,
  text: string,
  apiKey: string,
): Promise<ClassificationResult> {
  // 截取前 8000 字元送給 Haiku（避免 token 爆量）
  const truncated = text.slice(0, 8000)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `檔案名稱：${filename}\n\n文件內容（前 8000 字）：\n${truncated}`,
        },
      ],
      system: CLASSIFY_PROMPT,
    }),
  })

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`)
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>
  }
  const text_content = data.content.find((c) => c.type === 'text')?.text || '{}'

  return JSON.parse(text_content) as ClassificationResult
}

export async function processFileMessage(
  message: FileMessage,
  env: { DB: D1Database; BUCKET: R2Bucket; ANTHROPIC_API_KEY: string },
) {
  const db = getDB(env.DB)

  // 標記為 processing
  await db
    .update(files)
    .set({ status: 'processing', updated_at: new Date().toISOString() })
    .where(eq(files.id, message.fileId))

  try {
    // 1. 從 R2 讀取 PDF
    const object = await env.BUCKET.get(message.r2Key)
    if (!object) {
      throw new Error('R2 object not found')
    }
    const pdfBuffer = await object.arrayBuffer()

    // 2. 提取文字
    const { text: fullText } = await extractText(pdfBuffer)

    if (!fullText || fullText.trim().length === 0) {
      throw new Error('PDF 文字提取失敗，可能為純圖片掃描檔')
    }

    // 3. AI 分類 + 摘要
    let classification: ClassificationResult
    if (env.ANTHROPIC_API_KEY) {
      classification = await classifyWithAI(message.filename, fullText, env.ANTHROPIC_API_KEY)
    } else {
      // 無 API key 時用 fallback 分類
      classification = fallbackClassify(message.filename)
    }

    // 4. 更新 D1
    await db
      .update(files)
      .set({
        status: 'ready',
        full_text: fullText,
        category: classification.category,
        doc_type: classification.doc_type,
        doc_date: classification.doc_date,
        summary: JSON.stringify(classification.summary),
        extracted_claims: JSON.stringify(classification.summary.key_claims || []),
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId))
  } catch (err) {
    // 處理失敗
    await db
      .update(files)
      .set({
        status: 'error',
        updated_at: new Date().toISOString(),
      })
      .where(eq(files.id, message.fileId))
    console.error(`File processing failed for ${message.fileId}:`, err)
    throw err // 讓 Queue 重試
  }
}

/** 無 API key 時的 fallback 分類（純靠檔名） */
function fallbackClassify(filename: string): ClassificationResult {
  const name = filename.toLowerCase()
  let category: ClassificationResult['category'] = 'other'
  let doc_type = 'other'

  if (name.includes('起訴') || name.includes('準備')) {
    category = 'ours'
    doc_type = name.includes('起訴') ? 'complaint' : 'preparation'
  } else if (name.includes('答辯') || name.includes('爭點')) {
    category = 'theirs'
    doc_type = 'defense'
  } else if (name.includes('筆錄')) {
    category = 'court'
    doc_type = 'transcript'
  } else if (name.includes('裁定') || name.includes('判決')) {
    category = 'court'
    doc_type = 'ruling'
  } else if (name.includes('通知')) {
    category = 'court'
    doc_type = 'notice'
  }

  return {
    category,
    doc_type,
    doc_date: null,
    summary: {
      type: doc_type,
      party: category === 'ours' ? 'plaintiff' : category === 'theirs' ? 'defendant' : null,
      summary: '（無 AI API Key，僅依檔名分類）',
      key_claims: [],
      key_dates: [],
      key_amounts: [],
      contradictions: [],
      judge_focus: null,
    },
  }
}
