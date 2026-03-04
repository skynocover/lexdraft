// ── Test: stub-context noop proxy ──
// Verifies the recursive proxy doesn't throw on deep property chains.

import { createStubContext } from './stub-context';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Stub Context Tests ═══\n');

// Test 1: createStubContext returns valid shape
const ctx = createStubContext();
assert(typeof ctx.caseId === 'string', 'caseId is string');
assert(typeof ctx.briefType === 'string', 'briefType is string');
assert(typeof ctx.sendSSE === 'function', 'sendSSE is function');
assert(ctx.signal instanceof AbortSignal, 'signal is AbortSignal');

// Test 2: sendSSE is a no-op (doesn't throw)
let sendOk = false;
try {
  await ctx.sendSSE({ type: 'done' });
  sendOk = true;
} catch {
  /* */
}
assert(sendOk, 'sendSSE() does not throw');

// Test 3: D1 noop proxy — deep chains don't throw
let dbOk = false;
try {
  const result = (
    ctx.db as unknown as {
      prepare: (s: string) => { bind: (...a: unknown[]) => { run: () => unknown } };
    }
  )
    .prepare('SELECT 1')
    .bind('a', 'b')
    .run();
  dbOk = result !== undefined;
} catch {
  /* */
}
assert(dbOk, 'db.prepare().bind().run() does not throw');

// Test 4: D1 proxy returns object with results array
let resultsOk = false;
try {
  const result = (
    ctx.db as unknown as { prepare: (s: string) => { all: () => { results: unknown[] } } }
  )
    .prepare('SELECT *')
    .all();
  resultsOk = Array.isArray(result.results);
} catch {
  /* */
}
assert(resultsOk, 'db.prepare().all().results is array');

// Test 5: Drizzle wrapper doesn't throw on basic access
let drizzleOk = false;
try {
  // drizzle wrapping noop proxy — property access should not throw
  const d = ctx.drizzle;
  drizzleOk = d !== undefined && d !== null;
} catch {
  /* */
}
assert(drizzleOk, 'drizzle is defined');

// Test 6: aiEnv has expected keys
assert(typeof ctx.aiEnv.CF_ACCOUNT_ID === 'string', 'aiEnv.CF_ACCOUNT_ID is string');
assert(typeof ctx.aiEnv.CF_GATEWAY_ID === 'string', 'aiEnv.CF_GATEWAY_ID is string');
assert(typeof ctx.aiEnv.CF_AIG_TOKEN === 'string', 'aiEnv.CF_AIG_TOKEN is string');

// Test 7: overrides work
const custom = createStubContext({ caseId: 'my-case', briefType: '民事起訴狀' });
assert(custom.caseId === 'my-case', 'override caseId works');
assert(custom.briefType === '民事起訴狀', 'override briefType works');

// Test 8: proxy 'then' returns undefined (prevents accidental await treating proxy as thenable)
let thenOk = false;
try {
  const val = (ctx.db as unknown as { then?: unknown }).then;
  thenOk = val === undefined;
} catch {
  /* */
}
assert(thenOk, 'proxy.then is undefined (not thenable)');

summary('✓ All stub-context tests passed');
