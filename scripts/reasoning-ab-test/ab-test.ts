/**
 * Phase 2 A/B Test: Reasoning Strategy Model Comparison
 *
 * Tests 3 models on Step 2 (推理策略): Claude Haiku 4.5, DeepSeek V3.2, Qwen 3.5 Plus
 * Uses real case data from D1 local DB + MongoDB Atlas law search.
 *
 * Usage: npx tsx scripts/reasoning-ab-test/ab-test.ts
 *
 * Requires: MONGO_URL, MONGO_API_KEY, CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN
 * (auto-loaded from dist/lexdraft/.dev.vars)
 */
import { MongoClient, Collection, Document } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { jsonrepair } from 'jsonrepair';

// ── Imports from source (replace duplicated constants/functions) ──
import { parseJsonField } from '../../src/server/lib/jsonUtils';
import { extractBalancedJson, cleanLLMJson } from '../../src/server/lib/jsonUtils';
import {
  PCODE_MAP,
  ALIAS_MAP,
  CONCEPT_TO_LAW,
  resolveAlias,
  SORTED_LAW_NAMES,
  tryExtractLawName,
  tryRewriteQuery,
  SORTED_CONCEPTS,
  LAW_CONCEPT_REGEX,
} from '../../src/server/lib/lawConstants';
import {
  MAX_ROUNDS,
  MAX_SEARCHES,
  MAX_TOKENS,
  JSON_OUTPUT_MAX_TOKENS,
  CLAIMS_RULES,
  SECTION_RULES,
  STRATEGY_JSON_SCHEMA,
  WRITING_CONVENTIONS,
  BRIEF_TYPE_FALLBACK_STRUCTURES,
} from '../../src/server/agent/prompts/strategyConstants';

// ── Derived constants ──
const BRIEF_STRUCTURE_CONVENTIONS = `${WRITING_CONVENTIONS}\n\n${BRIEF_TYPE_FALLBACK_STRUCTURES['complaint']}`;

// ══════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════

interface EnvVars {
  mongoUrl: string | undefined;
  mongoApiKey: string | undefined;
  cfAccountId: string | undefined;
  cfGatewayId: string | undefined;
  cfAigToken: string | undefined;
}

interface ModelConfig {
  name: string;
  id: string;
  format: 'anthropic' | 'openai';
  gateway: string;
  costIn: number;
  costOut: number;
}

interface CaseRow {
  id: string;
  title: string;
  case_number: string;
  court: string;
  case_type: string;
  client_role: string;
  case_instructions: string;
  law_refs: string | null;
  timeline: string | null;
  [key: string]: unknown;
}

interface FileRow {
  id: string;
  filename: string;
  category: string;
  summary: string | null;
  [key: string]: unknown;
}

interface DisputeRow {
  id: string;
  title: string;
  our_position: string | null;
  their_position: string | null;
  evidence: string | null;
  law_refs: string | null;
  [key: string]: unknown;
}

interface DamageRow {
  category: string;
  description: string;
  amount: number | null;
  [key: string]: unknown;
}

interface CaseData {
  caseRow: CaseRow;
  files: FileRow[];
  disputes: DisputeRow[];
  damages: DamageRow[];
}

interface LegalIssue {
  id: string;
  title: string;
  our_position: string;
  their_position: string;
  key_evidence: string[];
  mentioned_laws: string[];
  facts: unknown[];
}

interface FetchedLaw {
  id: string;
  law_name: string;
  article_no: string;
  content: string;
  source: string;
}

interface FileSummary {
  id: string;
  filename: string;
  category: string;
  summary: string;
}

interface DamageItem {
  category: string;
  description: string;
  amount: number;
}

