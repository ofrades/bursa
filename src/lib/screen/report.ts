import type { ScreenStock } from "../schema";

export const METHODOLOGY_VERSION = 2;

export function isSurvivor(
  row: Pick<ScreenStock, "passUniverse" | "passRevision" | "passQuality">,
) {
  return row.passUniverse && row.passRevision && row.passQuality;
}

type ComparisonRow = Pick<ScreenStock, "symbol" | "strict" | "revAvg" | "composite">;

export function compareRuns(current: ComparisonRow[], previous: ComparisonRow[]) {
  const before = new Map(previous.map((r) => [r.symbol, r]));
  const currentStrict = new Set(current.filter((r) => r.strict).map((r) => r.symbol));
  const previousStrict = new Set(previous.filter((r) => r.strict).map((r) => r.symbol));
  return {
    entered: [...currentStrict].filter((s) => !previousStrict.has(s)),
    exited: [...previousStrict].filter((s) => !currentStrict.has(s)),
    changes: Object.fromEntries(
      current.map((r) => {
        const prior = before.get(r.symbol);
        return [
          r.symbol,
          {
            revision: r.revAvg !== null && prior?.revAvg != null ? r.revAvg - prior.revAvg : null,
            composite:
              r.composite !== null && prior?.composite != null
                ? r.composite - prior.composite
                : null,
          },
        ];
      }),
    ),
  };
}

export function exclusionReasons(
  row: Pick<
    ScreenStock,
    | "error"
    | "passUniverse"
    | "passRevision"
    | "passQuality"
    | "mcapEur"
    | "advEur"
    | "analysts"
    | "fy1Rev"
    | "fy2Rev"
    | "breadth"
    | "roic"
    | "ndEbitda"
    | "fscore"
  >,
) {
  if (row.error) return [row.error];
  const reasons: string[] = [];
  if (!row.passUniverse)
    reasons.push(
      row.mcapEur === null || row.advEur === null || row.analysts === null
        ? "Missing market cap, liquidity, analyst count or FX"
        : "Below size, liquidity or coverage minimum",
    );
  if (!row.passRevision)
    reasons.push(
      row.fy1Rev === null || row.fy2Rev === null || row.breadth === null
        ? "Missing comparable EPS revisions or analyst breadth"
        : "FY1/FY2 revisions or breadth not positive",
    );
  if (!row.passQuality)
    reasons.push(
      row.roic === null || row.ndEbitda === null || row.fscore === null
        ? "Missing quality inputs"
        : "Quality thresholds not met",
    );
  return reasons;
}
