import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { callAI } from '../agent/aiClient';
import type { ChatMessage } from '../agent/aiClient';
import { badRequest } from '../lib/errors';
import { requireString } from '../lib/validate';

type Operation = 'condense' | 'strengthen';

const SYSTEM_PROMPTS: Record<Operation, string> = {
  condense:
    '請將以下法律文書段落精簡，去除冗餘用語，保留核心論點和關鍵引用。只輸出精簡後的純文字，不要使用任何 Markdown 格式（如 **粗體**、標題等）。',
  strengthen:
    '請加強以下法律文書段落的論述力度，補充法律推理、增加論證層次。只輸出加強後的純文字，不要使用任何 Markdown 格式（如 **粗體**、標題等）。',
};

const VALID_OPERATIONS = new Set<string>(['condense', 'strengthen']);

const INLINE_MODEL = 'google-ai-studio/gemini-2.5-flash-lite';

const inlineAIRouter = new Hono<AppEnv>();

// POST /inline-ai/transform — 文字轉換
inlineAIRouter.post('/inline-ai/transform', async (c) => {
  const body = await c.req.json<{
    text: string;
    operation: string;
  }>();

  requireString(body.text, '轉換文字');

  if (!VALID_OPERATIONS.has(body.operation)) {
    throw badRequest('無效的操作類型');
  }

  const systemPrompt = SYSTEM_PROMPTS[body.operation as Operation];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: body.text },
  ];

  const env = {
    CF_ACCOUNT_ID: c.env.CF_ACCOUNT_ID,
    CF_GATEWAY_ID: c.env.CF_GATEWAY_ID,
    CF_AIG_TOKEN: c.env.CF_AIG_TOKEN,
  };

  const { content } = await callAI(env, messages, INLINE_MODEL);
  return c.json({ result: content });
});

export { inlineAIRouter };
