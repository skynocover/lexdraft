import type { Citation } from "../../client/stores/useBriefStore";
import type { AIEnv } from "./aiClient";
import { nanoid } from "nanoid";

// ── Document block types ──

interface CustomContentDocumentBlock {
  type: "document";
  source: {
    type: "content";
    content: Array<{ type: "text"; text: string }>;
  };
  title: string;
  context?: string;
  citations: { enabled: true };
}

interface TextBlock {
  type: "text";
  text: string;
}

// ── Response types ──

interface ContentBlockCitation {
  type: "content_block_location";
  cited_text: string;
  document_index: number;
  document_title: string;
  start_block_index: number;
  end_block_index: number;
}

interface CharLocationCitation {
  type: "char_location";
  cited_text: string;
  document_index: number;
  document_title: string;
  start_char_index: number;
  end_char_index: number;
}

interface ClaudeResponse {
  content: Array<{
    type: "text";
    text: string;
    citations?: Array<ContentBlockCitation | CharLocationCitation>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeDocument {
  title: string;
  content: string;
  file_id?: string;
}

export interface TextSegment {
  text: string;
  citations: Citation[];
}

export interface ClaudeCitationResult {
  text: string;
  segments: TextSegment[];
  citations: Citation[];
}

// ── Chunking ──

const MAX_CHUNK_LENGTH = 500;

/**
 * Split document content into chunks for custom content citations.
 *
 * Strategy:
 * 1. Split by \n into lines
 * 2. Detect structural break lines (section headers, key-value fields, numbered items)
 * 3. Group lines between breaks into chunks
 * 4. If a chunk > MAX_CHUNK_LENGTH, split further by 。
 *
 * Structural breaks detected:
 * - Blank lines
 * - Lines ending with ： (section headers like 診斷病名：, 醫師囑言：)
 * - Short key-value lines with ： early in the line (like 病歷編號：12345)
 * - Chinese formal numbering (壹、貳、參、)
 * - Chinese standard numbering (一、二、三、)
 * - Parenthesized numbering ((一)(二))
 * - Arabic numeral patterns (1. 2.)
 *
 * This produces fine-grained chunks so that citations pinpoint specific
 * sections rather than entire documents. All chunks are still sent to
 * Claude together — only citation granularity is affected.
 */
const chunkContent = (content: string): string[] => {
  const trimmed = content.trim();
  if (!trimmed) return [trimmed];

  const lines = trimmed.split("\n");
  const chunks: string[] = [];
  let buffer = "";

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      // Blank line: flush buffer
      if (buffer.trim()) {
        chunks.push(buffer.trim());
        buffer = "";
      }
      continue;
    }

    // If this line starts a new structural section, flush previous buffer first
    if (isStructuralBreak(t) && buffer.trim()) {
      chunks.push(buffer.trim());
      buffer = "";
    }

    buffer += (buffer ? "\n" : "") + t;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  // Post-process: split oversized chunks by sentence
  const split: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHUNK_LENGTH) {
      split.push(chunk);
    } else {
      split.push(...splitBySentence(chunk));
    }
  }

  // Post-process: merge standalone section headers (ending with ：) with the next chunk
  // e.g. "診斷病名：" alone → merge with "一、左側鎖骨骨折" → "診斷病名：\n一、左側鎖骨骨折"
  const result: string[] = [];
  for (let i = 0; i < split.length; i++) {
    if (/[：:]$/.test(split[i].trim()) && i + 1 < split.length) {
      result.push(split[i] + "\n" + split[i + 1]);
      i++; // skip next chunk (already merged)
    } else {
      result.push(split[i]);
    }
  }

  return result.length > 0 ? result : [trimmed];
};

/**
 * Detect if a line is a structural break point for chunking.
 * These lines start a new chunk boundary.
 */
const isStructuralBreak = (line: string): boolean => {
  // Lines ending with ： or : (pure section headers like 診斷病名：, 醫師囑言：)
  if (/[：:]$/.test(line)) return true;

  // Formal Chinese section numbering (壹、貳、參、肆、)
  if (/^[壹貳參肆伍陸柒捌玖拾]+、/.test(line)) return true;

  // Standard Chinese numbering (一、二、三、)
  if (/^[一二三四五六七八九十]+、/.test(line)) return true;

  // Parenthesized numbering ((一)(二) or （一）（二）)
  if (/^[（(][一二三四五六七八九十]+[）)]/.test(line)) return true;

  // Arabic numeral patterns (1. 2. or 1、2、)
  if (/^\d+[.、]/.test(line)) return true;

  return false;
};

/** Split a long text into chunks by 。 boundaries, each <= MAX_CHUNK_LENGTH */
const splitBySentence = (text: string): string[] => {
  const sentences = text.split(/(?<=。)/);
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > MAX_CHUNK_LENGTH && buffer) {
      chunks.push(buffer.trim());
      buffer = "";
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
      type: "document",
      source: {
        type: "content",
        content: chunks.map((text) => ({ type: "text" as const, text })),
      },
      title: doc.title,
      citations: { enabled: true },
    });
  }

  contentBlocks.push({
    type: "text",
    text: instruction,
  });

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: contentBlocks,
      },
    ],
  };

  // Route through Cloudflare AI Gateway → Anthropic
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/anthropic/v1/messages`;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as ClaudeResponse;

  // Parse response: extract text, segments, and citations
  let fullText = "";
  const allCitations: Citation[] = [];
  const segments: TextSegment[] = [];

  for (const block of data.content) {
    if (block.type === "text") {
      fullText += block.text;
      const blockCitations: Citation[] = [];

      if (block.citations) {
        for (const cite of block.citations) {
          const docMap = chunkMaps[cite.document_index];
          const doc = docMap?.doc;

          const citation: Citation = {
            id: nanoid(),
            label: cite.document_title,
            type: doc?.file_id ? "file" : "law",
            file_id: doc?.file_id,
            location:
              cite.type === "content_block_location"
                ? { block_index: cite.start_block_index }
                : {
                    char_start: cite.start_char_index,
                    char_end: cite.end_char_index,
                  },
            quoted_text: cite.cited_text,
            status: "confirmed",
          };
          blockCitations.push(citation);
          allCitations.push(citation);
        }
      }

      segments.push({ text: block.text, citations: blockCitations });
    }
  }

  return { text: fullText, segments, citations: allCitations };
};
