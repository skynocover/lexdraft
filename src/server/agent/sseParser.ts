/**
 * Shared OpenAI-compatible SSE stream parser.
 * Used by both collectStreamText (tool execution) and AgentDO (agent loop).
 */

export interface OpenAIChunk {
  choices?: Array<{
    delta: {
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Parse an OpenAI-compatible SSE stream, calling onChunk for each parsed JSON object.
 * Handles multi-byte UTF-8 split across chunks and flushes remaining data.
 */
export async function parseOpenAIStream(
  response: Response,
  onChunk: (chunk: OpenAIChunk) => void,
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        onChunk(JSON.parse(data))
      } catch { /* skip unparseable */ }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    processLines(lines)
  }

  // Flush remaining bytes in decoder
  buffer += decoder.decode()
  if (buffer) {
    processLines(buffer.split('\n'))
  }
}

/**
 * Collect full text from an SSE streaming response.
 * Strips U+FFFD replacement characters from corrupted multi-byte sequences.
 */
export async function collectStreamText(response: Response): Promise<string> {
  let text = ''
  await parseOpenAIStream(response, (chunk) => {
    const content = chunk.choices?.[0]?.delta?.content
    if (content) text += content
  })
  return text.replace(/\uFFFD/g, '')
}
