// Robust parser for LLM responses that may contain:
// - ```json fenced blocks
// - explanatory text before/after JSON
// - multiple named sections (OPPORTUNITY_JSON:, SIGNAL_JSON:, MEMORY_UPDATE:)

export function stripCodeFences(input: string): string {
  return input
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractFirstJsonObject(input: string): string | null {
  const text = stripCodeFences(input);
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Find a named label in raw text and extract the first JSON object after it.
 * e.g. extractBlockAfterLabel(raw, 'SIGNAL_JSON:') → '{...}'
 */
export function extractBlockAfterLabel(raw: string, label: string): string | null {
  const idx = raw.indexOf(label);
  if (idx === -1) return null;
  return extractFirstJsonObject(raw.slice(idx + label.length));
}

/**
 * Legacy: split a raw response into json + optional MEMORY_UPDATE block.
 * Used by the old single-section format.
 */
export function splitMemoryUpdate(raw: string): { jsonPart: string; memoryUpdate: string | null } {
  const memoryIdx = raw.indexOf("MEMORY_UPDATE:");
  if (memoryIdx === -1) {
    return { jsonPart: raw, memoryUpdate: null };
  }
  return {
    jsonPart: raw.slice(0, memoryIdx),
    memoryUpdate: raw.slice(memoryIdx + "MEMORY_UPDATE:".length).trim(),
  };
}

/**
 * Parse the multi-section AI response format:
 *
 * 1. OPPORTUNITY_JSON: {...}
 * 2. SIGNAL_JSON: {...}
 * 3. MEMORY_UPDATE: <markdown>
 */
export function parseStructuredResponse(raw: string): {
  signalJson: string | null;
  opportunityJson: string | null;
  thesisJson: string | null;
  contextJson: string | null;
  memoryUpdate: string | null;
} {
  const signalJson = extractBlockAfterLabel(raw, "SIGNAL_JSON:");
  const opportunityJson = extractBlockAfterLabel(raw, "OPPORTUNITY_JSON:");
  const thesisJson = extractBlockAfterLabel(raw, "THESIS_JSON:");
  const contextJson = extractBlockAfterLabel(raw, "CONTEXT_JSON:");

  const memoryIdx = raw.indexOf("MEMORY_UPDATE:");
  const memoryUpdate =
    memoryIdx !== -1 ? raw.slice(memoryIdx + "MEMORY_UPDATE:".length).trim() : null;

  return { signalJson, opportunityJson, thesisJson, contextJson, memoryUpdate };
}

export function parseAiJson<T = unknown>(raw: string): T {
  const candidate = extractFirstJsonObject(raw);
  if (!candidate) {
    throw new Error(`No JSON object found in AI response: ${raw.slice(0, 220)}`);
  }
  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new Error(`Invalid JSON object in AI response: ${candidate.slice(0, 220)}`);
  }
}
