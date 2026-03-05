/**
 * Writer A/B Test: Compare intro/conclusion writing quality.
 *
 * Tests Gemini 2.5 Flash (native) vs Gemini 3.1 Flash Lite (OpenRouter)
 * for writing intro and conclusion sections of legal briefs.
 *
 * Usage: npx tsx scripts/test-writer-compare.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load env vars ──

const devVarsPath = path.resolve(import.meta.dirname, '../.dev.vars');
const devVars = fs.readFileSync(devVarsPath, 'utf-8');
for (const line of devVars.split('\n')) {
  const match = line.match(/^(\w+)\s*=\s*(.+)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_GATEWAY_ID = process.env.CF_GATEWAY_ID!;
const CF_AIG_TOKEN = process.env.CF_AIG_TOKEN!;
const OPENROUTER_BYOK_ALIAS = 'lex-draft-openrouter';

// ── API Callers ──

const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}`;

/** Call Gemini 2.5 Flash via native Google AI Studio endpoint */
const callGeminiNative = async (
  systemPrompt: string,
  userMessage: string,
): Promise<{ content: string; durationMs: number; tokens: { input: number; output: number } }> => {
  const url = `${GATEWAY_BASE}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`;
  const start = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}`,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 2048,
        responseMimeType: 'text/plain',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Native ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    durationMs: Date.now() - start,
    tokens: {
      input: data.usageMetadata?.promptTokenCount || 0,
      output: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
};

/** Call Gemini 3.1 Flash Lite via OpenRouter (AI Gateway stored key) */
const callOpenRouter = async (
  systemPrompt: string,
  userMessage: string,
): Promise<{ content: string; durationMs: number; tokens: { input: number; output: number } }> => {
  const url = `${GATEWAY_BASE}/openrouter/v1/chat/completions`;
  const start = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}`,
      'cf-aig-byok-alias': OPENROUTER_BYOK_ALIAS,
    },
    body: JSON.stringify({
      model: 'google/gemini-3.1-flash-lite-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    durationMs: Date.now() - start,
    tokens: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    },
  };
};

// ── Writer System Prompt ──

const WRITER_SYSTEM = '你是台灣資深訴訟律師。請根據指示撰寫法律書狀段落。只輸出段落內容，不要加標題、markdown 或其他格式。';

// ── Intro Instruction (based on real Step 2 output for car accident case) ──

const INTRO_INSTRUCTION = `你是台灣資深訴訟律師。請根據提供的來源文件撰寫法律書狀段落。

[書狀全局資訊]
  書狀類型：準備書狀
  案號：114年度訴字第XXXX號
  管轄法院：臺灣臺北地方法院
  我方立場：原告方
  完整大綱：
  → 壹、前言 ← （你正在寫這段）
    貳、事實及理由 > 一、侵權行為之成立
    貳、事實及理由 > 二、醫療費用之請求
    貳、事實及理由 > 三、交通費用之請求
    貳、事實及理由 > 四、不能工作損失之請求
    貳、事實及理由 > 五、財物損害之請求
    貳、事實及理由 > 六、精神慰撫金之請求
    參、結論

[本段負責的 Claims]
  c-intro: 原告因被告之侵權行為受有損害，爰依民法第184條、第191條之2、第193條及第195條規定，提起本訴請求損害賠償共計423,700元（我方｜主要主張）

[本段論證結構]
  事實適用：原告陳美玲因被告王建宏於113年10月5日駕車左轉未讓直行車先行，發生交通事故受有傷害，依法提起損害賠償訴訟。
  結論：請求被告賠償原告共計423,700元及法定遲延利息。

[撰寫規則]
- 使用正式法律文書用語（繁體中文）
- 依照論證結構和 claims 列表撰寫，確保每個 claim 都有論述
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 絕對不要在書狀中提及「論證結構」「來源文件」「提供的文件」等內部指令術語，直接以律師口吻撰寫
- 直接撰寫段落內容，不需要加入章節標題
- 絕對不要使用 markdown 語法（包括 #、>、**、* 等標記），輸出純文字段落
- 段落長度控制在 150-400 字之間
- 如遇不確定或需律師確認的資訊，使用【待填：說明】標記`;

// ── Conclusion Instruction ──

