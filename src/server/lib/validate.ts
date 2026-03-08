import type { ZodType } from 'zod';
import type { ValidationDetail } from './errors';
import { badRequest } from './errors';

/** 驗證 API route request body，失敗時 throw AppError(400) */
export const parseBody = <T>(raw: unknown, schema: ZodType<T>): T => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstMessage = result.error.issues[0]?.message ?? '請求格式錯誤';
    const details: ValidationDetail[] = result.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    }));
    throw badRequest(firstMessage, details);
  }
  return result.data;
};

/** 驗證 Agent tool arguments，失敗回傳格式化 error string（不 throw） */
export const safeParseToolArgs = <T>(
  toolName: string,
  raw: Record<string, unknown>,
  schema: ZodType<T>,
): { success: true; data: T } | { success: false; error: string } => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join('; ');
    return { success: false, error: `${toolName} 參數格式錯誤: ${details}` };
  }
  return { success: true, data: result.data };
};
