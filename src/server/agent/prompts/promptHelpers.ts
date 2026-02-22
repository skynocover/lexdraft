// ── Shared prompt helpers ──
// Extracted from orchestratorPrompt / strategistPrompt / writerStep to DRY up
// the repeated clientRole label and case metadata block construction.

export interface CaseMetaInput {
  caseNumber?: string;
  court?: string;
  caseType?: string;
  clientRole?: string;
  caseInstructions?: string;
}

/** Map clientRole value to display label */
export const getClientRoleLabel = (clientRole?: string): string => {
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
    roleLabel ? `${prefix}我方立場：${roleLabel}` : '',
    meta.caseNumber ? `${prefix}案號：${meta.caseNumber}` : '',
    meta.court ? `${prefix}法院：${meta.court}` : '',
    meta.caseType ? `${prefix}案件類型：${meta.caseType}` : '',
  ].filter(Boolean);
};

/** Build the `[律師處理指引]` block (returns empty string when no instructions) */
export const buildInstructionsBlock = (caseInstructions?: string): string => {
  if (!caseInstructions) return '';
  return `\n[律師處理指引]\n${caseInstructions}\n`;
};
