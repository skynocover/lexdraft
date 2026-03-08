import { HTTPException } from 'hono/http-exception';

export interface ValidationDetail {
  path: PropertyKey[];
  message: string;
}

/**
 * 統一的應用程式錯誤類別
 * 繼承 Hono HTTPException，自動回傳 { error: string, details?: ValidationDetail[] } JSON
 */
export class AppError extends HTTPException {
  constructor(status: 400 | 401 | 404 | 500, message: string, details?: ValidationDetail[]) {
    const body: { error: string; details?: ValidationDetail[] } = { error: message };
    if (details) body.details = details;
    const res = new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    super(status, { res });
  }
}

/** 400 Bad Request */
export const badRequest = (message: string, details?: ValidationDetail[]): AppError =>
  new AppError(400, message, details);

/** 404 Not Found — 自動拼接 `${resource}不存在` */
export const notFound = (resource: string): AppError => new AppError(404, `${resource}不存在`);

/** 401 Unauthorized */
export const unauthorized = (): AppError => new AppError(401, '未授權');
