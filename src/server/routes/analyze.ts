import { Hono } from 'hono';
import { getDB } from '../db';
import type { AppEnv } from '../types';
import { parseBody } from '../lib/validate';
import { analyzeSchema } from '../schemas/analyze';
import { runAnalysis } from '../services/analysisService';

const analyzeRouter = new Hono<AppEnv>();

// POST /api/cases/:caseId/analyze — 直接觸發分析（不經過 agent loop）
analyzeRouter.post('/cases/:caseId/analyze', async (c) => {
  const caseId = c.req.param('caseId');
  const body = parseBody(await c.req.json(), analyzeSchema);
  const drizzle = getDB(c.env.DB);

  const aiEnv = {
    CF_ACCOUNT_ID: c.env.CF_ACCOUNT_ID,
    CF_GATEWAY_ID: c.env.CF_GATEWAY_ID,
    CF_AIG_TOKEN: c.env.CF_AIG_TOKEN,
  };

  const result = await runAnalysis(body.type, caseId, c.env.DB, drizzle, aiEnv);

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 422);
  }

  return c.json({
    success: true,
    data: result.data,
    summary: result.summary,
    ...('damages' in result ? { damages: result.damages } : {}),
    analyzed_at: 'analyzed_at' in result ? result.analyzed_at : null,
  });
});

export { analyzeRouter };
