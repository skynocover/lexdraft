// ── Programmatic Enrichment (補齊 AI 偷懶填空的欄位) ──
// Pure functions extracted from reasoningStrategyStep.ts for testability.

import type {
  ReasoningStrategyOutput,
  PerIssueAnalysis,
  LegalIssue,
  EnrichmentStats,
} from './types';

/**
 * Levenshtein distance between two strings.
 * Used to fuzzy-match corrupted dispute_ids from Gemini output.
 */
export const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

/**
 * Try to find the closest valid issue ID for a corrupted dispute_id.
 * Returns the match if Levenshtein distance ≤ 3 (nanoid is 21 chars, so 3 edits is ~14% error).
 */
export const fuzzyMatchDisputeId = (corrupted: string, validIds: Set<string>): string | null => {
  if (validIds.has(corrupted)) return null; // already valid

  // Strip whitespace that Gemini sometimes inserts
  const stripped = corrupted.replace(/\s/g, '');
  if (validIds.has(stripped)) return stripped;

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const id of validIds) {
    const dist = levenshtein(stripped, id);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestDist <= 3 ? bestId : null;
};

/** Fix corrupted dispute_ids in an array of items (sections or claims). Returns count of fixes. */
export const fixCorruptedDisputeIds = (
  items: Array<{ dispute_id?: string | null }>,
  validIds: Set<string>,
  label: string,
): number => {
  let fixed = 0;
  for (const item of items) {
    if (item.dispute_id && !validIds.has(item.dispute_id)) {
      const match = fuzzyMatchDisputeId(item.dispute_id, validIds);
      if (match) {
        console.warn(`[enrichment] fixed ${label} dispute_id: "${item.dispute_id}" → "${match}"`);
        item.dispute_id = match;
        fixed++;
      }
    }
  }
  return fixed;
};

