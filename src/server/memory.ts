/**
 * Build an initial memory document for a stock.
 * The AI will progressively enrich this over time.
 */
export function buildInitialMemory(symbol: string): string {
  return `# ${symbol} — Stock Memory

## Investment Thesis
*Not yet established. Will be set after first analysis.*

## Demand Map
- Primary demand driver: TBD
- Bottleneck role: TBD
- Demand -> earnings -> stock path: TBD
- Consensus blind spot: TBD

## Key Levels
- Support: TBD
- Resistance: TBD

## Upcoming Events
*None recorded yet.*

## Recommendation History
*No recommendations yet.*

## Accumulated Context
*No context yet. Will accumulate news, events, bottlenecks, and observations over time.*
`;
}
