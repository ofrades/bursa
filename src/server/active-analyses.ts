/**
 * Server-side in-memory registry of symbols with actively running analyses.
 * Lives at module scope so it is shared across all requests in the same process.
 * Entries are added when a stream starts and removed when it finishes (or errors).
 */

const active = new Set<string>();

export function markAnalysisStarted(symbol: string): void {
  active.add(symbol);
}

export function markAnalysisFinished(symbol: string): void {
  active.delete(symbol);
}

export function isAnalysisRunning(symbol: string): boolean {
  return active.has(symbol);
}
