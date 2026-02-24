import type { Citation } from '../../client/stores/useBriefStore';
import type { AIEnv } from './aiClient';
import { nanoid } from 'nanoid';

// ── Document block types ──

interface CustomContentDocumentBlock {
  type: 'document';
  source: {
    type: 'content';
    content: Array<{ type: 'text'; text: string }>;
  };
  title: string;
  context?: string;
  citations: { enabled: true };
}

interface TextBlock {
  type: 'text';
  text: string;
}

// ── Response types ──

interface ContentBlockCitation {
  type: 'content_block_location';
  cited_text: string;
  document_index: number;
  document_title: string;
  start_block_index: number;
  end_block_index: number;
}

interface CharLocationCitation {
  type: 'char_location';
  cited_text: string;
  document_index: number;
  document_title: string;
  start_char_index: number;
  end_char_index: number;
}

interface ClaudeResponse {
  content: Array<{
    type: 'text';
    text: string;
    citations?: Array<ContentBlockCitation | CharLocationCitation>;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeDocument {
  title: string;
  content: string;
  file_id?: string;
  doc_type?: 'file' | 'law';
}

export interface TextSegment {
  text: string;
  citations: Citation[];
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ClaudeCitationResult {
  text: string;
  segments: TextSegment[];
  citations: Citation[];
  usage: ClaudeUsage;
}

// ── Chunking ──

const MAX_CHUNK_LENGTH = 800;

/**
 * Split document content into chunks for custom content citations.
 *
 * If the content contains ## headers (AI-generated markdown), split by ## boundaries.
 * Otherwise fall back to splitting by 。 sentence boundaries.
 *
 * All chunks are sent to Claude together — only citation granularity is affected.
 */
const chunkContent = (content: string): string[] => {
  const trimmed = content.trim();
  if (!trimmed) return [trimmed];

  // Split by ## headers if present
  if (/^##\s/m.test(trimmed)) {
    const sections = trimmed.split(/(?=^##\s)/m);
    const chunks: string[] = [];
    for (const section of sections) {
      const s = section.trim();
      if (!s) continue;
      if (s.length <= MAX_CHUNK_LENGTH) {
        chunks.push(s);
      } else {
        chunks.push(...splitBySentence(s));
      }
    }
    return chunks.length > 0 ? chunks : [trimmed];
  }

  // Fallback: no ## headers — split by 。 if too long
  if (trimmed.length <= MAX_CHUNK_LENGTH) return [trimmed];
  return splitBySentence(trimmed);
};

/** Split a long text into chunks by 。 boundaries, each <= MAX_CHUNK_LENGTH */
const splitBySentence = (text: string): string[] => {
  const sentences = text.split(/(?<=。)/);
  const chunks: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > MAX_CHUNK_LENGTH && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    buffer += sentence;
  }
  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.length > 0 ? chunks : [text];
};

// ── Per-document chunk map (to resolve block_index back to text) ──

interface DocumentChunkMap {
  doc: ClaudeDocument;
  chunks: string[];
}

/**
 * Call Claude Haiku 4.5 with Citations API enabled (custom content format),
 * routed through Cloudflare AI Gateway for unified billing.
 */
export const callClaudeWithCitations = async (
  env: AIEnv,
  documents: ClaudeDocument[],
  instruction: string,
): Promise<ClaudeCitationResult> => {
  // Build content blocks: documents first, then user instruction
  const contentBlocks: Array<CustomContentDocumentBlock | TextBlock> = [];
  const chunkMaps: DocumentChunkMap[] = [];

  for (const doc of documents) {
    const chunks = chunkContent(doc.content);
    chunkMaps.push({ doc, chunks });

    contentBlocks.push({
      type: 'document',
      source: {
        type: 'content',
        content: chunks.map((text) => ({ type: 'text' as const, text })),
      },
      title: doc.title,
      citations: { enabled: true },
    });
  }

  contentBlocks.push({
    type: 'text',
    text: instruction,
  });

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: contentBlocks,
      },
    ],
  };

  // Route through Cloudflare AI Gateway → Anthropic
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/anthropic/v1/messages`;

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as ClaudeResponse;

  // Parse response: extract text, segments, and citations
  let fullText = '';
  const allCitations: Citation[] = [];
  const segments: TextSegment[] = [];

  for (const block of data.content) {
    if (block.type === 'text') {
      // Strip raw <cite> tags that Claude sometimes outputs in text
      const cleanText = block.text.replace(/<cite\s+index="[^"]*">/g, '').replace(/<\/cite>/g, '');
      fullText += cleanText;
      const blockCitations: Citation[] = [];

      if (block.citations) {
        for (const cite of block.citations) {
          const docMap = chunkMaps[cite.document_index];
          const doc = docMap?.doc;

          const citation: Citation = {
            id: nanoid(),
            label: cite.document_title,
            type: doc?.doc_type || (doc?.file_id ? 'file' : 'law'),
            file_id: doc?.file_id,
            location:
              cite.type === 'content_block_location'
                ? { block_index: cite.start_block_index }
                : {
                    char_start: cite.start_char_index,
                    char_end: cite.end_char_index,
                  },
            quoted_text: cite.cited_text,
            status: 'confirmed',
          };
          blockCitations.push(citation);
          allCitations.push(citation);
        }
      }

      segments.push({ text: cleanText, citations: blockCitations });
    }
  }

  const usage: ClaudeUsage = data.usage || { input_tokens: 0, output_tokens: 0 };

  return { text: fullText, segments, citations: allCitations, usage };
};

/**
 * Call Claude Haiku 4.5 without citations (for Planner sub-agent).
 * Routed through Cloudflare AI Gateway.
 */
export const callClaude = async (
  env: AIEnv,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096,
): Promise<{ content: string; usage: ClaudeUsage; truncated: boolean }> => {
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/anthropic/v1/messages`;

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const content = data.content.map((b) => b.text).join('');
  const usage: ClaudeUsage = data.usage || { input_tokens: 0, output_tokens: 0 };
  const truncated = data.stop_reason === 'max_tokens';

  if (truncated) {
    console.warn(
      `[callClaude] Response truncated (stop_reason=max_tokens, maxTokens=${maxTokens})`,
    );
  }

  return { content, usage, truncated };
};
