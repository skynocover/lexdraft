import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
export { AgentDO } from './server/durable-objects/AgentDO';
import type { AppEnv } from './server/types';
import { authMiddleware } from './server/middleware/auth';
import { casesRouter } from './server/routes/cases';
import { filesRouter } from './server/routes/files';
import { chatRouter } from './server/routes/chat';
import { briefsRouter } from './server/routes/briefs';
import { damagesRouter } from './server/routes/damages';
import { briefVersionsRouter } from './server/routes/briefVersions';
import { lawRouter } from './server/routes/law';
import { inlineAIRouter } from './server/routes/inlineAI';
import { processFileMessage } from './server/queue/fileProcessor';

const app = new Hono<AppEnv>();

// === 全域錯誤處理 ===
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error('[unhandled]', err);
  return c.json({ error: '伺服器發生錯誤，請稍後再試' }, 500);
});

// === 公開路由 ===

// Token 驗證端點（不需要 auth middleware）
app.get('/api/auth/verify', authMiddleware, (c) => {
  return c.json({ ok: true });
});

// === 受保護的 API 路由 ===
const api = new Hono<AppEnv>();
api.use('*', authMiddleware);

// 案件
api.route('/cases', casesRouter);

// 檔案（包含 /cases/:caseId/files 和 /files/:id 路由）
api.route('/', filesRouter);

// 聊天（包含 /cases/:caseId/chat 和 /cases/:caseId/messages 路由）
api.route('/', chatRouter);

// 書狀（包含 /cases/:caseId/briefs 和 /briefs/:id 路由）
api.route('/', briefsRouter);

// 書狀版本（包含 /briefs/:briefId/versions 和 /brief-versions/:id 路由）
api.route('/', briefVersionsRouter);

// 金額計算（包含 /cases/:caseId/damages 和 /damages/:id 路由）
api.route('/', damagesRouter);

// 法條搜尋（包含 /law/search 和 /cases/:caseId/law-refs 路由）
api.route('/', lawRouter);

// Inline AI（段落級 AI 操作）
api.route('/', inlineAIRouter);

app.route('/api', api);

// === 靜態資源回退（前端 SPA） ===
app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// === Export with Queue handler ===
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: AppEnv['Bindings']) {
    for (const message of batch.messages) {
      try {
        await processFileMessage(
          message.body as {
            fileId: string;
            caseId: string;
            r2Key: string;
            filename: string;
          },
          env,
        );
        message.ack();
      } catch (err) {
        console.error('Queue processing error:', err);
        message.retry();
      }
    }
  },
};