const CONCLUSION_INSTRUCTION = `你是台灣資深訴訟律師。請根據提供的來源文件撰寫法律書狀段落。

[書狀全局資訊]
  書狀類型：準備書狀
  案號：114年度訴字第XXXX號
  管轄法院：臺灣臺北地方法院
  我方立場：原告方
  完整大綱：
    壹、前言
    貳、事實及理由 > 一、侵權行為之成立
    貳、事實及理由 > 二、醫療費用之請求
    貳、事實及理由 > 三、交通費用之請求
    貳、事實及理由 > 四、不能工作損失之請求
    貳、事實及理由 > 五、財物損害之請求
    貳、事實及理由 > 六、精神慰撫金之請求
  → 參、結論 ← （你正在寫這段）

[本段負責的 Claims]
（無特定主張）

[本段論證結構]
  事實適用：綜合以上各項損害賠償請求，原告合計請求423,700元。
  結論：請鈞院依法判命被告如數給付。

[已完成段落]（維持前後文一致性）
【壹、前言】
緣原告陳美玲於民國113年10月5日騎乘普通重型機車行經臺北市大安區復興南路一段與仁愛路四段交岔口時，遭被告王建宏駕駛自用小客車左轉未讓直行車先行而發生碰撞，致原告受有左側鎖骨骨折、左膝挫傷、全身多處擦挫傷及頭部外傷等傷害。原告因此住院3日，休養逾3個月，復健治療持續6個月以上，迄今仍有左肩關節活動度受限及左膝韌帶損傷之後遺症。經臺北市車輛行車事故鑑定會鑑定，被告為肇事主因，原告無肇事因素。原告爰依民法第184條、第191條之2、第193條及第195條規定，請求被告賠償醫療費用、交通費用、不能工作損失、財物損害及精神慰撫金，合計新臺幣423,700元。

【貳、事實及理由 > 六、精神慰撫金之請求】
原告陳美玲因本件車禍事故，身體受有左側鎖骨骨折、左膝挫傷及全身多處擦挫傷等傷害，住院3日，休養逾3個月始返回工作崗位，復健治療更持續6個月以上，迄今仍遺有左肩關節活動度受限及左膝韌帶損傷之後遺症，日常生活及工作能力均受相當程度之影響。原告於事故發生時正值壯年，任職資深平面設計師，因傷勢不得不長期請假，身心均承受巨大痛苦。衡酌原告所受傷害之程度、治療期間之漫長、後遺症對生活品質之持續影響，以及被告過失程度等情，請求精神慰撫金新臺幣200,000元，應屬合理適當。

[撰寫規則]
- 使用正式法律文書用語（繁體中文）
- 絕對不要輸出任何 XML 標籤
- 絕對不要使用 emoji 或特殊符號
- 絕對不要在書狀中提及「論證結構」「來源文件」等內部指令術語
- 直接撰寫段落內容，不需要加入章節標題
- 絕對不要使用 markdown 語法
- 結論段落控制在 100-200 字之間
- 如遇不確定資訊，使用【待填：說明】標記
- 維持與已完成段落一致的語氣和風格`;

// ── Main ──

const main = async () => {
  console.log('═══ Writer A/B Compare: Intro + Conclusion ═══\n');

  const models = [
    { label: 'Gemini 2.5 Flash', caller: callGeminiNative },
    { label: 'Gemini 3.1 Flash Lite', caller: callOpenRouter },
  ];

  const sections = [
    { label: '壹、前言', instruction: INTRO_INSTRUCTION },
    { label: '參、結論', instruction: CONCLUSION_INSTRUCTION },
  ];

  for (const section of sections) {
    console.log(`${'═'.repeat(60)}`);
    console.log(`${section.label}`);
    console.log(`${'═'.repeat(60)}\n`);

    for (const model of models) {
      console.log(`── ${model.label} ──`);
      const start = Date.now();

      try {
        const result = await model.caller(WRITER_SYSTEM, section.instruction);
        console.log(`  Time: ${result.durationMs}ms`);
        console.log(`  Tokens: ${result.tokens.input} in / ${result.tokens.output} out`);
        console.log(`  Length: ${result.content.length} chars\n`);
        console.log(`  Output:`);
        console.log(`  ${'-'.repeat(50)}`);
        console.log(`  ${result.content.replace(/\n/g, '\n  ')}`);
        console.log(`  ${'-'.repeat(50)}\n`);
      } catch (err) {
        console.error(`  ERROR: ${(err as Error).message}\n`);
      }
    }
  }

  console.log('Done.');
};

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