interface TimelineItem {
  id: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

interface CaseMetadata {
  caseNumber: string;
  court: string;
  caseType: string;
  clientRole: string;
  caseInstructions: string;
}

interface TestInput {
  caseSummary: string;
  briefType: string;
  legalIssues: LegalIssue[];
  informationGaps: unknown[];
  fetchedLaws: FetchedLaw[];
  fileSummaries: FileSummary[];
  damages: DamageItem[];
  timeline: TimelineItem[];
  userAddedLaws: unknown[];
  caseMetadata: CaseMetadata;
}

interface SupplementedLaw {
  id: string;
  law_name: string;
  article_no: string;
  content: string;
}

interface ToolLoopResult {
  reasoningSummary: string;
  perIssueAnalysis: PerIssueAnalysis[];
  supplementedLaws: SupplementedLaw[];
  input: TestInput;
}

interface PerIssueAnalysis {
  issue_id: string;
  chosen_basis: string;
  key_law_ids: string[];
  element_mapping: string;
  defense_response?: string;
}

interface SectionOutput {
  id: string;
  section: string;
  subsection?: string | null;
  dispute_id?: string | null;
  argumentation?: {
    legal_basis?: string[];
    fact_application?: string;
    conclusion?: string;
  };
  claims?: string[];
  relevant_file_ids?: string[];
  relevant_law_ids?: string[];
  legal_reasoning?: string;
}

interface ClaimOutput {
  id: string;
  side: string;
  claim_type: string;
  statement: string;
  assigned_section: string | null;
  dispute_id: string | null;
  responds_to: string | null;
}

interface StrategyOutput {
  claims: ClaimOutput[];
  sections: SectionOutput[];
}

interface ReasoningDetail {
  summary: string;
  perIssueAnalysis: PerIssueAnalysis[];
  supplementedLaws: string[];
  sections?: Array<{
    id: string;
    section: string;
    subsection: string | null;
    dispute_id: string | null;
    legal_basis: string[];
    relevant_law_ids: string[];
    relevant_file_ids: string[];
    legal_reasoning: string;
  }>;
}

interface TestMetrics {
  rounds: number;
  search_count: number;
  laws_found: string[];
  finalize_called: boolean;
  input_tokens: number;
  output_tokens: number;
  json_parse_ok: boolean;
  validation_pass: boolean;
  validation_errors: string[];
  num_claims: number;
  num_sections: number;
  issue_coverage: number;
  total_time_ms: number;
  estimated_cost: number;
  error: string | null;
  raw_preview: string | null;
  reasoning: ReasoningDetail | null;
}

interface SearchResult {
  _id: string;
  law_name: string;
  article_no: string;
  content: string;
  score?: number;
  source?: string;
}

// ══════════════════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════════════════

const CASE_ID = 'z4keVNfyuKvL68Xg1qPl2';
const RUNS_PER_MODEL = 1;

const MODELS: ModelConfig[] = [
  {
    name: 'Claude Haiku 4.5',
    id: 'claude-haiku-4-5-20251001',
    format: 'anthropic',
    gateway: 'anthropic/v1/messages',
    costIn: 0.8,
    costOut: 4.0,
  },
  {
    name: 'MiniMax M2.5',
    id: 'minimax/minimax-m2.5',
    format: 'openai',
    gateway: 'openrouter/v1/chat/completions',
    costIn: 0.295,
    costOut: 1.2,
  },
];

// ══════════════════════════════════════════════════════════
//  Env Loading
// ══════════════════════════════════════════════════════════

const loadDevVars = (): EnvVars => {
  try {
    const devVars = readFileSync(resolve('dist/lexdraft/.dev.vars'), 'utf-8');
    const get = (key: string): string | undefined => {
      const m = devVars.match(new RegExp(`${key}\\s*=\\s*"?([^\\s"]+)"?`));
      return m?.[1] || process.env[key];
    };
    return {
      mongoUrl: get('MONGO_URL'),
      mongoApiKey: get('MONGO_API_KEY'),
      cfAccountId: get('CF_ACCOUNT_ID'),
      cfGatewayId: get('CF_GATEWAY_ID'),
      cfAigToken: get('CF_AIG_TOKEN'),
    };
  } catch {
    return {
      mongoUrl: process.env.MONGO_URL,
      mongoApiKey: process.env.MONGO_API_KEY,
      cfAccountId: process.env.CF_ACCOUNT_ID,
      cfGatewayId: process.env.CF_GATEWAY_ID,
      cfAigToken: process.env.CF_AIG_TOKEN,
    };
  }
};

const ENV = loadDevVars();

const requiredKeys: (keyof EnvVars)[] = [
  'mongoUrl',
  'mongoApiKey',
  'cfAccountId',
  'cfGatewayId',
  'cfAigToken',
];
for (const k of requiredKeys) {
  if (!ENV[k]) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════
//  D1 Local DB Helpers
// ══════════════════════════════════════════════════════════

const d1Query = <T = Record<string, unknown>>(sql: string): T[] => {
  const raw = execSync(
    `npx wrangler d1 execute lexdraft-db --local --command "${sql.replace(/"/g, '\\"')}" --json 2>/dev/null`,
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 },
  );
  const parsed = JSON.parse(raw);
  return parsed[0]?.results || [];
};

const loadCaseFromD1 = (): CaseData => {
  // Case
  const cases = d1Query<CaseRow>(`SELECT * FROM cases WHERE id = '${CASE_ID}'`);
  if (!cases.length) throw new Error(`Case ${CASE_ID} not found`);
  const caseRow = cases[0];

  // Files
  const files = d1Query<FileRow>(
    `SELECT id, filename, category, summary FROM files WHERE case_id = '${CASE_ID}' AND summary IS NOT NULL`,
  );

  // Disputes
  const disputes = d1Query<DisputeRow>(
    `SELECT * FROM disputes WHERE case_id = '${CASE_ID}' ORDER BY number`,
  );

  // Damages
  const damages = d1Query<DamageRow>(`SELECT * FROM damages WHERE case_id = '${CASE_ID}'`);

  return { caseRow, files, disputes, damages };
};

// ══════════════════════════════════════════════════════════
//  Build Test Input (ReasoningStrategyInput format)
// ══════════════════════════════════════════════════════════

const buildTestInput = (data: CaseData): TestInput => {
  const { caseRow, files, disputes, damages } = data;

  const lawRefs = parseJsonField<
    Array<{ id: string; law_name: string; article: string; full_text: string }>
  >(caseRow.law_refs, []);
  const timeline = parseJsonField<
    Array<{
      id?: string;
      date?: string;
      title?: string;
      description?: string;
      is_critical?: boolean;
    }>
  >(caseRow.timeline, []);

  const legalIssues: LegalIssue[] = disputes.map((d) => ({
    id: d.id,
    title: d.title,
    our_position: d.our_position || '',
    their_position: d.their_position || '',
    key_evidence: parseJsonField<Array<{ description?: string } | string>>(d.evidence, []).map(
      (e) => (typeof e === 'string' ? e : e.description || ''),
    ),
    mentioned_laws: parseJsonField<Array<{ id?: string } | string>>(d.law_refs, []).map((l) =>
      typeof l === 'string' ? l : l.id || '',
    ),
    facts: [],
  }));

  const fetchedLaws: FetchedLaw[] = lawRefs
    .filter((l) => l.full_text)
    .map((l) => ({
      id: l.id,
      law_name: l.law_name,
      article_no: l.article,
      content: l.full_text,
      source: 'mentioned',
    }));

  const fileSummaries: FileSummary[] = files.map((f) => {
    const summary = parseJsonField<{ summary?: string }>(f.summary, {});
    return {
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: summary.summary || '（無摘要）',
    };
  });

  const damageItems: DamageItem[] = damages.map((d) => ({
    category: d.category,
    description: d.description,
    amount: d.amount || 0,
  }));

  const timelineItems: TimelineItem[] = timeline.map((t) => ({
    id: t.id || '',
    date: t.date || '',
    title: t.title || '',
    description: t.description || '',
    is_critical: t.is_critical || false,
  }));

  return {
    caseSummary: caseRow.title || '',
    briefType: 'complaint',
    legalIssues,
    informationGaps: [],
    fetchedLaws,
    fileSummaries,
    damages: damageItems,
    timeline: timelineItems,
    userAddedLaws: [],
    caseMetadata: {
      caseNumber: caseRow.case_number || '',
      court: caseRow.court || '',
      caseType: caseRow.case_type || '',
      clientRole: caseRow.client_role || '',
      caseInstructions: caseRow.case_instructions || '',
    },
  };
};

// ══════════════════════════════════════════════════════════
//  Prompts (from reasoningStrategyPrompt.ts + strategyConstants.ts)
// ══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `你是一位資深台灣訴訟律師，正在為案件制定論證策略。你可以使用文字自由推理，也可以搜尋法條資料庫來補充推理所需的法律依據。

═══ 你的工作流程 ═══

### Reasoning 階段：法律推理（自由使用文字思考）

1. **請求權基礎分析**
   - 檢視每個爭點可用的請求權基礎
   - 比較不同基礎的優劣（舉證責任、構成要件難易度、法律效果）
   - 決定主要主張（primary）和備位主張（如有必要）
   - 說明為什麼選這個基礎、為什麼不選其他的

2. **構成要件涵攝（逐要件拆解）**
   - 列出選定請求權基礎的每一個構成要件
   - 逐一將案件事實涵攝到各要件中，引用具體數字、日期、金額
   - 涵攝格式：要件名稱 → 對應事實 → 小結論
   - 例如：「過失要件 → 被告左轉未讓直行車先行，違反道交§102(1)(7) → 構成過失」
   - 標記哪些要件有充分證據、哪些是弱點

3. **攻防預判（具體反駁策略）**
   - 站在對方律師角度，預測可能的具體抗辯（不要只說「金額過高」，要具體指出對方可能主張的替代金額或計算方式）
   - 為每個預測的抗辯準備具體反駁：
     a. 引用案件中的具體數字（日期、天數、金額）來反駁
     b. 區分概念差異（如「醫囑最低休養期」vs「完全恢復職業能力所需時間」）
     c. 如有可能，提供類案判決的合理金額區間作為參考
     d. 論述職業特殊性對損害程度的影響（如有）
   - 如果預判需要額外法條 -> 呼叫 search_law 補搜

4. **補充搜尋**
   - 審視推理過程中提到但尚未查閱全文的法條，主動搜尋
   - search_law 關鍵字格式：「法規名 概念」（中間加空格）
   - 搜尋範例：
     - 「民法 損害賠償」→ 找到 §213, §216 等
     - 「民法 動力車輛」→ 找到 §191-2
     - 「民法 慰撫金」→ 找到 §195
   - 每次搜尋必須附上 purpose

5. **完整性檢查（finalize 前必做）**
   - 在呼叫 finalize_strategy 之前，逐一檢查：
     a. 每個請求權基礎的構成要件條文是否都已查到全文？
     b. 損害賠償的計算依據條文是否齊全？
     c. 是否有遺漏的特別規定？
     d. 過失相抵（§217）、損害賠償範圍（§216）等通用條文是否已備齊？
   - 如果發現缺漏，立即補搜後再呼叫 finalize_strategy

### Structuring 階段：輸出策略（呼叫 finalize_strategy 後）

當你完成推理和完整性檢查，呼叫 finalize_strategy 工具：
- reasoning_summary：整體策略方向（200字以內）
- per_issue_analysis：每個爭點的推理結論
然後輸出完整的 JSON 結果。

═══ 工具 ═══

- search_law(query, purpose, limit): 搜尋法條資料庫，回傳條文全文。
- finalize_strategy(reasoning_summary, per_issue_analysis, supplemented_law_ids): 完成推理後呼叫此工具。

${CLAIMS_RULES}

${SECTION_RULES}

═══ 事實運用規則 ═══

- 「承認」的事實：直接援引，不需要花篇幅論證
- 「爭執」的事實：需要重點論證，提出證據佐證
- 「自認」的事實：明確援引對方書狀中的自認
- 「推定」的事實：援引法律推定，轉移舉證責任

${BRIEF_STRUCTURE_CONVENTIONS}

${STRATEGY_JSON_SCHEMA}

═══ 硬性規則 ═══

- 在呼叫 finalize_strategy 之前，禁止輸出任何 JSON code block。
- 只有在 finalize_strategy 的 tool result 回傳後，才可以輸出完整的 JSON 結果。
- 每個 our claim 必須有 assigned_section
- 每個 theirs claim 的 assigned_section 為 null
- rebuttal 必須有 responds_to
- supporting 必須有 responds_to
- primary 的 responds_to 為 null`;

const JSON_OUTPUT_SYSTEM_PROMPT = `你是一位資深台灣訴訟律師的策略輸出助手。你將收到律師的推理摘要、爭點清單、和可用法條，你的任務是根據這些資料輸出結構化的論證策略 JSON。

${BRIEF_STRUCTURE_CONVENTIONS}

${CLAIMS_RULES}

${SECTION_RULES}

═══ 輸出規則 ═══

- 只輸出 JSON，不要加 markdown code block 或其他文字

${STRATEGY_JSON_SCHEMA}`;

// ══════════════════════════════════════════════════════════
//  User Message Builder
// ══════════════════════════════════════════════════════════

const getClientRoleLabel = (clientRole: string): string => {
  if (clientRole === 'plaintiff') return '原告方';
  if (clientRole === 'defendant') return '被告方';
  return '';
};

const buildUserMessage = (input: TestInput): string => {
  const issueText = input.legalIssues
    .map((issue) => {
      let text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      if (issue.mentioned_laws.length > 0) {
        text += `\n  提及法條：${issue.mentioned_laws.join('、')}`;
      }
      return text;
    })
    .join('\n');

  const lawText =
    input.fetchedLaws.length > 0
      ? input.fetchedLaws
          .map((l) => `- [${l.id}] ${l.law_name} ${l.article_no}\n  ${l.content}`)
          .join('\n\n')
      : '（無預先查到的法條，請視需要使用 search_law 搜尋）';

  const fileText = input.fileSummaries
    .map((f) => `- [${f.id}] ${f.filename} (${f.category || '未分類'}): ${f.summary}`)
    .join('\n');

  const damageText =
    input.damages.length > 0
      ? input.damages
          .map((d) => `- ${d.category}: NT$ ${d.amount.toLocaleString()} (${d.description || ''})`)
          .join('\n')
      : '無';

  const totalDamage = input.damages.reduce((sum, d) => sum + d.amount, 0);

  const timelineText =
    input.timeline.length > 0
      ? input.timeline
          .map((t) => `- ${t.date} ${t.is_critical ? '★' : ' '} ${t.title}：${t.description}`)
          .join('\n')
      : '無';

  const meta = input.caseMetadata;
  const metaLines: string[] = [];
  if (meta) {
    const roleLabel = getClientRoleLabel(meta.clientRole);
    if (roleLabel) metaLines.push(`我方立場：${roleLabel}`);
    if (meta.caseNumber) metaLines.push(`案號：${meta.caseNumber}`);
    if (meta.court) metaLines.push(`法院：${meta.court}`);
    if (meta.caseType) metaLines.push(`案件類型：${meta.caseType}`);
  }
  const caseMetaBlock = metaLines.length > 0 ? `\n[案件基本資訊]\n${metaLines.join('\n')}\n` : '';
  const instructionsBlock = meta?.caseInstructions
    ? `\n[律師處理指引]\n${meta.caseInstructions}\n`
    : '';

  return `[案件全貌]
${input.caseSummary || '（尚未整合）'}
${caseMetaBlock}${instructionsBlock}
[書狀類型] ${input.briefType}

[爭點清單]
${issueText || '（尚未分析）'}

[已查到的法條全文]
${lawText}

[案件檔案摘要]
${fileText}

[Information Gaps]
無

[使用者手動加入的法條]
無

[損害賠償]
${damageText}${input.damages.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}

[時間軸]
${timelineText}

請開始分析。先用文字推理（請求權基礎分析、構成要件檢視、攻防預判），如果需要額外法條就用 search_law 搜尋。推理完成後呼叫 finalize_strategy，然後輸出完整 JSON。

[session: ${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
};

// ══════════════════════════════════════════════════════════
//  Tool Definitions (Claude + OpenAI formats)
// ══════════════════════════════════════════════════════════

const SEARCH_LAW_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: '搜尋關鍵字。格式：「法規名 概念」（中間加空格），例如「民法 過失相抵」。',
    },
    law_name: {
      type: 'string',
      description: '指定搜尋的法規名稱（如「民法」「刑法」），支援縮寫。',
    },
    purpose: { type: 'string', description: '為什麼需要搜尋這條法條' },
    limit: { type: 'number', description: '回傳結果數量（預設 3）' },
  },
  required: ['query', 'purpose'],
};

