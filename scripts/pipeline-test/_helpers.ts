// ── Shared helpers for pipeline test scripts ──

import { readFileSync } from 'fs';
import { resolve } from 'path';

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

// ── Dev vars ──

export const loadDevVars = (): Record<string, string> => {
  const vars: Record<string, string> = {};
  try {
    const content = readFileSync(resolve('dist/lexdraft/.dev.vars'), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*"?([^\s"]+)"?/);
      if (m) vars[m[1]] = m[2];
    }
  } catch {
    /* .dev.vars not found */
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
