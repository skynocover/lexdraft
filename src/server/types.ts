export type AppEnv = {
  Bindings: {
    ASSETS: Fetcher
    DB: D1Database
    BUCKET: R2Bucket
    FILE_QUEUE: Queue
    AGENT_DO: DurableObjectNamespace
    AUTH_TOKEN: string
    CF_ACCOUNT_ID: string
    CF_GATEWAY_ID: string
    CF_AIG_TOKEN: string
  }
}
