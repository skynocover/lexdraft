// ── Test: Gemini Flash Review Step ──
// Loads a completed brief from local D1, sends it to Flash for quality review,
// and prints the result for human evaluation.

import { loadDevVars, parseArgs, d1Query, type InjectedError } from './_helpers';

// ── Types ──

interface ReviewIssue {
  severity: 'critical' | 'warning';
  type: string;
  paragraph_id: string | null;
  description: string;
  suggestion: string;
}

interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
}

interface Paragraph {
  id: string;
  section: string;
  subsection: string;
  content_md: string;
  dispute_id: string | null;
}

interface Dispute {
  id: string;
  title: string;
  our_position: string;
  their_position: string;
}

interface Claim {
  id: string;
  side: 'ours' | 'theirs';
  claim_type: string;
  statement: string;
  dispute_id: string | null;
}

// ── Gemini Flash call ──

const callFlashReview = async (
  vars: Record<string, string>,
  systemPrompt: string,
  userMessage: string,
): Promise<{
  result: ReviewResult;
  usage: { input: number; output: number };
  latencyMs: number;
}> => {
  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${vars.CF_ACCOUNT_ID}/${vars.CF_GATEWAY_ID}`;
  const url = `${baseUrl}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      passed: { type: 'BOOLEAN' },
      issues: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            severity: { type: 'STRING', enum: ['critical', 'warning'] },
            type: {
              type: 'STRING',
              enum: [
                'evidence_gap',
                'law_mismatch',
                'fact_contradiction',
                'amount_inconsistency',
                'coverage_gap',
                'format',
              ],
            },
            paragraph_id: { type: 'STRING', nullable: true },
            description: { type: 'STRING' },
            suggestion: { type: 'STRING' },
          },
          required: ['severity', 'type', 'description', 'suggestion'],
        },
      },
    },
    required: ['passed', 'issues'],
  };

  const body = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const start = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${vars.CF_AIG_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Flash API error ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const result = JSON.parse(rawContent) as ReviewResult;
  const usage = {
    input: data.usageMetadata?.promptTokenCount || 0,
    output: data.usageMetadata?.candidatesTokenCount || 0,
  };

  return { result, usage, latencyMs };
};

// ── Prompt ──

const REVIEW_SYSTEM_PROMPT = `你是台灣民事法律書狀的品質審查員。你的任務是驗證書狀的事實正確性和邏輯一致性。
所有輸出必須使用繁體中文。

═══ 審查項目（逐一檢查，只做這些） ═══

□ 佔位符檢查：書狀中是否有【待填】、○○、___等未填寫的佔位符？
□ 金額一致性：前後段落引用的同一金額是否矛盾？（注意：如果你自己計算後發現金額是正確的，就不要列入 issues）
□ 事實一致性：不同段落描述的同一事實（日期、人名、地點）是否矛盾？
□ 法條對應：引用的法條是否與該段討論的法律關係吻合？（例如：侵權用§184、醫療費用用§193）
□ 爭點覆蓋：每個爭點是否至少有一個段落論述？對方主要主張是否有回應？
□ 證據引用：我方主張是否有指向具體證據（甲證X）？有沒有空泛引用（如「依卷證資料」）？

═══ 不要做的 ═══

- 不評論文筆、風格、用語
- 不判斷論證說服力（主觀）
- 不建議增加新論點或新證據
- 不建議「應提供更強的證據」（這是策略建議，不是驗證）

═══ 嚴重程度判定規則 ═══

critical（僅限以下情況）：
- 佔位符未填寫（書狀無法直接遞交）
- 金額前後矛盾（同一項目在不同段落出現不同數字）
- 關鍵爭點完全沒有論述段落
- 法條引用明確錯誤（用錯法律條文）
- 前後事實陳述直接矛盾

warning（僅限以下情況）：
- 證據引用不夠具體（有引用但不精確）
- 格式瑕疵（法條格式不統一等）
- 小金額差異（不影響訴訟結果）

其他情況 → 不列入

═══ 重要規則 ═══

- 寧可少報也不要誤報。不確定就不列。
- 最多列出 5 個最重要的問題。
- passed = true 表示沒有 critical 問題（可以有 warning）
- 每個 issue 必須指向具體的 paragraph_id，除非是全篇性問題
- description 和 suggestion 都用繁體中文，簡短明確（各不超過 80 字）`;

