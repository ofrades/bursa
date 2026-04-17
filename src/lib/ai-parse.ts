// Robust parser for LLM responses that may contain:
// - ```json fenced blocks
// - explanatory text before/after JSON
// - a second MEMORY_UPDATE block after the JSON

export function stripCodeFences(input: string): string {
  return input
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export function extractFirstJsonObject(input: string): string | null {
  const text = stripCodeFences(input)
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') depth++
    if (ch === '}') depth--

    if (depth === 0) {
      return text.slice(start, i + 1)
    }
  }

  return null
}

export function splitMemoryUpdate(raw: string): { jsonPart: string; memoryUpdate: string | null } {
  const memoryIdx = raw.indexOf('MEMORY_UPDATE:')
  if (memoryIdx === -1) {
    return { jsonPart: raw, memoryUpdate: null }
  }
  return {
    jsonPart: raw.slice(0, memoryIdx),
    memoryUpdate: raw.slice(memoryIdx + 'MEMORY_UPDATE:'.length).trim(),
  }
}

export function parseAiJson<T = unknown>(raw: string): T {
  const candidate = extractFirstJsonObject(raw)
  if (!candidate) {
    throw new Error(`No JSON object found in AI response: ${raw.slice(0, 220)}`)
  }
  try {
    return JSON.parse(candidate) as T
  } catch {
    throw new Error(`Invalid JSON object in AI response: ${candidate.slice(0, 220)}`)
  }
}