const FINALIZE_SCHEMA = {
  type: 'object',
  properties: {
    reasoning_summary: {
      type: 'string',
      description: '整體策略方向摘要（200字以內）',
    },
    per_issue_analysis: {
      type: 'array',
      description: '逐爭點的推理結論',
      items: {
        type: 'object',
        properties: {
          issue_id: { type: 'string' },
          chosen_basis: { type: 'string' },
          key_law_ids: { type: 'array', items: { type: 'string' } },
          element_mapping: { type: 'string' },
          defense_response: { type: 'string' },
        },
        required: ['issue_id', 'chosen_basis', 'key_law_ids', 'element_mapping'],
      },
    },
    supplemented_law_ids: {
      type: 'array',
      items: { type: 'string' },
      description: '推理過程中補搜到的法條 ID 列表',
    },
  },
  required: ['reasoning_summary', 'per_issue_analysis'],
};

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: typeof SEARCH_LAW_SCHEMA | typeof FINALIZE_SCHEMA;
}

// Claude format
const CLAUDE_TOOLS: ClaudeTool[] = [
  {
    name: 'search_law',
    description: '搜尋法律條文資料庫。推理過程中主動搜尋你需要引用的法條全文。',
    input_schema: SEARCH_LAW_SCHEMA,
  },
  {
    name: 'finalize_strategy',
    description:
      '當你完成法律推理、完整性檢查、並補搜完所有需要的法條後，呼叫此工具。呼叫後需輸出完整 JSON。',
    input_schema: FINALIZE_SCHEMA,
  },
];

// OpenAI format
const OPENAI_TOOLS = CLAUDE_TOOLS.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ══════════════════════════════════════════════════════════
//  MongoDB Law Search (real, from strategy-compare.mjs)
// ══════════════════════════════════════════════════════════

