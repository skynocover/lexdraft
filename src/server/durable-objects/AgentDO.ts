import { DurableObject } from 'cloudflare:workers'

export class AgentDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    return new Response('AgentDO stub — not yet implemented', { status: 501 })
  }
}
