import { stripFFFD } from '../lib/sanitize';
import { fetchWithRetry } from '../lib/fetchRetry';

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

export const getGatewayBaseUrl = (env: AIEnv): string =>
  `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}`;

const getGatewayUrl = (env: AIEnv): string => `${getGatewayBaseUrl(env)}/compat/chat/completions`;

/** Shared header builder for AI Gateway requests */
const buildHeaders = (env: AIEnv, byokAlias?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
  ...(byokAlias ? { 'cf-aig-byok-alias': byokAlias } : {}),
});

/** Extract usage from OpenAI-compatible response */
const extractCompatUsage = (usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
}): { input_tokens: number; output_tokens: number } => ({
  input_tokens: usage?.prompt_tokens || 0,
  output_tokens: usage?.completion_tokens || 0,
});

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
    headers: buildHeaders(env),
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
): Promise<{
  content: string;
  usage: { input_tokens: number; output_tokens: number };
  truncated: boolean;
}> => {
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
    headers: buildHeaders(env),
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const truncated = data.choices[0]?.finish_reason === 'length';
  return {
    content: stripFFFD(data.choices[0]?.message?.content || ''),
    usage: extractCompatUsage(data.usage),
    truncated,
  };
};

// ── Gemini Native (provider-native endpoint, constrained decoding) ──

const GEMINI_NATIVE_MODEL = 'gemini-2.5-flash';

interface GeminiNativeOptions {
  maxTokens?: number;
  responseSchema?: Record<string, unknown>;
  responseMimeType?: string;
  signal?: AbortSignal;
}

/**
 * Call Gemini via AI Gateway's provider-native endpoint.
 * Uses `responseSchema` constrained decoding to guarantee JSON schema compliance.
 */
export const callGeminiNative = async (
  env: AIEnv,
  systemPrompt: string,
  userMessage: string,
  opts?: GeminiNativeOptions,
): Promise<{
  content: string;
  usage: { input_tokens: number; output_tokens: number };
  truncated: boolean;
}> => {
  const url = `${getGatewayBaseUrl(env)}/google-ai-studio/v1beta/models/${GEMINI_NATIVE_MODEL}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: opts?.maxTokens || 4096,
      responseMimeType: opts?.responseMimeType || 'application/json',
      ...(opts?.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  };

  const bodyStr = JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(env),
    body: bodyStr,
    signal: opts?.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      `Gemini Native ${response.status} | url=${url}\nrequest_body_length=${bodyStr.length}ch\nresponse: ${errText.slice(0, 500)}`,
    );
    throw new Error(`Gemini Native error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const candidate = data.candidates?.[0];
  const rawContent = candidate?.content?.parts?.[0]?.text || '';
  const content = stripFFFD(rawContent);
  const truncated = candidate?.finishReason === 'MAX_TOKENS';
  const usage = {
    input_tokens: data.usageMetadata?.promptTokenCount || 0,
    output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
  };

  return { content, usage, truncated };
};

// ── OpenRouter Text (for Gemini 3.1 Flash Lite intro/conclusion) ──

const OPENROUTER_MODEL = 'google/gemini-3.1-flash-lite-preview';
const OPENROUTER_BYOK_ALIAS = 'lex-draft-openrouter';

/**
 * Call Gemini 3.1 Flash Lite via OpenRouter (AI Gateway stored key).
 * Used for intro/conclusion writing where text/plain output suffices.
 */
export const callOpenRouterText = async (
  env: AIEnv,
  systemPrompt: string,
  userMessage: string,
  opts?: { maxTokens?: number; signal?: AbortSignal },
): Promise<{
  content: string;
  usage: { input_tokens: number; output_tokens: number };
  truncated: boolean;
}> => {
  const url = `${getGatewayBaseUrl(env)}/openrouter/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(env, OPENROUTER_BYOK_ALIAS),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      max_tokens: opts?.maxTokens || 2048,
    }),
    signal: opts?.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`OpenRouter ${response.status}: ${errText.slice(0, 500)}`);
    throw new Error(`OpenRouter error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = stripFFFD(data.choices[0]?.message?.content || '');
  const truncated = data.choices[0]?.finish_reason === 'length';

  return { content, usage: extractCompatUsage(data.usage), truncated };
};

// ── Retry wrapper for Gemini (AI Gateway) calls ──

const fetchWithRetryGemini = (env: AIEnv, body: Record<string, unknown>) =>
  fetchWithRetry(getGatewayUrl(env), buildHeaders(env), body, { label: 'AI Gateway' });

// ── Gemini Tool-Loop (non-streaming, for pipeline Reasoning phase) ──

export interface GeminiToolLoopResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Call Gemini via AI Gateway with tool support (non-streaming).
 * Used by pipeline reasoning loop. Retries on 429/5xx.
 * `roundIndex` is used to generate unique tool call IDs.
 */
export const callGeminiToolLoop = async (
  env: AIEnv,
  opts: {
    messages: ChatMessage[];
    tools: ToolDef[];
    maxTokens?: number;
  },
  roundIndex = 0,
): Promise<GeminiToolLoopResponse> => {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: sanitizeMessages(opts.messages),
    stream: false,
    max_tokens: opts.maxTokens || 16384,
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools;
  }

  const response = await fetchWithRetryGemini(env, body);

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const msg = data.choices[0]?.message;
  const content = msg?.content || '';

  const toolCalls: ToolCall[] = (msg?.tool_calls || []).map((tc, i) => ({
    id: tc.id || `call_${roundIndex}_${i}`,
    type: 'function' as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));

  return { content, toolCalls, usage: extractCompatUsage(data.usage) };
};

export type { ChatMessage, ToolCall, ToolDef, AIEnv };