const embedQuery = async (text: string): Promise<number[]> => {
  const res = await fetch('https://ai.mongodb.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.mongoApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3.5',
      input: [text],
      input_type: 'query',
      output_dimension: 512,
    }),
  });
  if (!res.ok) throw new Error(`Embedding HTTP ${res.status}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
};

const buildLawClause = (resolvedName: string): Record<string, unknown> => {
  const pcode = PCODE_MAP[resolvedName];
  if (pcode) return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  return { must: [{ text: { query: resolvedName, path: ['law_name', 'aliases'] } }] };
};

const keywordSearch = async (
  coll: Collection<Document>,
  concept: string,
  resolvedLawName: string | undefined,
  limit: number,
): Promise<SearchResult[]> => {
  const compound = resolvedLawName
    ? {
        ...buildLawClause(resolvedLawName),
        should: [
          { text: { query: concept, path: 'chapter', score: { boost: { value: 5 } } } },
          { text: { query: concept, path: 'content', score: { boost: { value: 3 } } } },
          { text: { query: concept, path: 'category' } },
        ],
        minimumShouldMatch: 1,
      }
    : {
        should: [
          {
            text: {
              query: concept,
              path: ['law_name', 'aliases'],
              score: { boost: { value: 1.5 } },
            },
          },
          { text: { query: concept, path: 'chapter', score: { boost: { value: 3 } } } },
          { text: { query: concept, path: 'content' } },
          { text: { query: concept, path: 'category', score: { boost: { value: 0.5 } } } },
        ],
        minimumShouldMatch: 1,
      };

  return coll
    .aggregate([
      { $search: { index: 'law_search', compound } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          law_name: 1,
          article_no: 1,
          content: 1,
          score: { $meta: 'searchScore' },
        },
      },
    ])
    .toArray() as Promise<SearchResult[]>;
};

const vectorSearch = async (
  coll: Collection<Document>,
  queryVector: number[],
  limit: number,
  pcode: string | undefined,
): Promise<SearchResult[]> => {
  const filter = pcode ? { pcode: { $eq: pcode } } : undefined;
  return coll
    .aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: limit * 10,
          limit,
          ...(filter && { filter }),
        },
      },
      {
        $project: {
          _id: 1,
          law_name: 1,
          article_no: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray() as Promise<SearchResult[]>;
};

const vectorFirstMerge = (
  kwResults: SearchResult[],
  vecResults: SearchResult[],
  limit: number,
): SearchResult[] => {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of vecResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, source: 'vec' });
    }
  }
  for (const r of kwResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, source: 'kw' });
    }
  }
  return out.slice(0, limit);
};

/** Shared MongoClient for law searches within a test run */
let _mongoClient: MongoClient | null = null;
let _mongoColl: Collection<Document> | null = null;

const ensureMongo = async (): Promise<Collection<Document>> => {
  if (_mongoClient) return _mongoColl!;
  _mongoClient = new MongoClient(ENV.mongoUrl!, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 15000,
  });
  await _mongoClient.connect();
  _mongoColl = _mongoClient.db('lawdb').collection('articles');
  return _mongoColl;
};

const closeMongo = async (): Promise<void> => {
  if (_mongoClient) {
    await _mongoClient.close().catch(() => {});
    _mongoClient = null;
    _mongoColl = null;
  }
};

interface SearchLawInput {
  query: string;
  law_name?: string;
  purpose?: string;
  limit?: number;
}

const handleSearchLaw = async (input: SearchLawInput): Promise<SearchResult[]> => {
  const query = input.query;
  const explicitLawName = input.law_name;
  const limit = input.limit || 3;

  const coll = await ensureMongo();

  // Parse query to determine lawName + concept (same logic as lawSearch.ts)
  let resolvedLawName: string | undefined;
  let keywordConcept: string;

  if (explicitLawName) {
    resolvedLawName = resolveAlias(explicitLawName);
    keywordConcept = query;
  } else {
    const lawConceptMatch = query.match(LAW_CONCEPT_REGEX);
    if (lawConceptMatch) {
      resolvedLawName = resolveAlias(lawConceptMatch[1]);
      keywordConcept = lawConceptMatch[2];
    } else {
      const extracted = tryExtractLawName(query);
      if (extracted) {
        resolvedLawName = resolveAlias(extracted.lawName);
        keywordConcept = extracted.concept;
      } else {
        const rw = tryRewriteQuery(query);
        if (rw) {
          resolvedLawName = resolveAlias(rw.lawName);
          keywordConcept = rw.concept;
        } else {
          resolvedLawName = undefined;
          keywordConcept = query;
        }
      }
    }
  }

  const pcode = resolvedLawName ? PCODE_MAP[resolvedLawName] : undefined;

  // Hybrid search: keyword + vector → vector-first merge
  try {
    const queryVector = await embedQuery(query);
    const [kwResults, vecResults] = await Promise.all([
      keywordSearch(coll, keywordConcept, resolvedLawName, limit),
      vectorSearch(coll, queryVector, limit, pcode),
    ]);
    const merged = vectorFirstMerge(kwResults, vecResults, limit);
    if (merged.length > 0) return merged;
  } catch {
    // Fall through to keyword-only
  }

  return keywordSearch(coll, keywordConcept, resolvedLawName, limit);
};

// ══════════════════════════════════════════════════════════
//  API Callers (Claude Anthropic + OpenAI-compatible)
// ══════════════════════════════════════════════════════════

const gatewayUrl = (path: string): string =>
  `https://gateway.ai.cloudflare.com/v1/${ENV.cfAccountId}/${ENV.cfGatewayId}/${path}`;

const fetchWithRetry = async (
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  maxRetries = 2,
): Promise<Response> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (response.ok) return response;
    if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    const errText = await response.text();
    throw new Error(`API error: ${response.status} - ${errText.slice(0, 500)}`);
  }
  throw new Error('fetchWithRetry: exhausted retries');
};

// ── Claude Anthropic API ──

interface ClaudeApiResponse {
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const callClaudeApi = async (
  model: string,
  system: string,
  messages: unknown[],
  tools: ClaudeTool[] | null,
  maxTokens: number,
): Promise<ClaudeApiResponse> => {
  const url = gatewayUrl('anthropic/v1/messages');
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools && { tools }),
  };
  const headers = {
    'cf-aig-authorization': `Bearer ${ENV.cfAigToken}`,
    'anthropic-version': '2023-06-01',
  };
  const resp = await fetchWithRetry(url, body, headers);
  return resp.json() as Promise<ClaudeApiResponse>;
};

// ── OpenAI-compatible API (DeepSeek/Qwen via OpenRouter) ──

interface OpenAIApiResponse {
  choices?: Array<{
    message: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const callOpenAIApi = async (
  model: string,
  system: string,
  messages: unknown[],
  tools: typeof OPENAI_TOOLS | null,
  maxTokens: number,
): Promise<OpenAIApiResponse> => {
  const url = gatewayUrl('openrouter/v1/chat/completions');
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools && tools.length > 0 && { tools }),
  };
  const headers = {
    'cf-aig-authorization': `Bearer ${ENV.cfAigToken}`,
    'cf-aig-byok-alias': 'lex-draft-openrouter',
  };
  const resp = await fetchWithRetry(url, body, headers);
  return resp.json() as Promise<OpenAIApiResponse>;
};

// ══════════════════════════════════════════════════════════
//  Tool-Loop: Claude (Anthropic format)
// ══════════════════════════════════════════════════════════

