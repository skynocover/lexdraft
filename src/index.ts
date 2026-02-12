import { Hono } from 'hono'

type Bindings = {
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Bindings }>()

// === API 路由（後端） ===

app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Cloudflare Workers!' })
})

app.get('/api/time', (c) => {
  return c.json({ time: new Date().toISOString() })
})

// === 靜態資源回退（前端） ===
// 所有非 API 請求都交給 Static Assets 處理
app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

// CRITICAL: 直接 export default app，不要用 { fetch: app.fetch }
export default app
