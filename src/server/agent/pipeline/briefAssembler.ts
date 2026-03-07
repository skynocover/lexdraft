// ── Brief Assembler: 根據 brief_type 組裝書狀的 header / declaration / footer ──

import { nanoid } from 'nanoid';
import type { Paragraph, DamageItem } from './types';
import { COURTS } from '../../../shared/caseConstants';

// ── Types ──

interface BriefConfig {
  title: string;
  partyLabels: [string, string]; // [原告方, 被告方]
  caseNumberRequired: boolean;
  declaration: {
    section: string;
    type: 'claim' | 'dismiss' | 'appeal';
  } | null;
  courtSuffix: string;
}

interface CaseRow {
  court: string | null;
  case_number: string | null;
  plaintiff: string | null;
  defendant: string | null;
  client_role: string | null;
}

// ── Config 對照表 ──

const BRIEF_CONFIGS: Record<string, BriefConfig> = {
  complaint: {
    title: '民事起訴狀',
    partyLabels: ['原告', '被告'],
    caseNumberRequired: false,
    declaration: { section: '壹、訴之聲明', type: 'claim' },
    courtSuffix: '民事庭',
  },
  defense: {
    title: '民事答辯狀',
    partyLabels: ['原告', '被告'],
    caseNumberRequired: true,
    declaration: { section: '壹、答辯聲明', type: 'dismiss' },
    courtSuffix: '民事庭',
  },
  preparation: {
    title: '民事準備書狀',
    partyLabels: ['原告', '被告'],
    caseNumberRequired: true,
    declaration: null,
    courtSuffix: '民事庭',
  },
  appeal: {
    title: '上訴狀',
    partyLabels: ['上訴人', '被上訴人'],
    caseNumberRequired: true,
    declaration: { section: '壹、上訴聲明', type: 'appeal' },
    courtSuffix: '民事庭',
  },
};

// ── Helpers ──

const makeParagraph = (section: string, contentMd: string, subsection = ''): Paragraph => ({
  id: nanoid(),
  section,
  subsection,
  content_md: contentMd,
  segments: [{ text: contentMd, citations: [] }],
  dispute_id: null,
  citations: [],
});

const formatAmount = (amount: number): string => `新臺幣${amount.toLocaleString()}元`;

const calcTotal = (damages: DamageItem[]): number => {
  const totalRow = damages.find((d) => d.description?.includes('總計'));
  if (totalRow) return totalRow.amount;
  return damages.reduce((sum, d) => sum + d.amount, 0);
};

/** Treat actual null, empty string, and the string "null" as missing */
const isBlank = (v: string | null | undefined): boolean => !v || v === 'null';

const matchCourt = (input: string): string | null => {
  // 完全比對
  const exact = COURTS.find((c) => c === input);
  if (exact) return exact;
  // 部分比對：input 是某個法院名稱的子字串（如「高雄地方法院」→「臺灣高雄地方法院」）
  const partial = COURTS.find((c) => c.includes(input));
  if (partial) return partial;
  // 模糊比對：去掉「臺灣」「法院」取核心地名，找對應的地方法院
  const core = input.replace(/^臺灣/, '').replace(/法院$/, '');
  if (core) {
    const fuzzy = COURTS.find((c) => c.includes(core) && c.includes('地方法院'));
    if (fuzzy) return fuzzy;
  }
  return null;
};

const getCourtFullName = (court: string | null, suffix: string): string => {
  if (isBlank(court)) return `【待填：法院名稱】　${suffix}`;
  const matched = matchCourt(court!);
  return `${matched || court!}　${suffix}`;
};

// ── assembleHeader ──

export const assembleHeader = (briefType: string, caseRow: CaseRow): Paragraph[] => {
  const config = BRIEF_CONFIGS[briefType];
  if (!config) return [];

  const lines: string[] = [];

  // 案號、股別
  if (!isBlank(caseRow.case_number)) {
    lines.push(`案號：${caseRow.case_number}`);
  } else if (!config.caseNumberRequired) {
    lines.push('案號：（新案免填）');
  } else {
    lines.push('案號：【待填：案號】');
  }
  lines.push('股別：');
  lines.push('');

  // 當事人
  const [label1, label2] = config.partyLabels;
  lines.push(
    isBlank(caseRow.plaintiff)
      ? `${label1}　【待填：${label1}姓名】`
      : `${label1}　${caseRow.plaintiff}`,
  );
  lines.push(
    isBlank(caseRow.defendant)
      ? `${label2}　【待填：${label2}姓名】`
      : `${label2}　${caseRow.defendant}`,
  );

  return lines.length > 0 ? [makeParagraph('書狀首頁', lines.join('\n'))] : [];
};

// ── assembleDeclaration ──

export const assembleDeclaration = (briefType: string, damages: DamageItem[]): Paragraph[] => {
  const config = BRIEF_CONFIGS[briefType];
  if (!config?.declaration) return [];

  const { section, type } = config.declaration;

  if (type === 'claim') {
    const lines: string[] = [];
    if (damages.length > 0) {
      const total = calcTotal(damages);
      lines.push(
        `一、被告應給付原告${formatAmount(total)}，及自起訴狀繕本送達翌日起至清償日止，按年息百分之五計算之利息。`,
      );
    } else {
      lines.push(
        '一、被告應給付原告新臺幣＿＿＿元，及自起訴狀繕本送達翌日起至清償日止，按年息百分之五計算之利息。',
      );
    }
    lines.push('');
    lines.push('二、訴訟費用由被告負擔。');
    lines.push('');
    lines.push('三、原告願供擔保，請准宣告假執行。');
    return [makeParagraph(section, lines.join('\n'))];
  }

  if (type === 'dismiss') {
    const lines = [
      '一、原告之訴駁回。',
      '',
      '二、訴訟費用由原告負擔。',
      '',
      '三、如受不利判決，被告願供擔保請准宣告免為假執行。',
    ];
    return [makeParagraph(section, lines.join('\n'))];
  }

  if (type === 'appeal') {
    const lines = [
      '一、原判決廢棄。',
      '',
      '二、上開廢棄部分，依上訴人之聲明改為判決。',
      '',
      '三、第一、二審訴訟費用由被上訴人負擔。',
    ];
    return [makeParagraph(section, lines.join('\n'))];
  }

  return [];
};

// ── assembleFooter ──

export const assembleFooter = (briefType: string, caseRow: CaseRow): Paragraph[] => {
  const config = BRIEF_CONFIGS[briefType];
  if (!config) return [];

  const courtName = getCourtFullName(caseRow.court, config.courtSuffix);

  // 具狀人：根據 client_role 決定
  let signatory = '';
  if (caseRow.client_role === 'plaintiff') {
    signatory = isBlank(caseRow.plaintiff) ? '' : caseRow.plaintiff!;
  } else if (caseRow.client_role === 'defendant') {
    signatory = isBlank(caseRow.defendant) ? '' : caseRow.defendant!;
  } else {
    // 依書狀類型推斷
    if (briefType === 'defense') {
      signatory = isBlank(caseRow.defendant) ? '' : caseRow.defendant!;
    } else {
      signatory = isBlank(caseRow.plaintiff) ? '' : caseRow.plaintiff!;
    }
  }

  const lines: string[] = [];
  lines.push('謹　狀');
  lines.push('');
  lines.push(`${courtName}　公鑒`);
  lines.push('');
  lines.push(signatory ? `具狀人：${signatory}` : '具狀人：【待填：具狀人姓名】');
  lines.push('');
  lines.push('中　華　民　國　　　年　　　月　　　日');

  return [makeParagraph('書狀末尾', lines.join('\n'))];
};
