// ── Stub Context ──
// Noop D1/R2 proxy + real AI env vars for replay scripts.
// D1/R2 calls will no-op; only AI calls (Gemini/Claude) hit real APIs.

import { getDB } from '../../src/server/db';
import type { PipelineContext } from '../../src/server/agent/pipeline/types';
import { loadDevVars } from './_helpers';

// Recursive Proxy — any chain of property access / function calls returns a safe default.
// Property access → proxy (chainable), function call → proxy (chainable),
// special props: then→undefined (not thenable), results→[], success→true (D1 return shape).
const createNoopProxy = (): unknown =>
  new Proxy(() => {}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'results') return [];
      if (prop === 'success') return true;
      return createNoopProxy();
    },
    apply: () => createNoopProxy(),
  });

export const createStubContext = (overrides?: Partial<PipelineContext>): PipelineContext => {
  const vars = loadDevVars();
  const db = createNoopProxy() as D1Database;

  return {
    caseId: 'replay-stub',
    briefType: '準備書狀',
    title: 'Replay',
    signal: new AbortController().signal,
    sendSSE: async () => {},
    db,
    drizzle: getDB(db),
    aiEnv: {
      CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID || '',
      CF_GATEWAY_ID: vars.CF_GATEWAY_ID || '',
      CF_AIG_TOKEN: vars.CF_AIG_TOKEN || '',
    },
    mongoUrl: vars.MONGO_URL || '',
    mongoApiKey: vars.MONGO_API_KEY,
    ...overrides,
  } as PipelineContext;
};
