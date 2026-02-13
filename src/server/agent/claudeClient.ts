import type { Citation } from '../../client/stores/useBriefStore'
import type { AIEnv } from './aiClient'
import { nanoid } from 'nanoid'

interface DocumentBlock {
  type: 'document'
  source: {
    type: 'text'
    media_type: 'text/plain'
    data: string
  }
  title: string
  context?: string
  citations: { enabled: true }
}

interface TextBlock {
  type: 'text'
  text: string
}

interface ClaudeResponse {
  content: Array<{
    type: 'text'
    text: string
    citations?: Array<{
      type: 'char_location'
      cited_text: string
      document_index: number
      document_title: string
      start_char_index: number
      end_char_index: number
    }>
  }>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export interface ClaudeDocument {
  title: string
  content: string
  file_id?: string
}

export interface TextSegment {
  text: string
  citations: Citation[]
}

export interface ClaudeCitationResult {
  text: string
  segments: TextSegment[]
  citations: Citation[]
}

/**
 * Call Claude Haiku 4.5 with Citations API enabled,
 * routed through Cloudflare AI Gateway for unified billing.
 */
export async function callClaudeWithCitations(
  env: AIEnv,
  documents: ClaudeDocument[],
  instruction: string,
): Promise<ClaudeCitationResult> {
  // Build content blocks: documents first, then user instruction
  const contentBlocks: Array<DocumentBlock | TextBlock> = []

  for (const doc of documents) {
    contentBlocks.push({
      type: 'document',
      source: {
        type: 'text',
        media_type: 'text/plain',
        data: doc.content,
      },
      title: doc.title,
      citations: { enabled: true },
    })
  }

  contentBlocks.push({
    type: 'text',
    text: instruction,
  })

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: contentBlocks,
      },
    ],
  }

  // Route through Cloudflare AI Gateway → Anthropic
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/anthropic/v1/messages`

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${errText}`)
  }

  const data = (await response.json()) as ClaudeResponse

  // Parse response: extract text, segments, and citations
  let fullText = ''
  const allCitations: Citation[] = []
  const segments: TextSegment[] = []

  for (const block of data.content) {
    if (block.type === 'text') {
      fullText += block.text
      const blockCitations: Citation[] = []

      if (block.citations) {
        for (const cite of block.citations) {
          const doc = documents[cite.document_index]
          const citation: Citation = {
            id: nanoid(),
            label: cite.document_title,
            type: doc?.file_id ? 'file' : 'law',
            file_id: doc?.file_id,
            location: {
              page: 0,
              char_start: cite.start_char_index,
              char_end: cite.end_char_index,
            },
            quoted_text: cite.cited_text,
            status: 'confirmed',
          }
          blockCitations.push(citation)
          allCitations.push(citation)
        }
      }

      segments.push({ text: block.text, citations: blockCitations })
    }
  }

  return { text: fullText, segments, citations: allCitations }
}
