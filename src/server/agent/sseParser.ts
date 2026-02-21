/**
 * Shared OpenAI-compatible SSE stream parser.
 * Used by both collectStreamText (tool execution) and AgentDO (agent loop).
 */
import { stripReplacementChars } from '../lib/textSanitize';
import type { ToolCall } from './aiClient';

export interface OpenAIChunk {
  choices?: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Parse an OpenAI-compatible SSE stream, calling onChunk for each parsed JSON object.
 * Handles multi-byte UTF-8 split across chunks and flushes remaining data.
 */
export async function parseOpenAIStream(
  response: Response,
  onChunk: (chunk: OpenAIChunk) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        onChunk(JSON.parse(data));
      } catch {
        /* skip unparseable */
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    processLines(lines);
  }

  // Flush remaining bytes in decoder
  buffer += decoder.decode();
  if (buffer) {
    processLines(buffer.split('\n'));
  }
}

/**
 * Collect full text from an SSE streaming response.
 * Strips U+FFFD replacement characters from corrupted multi-byte sequences.
 */
export async function collectStreamText(response: Response): Promise<string> {
  let text = '';
  await parseOpenAIStream(response, (chunk) => {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) text += content;
  });
  return stripReplacementChars(text);
}

// ── Stream with Tool Calls ──

export interface StreamParseResult {
  content: string;
  toolCalls: ToolCall[];
}

/**
 * Parse an OpenAI streaming response, collecting text content and tool calls.
 * Used by agent loops (orchestrator, research) that need both content and tool calls.
 */
export const collectStreamWithToolCalls = async (
  response: Response,
  roundIndex: number,
): Promise<StreamParseResult> => {
  let content = '';
  const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

  await parseOpenAIStream(response, (chunk: OpenAIChunk) => {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    if (delta.content) {
      content += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallBuffers.has(idx)) {
          toolCallBuffers.set(idx, { id: tc.id || '', name: '', args: '' });
        }
        const buf = toolCallBuffers.get(idx)!;
        if (tc.id) buf.id = tc.id;
        if (tc.function?.name) buf.name = tc.function.name;
        if (tc.function?.arguments) {
          buf.args += tc.function.arguments;
        }
      }
    }
  });

  // Gemini via AI Gateway may merge multiple parallel tool calls into one buffer
  // (all sharing index=0), producing concatenated JSON: {…}{…}{…}
  // Split them into individual tool calls.
  const toolCalls: ToolCall[] = [];
  for (const [, buf] of toolCallBuffers) {
    if (!buf.name) continue;
    const argsList = splitConcatenatedJson(buf.args || '{}');
    for (const args of argsList) {
      toolCalls.push({
        id: `${buf.id || 'call'}_${roundIndex}_${toolCalls.length}`,
        type: 'function',
        function: { name: buf.name, arguments: args },
      });
    }
  }

  return { content, toolCalls };
};

/**
 * Split concatenated JSON objects: `{…}{…}{…}` → [`{…}`, `{…}`, `{…}`]
 * Tracks brace depth and string boundaries to handle nested objects and braces in strings.
 */
const splitConcatenatedJson = (str: string): string[] => {
  const trimmed = str.trim();
  if (!trimmed) return ['{}'];

  const results: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        results.push(trimmed.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  return results.length > 0 ? results : [trimmed];
};