const buildReviewInput = (
  paragraphs: Paragraph[],
  disputes: Dispute[],
  claims: Claim[],
): string => {
  // Build full draft text (skip header/footer)
  const contentParagraphs = paragraphs.filter(
    (p) => p.section !== '__header__' && p.section !== '__footer__',
  );
  const fullDraft = contentParagraphs
    .map((p) => {
      const heading = p.subsection ? `[${p.section} > ${p.subsection}]` : `[${p.section}]`;
      return `${heading} (paragraph_id: ${p.id})\n${p.content_md}`;
    })
    .join('\n\n---\n\n');

  // Build dispute list
  const disputeText = disputes
    .map((d) => `- [${d.id}] ${d.title}\n  我方：${d.our_position}\n  對方：${d.their_position}`)
    .join('\n');

  // Build claims summary
  const oursClaims = claims.filter((c) => c.side === 'ours');
  const theirsClaims = claims.filter((c) => c.side === 'theirs');
  const claimsText = `我方主張 ${oursClaims.length} 項，對方主張 ${theirsClaims.length} 項`;

  return `請審查以下民事書狀草稿。

[爭點清單]
${disputeText || '（無爭點）'}

[主張概況] ${claimsText}

[我方主張]
${oursClaims.map((c) => `- ${c.statement}`).join('\n')}

[對方主張]
${theirsClaims.map((c) => `- ${c.statement}`).join('\n')}

[書狀全文]
${fullDraft}

請根據審查範圍，找出書狀中的問題。記住：寧可少報也不要誤報。`;
};

// ── Error injection for recall testing ──

const INJECTED_ERRORS: InjectedError[] = [
  {
    label: '金額矛盾：醫療費用 41,550→45,150',
    targetParagraphId: 'iy9S3q6g007xgZFEksNSx',
    expectedType: 'fact_contradiction',
    apply: (ps) =>
      ps.map((p) =>
        p.id === 'iy9S3q6g007xgZFEksNSx'
          ? { ...p, content_md: p.content_md.replace('41,550', '45,150') }
          : p,
      ),
  },
  {
    label: '法條錯誤：侵權 §184 → 物權 §767',
    targetParagraphId: 'P95SxW_I6TgCjEIuwLeKD',
    expectedType: 'law_mismatch',
    apply: (ps) =>
      ps.map((p) =>
        p.id === 'P95SxW_I6TgCjEIuwLeKD'
          ? {
              ...p,
              content_md: p.content_md
                .replace('民法第一百八十四條第二項', '民法第七百六十七條第一項')
                .replace(
                  '違反保護他人之法律，致生損害於他人者，負賠償責任，但能證明其行為無過失者，不在此限',
                  '所有人對於無權占有或侵奪其所有物者，得請求返還之',
                ),
            }
          : p,
      ),
  },
  {
    label: '爭點缺漏：刪除精神慰撫金全部段落',
    targetParagraphId: 'PCjbszyB_MK2N9quzY7Gn',
    expectedType: 'coverage_gap',
    apply: (ps) => ps.filter((p) => p.dispute_id !== 'PCjbszyB_MK2N9quzY7Gn'),
  },
  {
    label: '人名矛盾：被告 王建宏→王建明（僅一段）',
    targetParagraphId: 'Pzcd7ipYa6xoz6IKTg9-F',
    expectedType: 'fact_contradiction',
    apply: (ps) =>
      ps.map((p) =>
        p.id === 'Pzcd7ipYa6xoz6IKTg9-F'
          ? { ...p, content_md: p.content_md.replaceAll('王建宏', '王建明') }
          : p,
      ),
  },
];

// ── Scoring ──

const scoreRecall = (
  issues: ReviewIssue[],
  injected: InjectedError[],
): { detected: string[]; missed: string[] } => {
  const detected: string[] = [];
  const missed: string[] = [];

  for (const err of injected) {
    const found = issues.some((issue) => {
      // Match by paragraph_id or by type
      const matchesParagraph = issue.paragraph_id === err.targetParagraphId;
      const matchesType = issue.type === err.expectedType;
      // For coverage_gap (deleted paragraphs), check description mentions the dispute
      const mentionsDispute = err.expectedType === 'coverage_gap' && issue.type === 'coverage_gap';
      return matchesParagraph || (matchesType && mentionsDispute);
    });
    if (found) {
      detected.push(err.label);
    } else {
      missed.push(err.label);
    }
  }

  return { detected, missed };
};

// ── Main ──

