// ── Test: Layer 1 Programmatic Review Checks ──
// Tests pure-code checks for issues LLM can't reliably catch:
// placeholders, amount inconsistency, name inconsistency, exhibit references.

import { parseArgs, d1Query, type InjectedError } from './_helpers';

// ── Types ──

interface Paragraph {
  id: string;
  section: string;
  subsection: string;
  content_md: string;
  dispute_id: string | null;
}

interface ReviewIssue {
  severity: 'critical' | 'warning';
  type: string;
  paragraph_id: string | null;
  description: string;
}

// ── Check 1: Placeholders ──

const checkPlaceholders = (paragraphs: Paragraph[]): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];
  const patterns = [/【待填[^】]*】/g, /○○/g, /___+/g, /\[待填[^\]]*\]/g, /（待填[^）]*）/g];

  for (const p of paragraphs) {
    for (const pattern of patterns) {
      const matches = p.content_md.match(pattern);
      if (matches) {
        issues.push({
          severity: 'critical',
          type: 'placeholder',
          paragraph_id: p.id,
          description: `未填寫的佔位符：${matches.join('、')}`,
        });
      }
    }
  }

  return issues;
};

// ── Check 2: Amount inconsistency ──

const extractAmounts = (text: string): Array<{ amount: number; context: string }> => {
  const results: Array<{ amount: number; context: string }> = [];

  // Match patterns like: 新臺幣41,550元, 41,550元, NT$41,550
  const pattern = /(?:新臺幣|NT\$?)?\s*([\d,]+)\s*元/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    const amount = parseInt(numStr, 10);
    if (amount > 0) {
      // Get surrounding context (20 chars before and after)
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      results.push({ amount, context: text.slice(start, end).replace(/\n/g, ' ') });
    }
  }

  return results;
};

const checkAmountConsistency = (paragraphs: Paragraph[]): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];

  // Damage categories to check
  const damageKeywords = ['醫療費用', '交通費用', '不能工作損失', '修復費', '精神慰撫金'];

  // For each keyword, collect (amount, paragraphId) pairs across paragraphs
  for (const keyword of damageKeywords) {
    const seen: Array<{ amount: number; paragraphId: string; label: string }> = [];

    for (const p of paragraphs) {
      if (p.section === '__header__' || p.section === '__footer__') continue;

      // Check if this paragraph discusses this damage category
      const inSubsection = p.subsection?.includes(keyword);
      const inContent = p.content_md.includes(keyword);
      if (!inSubsection && !inContent) continue;

      // Extract amounts near the keyword mention
      const amounts = extractAmounts(p.content_md);
      // Find amounts that appear near the keyword (within 80 chars)
      const keywordPositions: number[] = [];
      let searchIdx = 0;
      while (true) {
        const idx = p.content_md.indexOf(keyword, searchIdx);
        if (idx < 0) break;
        keywordPositions.push(idx);
        searchIdx = idx + 1;
      }

      for (const a of amounts) {
        // Check if this amount is near a keyword mention
        const amountStr = a.amount.toLocaleString();
        const amountIdx = p.content_md.indexOf(amountStr);
        if (amountIdx < 0) continue;

        const nearKeyword = keywordPositions.some((ki) => Math.abs(amountIdx - ki) < 120);
        // Also consider: if the paragraph's subsection matches, all "total" amounts are relevant
        const isTotalAmount =
          p.content_md.includes('合計') && Math.abs(p.content_md.indexOf('合計') - amountIdx) < 40;
        const isInMatchingSubsection = inSubsection;

        if (nearKeyword || (isInMatchingSubsection && (isTotalAmount || amounts.length <= 2))) {
          seen.push({ amount: a.amount, paragraphId: p.id, label: `${keyword}` });
        }
      }
    }

    // Compare: if we have multiple "total/headline" amounts for same keyword, check consistency
    if (seen.length < 2) continue;

    // Find the most common amount (canonical)
    const amountCounts = new Map<number, number>();
    for (const s of seen) {
      amountCounts.set(s.amount, (amountCounts.get(s.amount) || 0) + 1);
    }
    let canonicalAmount = 0;
    let maxCount = 0;
    for (const [amount, count] of amountCounts) {
      if (count > maxCount) {
        maxCount = count;
        canonicalAmount = amount;
      }
    }

    // Flag mismatches
    for (const s of seen) {
      if (s.amount === canonicalAmount) continue;
      // Only flag if amounts are in the same order of magnitude (avoid comparing subtotals vs per-item)
      const ratio = s.amount / canonicalAmount;
      if (ratio > 0.5 && ratio < 2) {
        issues.push({
          severity: 'critical',
          type: 'amount_inconsistency',
          paragraph_id: s.paragraphId,
          description: `${keyword}金額不一致：此段為 ${s.amount.toLocaleString()} 元，但其他段落為 ${canonicalAmount.toLocaleString()} 元`,
        });
      }
    }
  }

  return issues;
};