const callClaudeToolLoop = async (
  modelConfig: ModelConfig,
  input: TestInput,
  metrics: TestMetrics,
): Promise<ToolLoopResult> => {
  const userMessage = buildUserMessage(input);
  const messages: unknown[] = [{ role: 'user', content: userMessage }];
  let finalized = false;
  let searchCount = 0;
  let reasoningSummary = '';
  let perIssueAnalysis: PerIssueAnalysis[] = [];
  const supplementedLaws: SupplementedLaw[] = [];
  const lawsFound: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    metrics.rounds = round + 1;

    const data = await callClaudeApi(
      modelConfig.id,
      SYSTEM_PROMPT,
      messages,
      CLAUDE_TOOLS,
      MAX_TOKENS,
    );

    // Track tokens
    if (data.usage) {
      metrics.input_tokens += data.usage.input_tokens || 0;
      metrics.output_tokens += data.usage.output_tokens || 0;
    }

    messages.push({ role: 'assistant', content: data.content });

    // Extract tool calls
    const toolCalls = (data.content || []).filter((b) => b.type === 'tool_use');

    if (toolCalls.length === 0) {
      if (finalized) break;
      messages.push({
        role: 'user',
        content: '請繼續推理，或如果你已完成推理，請呼叫 finalize_strategy。',
      });
      continue;
    }

    const resultBlocks: Array<{ type: string; tool_use_id: string; content: string }> = [];

    for (const tc of toolCalls) {
      if (tc.name === 'search_law') {
        if (searchCount >= MAX_SEARCHES) {
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: tc.id!,
            content: '已達到搜尋上限。請呼叫 finalize_strategy。',
          });
          continue;
        }
        searchCount++;
        metrics.search_count = searchCount;

        try {
          const results = await handleSearchLaw(tc.input as SearchLawInput);
          if (results.length === 0) {
            resultBlocks.push({
              type: 'tool_result',
              tool_use_id: tc.id!,
              content: `未找到「${(tc.input as SearchLawInput).query}」的相關法條。`,
            });
          } else {
            for (const r of results) {
              lawsFound.push(r._id);
              supplementedLaws.push({
                id: r._id,
                law_name: r.law_name,
                article_no: r.article_no,
                content: r.content,
              });
            }
            const resultText = results
              .map((r) => `[${r._id}] ${r.law_name} ${r.article_no}\n${r.content}`)
              .join('\n\n');
            resultBlocks.push({
              type: 'tool_result',
              tool_use_id: tc.id!,
              content: `找到 ${results.length} 筆結果：\n\n${resultText}`,
            });
          }
        } catch (err) {
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: tc.id!,
            content: `搜尋失敗：${(err as Error).message}`,
          });
        }
      } else if (tc.name === 'finalize_strategy') {
        finalized = true;
        metrics.finalize_called = true;
        reasoningSummary =
          ((tc.input as Record<string, unknown>).reasoning_summary as string) || '';
        perIssueAnalysis =
          ((tc.input as Record<string, unknown>).per_issue_analysis as PerIssueAnalysis[]) || [];
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id!,
          content: '推理完成。',
        });
      } else {
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id!,
          content: `錯誤：工具「${tc.name}」不存在。`,
        });
      }
    }

    messages.push({ role: 'user', content: resultBlocks });
    if (finalized) break;
  }

  // Force finalize if needed
  if (!finalized) {
    const lastMsg = messages[messages.length - 1] as Record<string, unknown>;
    if (lastMsg.role === 'user') {
      if (typeof lastMsg.content === 'string') {
        lastMsg.content += '\n\n你已達到最大輪數。請立即呼叫 finalize_strategy。';
      } else {
        (lastMsg.content as unknown[]).push({
          type: 'text',
          text: '你已達到最大輪數。請立即呼叫 finalize_strategy。',
        });
      }
    }

    const forceData = await callClaudeApi(
      modelConfig.id,
      SYSTEM_PROMPT,
      messages,
      CLAUDE_TOOLS,
      MAX_TOKENS,
    );
    if (forceData.usage) {
      metrics.input_tokens += forceData.usage.input_tokens || 0;
      metrics.output_tokens += forceData.usage.output_tokens || 0;
    }
    const forceToolCalls = (forceData.content || []).filter((b) => b.type === 'tool_use');
    for (const tc of forceToolCalls) {
      if (tc.name === 'finalize_strategy') {
        finalized = true;
        metrics.finalize_called = true;
        reasoningSummary =
          ((tc.input as Record<string, unknown>).reasoning_summary as string) || '';
        perIssueAnalysis =
          ((tc.input as Record<string, unknown>).per_issue_analysis as PerIssueAnalysis[]) || [];
      }
    }
  }

  metrics.laws_found = [...new Set(lawsFound)];

  return { reasoningSummary, perIssueAnalysis, supplementedLaws, input };
};

// ══════════════════════════════════════════════════════════
//  Tool-Loop: OpenAI-compatible (DeepSeek/Qwen)
// ══════════════════════════════════════════════════════════

const callOpenAIToolLoop = async (
  modelConfig: ModelConfig,
  input: TestInput,
  metrics: TestMetrics,
): Promise<ToolLoopResult> => {
  const userMessage = buildUserMessage(input);
  const messages: unknown[] = [{ role: 'user', content: userMessage }];
  let finalized = false;
  let searchCount = 0;
  let reasoningSummary = '';
  let perIssueAnalysis: PerIssueAnalysis[] = [];
  const supplementedLaws: SupplementedLaw[] = [];
  const lawsFound: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    metrics.rounds = round + 1;

    const data = await callOpenAIApi(
      modelConfig.id,
      SYSTEM_PROMPT,
      messages,
      OPENAI_TOOLS,
      MAX_TOKENS,
    );

    // Track tokens
    if (data.usage) {
      metrics.input_tokens += data.usage.prompt_tokens || 0;
      metrics.output_tokens += data.usage.completion_tokens || 0;
    }

    const choice = data.choices?.[0];
    if (!choice) {
      console.warn('  No choices in response');
      break;
    }

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls || [];

    if (toolCalls.length === 0) {
      if (finalized) break;
      // Don't give up on first stop — nudge the model to use tools
      if (choice.finish_reason === 'stop' && round === 0) {
        messages.push({
          role: 'user',
          content:
            '你需要使用 search_law 工具來搜尋法條全文，而不是僅憑記憶引用。請搜尋 2-3 次後再呼叫 finalize_strategy。',
        });
        continue;
      }
      if (choice.finish_reason === 'stop') break;
      messages.push({
        role: 'user',
        content: '請繼續推理，或如果你已完成推理，請呼叫 finalize_strategy。',
      });
      continue;
    }

    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(tc.function.arguments);
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: '錯誤：無法解析工具參數 JSON。',
        });
        continue;
      }

      if (fnName === 'search_law') {
        if (searchCount >= MAX_SEARCHES) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: '已達到搜尋上限。請呼叫 finalize_strategy。',
          });
          continue;
        }
        searchCount++;
        metrics.search_count = searchCount;

        try {
          const results = await handleSearchLaw(fnArgs as unknown as SearchLawInput);
          if (results.length === 0) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `未找到「${fnArgs.query}」的相關法條。`,
            });
          } else {
            for (const r of results) {
              lawsFound.push(r._id);
              supplementedLaws.push({
                id: r._id,
                law_name: r.law_name,
                article_no: r.article_no,
                content: r.content,
              });
            }
            const resultText = results
              .map((r) => `[${r._id}] ${r.law_name} ${r.article_no}\n${r.content}`)
              .join('\n\n');
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `找到 ${results.length} 筆結果：\n\n${resultText}`,
            });
          }
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `搜尋失敗：${(err as Error).message}`,
          });
        }
      } else if (fnName === 'finalize_strategy') {
        finalized = true;
        metrics.finalize_called = true;
        reasoningSummary = (fnArgs.reasoning_summary as string) || '';
        perIssueAnalysis = (fnArgs.per_issue_analysis as PerIssueAnalysis[]) || [];
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: '推理完成。',
        });
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `錯誤：工具「${fnName}」不存在。`,
        });
      }
    }

    if (finalized) break;
  }

  // Force finalize if needed
  if (!finalized) {
    messages.push({
      role: 'user',
      content: '你已達到最大輪數。請立即呼叫 finalize_strategy。',
    });

    const forceData = await callOpenAIApi(
      modelConfig.id,
      SYSTEM_PROMPT,
      messages,
      OPENAI_TOOLS,
      MAX_TOKENS,
    );
    if (forceData.usage) {
      metrics.input_tokens += forceData.usage.prompt_tokens || 0;
      metrics.output_tokens += forceData.usage.completion_tokens || 0;
    }
    const forceChoice = forceData.choices?.[0];
    if (forceChoice?.message?.tool_calls) {
      for (const tc of forceChoice.message.tool_calls) {
        if (tc.function.name === 'finalize_strategy') {
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            finalized = true;
            metrics.finalize_called = true;
            reasoningSummary = (args.reasoning_summary as string) || '';
            perIssueAnalysis = (args.per_issue_analysis as PerIssueAnalysis[]) || [];
          } catch {
            /* noop */
          }
        }
      }
    }
  }

  metrics.laws_found = [...new Set(lawsFound)];

  return { reasoningSummary, perIssueAnalysis, supplementedLaws, input };
};

