export type AppEnv = {
  Bindings: {
    ASSETS: Fetcher
    DB: D1Database
    BUCKET: R2Bucket
    FILE_QUEUE: Queue
    AGENT_DO: DurableObjectNamespace
    AUTH_TOKEN: string
    ANTHROPIC_API_KEY: string
  }
}
