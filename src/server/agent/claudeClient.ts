import type { Citation } from '../../client/stores/useBriefStore';
import { getGatewayBaseUrl, type AIEnv } from './aiClient';
import { nanoid } from 'nanoid';
import { stripFFFD } from '../lib/sanitize';

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
  const gatewayUrl = `${getGatewayBaseUrl(env)}/anthropic/v1/messages`;

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

  // Detect truncation (like callClaude does)
  if (data.stop_reason === 'max_tokens') {
    console.warn(
      `[callClaudeWithCitations] Response truncated (stop_reason=max_tokens, output_tokens=${data.usage?.output_tokens})`,
    );
  }

  // Parse response: extract text, segments, and citations
  let fullText = '';
  const allCitations: Citation[] = [];
  const segments: TextSegment[] = [];

  for (const block of data.content) {
    if (block.type === 'text') {
      // Strip raw <cite> tags that Claude sometimes outputs in text,
      // then strip U+FFFD from AI Gateway corruption (Claude boundary)
      const cleanText = stripFFFD(
        block.text.replace(/<cite\s+index="[^"]*">/g, '').replace(/<\/cite>/g, ''),
      );
      fullText += cleanText;
      const blockCitations: Citation[] = [];

      if (block.citations) {
        for (const cite of block.citations) {
          const docMap = chunkMaps[cite.document_index];
          const doc = docMap?.doc;

          const citation: Citation = {
            id: nanoid(),
            // Use our own doc.title (guaranteed clean) instead of the
            // AI Gateway-echoed document_title which may contain U+FFFD
            label: doc?.title || stripFFFD(cite.document_title),
            type: doc?.doc_type || (doc?.file_id ? 'file' : 'law'),
            file_id: doc?.file_id,
            location:
              cite.type === 'content_block_location'
                ? { block_index: cite.start_block_index }
                : {
                    char_start: cite.start_char_index,
                    char_end: cite.end_char_index,
                  },
            quoted_text: stripFFFD(cite.cited_text),
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
  const gatewayUrl = `${getGatewayBaseUrl(env)}/anthropic/v1/messages`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      body,
    });

    if (response.ok) break;

    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      console.warn(`[callClaude] ${response.status} on attempt ${attempt + 1}, retrying...`);
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }

    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  if (!response || !response.ok) {
    throw new Error('callClaude: exhausted retries');
  }

  const data = (await response.json()) as ClaudeResponse;
  const content = stripFFFD(data.content.map((b) => b.text).join(''));
  const usage: ClaudeUsage = data.usage || { input_tokens: 0, output_tokens: 0 };
  const truncated = data.stop_reason === 'max_tokens';

  if (truncated) {
    console.warn(
      `[callClaude] Response truncated (stop_reason=max_tokens, maxTokens=${maxTokens})`,
    );
  }

  return { content, usage, truncated };
};

// ── Claude Tool-Loop Types ──

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ClaudeToolLoopOptions {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  tools: ClaudeToolDefinition[];
  max_tokens: number;
}

export interface ClaudeToolLoopResponse {
  content: ClaudeContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: ClaudeUsage;
}

// ── Retry wrapper (429 / 5xx) ──

const callWithRetry = async (
  url: string,
  env: AIEnv,
  body: Record<string, unknown>,
  maxRetries = 3,
): Promise<Response> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    if (attempt < maxRetries - 1 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }

    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }
  throw new Error('callWithRetry: unreachable');
};

// ── Claude Tool-Loop Call ──

/**
 * Call Claude with tool support (for multi-turn tool-loop agents).
 * Routed through Cloudflare AI Gateway. Retries on 429/5xx.
 * Strips U+FFFD at AI Gateway boundary.
 */
export const callClaudeToolLoop = async (
  env: AIEnv,
  options: ClaudeToolLoopOptions,
): Promise<ClaudeToolLoopResponse> => {
  const gatewayUrl = `${getGatewayBaseUrl(env)}/anthropic/v1/messages`;

  const body = {
    model: options.model,
    max_tokens: options.max_tokens,
    system: options.system,
    messages: options.messages,
    tools: options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })),
  };

  const response = await callWithRetry(gatewayUrl, env, body);

  const data = (await response.json()) as {
    content: Array<Record<string, unknown>>;
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  // Strip U+FFFD at AI Gateway boundary (text + tool_use input string values)
  const stripFFFDFromValues = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = typeof v === 'string' ? stripFFFD(v) : v;
    }
    return result;
  };

  const content: ClaudeContentBlock[] = data.content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: stripFFFD(block.text as string) };
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use' as const,
        id: block.id as string,
        name: block.name as string,
        input: stripFFFDFromValues(block.input as Record<string, unknown>),
      };
    }
    return block as ClaudeContentBlock;
  });

  return {
    content,
    stop_reason: data.stop_reason as ClaudeToolLoopResponse['stop_reason'],
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
  };
};

// ── Tool-loop helpers ──

/** Extract all tool_use calls from Claude response blocks */
export const extractToolCalls = (
  blocks: ClaudeContentBlock[],
): Array<{ id: string; name: string; input: Record<string, unknown> }> =>
  blocks.filter(
    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      b.type === 'tool_use',
  );
