/**
 * Step 0 Model Comparison: Gemini 2.5 Flash vs Gemini 3.1 Flash Lite
 *
 * Tests Issue Analyzer (single-shot, deterministic comparison) with both models.
 * Uses pre-built case summary from DB file summaries to skip the Case Reader tool-loop.
 *
 * Usage: npx tsx scripts/test-step0-compare.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Load env vars from .dev.vars manually
const devVarsPath = path.resolve(import.meta.dirname, '../.dev.vars');
const devVars = fs.readFileSync(devVarsPath, 'utf-8');
for (const line of devVars.split('\n')) {
  const match = line.match(/^(\w+)\s*=\s*(.+)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_GATEWAY_ID = process.env.CF_GATEWAY_ID!;
const CF_AIG_TOKEN = process.env.CF_AIG_TOKEN!;

if (!CF_ACCOUNT_ID || !CF_GATEWAY_ID || !CF_AIG_TOKEN) {
  console.error('Missing CF_ACCOUNT_ID, CF_GATEWAY_ID, or CF_AIG_TOKEN in .dev.vars');
  process.exit(1);
}

// ── Models to compare ──
// 2.5 Flash via google-ai-studio provider (stored key)
// 3.1 Flash Lite via openrouter provider (stored key)
const MODELS = [
  { id: 'google-ai-studio/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'compat' as const },
  // Try compat endpoint with openrouter prefix first
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', provider: 'openrouter' as const },
];

// ── AI Gateway call (non-streaming) ──
const callAI = async (
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 8192,
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number }; durationMs: number }> => {
  const url = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/compat/chat/completions`;
  const start = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: maxTokens,
    }),
  });

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI Gateway ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    durationMs,
  };
};

// ── Test data: car accident case (z4keVNf) ──
// Pre-built from DB file summaries — simulates what Case Reader would produce

const CASE_SUMMARY = `本案為交通事故損害賠償案件。113年10月5日，被告王建宏駕駛自用小客車（車號ABC-1234）於臺北市大安區復興南路一段與仁愛路四段交岔口左轉時，未讓對向直行車先行，與原告陳美玲騎乘之普通重型機車（車號MNO-5678）發生碰撞。原告因此受傷送醫，診斷為左側鎖骨骨折、左膝挫傷、全身多處擦挫傷及頭部外傷，住院3日，休養3個月，復健治療持續逾6個月。臺北市車輛行車事故鑑定會鑑定意見認定被告為肇事主因，原告無肇事因素。原告請求損害賠償共計423,700元，包含醫療費用41,550元、交通費用13,300元、不能工作損失156,000元、財物損害12,850元及精神慰撫金200,000元。雙方經調解未能達成共識，被告僅願賠償150,000元。`;

const FILE_NOTES = `【01_交通事故初步分析研判表.pdf】
關鍵事實：
  - 事故發生於113年10月5日，臺北市大安區復興南路一段與仁愛路四段交岔口
  - A車王建宏駕駛自小客車左轉彎未讓直行車先行
  - B車陳美玲騎乘普通重型機車直行
  - B車受傷送醫
提及法條：（無）

【02_診斷證明書.pdf】
關鍵事實：
  - 陳美玲因車禍受傷，診斷：左側鎖骨骨折、左膝挫傷、全身多處擦挫傷及頭部外傷
  - 建議休養8週
  - 113年12月2日至114年3月28日接受復健治療
  - 左肩關節活動度受限及左膝韌帶損傷後遺症
  - 因傷勢導致無法正常工作3個月
提及法條：（無）
關鍵金額：住院3日、休養8週、復健32次、門診6次

【03_車鑑會鑑定意見書.pdf】
關鍵事實：
  - 王建宏未讓對向直行車先行，為肇事主因
  - 陳美玲無肇事因素
  - 鑑定於114年2月18日完成
提及法條：（無）

【04_損害賠償明細.pdf】
關鍵事實：
  - 原告陳美玲向被告王建宏請求損害賠償
各方主張：
  - 醫療費用41,550元
  - 交通費用13,300元
  - 不能工作之損失156,000元（月薪約52,000元 × 3個月）
  - 財物損害12,850元
  - 精神慰撫金200,000元
  - 總計423,700元
提及法條：（無）

【05_在職及薪資證明.pdf】
關鍵事實：
  - 陳美玲任職於創意方舟設計有限公司，資深平面設計師
  - 自107年9月1日到職
  - 事故前六個月平均月薪約52,000元
  - 113年10月5日起請傷病假，114年1月5日返回工作，共92日
提及法條：（無）

【06_調解不成立證明書.pdf】
關鍵事實：
  - 調解於114年3月20日進行
  - 被告承認肇事責任
  - 被告僅願賠償150,000元
  - 原告請求423,700元
  - 雙方對金額無法達成共識，調解不成立
提及法條：（無）`;

// ── Issue Analyzer prompt (copied from orchestratorPrompt.ts) ──
const ISSUE_ANALYZER_SYSTEM = `你是法律爭點分析師。根據提供的案件摘要和檔案筆記，辨識法律爭點、分類事實爭議、找出資訊缺口。

═══ 我方/對方立場判定（重要）═══

案件基本資訊中會標注「我方立場」（原告方或被告方）。
- 如果我方立場是「原告方」：our_position = 原告的主張，their_position = 被告的主張
- 如果我方立場是「被告方」：our_position = 被告的主張，their_position = 原告的主張
- 如果未標注我方立場：根據書狀類型推斷（起訴狀→原告方，答辯狀→被告方）

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

const USER_MESSAGE = `請根據以下案件資訊，辨識法律爭點、分類事實爭議、找出資訊缺口。

[書狀類型] 民事起訴狀

[案件基本資訊]
我方立場：原告方

[當事人]
原告：陳美玲
被告：王建宏

[案情摘要]
${CASE_SUMMARY}

[時間軸摘要]
113年10月5日：交通事故發生
113年10月5日-8日：住院治療
113年10月12日：事故初步分析研判表出具
113年12月2日-114年3月28日：復健治療
114年1月5日：返回工作崗位
114年2月18日：車鑑會鑑定完成
114年3月20日：調解不成立
114年4月10日：損害賠償明細製作

[檔案重點筆記]
${FILE_NOTES}

請根據以上資訊，辨識所有法律爭點，並為每個爭點列出關鍵事實和雙方態度。
注意：our_position 和 their_position 要包含具體事實（人事時地金額），mentioned_laws 至少填 1 條相關法條。
直接輸出 JSON。`;

// ── AI Gateway call via OpenRouter provider ──
const OPENROUTER_BYOK_ALIAS = 'lex-draft-openrouter';

const callOpenRouter = async (
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 8192,
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number }; durationMs: number }> => {
  const url = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openrouter/v1/chat/completions`;
  const start = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}`,
      'cf-aig-byok-alias': OPENROUTER_BYOK_ALIAS,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: maxTokens,
    }),
  });

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter via Gateway ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content || '',
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    durationMs,
  };
};

// ── AI Gateway call (native Gemini endpoint) ──
const callGeminiNative = async (
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8192,
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number }; durationMs: number }> => {
  const url = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/google-ai-studio/v1beta/models/${model}:generateContent`;
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
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  });

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Native ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    content,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
    durationMs,
  };
};

// ── Comparison logic ──

interface IssueAnalyzerResult {
  legal_issues: Array<{
    title: string;
    our_position: string;
    their_position: string;
    key_evidence: string[];
    mentioned_laws: string[];
    facts: Array<{
      description: string;
      assertion_type: string;
    }>;
  }>;
  information_gaps: Array<{
    severity: string;
    description: string;
  }>;
}

const tryParseJson = (text: string): IssueAnalyzerResult | null => {
  try {
    // Strip markdown code block if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

const printResult = (label: string, content: string, usage: { input_tokens: number; output_tokens: number }, durationMs: number) => {
  const parsed = tryParseJson(content);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);
  console.log(`  JSON parse: ${parsed ? 'OK' : 'FAILED'}`);

  if (!parsed) {
    console.log(`  Raw (first 500): ${content.slice(0, 500)}`);
    return null;
  }

  console.log(`  Issues: ${parsed.legal_issues.length}`);
  for (const issue of parsed.legal_issues) {
    console.log(`    - ${issue.title}`);
    console.log(`      Laws: ${issue.mentioned_laws.join(', ') || '(none)'}`);
    console.log(`      Facts: ${issue.facts?.length || 0}`);
    console.log(`      Our pos (${issue.our_position.length} chars): ${issue.our_position.slice(0, 80)}...`);
  }
  console.log(`  Gaps: ${parsed.information_gaps.length}`);
  for (const gap of parsed.information_gaps) {
    console.log(`    - [${gap.severity}] ${gap.description}`);
  }

  return parsed;
};

const compareResults = (a: IssueAnalyzerResult, b: IssueAnalyzerResult, labelA: string, labelB: string) => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  COMPARISON');
  console.log(`${'═'.repeat(60)}`);

  console.log(`\n  Issue count: ${labelA}=${a.legal_issues.length}, ${labelB}=${b.legal_issues.length}`);

  // Compare issue titles
  const titlesA = a.legal_issues.map((i) => i.title);
  const titlesB = b.legal_issues.map((i) => i.title);
  console.log(`\n  ${labelA} issues:`);
  titlesA.forEach((t) => console.log(`    - ${t}`));
  console.log(`\n  ${labelB} issues:`);
  titlesB.forEach((t) => console.log(`    - ${t}`));

  // Compare law coverage
  const lawsA = new Set(a.legal_issues.flatMap((i) => i.mentioned_laws));
  const lawsB = new Set(b.legal_issues.flatMap((i) => i.mentioned_laws));
  console.log(`\n  Total unique laws: ${labelA}=${lawsA.size}, ${labelB}=${lawsB.size}`);
  const onlyA = [...lawsA].filter((l) => !lawsB.has(l));
  const onlyB = [...lawsB].filter((l) => !lawsA.has(l));
  if (onlyA.length) console.log(`  Only in ${labelA}: ${onlyA.join(', ')}`);
  if (onlyB.length) console.log(`  Only in ${labelB}: ${onlyB.join(', ')}`);

  // Compare facts count
  const factsA = a.legal_issues.reduce((sum, i) => sum + (i.facts?.length || 0), 0);
  const factsB = b.legal_issues.reduce((sum, i) => sum + (i.facts?.length || 0), 0);
  console.log(`\n  Total facts: ${labelA}=${factsA}, ${labelB}=${factsB}`);

  // Compare gaps
  console.log(`\n  Gaps: ${labelA}=${a.information_gaps.length}, ${labelB}=${b.information_gaps.length}`);
};

// ── Main ──

const main = async () => {
  console.log('Step 0 (Issue Analyzer) Model Comparison');
  console.log(`Input: car accident case (陳美玲 v. 王建宏)`);
  console.log(`Prompt tokens ~${USER_MESSAGE.length} chars`);

  const results: Array<{ label: string; parsed: IssueAnalyzerResult | null; durationMs: number; usage: { input_tokens: number; output_tokens: number } }> = [];

  for (const model of MODELS) {
    const msgs = [
      { role: 'system', content: ISSUE_ANALYZER_SYSTEM },
      { role: 'user', content: USER_MESSAGE },
    ];
    console.log(`\nCalling ${model.label} via ${model.provider}...`);
    try {
      const resp = model.provider === 'openrouter'
        ? await callOpenRouter(model.id, msgs, 8192)
        : await callAI(model.id, msgs, 8192);
      const parsed = printResult(model.label, resp.content, resp.usage, resp.durationMs);
      results.push({ label: model.label, parsed, durationMs: resp.durationMs, usage: resp.usage });
    } catch (err) {
      console.error(`\n  ${model.label} FAILED:`, (err as Error).message.slice(0, 300));
      results.push({ label: model.label, parsed: null, durationMs: 0, usage: { input_tokens: 0, output_tokens: 0 } });
    }
  }

  // Compare if both succeeded
  if (results[0].parsed && results[1].parsed) {
    compareResults(results[0].parsed, results[1].parsed, results[0].label, results[1].label);
  }

  // Dump full JSON for detailed comparison
  for (const r of results) {
    if (r.parsed) {
      const outPath = `scripts/step0-output-${r.label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.json`;
      fs.writeFileSync(outPath, JSON.stringify(r.parsed, null, 2), 'utf-8');
      console.log(`\n  Full output saved to ${outPath}`);
    }
  }

  // Speed comparison
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SPEED');
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    if (r.durationMs > 0) {
      const tokPerSec = r.usage.output_tokens / (r.durationMs / 1000);
      console.log(`  ${r.label}: ${(r.durationMs / 1000).toFixed(1)}s (${tokPerSec.toFixed(0)} tok/s output)`);
    }
  }

  if (results[0].durationMs > 0 && results[1].durationMs > 0) {
    const speedup = results[0].durationMs / results[1].durationMs;
    console.log(`\n  ${results[1].label} is ${speedup.toFixed(2)}x ${speedup > 1 ? 'faster' : 'slower'} than ${results[0].label}`);
  }
};

main().catch(console.error);
