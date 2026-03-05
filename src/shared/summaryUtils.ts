/**
 * Backward-compatible summary parser.
 * Old format: JSON string with { summary: "..." }, new format: plain string.
 */
export const parseSummaryText = (summary: string | null): string | null => {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary);
    if (typeof parsed === 'object' && parsed !== null) return (parsed.summary as string) || null;
    return String(parsed);
  } catch {
    return summary;
  }
};