// ── Check 3: Name inconsistency ──

const checkNameConsistency = (paragraphs: Paragraph[]): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];

  // Strategy: extract person names by matching role + common Chinese surname + given name
  // Common surnames (top 50 in Taiwan)
  const surnames =
    '陳王李張劉黃林吳周蔡楊許鄭謝洪郭邱曾廖賴徐何蕭葉傅蘇戴呂莊江田石潘游詹施顏余彭趙姜沈盧魏馮鍾';
  const surnameSet = new Set(surnames.split(''));

  // Match: 原告/被告 + surname + 1-2 given name chars
  const namePattern = /(?:原告|被告|訴外人)([\u4e00-\u9fff][\u4e00-\u9fff]{1,2})/g;

  // Collect all name variants per role
  const roleNames = new Map<string, Map<string, string[]>>(); // role -> name -> [paragraphIds]

  for (const p of paragraphs) {
    if (p.section === '__header__' || p.section === '__footer__') continue;
    let match;
    const regex = new RegExp(namePattern.source, 'g');
    while ((match = regex.exec(p.content_md)) !== null) {
      const fullMatch = match[0];
      const role = fullMatch.startsWith('原告')
        ? '原告'
        : fullMatch.startsWith('被告')
          ? '被告'
          : '訴外人';
      const name = match[1];

      // Only keep if first char is a known surname
      if (!surnameSet.has(name[0])) continue;

      if (!roleNames.has(role)) roleNames.set(role, new Map());
      const names = roleNames.get(role)!;
      if (!names.has(name)) names.set(name, []);
      names.get(name)!.push(p.id);
    }
  }

  // For each role, if there are multiple name variants, flag the minority
  for (const [role, names] of roleNames) {
    if (names.size <= 1) continue;

    // Find the most common name (canonical)
    let maxCount = 0;
    let canonicalName = '';
    for (const [name, pids] of names) {
      if (pids.length > maxCount) {
        maxCount = pids.length;
        canonicalName = name;
      }
    }

    // Flag variants
    for (const [name, pids] of names) {
      if (name === canonicalName) continue;
      const uniquePids = [...new Set(pids)];
      for (const pid of uniquePids) {
        issues.push({
          severity: 'critical',
          type: 'name_inconsistency',
          paragraph_id: pid,
          description: `${role}名稱不一致：此段使用「${role}${name}」，但其他段落多為「${role}${canonicalName}」`,
        });
      }
    }
  }

  return issues;
};

// ── Check 4: Exhibit reference completeness ──

const checkExhibitRefs = (paragraphs: Paragraph[]): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];

  // Collect all exhibit references (甲證一, 甲證二, etc.)
  const exhibitPattern = /甲證([一二三四五六七八九十百]+|\d+)/g;
  const allExhibits = new Set<string>();
  const exhibitsByParagraph = new Map<string, Set<string>>();

  for (const p of paragraphs) {
    if (p.section === '__header__' || p.section === '__footer__') continue;
    const regex = new RegExp(exhibitPattern.source, 'g');
    let match;
    while ((match = regex.exec(p.content_md)) !== null) {
      const exhibit = match[0];
      allExhibits.add(exhibit);
      if (!exhibitsByParagraph.has(p.id)) exhibitsByParagraph.set(p.id, new Set());
      exhibitsByParagraph.get(p.id)!.add(exhibit);
    }
  }

  // Check if exhibits are defined in 證據方法 section
  const evidenceParagraphs = paragraphs.filter(
    (p) => p.section === '參、證據方法' || p.section === '證據方法',
  );
  const evidenceText = evidenceParagraphs.map((p) => p.content_md).join('\n');

  for (const exhibit of allExhibits) {
    if (!evidenceText.includes(exhibit)) {
      // Find first paragraph that references this exhibit
      const firstPid = [...exhibitsByParagraph.entries()].find(([, exs]) => exs.has(exhibit))?.[0];
      issues.push({
        severity: 'warning',
        type: 'exhibit_missing',
        paragraph_id: firstPid || null,
        description: `內文引用「${exhibit}」，但證據方法段落中未列出此證據`,
      });
    }
  }

  return issues;
};

