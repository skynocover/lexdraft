interface AIEnv {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface CallAIOptions {
  messages: ChatMessage[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  maxTokens?: number;
}

const MODEL = 'google-ai-studio/gemini-2.5-flash';

function getGatewayUrl(env: AIEnv): string {
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`;
}

/**
 * Sanitize messages for Gemini via AI Gateway:
 * Strip empty `content` from assistant messages that carry tool_calls,
 * otherwise Gemini rejects the request with INVALID_ARGUMENT.
 */
const sanitizeMessages = (messages: ChatMessage[]): Record<string, unknown>[] =>
  messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length && !m.content) {
      const { content: _, ...rest } = m;
      return rest;
    }
    return m;
  });

/**
 * Call AI Gateway with streaming enabled. Returns the raw Response
 * so the caller can parse the SSE stream incrementally.
 */
export async function callAIStreaming(env: AIEnv, opts: CallAIOptions): Promise<Response> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: sanitizeMessages(opts.messages),
    stream: true,
    max_tokens: opts.maxTokens || 8192,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
  }

  const response = await fetch(getGatewayUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    // Dump full message structure for debugging (content truncated)
    const sanitized = body.messages as Record<string, unknown>[];
    const msgDump = sanitized.map((m) => {
      const dump: Record<string, unknown> = { role: m.role };
      if (typeof m.content === 'string') dump.content = m.content.slice(0, 80) + '…';
      if (m.tool_calls) dump.tool_calls = m.tool_calls;
      if (m.tool_call_id) dump.tool_call_id = m.tool_call_id;
      return dump;
    });
    console.error(
      `AI Gateway ${response.status} | model=${MODEL} | payload=${JSON.stringify(body).length}ch\nmessages: ${JSON.stringify(msgDump, null, 2)}\ntools: ${JSON.stringify(body.tools)}\nresponse: ${errText.slice(0, 300)}`,
    );
    throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
  }

  return response;
}

interface CallAISimpleOptions {
  model?: string;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Call AI Gateway without streaming. Returns the full response content.
 */
export const callAI = async (
  env: AIEnv,
  messages: ChatMessage[],
  opts?: CallAISimpleOptions,
): Promise<{ content: string }> => {
  const body: Record<string, unknown> = {
    model: opts?.model || MODEL,
    messages: sanitizeMessages(messages),
    stream: false,
    max_tokens: opts?.maxTokens || 4096,
  };
  if (opts?.responseFormat) {
    body.response_format = opts.responseFormat;
  }

  const response = await fetch(getGatewayUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return { content: data.choices[0]?.message?.content || '' };
};

export type { ChatMessage, ToolCall, ToolDef, AIEnv };
