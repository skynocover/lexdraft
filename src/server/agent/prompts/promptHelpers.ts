// ── Shared prompt helpers ──
// Extracted from orchestratorPrompt / strategistPrompt / writerStep to DRY up
// the repeated clientRole label and case metadata block construction.

import type { ClientRole } from '../../../shared/caseConstants';

export interface CaseMetaInput {
  title?: string;
  caseNumber?: string;
  court?: string;
  division?: string;
  clientRole?: ClientRole | '';
  plaintiff?: string;
  defendant?: string;
  caseInstructions?: string;
}

/** Map clientRole value to display label */
export const getClientRoleLabel = (clientRole?: ClientRole | ''): string => {
  if (clientRole === 'plaintiff') return '原告方';
  if (clientRole === 'defendant') return '被告方';
  return '';
};

/**
 * Build an array of "key：value" lines for case metadata.
 * @param prefix Optional prefix for each line (e.g. '  ' for indented writer context)
 */
export const buildCaseMetaLines = (meta?: CaseMetaInput, prefix = ''): string[] => {
  if (!meta) return [];
  const roleLabel = getClientRoleLabel(meta.clientRole);
  return [
    meta.title ? `${prefix}案件名稱：${meta.title}` : '',
    roleLabel ? `${prefix}我方立場：${roleLabel}` : '',
    meta.plaintiff ? `${prefix}原告：${meta.plaintiff}` : '',
    meta.defendant ? `${prefix}被告：${meta.defendant}` : '',
    meta.court ? `${prefix}法院：${meta.court}` : '',
    meta.division ? `${prefix}庭別：${meta.division}` : '',
    meta.caseNumber ? `${prefix}案號：${meta.caseNumber}` : '',
  ].filter(Boolean);
};

/** Build the `[律師處理指引]` block (returns empty string when no instructions) */
export const buildInstructionsBlock = (caseInstructions?: string): string => {
  if (!caseInstructions) return '';
  return `\n[律師處理指引]\n${caseInstructions}\n`;
};
