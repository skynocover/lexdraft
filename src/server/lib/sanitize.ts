/**
 * Shared U+FFFD sanitisation utility.
 *
 * Cloudflare AI Gateway occasionally corrupts multi-byte UTF-8 characters
 * when proxying chunked responses, producing U+FFFD replacement characters.
 *
 * This function is the SINGLE place where the regex lives.
 * It should ONLY be called at AI Gateway data boundaries:
 *   - sseParser.ts   (Gemini streaming path)
 *   - claudeClient.ts (Claude JSON path)
 *
 * Do NOT call this in downstream code (stores, components, DB writes).
 */
export const stripFFFD = (s: string): string =>
  s.includes('\uFFFD') ? s.replace(/\uFFFD/g, '') : s;
