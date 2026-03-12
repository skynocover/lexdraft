export const formatAmount = (amount: number): string => `NT$ ${amount.toLocaleString()}`;

/** Parse a JSON field that may arrive as string (from DB) or already-parsed array (from SSE) */
export const parseJsonArray = (value: string | string[] | null | undefined): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

/** Strip markdown headers (## ###) from cited text for display */
export const stripMarkdownHeaders = (text: string): string => text.replace(/^#{1,3}\s+/gm, '');

/** Strip emoji and other non-text symbols */
export function cleanText(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[\u{E0020}-\u{E007F}]/gu, '')
    .trim();
}