// ══════════════════════════════════════════════════════════
//  JSON Output Phase (Phase 2)
// ══════════════════════════════════════════════════════════

const buildJsonOutputMessage = (
  reasoningSummary: string,
  perIssueAnalysis: PerIssueAnalysis[],
  supplementedLaws: SupplementedLaw[],
  input: TestInput,
): string => {
  const issueText = input.legalIssues
    .map((issue) => {
      const text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      return text;
    })
    .join('\n');

  // Combine initial fetched laws + supplemented
  const allLawIds = new Set<string>();
  const allLaws: Array<{ id: string; name: string }> = [];
  for (const law of [...input.fetchedLaws, ...supplementedLaws]) {
    if (!allLawIds.has(law.id)) {
      allLawIds.add(law.id);
      allLaws.push({ id: law.id, name: `${law.law_name} ${law.article_no}` });
    }
  }
  const lawText = allLaws.map((l) => `- [${l.id}] ${l.name}`).join('\n');
  const fileText = input.fileSummaries.map((f) => `- [${f.id}] ${f.filename}`).join('\n');

  const analysisText =
    perIssueAnalysis.length > 0
      ? perIssueAnalysis
          .map(
            (a) =>
              `- [${a.issue_id}] 請求權基礎：${a.chosen_basis}\n  法條：${a.key_law_ids.join(', ')}\n  涵攝：${a.element_mapping}${a.defense_response ? `\n  攻防：${a.defense_response}` : ''}`,
          )
          .join('\n')
      : '';

  return `[書狀類型] ${input.briefType}

[推理摘要]
${reasoningSummary || '（無摘要）'}

${analysisText ? `[逐爭點分析]\n${analysisText}\n\n` : ''}[爭點清單]
${issueText}

[可用法條]
${lawText || '（無）'}

[案件檔案]
${fileText}

請根據以上推理結果，輸出完整的論證策略 JSON（claims + sections）。
- 每個 section 的 relevant_law_ids 應依照[逐爭點分析]中各爭點的 key_law_ids 分配
- 每個內容段落（非前言/結論）的 relevant_file_ids 必須列出該段撰寫時需要引用的檔案 ID
- 每個內容段落的 dispute_id 必須填入對應爭點的真實 ID（即[爭點清單]中方括號內的 ID，如「${input.legalIssues[0]?.id || 'Fc6FVvy_z9PPhZrpDUi2a'}」），不要自己編造 ID，不要留 null
- 每個 claim 的 dispute_id 也必須使用[爭點清單]中的真實 ID`;
};

const callClaudeJson = async (
  modelConfig: ModelConfig,
  message: string,
  metrics: TestMetrics,
): Promise<string> => {
  const data = await callClaudeApi(
    modelConfig.id,
    JSON_OUTPUT_SYSTEM_PROMPT,
    [{ role: 'user', content: message }],
    null,
    JSON_OUTPUT_MAX_TOKENS,
  );
  if (data.usage) {
    metrics.input_tokens += data.usage.input_tokens || 0;
    metrics.output_tokens += data.usage.output_tokens || 0;
  }
  return (data.content || []).map((b) => b.text || '').join('');
};

const callOpenAIJson = async (
  modelConfig: ModelConfig,
  message: string,
  metrics: TestMetrics,
): Promise<string> => {
  const data = await callOpenAIApi(
    modelConfig.id,
    JSON_OUTPUT_SYSTEM_PROMPT,
    [{ role: 'user', content: message }],
    null,
    JSON_OUTPUT_MAX_TOKENS,
  );
  if (data.usage) {
    metrics.input_tokens += data.usage.prompt_tokens || 0;
    metrics.output_tokens += data.usage.completion_tokens || 0;
  }
  return data.choices?.[0]?.message?.content || '';
};

// ══════════════════════════════════════════════════════════
//  JSON Parse + Validate (from validateStrategy.ts / toolHelpers.ts)
// ══════════════════════════════════════════════════════════

const tryParseJson = (content: string): StrategyOutput | null => {
  // Layer 1: extractBalancedJson + JSON.parse
  const jsonStr = extractBalancedJson(content);
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr) as StrategyOutput;
    } catch {
      /* noop */
    }

    // Layer 2: cleanLLMJson (markdown blocks, comments, trailing commas)
    try {
      return JSON.parse(cleanLLMJson(jsonStr)) as StrategyOutput;
    } catch {
      /* noop */
    }

    // Layer 3: jsonrepair (unescaped control chars, single quotes, truncation, etc.)
    try {
      return JSON.parse(jsonrepair(jsonStr)) as StrategyOutput;
    } catch {
      /* noop */
    }
  }

  // Layer 4: greedy match + jsonrepair
  const greedyMatch = content.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      return JSON.parse(jsonrepair(greedyMatch[0])) as StrategyOutput;
    } catch {
      /* noop */
    }
  }

  return null;
};

