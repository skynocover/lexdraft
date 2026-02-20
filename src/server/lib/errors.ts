import { HTTPException } from 'hono/http-exception'

/**
 * 統一的應用程式錯誤類別
 * 繼承 Hono HTTPException，自動回傳 { error: string } JSON
 */
export class AppError extends HTTPException {
  constructor(status: 400 | 401 | 404 | 500, message: string) {
    const res = new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
    super(status, { res })
  }
}

/** 400 Bad Request */
export const badRequest = (message: string): AppError => new AppError(400, message)

/** 404 Not Found — 自動拼接 `${resource}不存在` */
export const notFound = (resource: string): AppError => new AppError(404, `${resource}不存在`)

/** 401 Unauthorized */
export const unauthorized = (): AppError => new AppError(401, '未授權')
