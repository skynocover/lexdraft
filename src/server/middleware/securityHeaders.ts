import { secureHeaders } from 'hono/secure-headers';

export const securityHeadersMiddleware = secureHeaders({
  // 防止 clickjacking — 禁止被嵌入 iframe
  xFrameOptions: 'DENY',
  // 防止 MIME type sniffing
  xContentTypeOptions: 'nosniff',
  // 控制 Referrer 資訊洩漏
  referrerPolicy: 'strict-origin-when-cross-origin',
  // 禁用不需要的瀏覽器 API
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
  },
  // CSP — 根據實際資源來源配置
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
});
