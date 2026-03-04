/**
 * Generic retry wrapper for AI Gateway HTTP calls (429 / 5xx).
 * Used by both Claude (claudeClient.ts) and Gemini (aiClient.ts).
 */
export const fetchWithRetry = async (
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  opts?: { label?: string; maxRetries?: number },
): Promise<Response> => {
  const label = opts?.label ?? 'API';
  const maxRetries = opts?.maxRetries ?? 3;
  const bodyStr = JSON.stringify(body);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    if (response.ok) return response;

    if (attempt < maxRetries - 1 && (response.status === 429 || response.status >= 500)) {
      console.warn(`[${label}] ${response.status} on attempt ${attempt + 1}, retrying...`);
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }

    const errText = await response.text();
    throw new Error(`${label} error: ${response.status} - ${errText}`);
  }
  throw new Error(`${label}: exhausted retries`);
};
