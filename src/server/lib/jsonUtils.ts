/**
 * Pure JSON utility functions for parsing LLM responses.
 * Zero external dependencies — safe to import from test scripts via tsx.
 */

/** Parse a JSON string field with fallback default value */
export const parseJsonField = <T>(field: string | null | undefined, defaultValue: T): T => {
  if (!field) return defaultValue;
  try {
    return JSON.parse(field) as T;
  } catch {
    return defaultValue;
  }
};

/**
 * Extract the outermost balanced JSON object from a string.
 * Handles nested braces correctly, skips braces inside strings.
 */
export const extractBalancedJson = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

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
        return text.slice(start, i + 1);
      }
    }
  }

  // Unbalanced — return from start to last }
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > start) {
    return text.slice(start, lastBrace + 1);
  }
  return null;
};

/**
 * Clean up common LLM JSON issues before parsing.
 * Handles: trailing commas, JS-style comments, markdown code blocks.
 */
export const cleanLLMJson = (raw: string): string => {
  let s = raw;
  // Remove markdown code block wrappers
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // Remove single-line JS comments (but not inside strings — simplified)
  s = s.replace(/^(\s*)\/\/[^\n]*/gm, '$1');
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1');
  return s;
};

/**
 * Extract and parse JSON from LLM response text.
 * Uses balanced-brace extraction, then tries parse with cleanup fallback.
 */
export const parseLLMJsonResponse = <T>(content: string, errorLabel: string): T => {
  const jsonStr = extractBalancedJson(content);
  if (!jsonStr) {
    throw new Error(`${errorLabel}（無法找到 JSON）`);
  }

  // Try direct parse first
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Fallback: clean common LLM issues and retry
    const cleaned = cleanLLMJson(jsonStr);
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Last resort: try greedy regex (covers edge cases where balanced extraction is too strict)
      const greedyMatch = content.match(/\{[\s\S]*\}/);
      if (greedyMatch && greedyMatch[0] !== jsonStr) {
        try {
          return JSON.parse(cleanLLMJson(greedyMatch[0])) as T;
        } catch {
          /* fall through */
        }
      }
      // Log the problematic JSON for debugging
      console.error(
        `[parseLLMJsonResponse] Failed to parse (first 500 chars): ${jsonStr.slice(0, 500)}`,
      );
      throw new Error(`${errorLabel}（JSON 格式錯誤）`);
    }
  }
};

/**
 * Attempt to repair truncated JSON by closing unclosed strings, arrays, and objects.
 * Used when LLM response is cut off due to max_tokens limit.
 */
export const repairTruncatedJson = <T>(content: string): T | null => {
  let json = content.trim();

  // Remove markdown code block wrappers
  json = json.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Find the first { to start from
  const start = json.indexOf('{');
  if (start === -1) return null;
  json = json.slice(start);

  // Remove trailing comma if present
  json = json.replace(/,\s*$/, '');

  // Single pass: detect unclosed string + count unclosed brackets/braces
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
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
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) {
    json += '"';
  }

  // Remove any trailing key without value (e.g., `"key":` or `"key": `)
  json = json.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  // Remove trailing incomplete value after colon
  json = json.replace(/:\s*$/, ': null');

  // Remove trailing comma before closing
  json = json.replace(/,\s*$/, '');

  // Close all unclosed brackets/braces in reverse order
  while (stack.length > 0) {
    json += stack.pop();
  }

  try {
    return JSON.parse(json) as T;
  } catch {
    // Try with cleanLLMJson
    try {
      return JSON.parse(cleanLLMJson(json)) as T;
    } catch {
      console.error(`[repairTruncatedJson] Repair failed (first 300 chars): ${json.slice(0, 300)}`);
      return null;
    }
  }
};

/**
 * Extract and parse a JSON array from LLM response text.
 * Like parseLLMJsonResponse but for array output (matches outermost [...]).
 */
export const parseLLMJsonArray = <T>(content: string, errorLabel: string): T[] => {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`${errorLabel}（無法找到 JSON 陣列）`);
  }

  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    const cleaned = cleanLLMJson(match[0]);
    try {
      return JSON.parse(cleaned) as T[];
    } catch {
      console.error(
        `[parseLLMJsonArray] Failed to parse (first 500 chars): ${match[0].slice(0, 500)}`,
      );
      throw new Error(`${errorLabel}（JSON 格式錯誤）`);
    }
  }
};