const main = async () => {
  const { getArg, hasFlag } = parseArgs();
  const runs = parseInt(getArg('--runs', '3'), 10);
  const briefId = getArg('--brief', 'W0jVyzoW32UAqtjiDM1E-');
  const recallMode = hasFlag('--recall');

  const vars = loadDevVars();
  if (!vars.CF_ACCOUNT_ID || !vars.CF_AIG_TOKEN) {
    console.error('Missing CF_ACCOUNT_ID or CF_AIG_TOKEN in .dev.vars');
    process.exit(1);
  }

  // Load data from D1
  console.log(`\n📋 Loading brief ${briefId}...`);
  const briefRows = d1Query(
    `SELECT content_structured, case_id FROM briefs WHERE id = '${briefId}'`,
  ) as Array<{ content_structured: string; case_id: string }>;
  if (!briefRows.length) {
    console.error('Brief not found');
    process.exit(1);
  }
  let paragraphs = (JSON.parse(briefRows[0].content_structured) as { paragraphs: Paragraph[] })
    .paragraphs;
  const caseId = briefRows[0].case_id;

  const disputeRows = d1Query(
    `SELECT id, title, our_position, their_position FROM disputes WHERE case_id = '${caseId}'`,
  ) as Dispute[];

  const claimRows = d1Query(
    `SELECT id, side, claim_type, statement, dispute_id FROM claims WHERE case_id = '${caseId}'`,
  ) as Claim[];

  // Inject errors in recall mode
  if (recallMode) {
    console.log('\n🧪 RECALL TEST — Injecting known errors:');
    for (const err of INJECTED_ERRORS) {
      console.log(`  💉 ${err.label}`);
      paragraphs = err.apply(paragraphs);
    }
  }

  console.log(
    `\n  ${paragraphs.length} paragraphs, ${disputeRows.length} disputes, ${claimRows.length} claims`,
  );

  const userMessage = buildReviewInput(paragraphs, disputeRows, claimRows);
  console.log(`  Prompt length: ~${userMessage.length} chars`);

  // Recall stats across runs
  const recallScores: Array<{ detected: string[]; missed: string[] }> = [];

  // Run multiple times
  for (let i = 1; i <= runs; i++) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Run ${i}/${runs}`);
    console.log('═'.repeat(60));

    try {
      const { result, usage, latencyMs } = await callFlashReview(
        vars,
        REVIEW_SYSTEM_PROMPT,
        userMessage,
      );

      // Stats
      const criticals = result.issues.filter((i) => i.severity === 'critical');
      const warnings = result.issues.filter((i) => i.severity === 'warning');

      console.log(`\n⏱  Latency: ${(latencyMs / 1000).toFixed(1)}s`);
      console.log(`📊 Tokens: ${usage.input} in / ${usage.output} out`);
      console.log(`${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`   Critical: ${criticals.length}, Warning: ${warnings.length}`);

      // Print issues
      if (criticals.length > 0) {
        console.log('\n🔴 Critical Issues:');
        for (const issue of criticals) {
          console.log(`  [${issue.type}] ${issue.description}`);
          console.log(`    → ${issue.suggestion}`);
          if (issue.paragraph_id) console.log(`    📍 ${issue.paragraph_id}`);
        }
      }

      if (warnings.length > 0) {
        console.log('\n🟡 Warnings:');
        for (const issue of warnings) {
          console.log(`  [${issue.type}] ${issue.description}`);
          console.log(`    → ${issue.suggestion}`);
          if (issue.paragraph_id) console.log(`    📍 ${issue.paragraph_id}`);
        }
      }

      // Recall scoring
      if (recallMode) {
        const score = scoreRecall(result.issues, INJECTED_ERRORS);
        recallScores.push(score);
        console.log(`\n🎯 Recall: ${score.detected.length}/${INJECTED_ERRORS.length}`);
        for (const d of score.detected) console.log(`  ✅ ${d}`);
        for (const m of score.missed) console.log(`  ❌ ${m}`);
      }
    } catch (err) {
      console.error(`Run ${i} failed:`, (err as Error).message);
    }
  }

  // Summary for recall mode
  if (recallMode && recallScores.length > 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('RECALL SUMMARY');
    console.log('═'.repeat(60));

    const errorLabels = INJECTED_ERRORS.map((e) => e.label);
    for (const label of errorLabels) {
      const detectedCount = recallScores.filter((s) => s.detected.includes(label)).length;
      const pct = Math.round((detectedCount / recallScores.length) * 100);
      const bar = detectedCount === recallScores.length ? '✅' : detectedCount > 0 ? '⚠️' : '❌';
      console.log(`  ${bar} ${label}: ${detectedCount}/${recallScores.length} (${pct}%)`);
    }

    const avgRecall =
      recallScores.reduce((sum, s) => sum + s.detected.length, 0) /
      recallScores.length /
      INJECTED_ERRORS.length;
    console.log(`\n  Average recall: ${(avgRecall * 100).toFixed(0)}%`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('Done.');
};

main().catch(console.error);
