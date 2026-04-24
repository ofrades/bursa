import { parsePartialJSON } from "@tanstack/ai";

export type ParsedSections = {
  signalJson: Record<string, unknown> | null;
  talebJson: Record<string, unknown> | null;
  buffettJson: Record<string, unknown> | null;
  memoryUpdate: string | null;
};

const SECTION_MARKERS = [
  { name: "signalJson", marker: "1. SIGNAL_JSON:" },
  { name: "talebJson", marker: "2. TALEB_JSON:" },
  { name: "buffettJson", marker: "3. BUFFETT_JSON:" },
  { name: "memoryUpdate", marker: "4. MEMORY_UPDATE:" },
] as const;

function extractSection(text: string, startMarker: string, endMarker?: string): string | null {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return null;

  const contentStart = startIdx + startMarker.length;
  const endIdx = endMarker ? text.indexOf(endMarker, contentStart) : -1;

  const content = endIdx === -1 ? text.slice(contentStart) : text.slice(contentStart, endIdx);

  return content.trim();
}

export function parseSections(text: string): ParsedSections {
  const result: ParsedSections = {
    signalJson: null,
    talebJson: null,
    buffettJson: null,
    memoryUpdate: null,
  };

  for (let i = 0; i < SECTION_MARKERS.length; i++) {
    const { name, marker } = SECTION_MARKERS[i];
    const nextMarker = SECTION_MARKERS[i + 1]?.marker;
    const sectionText = extractSection(text, marker, nextMarker);

    if (!sectionText) continue;

    if (name === "memoryUpdate") {
      result.memoryUpdate = sectionText;
    } else {
      // Try to find JSON within the section text
      // Look for the first { and last }
      const firstBrace = sectionText.indexOf("{");
      const lastBrace = sectionText.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonText = sectionText.slice(firstBrace, lastBrace + 1);
        const parsed = parsePartialJSON(jsonText);
        if (parsed && typeof parsed === "object") {
          result[name] = parsed as Record<string, unknown>;
        }
      }
    }
  }

  return result;
}