export const enrichStrategyOutput = (
  output: ReasoningStrategyOutput,
  perIssueAnalysis: PerIssueAnalysis[],
  legalIssues: LegalIssue[] = [],
): EnrichmentStats => {
  const { claims, sections } = output;
  const stats = {
    disputeIdFixed: 0,
    sectionDisputeFromClaim: 0,
    claimDisputeFromSection: 0,
    claimConsistency: 0,
    legalBasis: 0,
    lawIds: 0,
    subsection: 0,
  };

  // 0. 修正 corrupted dispute_id（Gemini 經常抄錯 nanoid）
  if (legalIssues.length > 0) {
    const validIds = new Set(legalIssues.map((i) => i.id));
    stats.disputeIdFixed += fixCorruptedDisputeIds(sections, validIds, 'section');
    stats.disputeIdFixed += fixCorruptedDisputeIds(claims, validIds, 'claim');
  }

  // 1. 修正 section dispute_id — 從其 claims 推導
  for (const sec of sections) {
    if (!sec.dispute_id && sec.claims.length > 0) {
      const sectionClaimIds = new Set(sec.claims);
      const disputeIds = new Set(
        claims.filter((c) => sectionClaimIds.has(c.id) && c.dispute_id).map((c) => c.dispute_id!),
      );
      if (disputeIds.size === 1) {
        sec.dispute_id = [...disputeIds][0];
        stats.sectionDisputeFromClaim++;
      }
    }
  }

  // 2. 修正 claim dispute_id — 從其 assigned_section 的 section 取
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  for (const claim of claims) {
    if (!claim.dispute_id && claim.assigned_section) {
      const sec = sectionMap.get(claim.assigned_section);
      if (sec?.dispute_id) {
        claim.dispute_id = sec.dispute_id;
        stats.claimDisputeFromSection++;
      }
    }
  }

  // 3. 修正 section claims[] 一致性 — claim.assigned_section 指向 section 但 section.claims 沒有它
  for (const claim of claims) {
    if (claim.assigned_section) {
      const sec = sectionMap.get(claim.assigned_section);
      if (sec && !sec.claims.includes(claim.id)) {
        sec.claims.push(claim.id);
        stats.claimConsistency++;
      }
    }
  }

  // 4. 填 argumentation.legal_basis（如果空且有 dispute_id）
  const analysisMap = new Map(perIssueAnalysis.map((a) => [a.issue_id, a]));
  for (const sec of sections) {
    if (sec.dispute_id && sec.argumentation.legal_basis.length === 0) {
      const analysis = analysisMap.get(sec.dispute_id);
      if (analysis && analysis.key_law_ids.length > 0) {
        sec.argumentation.legal_basis = [...analysis.key_law_ids];
        stats.legalBasis++;
      }
    }
  }

  // 5. relevant_law_ids — validation only（AI 應自行填寫，此處只記錄缺漏不修改）
  for (const sec of sections) {
    // Defensive normalization: ensure array exists even if upstream skipped it
    sec.relevant_law_ids = sec.relevant_law_ids || [];
    if (!sec.dispute_id) continue;

    const analysis = analysisMap.get(sec.dispute_id);
    const fromAnalysis = analysis?.key_law_ids || [];
    const fromBasis = sec.argumentation.legal_basis || [];

    const expected = new Set([...fromAnalysis, ...fromBasis]);
    const missing = [...expected].filter((id) => !sec.relevant_law_ids.includes(id));
    if (missing.length > 0) {
      stats.lawIds++;
      console.warn(
        `[enrichment] section "${sec.subsection || sec.section}" missing law_ids: [${missing.join(', ')}]`,
      );
    }
  }

  // 6. subsection — validation only（AI 應自行填寫，此處只記錄缺漏不修改）
  if (legalIssues.length > 0) {
    for (const sec of sections) {
      if (sec.subsection || !sec.dispute_id) continue;
      stats.subsection++;
      console.warn(
        `[enrichment] section "${sec.section}" missing subsection (dispute=${sec.dispute_id})`,
      );
    }
  }

  // Summary log
  const enrichedCount = sections.filter((s) => s.relevant_law_ids.length > 0).length;
  const totalLawIds = sections.reduce((sum, s) => sum + s.relevant_law_ids.length, 0);
  const actualPatches =
    stats.disputeIdFixed +
    stats.sectionDisputeFromClaim +
    stats.claimDisputeFromSection +
    stats.claimConsistency +
    stats.legalBasis;
  const validationWarnings = stats.lawIds + stats.subsection;
  const totalPatched = actualPatches + validationWarnings;

  console.log(
    `[enrichment] ${actualPatches} patches, ${validationWarnings} warnings — ` +
      `dispute_id_fixed: ${stats.disputeIdFixed}, ` +
      `sec.dispute_id←claim: ${stats.sectionDisputeFromClaim}, ` +
      `claim.dispute_id←sec: ${stats.claimDisputeFromSection}, ` +
      `claim↔sec consistency: ${stats.claimConsistency}, ` +
      `legal_basis: ${stats.legalBasis}, ` +
      `law_ids: ${stats.lawIds}, ` +
      `subsection: ${stats.subsection}`,
  );
  console.log(
    `[enrichment] result: ${enrichedCount}/${sections.length} sections have law_ids (${totalLawIds} total)`,
  );

  // Per-section detail for debugging
  for (const sec of sections) {
    const label = sec.subsection ? `${sec.section} > ${sec.subsection}` : sec.section;
    console.log(
      `[enrichment]   "${label}" dispute=${sec.dispute_id || 'null'} ` +
        `laws=[${sec.relevant_law_ids.join(', ')}] ` +
        `basis=[${sec.argumentation.legal_basis.join(', ')}]`,
    );
  }

  if (actualPatches > sections.length) {
    console.warn(
      `[enrichment] WARNING: ${actualPatches} patches for ${sections.length} sections — AI output quality may be degrading`,
    );
  }

  return { ...stats, totalPatched };
};
