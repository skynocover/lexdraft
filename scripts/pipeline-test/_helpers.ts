// ── Shared helpers for pipeline test scripts ──

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Claim, LegalIssue, ReasoningSection } from '../../src/server/agent/pipeline/types';

// ── CLI args ──

export const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name: string, fallback: string): string => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  const hasFlag = (name: string): boolean => args.includes(name);
  return { args, getArg, hasFlag };
};

// ── Worktree path ──

export const getMainWorktreePath = (): string => {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
    const match = output.match(/^worktree (.+)$/m);
    if (match) return match[1];
  } catch {
    /* not in a worktree */
  }
  return process.cwd();
};

// ── Dev vars ──

export const loadDevVars = (): Record<string, string> => {
  const vars: Record<string, string> = {};
  const candidates = [resolve('.dev.vars'), resolve('dist/lexdraft/.dev.vars')];
  for (const path of candidates) {
    try {
      const content = readFileSync(path, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([A-Z_]+)\s*=\s*"?([^\s"]+)"?/);
        if (m) vars[m[1]] = m[2];
      }
      break;
    } catch {
      /* try next */
    }
  }
  return vars;
};

// ── Snapshot JSON loader ──

export const loadSnapshotJson = (
  snapshotDir: string,
  filename: string,
): Record<string, unknown> => {
  const path = `${snapshotDir}/${filename}`;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    console.error(`Failed to load ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
};

// ── Test harness ──

export const createTestRunner = () => {
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, label: string) => {
    if (condition) {
      passed++;
      console.log(`  ✓ ${label}`);
    } else {
      failed++;
      console.error(`  ✗ ${label}`);
    }
  };

  const summary = (allPassedMsg?: string) => {
    console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
    if (failed > 0) process.exit(1);
    if (allPassedMsg) console.log(allPassedMsg);
  };

  return { assert, summary };
};

// ── Test fixture factories ──

export const mkClaim = (overrides: Partial<Claim> = {}): Claim => ({
  id: overrides.id || 'c1',
  side: overrides.side || 'ours',
  claim_type: overrides.claim_type || 'primary',
  statement: overrides.statement || '測試主張',
  assigned_section: 'assigned_section' in overrides ? (overrides.assigned_section ?? null) : null,
  dispute_id: 'dispute_id' in overrides ? (overrides.dispute_id ?? null) : null,
  responds_to: overrides.responds_to ?? null,
});

export const mkSection = (overrides: Partial<ReasoningSection> = {}): ReasoningSection => ({
  id: overrides.id || 'sec-1',
  section: overrides.section || '貳、事實及理由',
  subsection: overrides.subsection,
  dispute_id: overrides.dispute_id,
  argumentation: overrides.argumentation || {
    legal_basis: [],
    fact_application: '',
    conclusion: '',
  },
  claims: overrides.claims || [],
  relevant_file_ids: overrides.relevant_file_ids || [],
  relevant_law_ids: overrides.relevant_law_ids || [],
  legal_reasoning: overrides.legal_reasoning || '',
});

export const mkIssue = (overrides: Partial<LegalIssue> = {}): LegalIssue => ({
  id: overrides.id || 'dispute-1',
  title: overrides.title || '侵權行為',
  our_position: overrides.our_position || '',
  their_position: overrides.their_position || '',
  key_evidence: overrides.key_evidence || [],
  mentioned_laws: overrides.mentioned_laws || [],
  facts: overrides.facts || [],
});