// ── Run all checks ──

const runLayer1Review = (paragraphs: Paragraph[]): ReviewIssue[] => {
  return [
    ...checkPlaceholders(paragraphs),
    ...checkAmountConsistency(paragraphs),
    ...checkNameConsistency(paragraphs),
    ...checkExhibitRefs(paragraphs),
  ];
};

// ── Error injection ──

const INJECTED_ERRORS: InjectedError[] = [
  {
    label: '金額矛盾：醫療費用 41,550→45,150',
    targetParagraphId: '_-VYwgpcnJkr_6vVD7vfC',
    expectedType: 'amount_inconsistency',
    apply: (ps) =>
      ps.map((p) =>
        p.id === '_-VYwgpcnJkr_6vVD7vfC'
          ? { ...p, content_md: p.content_md.replace('41,550', '45,150') }
          : p,
      ),
  },
  {
    label: '人名矛盾：被告 王建宏→王建明（僅一段）',
    targetParagraphId: 'Pzcd7ipYa6xoz6IKTg9-F',
    expectedType: 'name_inconsistency',
    apply: (ps) =>
      ps.map((p) =>
        p.id === 'Pzcd7ipYa6xoz6IKTg9-F'
          ? { ...p, content_md: p.content_md.replaceAll('王建宏', '王建明') }
          : p,
      ),
  },
];

// ── Main ──

const main = () => {
  const { hasFlag } = parseArgs();
  const briefId = 'W0jVyzoW32UAqtjiDM1E-';

  // Load brief
  console.log(`\n📋 Loading brief ${briefId}...`);
  const briefRows = d1Query(
    `SELECT content_structured FROM briefs WHERE id = '${briefId}'`,
  ) as Array<{ content_structured: string }>;
  const paragraphs = (JSON.parse(briefRows[0].content_structured) as { paragraphs: Paragraph[] })
    .paragraphs;
  console.log(`  ${paragraphs.length} paragraphs`);

  // ── Test 1: Clean brief ──
  console.log('\n' + '═'.repeat(60));
  console.log('TEST 1: Clean brief (baseline)');
  console.log('═'.repeat(60));

  const cleanIssues = runLayer1Review(paragraphs);
  printIssues(cleanIssues);

  // ── Test 2: Injected errors ──
  console.log('\n' + '═'.repeat(60));
  console.log('TEST 2: Injected errors');
  console.log('═'.repeat(60));

  let injectedParagraphs = [...paragraphs.map((p) => ({ ...p }))];
  for (const err of INJECTED_ERRORS) {
    console.log(`  💉 ${err.label}`);
    injectedParagraphs = err.apply(injectedParagraphs);
  }

  const injectedIssues = runLayer1Review(injectedParagraphs);
  printIssues(injectedIssues);

  // ── Recall check ──
  console.log('\n' + '═'.repeat(60));
  console.log('RECALL CHECK');
  console.log('═'.repeat(60));

  for (const err of INJECTED_ERRORS) {
    const caught = injectedIssues.some(
      (i) => i.type === err.expectedType && i.paragraph_id === err.targetParagraphId,
    );
    console.log(`  ${caught ? '✅' : '❌'} ${err.label}`);
  }

  // Check no false positives on clean brief for these types
  const cleanAmountIssues = cleanIssues.filter((i) => i.type === 'amount_inconsistency');
  const cleanNameIssues = cleanIssues.filter((i) => i.type === 'name_inconsistency');
  console.log(`\n  False positives on clean brief:`);
  console.log(`    amount_inconsistency: ${cleanAmountIssues.length}`);
  console.log(`    name_inconsistency: ${cleanNameIssues.length}`);
};

const printIssues = (issues: ReviewIssue[]) => {
  const criticals = issues.filter((i) => i.severity === 'critical');
  const warnings = issues.filter((i) => i.severity === 'warning');

  console.log(`\n  Critical: ${criticals.length}, Warning: ${warnings.length}`);

  if (criticals.length > 0) {
    console.log('\n  🔴 Critical:');
    for (const i of criticals) {
      console.log(`    [${i.type}] ${i.description}`);
      if (i.paragraph_id) console.log(`      📍 ${i.paragraph_id}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n  🟡 Warning:');
    for (const i of warnings) {
      console.log(`    [${i.type}] ${i.description}`);
      if (i.paragraph_id) console.log(`      📍 ${i.paragraph_id}`);
    }
  }
};

main();