const applyClaimDefaults = (claims: ClaimOutput[]): ClaimOutput[] =>
  claims.map((c) => ({
    ...c,
    claim_type: c.claim_type || 'primary',
    dispute_id: c.dispute_id || null,
    responds_to: c.responds_to || null,
  }));

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const validateStrategyOutput = (
  output: StrategyOutput,
  legalIssues: LegalIssue[],
): ValidationResult => {
  const errors: string[] = [];

  if (!output.claims || !Array.isArray(output.claims)) {
    return { valid: false, errors: ['缺少 claims 陣列'] };
  }
  if (!output.sections || !Array.isArray(output.sections)) {
    return { valid: false, errors: ['缺少 sections 陣列'] };
  }

  output.claims = applyClaimDefaults(output.claims);

  // Section IDs unique
  const sectionIds = new Set<string>();
  for (const section of output.sections) {
    if (sectionIds.has(section.id)) errors.push(`重複的段落 ID: ${section.id}`);
    sectionIds.add(section.id);
  }

  // Non-intro/conclusion sections have claims
  const skipKeywords = ['前言', '結論', '結語'];
  for (const section of output.sections) {
    const isSkippable = skipKeywords.some((k) => (section.section || '').includes(k));
    if (!isSkippable && (!section.claims || section.claims.length === 0)) {
      errors.push(
        `段落「${section.section}${section.subsection ? ' > ' + section.subsection : ''}」沒有分配 claim`,
      );
    }
  }

  // Every dispute has a section
  for (const issue of legalIssues) {
    const covered = output.sections.some((s) => s.dispute_id === issue.id);
    if (!covered) errors.push(`爭點「${issue.title}」沒有對應段落`);
  }

  // Claim assigned_section valid
  for (const claim of output.claims) {
    if (claim.assigned_section && !sectionIds.has(claim.assigned_section)) {
      errors.push(`Claim 指向不存在的段落 ${claim.assigned_section}`);
    }
  }

  // Ours claims have assigned_section
  for (const claim of output.claims.filter((c) => c.side === 'ours')) {
    if (!claim.assigned_section) {
      errors.push(`我方主張「${(claim.statement || '').slice(0, 30)}...」未被分配到段落`);
    }
  }

  // Claims referenced by sections exist
  const claimIds = new Set(output.claims.map((c) => c.id));
  for (const section of output.sections) {
    for (const claimId of section.claims || []) {
      if (!claimIds.has(claimId)) {
        errors.push(`段落「${section.section}」引用不存在的 claim: ${claimId}`);
      }
    }
  }

  // Rebuttal must have responds_to
  for (const claim of output.claims) {
    if (claim.claim_type === 'rebuttal' && !claim.responds_to) {
      errors.push(`反駁主張缺少 responds_to`);
    }
  }

  // legal_basis ⊆ relevant_law_ids
  for (const section of output.sections) {
    if (section.argumentation?.legal_basis && section.relevant_law_ids) {
      const lawIdSet = new Set(section.relevant_law_ids);
      for (const basisId of section.argumentation.legal_basis) {
        if (!lawIdSet.has(basisId)) {
          errors.push(
            `段落「${section.section}」的 legal_basis「${basisId}」不在 relevant_law_ids`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

interface ParseValidateResult {
  json_parse_ok: boolean;
  validation_pass: boolean;
  validation_errors: string[];
  output: StrategyOutput | null;
  num_claims?: number;
  num_sections?: number;
  issue_coverage?: number;
  raw_preview?: string;
}

const parseAndValidate = (rawText: string, legalIssues: LegalIssue[]): ParseValidateResult => {
  const output = tryParseJson(rawText);
  if (!output) {
    return {
      json_parse_ok: false,
      validation_pass: false,
      validation_errors: ['JSON 解析失敗'],
      output: null,
      raw_preview: rawText.slice(0, 500),
    };
  }

  const validation = validateStrategyOutput(output, legalIssues);
  return {
    json_parse_ok: true,
    validation_pass: validation.valid,
    validation_errors: validation.errors,
    output,
    num_claims: output.claims?.length || 0,
    num_sections: output.sections?.length || 0,
    issue_coverage: countIssueCoverage(output, legalIssues),
  };
};

const countIssueCoverage = (output: StrategyOutput | null, legalIssues: LegalIssue[]): number => {
  if (!output?.sections) return 0;
  // Models may use their own IDs (e.g. "issue_1") instead of actual nanoid DB IDs.
  // Count unique non-null dispute_ids in sections as a proxy for coverage.
  const sectionDispIds = new Set(output.sections.map((s) => s.dispute_id).filter(Boolean));
  // If any match actual DB IDs, use exact count; otherwise use unique dispute_id count
  let exactMatch = 0;
  const issueIdSet = new Set(legalIssues.map((i) => i.id));
  for (const did of sectionDispIds) {
    if (issueIdSet.has(did!)) exactMatch++;
  }
  const count = exactMatch > 0 ? exactMatch : sectionDispIds.size;
  return count;
};

// ══════════════════════════════════════════════════════════
//  Single Test Run
// ══════════════════════════════════════════════════════════

const runSingleTest = async (modelConfig: ModelConfig, input: TestInput): Promise<TestMetrics> => {
  const metrics: TestMetrics = {
    rounds: 0,
    search_count: 0,
    laws_found: [],
    finalize_called: false,
    input_tokens: 0,
    output_tokens: 0,
    json_parse_ok: false,
    validation_pass: false,
    validation_errors: [],
    num_claims: 0,
    num_sections: 0,
    issue_coverage: 0,
    total_time_ms: 0,
    estimated_cost: 0,
    error: null,
    raw_preview: null,
    reasoning: null,
  };

  const startTime = Date.now();

  try {
    // Phase 1: Tool-Loop Reasoning
    let toolLoopResult: ToolLoopResult;
    if (modelConfig.format === 'anthropic') {
      toolLoopResult = await callClaudeToolLoop(modelConfig, input, metrics);
    } else {
      toolLoopResult = await callOpenAIToolLoop(modelConfig, input, metrics);
    }

    // Phase 2: JSON Structuring Output
    const jsonMsg = buildJsonOutputMessage(
      toolLoopResult.reasoningSummary,
      toolLoopResult.perIssueAnalysis,
      toolLoopResult.supplementedLaws,
      input,
    );

    let rawJson: string;
    if (modelConfig.format === 'anthropic') {
      rawJson = await callClaudeJson(modelConfig, jsonMsg, metrics);
    } else {
      rawJson = await callOpenAIJson(modelConfig, jsonMsg, metrics);
    }

    // Parse + Validate
    const result = parseAndValidate(rawJson, input.legalIssues);
    metrics.json_parse_ok = result.json_parse_ok;
    metrics.validation_pass = result.validation_pass;
    metrics.validation_errors = result.validation_errors;
    metrics.num_claims = result.num_claims || 0;
    metrics.num_sections = result.num_sections || 0;
    metrics.issue_coverage = result.issue_coverage || 0;
    metrics.raw_preview = result.raw_preview || null;

    // Retry on parse failure
    if (!result.json_parse_ok) {
      const retryMsg = jsonMsg + '\n\n重要：只輸出純 JSON，不要加 markdown code block 或其他文字。';
      let retryRaw: string;
      if (modelConfig.format === 'anthropic') {
        retryRaw = await callClaudeJson(modelConfig, retryMsg, metrics);
      } else {
        retryRaw = await callOpenAIJson(modelConfig, retryMsg, metrics);
      }
      const retryResult = parseAndValidate(retryRaw, input.legalIssues);
      if (retryResult.json_parse_ok) {
        metrics.json_parse_ok = true;
        metrics.validation_pass = retryResult.validation_pass;
        metrics.validation_errors = retryResult.validation_errors;
        metrics.num_claims = retryResult.num_claims || 0;
        metrics.num_sections = retryResult.num_sections || 0;
        metrics.issue_coverage = retryResult.issue_coverage || 0;
        metrics.raw_preview = null;
      }
    }
    // Attach reasoning details for quality comparison
    metrics.reasoning = {
      summary: toolLoopResult.reasoningSummary,
      perIssueAnalysis: toolLoopResult.perIssueAnalysis,
      supplementedLaws: toolLoopResult.supplementedLaws.map((l) => `${l.law_name} ${l.article_no}`),
      sections: result.output?.sections?.map((s) => ({
        id: s.id,
        section: s.section,
        subsection: s.subsection || null,
        dispute_id: s.dispute_id || null,
        legal_basis: s.argumentation?.legal_basis || [],
        relevant_law_ids: s.relevant_law_ids || [],
        relevant_file_ids: s.relevant_file_ids || [],
        legal_reasoning: s.legal_reasoning || '',
      })),
    };
  } catch (err) {
    metrics.error = (err as Error).message;
    metrics.reasoning = null;
  }

  metrics.total_time_ms = Date.now() - startTime;
  metrics.estimated_cost =
    (metrics.input_tokens * modelConfig.costIn) / 1_000_000 +
    (metrics.output_tokens * modelConfig.costOut) / 1_000_000;

  return metrics;
};

// ══════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════

const main = async (): Promise<void> => {
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Reasoning Strategy A/B Test — ${MODELS.length} models × ${RUNS_PER_MODEL} run(s)`);
  console.log('══════════════════════════════════════════════════════════\n');

  // Load case data
  console.log('Loading case data from D1...');
  const caseData = loadCaseFromD1();
  console.log(
    `  Case: ${caseData.caseRow.title}`,
    `| ${caseData.disputes.length} disputes`,
    `| ${caseData.files.length} files`,
    `| ${caseData.damages.length} damages\n`,
  );

  const input = buildTestInput(caseData);
  const totalIssues = input.legalIssues.length;

  // Connect MongoDB once
  await ensureMongo();
  console.log('MongoDB connected.\n');

  const allResults: Record<string, TestMetrics[]> = {};

  for (const model of MODELS) {
    const modelResults: TestMetrics[] = [];
    console.log(`▶ ${model.name} (${model.id})`);

    for (let run = 1; run <= RUNS_PER_MODEL; run++) {
      const m = await runSingleTest(model, input);
      modelResults.push(m);

      const timeStr = (m.total_time_ms / 1000).toFixed(1) + 's';
      const parseStr = m.json_parse_ok ? '✅' : '❌';
      const validStr = m.validation_pass ? '✅' : '❌';
      const costStr = '$' + m.estimated_cost.toFixed(3);
      const statusStr = m.error ? `❌ ${m.error.slice(0, 60)}` : '✅';

      console.log(
        `  Run ${run}: ${statusStr} ${timeStr} | ${m.rounds} rounds, ${m.search_count} searches | parse ${parseStr} valid ${validStr} | ${m.num_claims} claims ${m.num_sections} sections | ${costStr}`,
      );

      if (m.validation_errors.length > 0 && !m.validation_pass) {
        console.log(`    Errors: ${m.validation_errors.slice(0, 3).join('; ')}`);
      }
      if (m.raw_preview) {
        console.log(`    Raw preview: ${m.raw_preview.slice(0, 100)}...`);
      }

      // Print reasoning details for quality comparison
      if (m.reasoning) {
        console.log(`\n    ── 推理摘要 ──`);
        console.log(`    ${(m.reasoning.summary || '(無)').replace(/\n/g, '\n    ')}`);

        if (m.reasoning.perIssueAnalysis?.length > 0) {
          console.log(`\n    ── 逐爭點分析 (${m.reasoning.perIssueAnalysis.length}) ──`);
          for (const a of m.reasoning.perIssueAnalysis) {
            console.log(`    [${a.issue_id}] 請求權基礎：${a.chosen_basis || '(無)'}`);
            console.log(`      法條：${(a.key_law_ids || []).join(', ') || '(無)'}`);
            console.log(`      涵攝：${a.element_mapping || '(無)'}`);
            if (a.defense_response) console.log(`      攻防：${a.defense_response}`);
          }
        }

        console.log(`\n    ── 搜尋到的法條 (${m.reasoning.supplementedLaws?.length || 0}) ──`);
        for (const law of m.reasoning.supplementedLaws || []) {
          console.log(`    • ${law}`);
        }

        if (m.reasoning.sections) {
          console.log(`\n    ── JSON 結構 sections (${m.reasoning.sections.length}) ──`);
          for (const sec of m.reasoning.sections) {
            const legalBasis = sec.legal_basis?.length ? sec.legal_basis.join(', ') : '(無)';
            const lawIds = sec.relevant_law_ids?.length ? sec.relevant_law_ids.join(', ') : '(無)';
            const fileIds = sec.relevant_file_ids?.length
              ? sec.relevant_file_ids.join(', ')
              : '(無)';
            console.log(
              `    [${sec.id}] ${sec.section}${sec.subsection ? ' > ' + sec.subsection : ''}`,
            );
            console.log(`      dispute_id: ${sec.dispute_id || '(無)'}`);
            console.log(`      legal_basis: ${legalBasis}`);
            console.log(`      relevant_law_ids: ${lawIds}`);
            console.log(`      relevant_file_ids: ${fileIds}`);
            if (sec.legal_reasoning) {
              const preview =
                sec.legal_reasoning.length > 200
                  ? sec.legal_reasoning.slice(0, 200) + '...'
                  : sec.legal_reasoning;
              console.log(`      legal_reasoning: ${preview}`);
            }
          }
        }
        console.log('');
      }
    }

    allResults[model.name] = modelResults;
    console.log('');
  }

  // ── Summary ──
  console.log('══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════════════');

  const header =
    'Model'.padEnd(22) +
    'Avg Time'.padStart(10) +
    'Avg Cost'.padStart(10) +
    'Parse'.padStart(8) +
    'Valid'.padStart(8) +
    'Claims'.padStart(8) +
    'Sections'.padStart(10) +
    'Coverage'.padStart(10);
  console.log(header);
  console.log('-'.repeat(86));

  for (const model of MODELS) {
    const results = allResults[model.name];
    if (!results || results.length === 0) continue;

    const n = results.length;
    const avgTime = (results.reduce((s, r) => s + r.total_time_ms, 0) / n / 1000).toFixed(1) + 's';
    const avgCost = '$' + (results.reduce((s, r) => s + r.estimated_cost, 0) / n).toFixed(3);
    const parseOk = results.filter((r) => r.json_parse_ok).length;
    const validOk = results.filter((r) => r.validation_pass).length;
    const avgClaims = (results.reduce((s, r) => s + r.num_claims, 0) / n).toFixed(1);
    const avgSections = (results.reduce((s, r) => s + r.num_sections, 0) / n).toFixed(1);
    const avgCoverage =
      (results.reduce((s, r) => s + r.issue_coverage, 0) / n).toFixed(1) + '/' + totalIssues;

    console.log(
      model.name.padEnd(22) +
        avgTime.padStart(10) +
        avgCost.padStart(10) +
        `${parseOk}/${n}`.padStart(8) +
        `${validOk}/${n}`.padStart(8) +
        avgClaims.padStart(8) +
        avgSections.padStart(10) +
        avgCoverage.padStart(10),
    );
  }

  // Token details
  console.log('\n── Token Details ──');
  for (const model of MODELS) {
    const results = allResults[model.name];
    if (!results || results.length === 0) continue;
    const n = results.length;
    const avgIn = Math.round(results.reduce((s, r) => s + r.input_tokens, 0) / n);
    const avgOut = Math.round(results.reduce((s, r) => s + r.output_tokens, 0) / n);
    const avgRounds = (results.reduce((s, r) => s + r.rounds, 0) / n).toFixed(1);
    const avgSearches = (results.reduce((s, r) => s + r.search_count, 0) / n).toFixed(1);
    console.log(
      `${model.name.padEnd(22)} avg_in=${avgIn} avg_out=${avgOut} avg_rounds=${avgRounds} avg_searches=${avgSearches}`,
    );
  }

  // Save full reasoning output to JSON for detailed comparison
  const outputPath = resolve('scripts/reasoning-ab-test/reasoning-comparison.json');
  const outputData: Record<string, unknown[]> = {};
  for (const model of MODELS) {
    const results = allResults[model.name];
    if (!results || results.length === 0) continue;
    outputData[model.name] = results.map((r) => ({
      total_time_ms: r.total_time_ms,
      estimated_cost: r.estimated_cost,
      rounds: r.rounds,
      search_count: r.search_count,
      laws_found: r.laws_found,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      json_parse_ok: r.json_parse_ok,
      validation_pass: r.validation_pass,
      validation_errors: r.validation_errors,
      num_claims: r.num_claims,
      num_sections: r.num_sections,
      issue_coverage: r.issue_coverage,
      reasoning: r.reasoning,
    }));
  }
  writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nFull reasoning output saved to: ${outputPath}`);

  await closeMongo();
};

main().catch((err) => {
  console.error('Fatal error:', err);
  closeMongo().finally(() => process.exit(1));
});
