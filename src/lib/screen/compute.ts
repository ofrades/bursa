// Deterministic EPS-revision + quality screen math. No I/O, no AI — pure
// functions over fetched data, ported from the revision-screener prototype
// (results cross-checked against the Python implementation).

export type ScreenParams = {
  minMarketCapEur: number;
  minAdvEur: number;
  minAnalysts: number;
  gateRevisionGt: number;
  gateBreadthGt: number;
  topQuintile: number;
  minRoic: number;
  maxNetDebtEbitda: number;
  minPiotroski: number;
  epsGrowthMin: number;
  epsGrowthMax: number;
  roeFwdMin: number;
  fcfYieldMin: number;
  fcfConversionMin: number;
  sueQuarters: number;
  zClip: number;
  weights: { revision: number; breadth: number; sue: number; momentum: number };
  momentumMonthsBack: number;
  momentumMonthsSkip: number;
};

export const DEFAULT_PARAMS: ScreenParams = {
  minMarketCapEur: 40e9,
  minAdvEur: 100e6,
  minAnalysts: 20,
  gateRevisionGt: 0,
  gateBreadthGt: 0,
  topQuintile: 0.2,
  minRoic: 0.1,
  maxNetDebtEbitda: 3,
  minPiotroski: 7,
  epsGrowthMin: 0.08, // GARP overlay: consensus FY1 EPS growth band
  epsGrowthMax: 0.15,
  roeFwdMin: 0.15, // consensus-implied forward ROE floor
  fcfYieldMin: 0.04, // current FCF yield floor
  fcfConversionMin: 0.8, // FCF / net income floor
  sueQuarters: 8,
  zClip: 3,
  weights: { revision: 0.35, breadth: 0.35, sue: 0.2, momentum: 0.1 },
  momentumMonthsBack: 12,
  momentumMonthsSkip: 1,
};

export type Statements = {
  ebit: number | null;
  depreciation: number | null;
  pretaxIncome: number | null;
  taxProvision: number | null;
  netIncome: [number | null, number | null]; // [latest, prior FY]
  totalRevenue: [number | null, number | null];
  grossProfit: [number | null, number | null];
  totalAssets: [number | null, number | null];
  currentAssets: [number | null, number | null];
  currentLiabilities: [number | null, number | null];
  totalDebt: number | null;
  longTermDebt: [number | null, number | null];
  stockholdersEquity: number | null;
  cash: number | null;
  shortTermInvestments: number | null;
  capitalExpenditure: number | null;
  sharesOutstanding: [number | null, number | null];
  operatingCashFlow: number | null;
};

export type SymbolData = {
  currency: string | null;
  financialCurrency: string | null; // reporting currency of the statements
  sector: string | null;
  mcap: number | null; // listing currency
  adv: number | null; // listing currency, 3m mean of close*volume
  analysts: number | null;
  fy1Rev: number | null; // 90-day consensus revision, FY1
  fy2Rev: number | null;
  upLast30d: number | null;
  downLast30d: number | null;
  surprises: number[]; // decimal surprise fractions, newest first
  statements: Statements;
  mom121: number | null;
  fwdPe: number | null;
  epsGrowthFy1: number | null; // consensus FY1 EPS growth vs year-ago EPS
};

export type ScreenRow = {
  symbol: string;
  name: string;
  region: string;
  country: string | null;
  sector: string | null;
  currency: string | null;
  mcapEur: number | null;
  advEur: number | null;
  analysts: number | null;
  fy1Rev: number | null;
  fy2Rev: number | null;
  revAvg: number | null;
  breadth: number | null;
  sue: number | null;
  roic: number | null;
  ndEbitda: number | null;
  fscore: number | null;
  mom121: number | null;
  fwdPe: number | null;
  upLast30d: number | null;
  downLast30d: number | null;
  epsGrowthFy1: number | null;
  roeFwd: number | null;
  fcfYield: number | null;
  fcfConversion: number | null;
  passUniverse: boolean;
  passRevision: boolean;
  passQuality: boolean;
  passExpectations: boolean;
  composite: number | null;
  strict: boolean;
  weight: number | null;
  error: string | null;
};

const isNum = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/** Mean of the last 4 quarterly surprises standardized by the std of the last
 * 8 — a t-statistic flavor of Bernard & Thomas (1989). */
export function computeSue(surprises: readonly number[]): number | null {
  if (surprises.length < 3) return null;
  const head = surprises.slice(0, 4);
  const mean4 = head.reduce((a, b) => a + b, 0) / head.length;
  const mean = surprises.reduce((a, b) => a + b, 0) / surprises.length;
  const variance = surprises.reduce((a, b) => a + (b - mean) ** 2, 0) / (surprises.length - 1);
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return mean4 > 0 ? 3 : mean4 < 0 ? -3 : 0;
  return mean4 / sd;
}

/** NOPAT / invested capital on the latest fiscal year. Returns null when the
 * statement rows are missing or invested capital is non-positive. */
export function computeRoic(s: Statements): number | null {
  const { ebit, pretaxIncome, taxProvision, totalDebt, stockholdersEquity } = s;
  if (
    !isNum(ebit) ||
    !isNum(pretaxIncome) ||
    !isNum(taxProvision) ||
    !isNum(totalDebt) ||
    !isNum(stockholdersEquity) ||
    pretaxIncome <= 0
  ) {
    return null;
  }
  const cash = (s.cash ?? 0) + (s.shortTermInvestments ?? 0);
  const invested = totalDebt + stockholdersEquity - cash;
  if (invested <= 0) return null;
  const taxRate = Math.min(Math.max(taxProvision / pretaxIncome, 0), 0.5);
  return (ebit * (1 - taxRate)) / invested;
}

export function computeNdEbitda(
  debt: number | null,
  cash: number | null,
  ebitda: number | null,
  s: Statements,
): number | null {
  let d = debt;
  let c = cash;
  let e = ebitda;
  if ((!isNum(e) || e === 0) && isNum(s.ebit) && isNum(s.depreciation)) {
    d = s.totalDebt;
    c = s.cash;
    e = s.ebit + s.depreciation;
  }
  if (!isNum(d) || !isNum(c) || !isNum(e) || e <= 0) return null;
  return (d - c) / e;
}

/** Piotroski F-score (0–9) over the two most recent fiscal years. */
export function computePiotroski(s: Statements): number | null {
  const [ni0, ni1] = s.netIncome;
  const [rev0, rev1] = s.totalRevenue;
  const [gp0, gp1] = s.grossProfit;
  const [ta0, ta1] = s.totalAssets;
  const [ca0, ca1] = s.currentAssets;
  const [cl0, cl1] = s.currentLiabilities;
  const [ltd0, ltd1] = s.longTermDebt;
  const [sh0, sh1] = s.sharesOutstanding;
  if (
    !isNum(ni0) ||
    !isNum(ni1) ||
    !isNum(rev0) ||
    !isNum(rev1) ||
    !isNum(gp0) ||
    !isNum(gp1) ||
    !isNum(ta0) ||
    !isNum(ta1) ||
    !isNum(ca0) ||
    !isNum(ca1) ||
    !isNum(cl0) ||
    !isNum(cl1) ||
    !isNum(sh0) ||
    !isNum(sh1) ||
    !isNum(s.operatingCashFlow)
  ) {
    return null;
  }
  const roa0 = ni0 / ta0;
  const roa1 = ni1 / ta1;
  let n = 0;
  if (roa0 > 0) n += 1;
  if (s.operatingCashFlow > 0) n += 1;
  if (roa0 > roa1) n += 1;
  if (s.operatingCashFlow > ni0) n += 1;
  if ((ltd0 ?? 0) / ta0 <= (ltd1 ?? 0) / ta1) n += 1;
  if (cl0 > 0 && cl1 > 0 && ca0 / cl0 >= ca1 / cl1) n += 1;
  if (sh0 <= sh1) n += 1;
  if (rev0 > 0 && rev1 > 0 && gp0 / rev0 >= gp1 / rev1) n += 1;
  if (rev0 / ta0 >= rev1 / ta1) n += 1;
  return n;
}

function isFinancial(sector: string | null): boolean {
  return (sector ?? "").includes("Financial");
}

export function evaluateSymbol(
  meta: { symbol: string; name: string; region: string; country: string | null },
  data: SymbolData,
  fxRates: Record<string, number>, // currency -> units per EUR
  params: ScreenParams,
): ScreenRow {
  const perEurRaw = data.currency
    ? (fxRates[data.currency] ?? (data.currency === "GBp" ? fxRates["GBP"] : undefined))
    : undefined;
  const perEur = perEurRaw ? 1 / perEurRaw : null; // units-per-EUR -> EUR-per-unit
  const pence = data.currency === "GBp";
  const mcapEur = isNum(data.mcap) && perEur ? (data.mcap * perEur) / 1e9 : null;
  const advEur = isNum(data.adv) && perEur ? (data.adv * perEur) / (pence ? 100 : 1) / 1e6 : null;

  const revAvg = isNum(data.fy1Rev) && isNum(data.fy2Rev) ? (data.fy1Rev + data.fy2Rev) / 2 : null;
  const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const breadth =
    isNum(data.fy1Rev) && isNum(data.fy2Rev) ? (sign(data.fy1Rev) + sign(data.fy2Rev)) / 2 : null;

  const financial = isFinancial(data.sector);
  const roic = computeRoic(data.statements);
  const ndEbitda = computeNdEbitda(
    data.statements.totalDebt,
    data.statements.cash,
    data.statements.ebit ?? null,
    data.statements,
  );
  const fscore = computePiotroski(data.statements);

  // Expectations overlay — what the market makes us pay for what it promises.
  // EPS growth band on consensus FY1; forward ROE = current ROE carried by the
  // consensus EPS growth (currency-safe: all reporting-currency figures); FCF
  // yield from reporting-currency FCF converted to EUR; conversion = FCF/NI.
  // Financials: ROE is meaningful, FCF is not (balance-sheet businesses).
  const epsGrowthFy1 = isNum(data.epsGrowthFy1) ? data.epsGrowthFy1 : null;
  const [ni0] = data.statements.netIncome;
  const roeFwd =
    isNum(ni0) &&
    isNum(data.statements.stockholdersEquity) &&
    data.statements.stockholdersEquity > 0 &&
    epsGrowthFy1 !== null
      ? (ni0 / data.statements.stockholdersEquity) * (1 + epsGrowthFy1)
      : null;
  const finPerEur =
    data.financialCurrency && fxRates[data.financialCurrency]
      ? 1 / fxRates[data.financialCurrency]
      : null;
  const fcf =
    isNum(data.statements.operatingCashFlow) && isNum(data.statements.capitalExpenditure)
      ? data.statements.operatingCashFlow - Math.abs(data.statements.capitalExpenditure)
      : null;
  const fcfYield = isNum(fcf) && finPerEur && mcapEur ? (fcf * finPerEur) / (mcapEur * 1e9) : null;
  const fcfConversion = isNum(fcf) && isNum(ni0) && ni0 > 0 ? fcf / ni0 : null;
  const passExpectations =
    epsGrowthFy1 !== null &&
    epsGrowthFy1 >= params.epsGrowthMin &&
    epsGrowthFy1 <= params.epsGrowthMax &&
    roeFwd !== null &&
    roeFwd >= params.roeFwdMin &&
    (financial
      ? true
      : fcfYield !== null &&
        fcfYield >= params.fcfYieldMin &&
        fcfConversion !== null &&
        fcfConversion >= params.fcfConversionMin);

  const passUniverse =
    (mcapEur ?? -1) >= params.minMarketCapEur / 1e9 &&
    (advEur ?? -1) >= params.minAdvEur / 1e6 &&
    (data.analysts ?? -1) >= params.minAnalysts;

  const passRevision =
    isNum(revAvg) &&
    isNum(breadth) &&
    revAvg > params.gateRevisionGt &&
    breadth > params.gateBreadthGt;

  // Financials: ROIC (NOPAT/IC) and net debt/EBITDA are undefined for
  // balance-sheet businesses, so both gates are exempt. Piotroski is exempt
  // only where it cannot be computed from standard statement rows.
  const gateRoic = financial ? "exempt" : roic === null ? "no_data" : roic >= params.minRoic;
  const gateLev = financial
    ? "exempt"
    : ndEbitda === null
      ? "no_data"
      : ndEbitda <= params.maxNetDebtEbitda;
  const gateFs =
    financial && fscore === null
      ? "exempt"
      : fscore === null
        ? "no_data"
        : fscore >= params.minPiotroski;
  const gatePass = (g: "exempt" | "no_data" | boolean) => g === "exempt" || g === true;
  const passQuality = gatePass(gateRoic) && gatePass(gateLev) && gatePass(gateFs);

  return {
    symbol: meta.symbol,
    name: meta.name,
    region: meta.region,
    country: meta.country,
    sector: data.sector,
    currency: data.currency,
    mcapEur,
    advEur,
    analysts: data.analysts,
    fy1Rev: data.fy1Rev,
    fy2Rev: data.fy2Rev,
    revAvg,
    breadth,
    sue: computeSue(data.surprises),
    roic,
    ndEbitda,
    fscore,
    mom121: data.mom121,
    fwdPe: data.fwdPe,
    upLast30d: data.upLast30d,
    downLast30d: data.downLast30d,
    epsGrowthFy1,
    roeFwd,
    fcfYield,
    fcfConversion,
    passUniverse,
    passRevision,
    passQuality,
    passExpectations,
    composite: null,
    strict: false,
    weight: null,
    error: null,
  };
}

/** 3-month average daily traded value (close × volume on traded bars). */
export function advFromBars(
  bars: readonly { close?: number | null; volume?: number | null }[],
): number | null {
  const values = bars
    .map((b) => (isNum(b.close) && isNum(b.volume) && b.volume > 0 ? b.close * b.volume : null))
    .filter(isNum);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 12-1 momentum over adjusted closes: last `skip`-sessions-ago close vs
 * `skip + back` sessions ago. Null when history is shorter than the window. */
export function momentumFromCloses(
  closes: readonly (number | null | undefined)[],
  back: number,
  skip: number,
): number | null {
  const c = closes.filter(isNum);
  if (c.length < back + skip) return null;
  return c[c.length - 1 - skip] / c[c.length - 1 - skip - back] - 1;
}

function zClip(values: number[], clip: number): number[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => Math.min(Math.max((v - mean) / sd, -clip), clip));
}

/** Assigns composite, strict (top revision quintile) and equal weights to the
 * survivor population. Mutates rows in place — z-scores need the full set. */
export function finalize(rows: ScreenRow[], params: ScreenParams): void {
  const survivors = rows.filter((r) => r.passUniverse && r.passRevision && r.passQuality);
  const pick = (key: "revAvg" | "breadth" | "sue" | "mom121") => survivors.map((r) => r[key]);
  const fill = (xs: (number | null)[]) => {
    const known = xs.filter(isNum) as number[];
    const median = known.length
      ? known.slice().sort((a, b) => a - b)[Math.floor(known.length / 2)]
      : 0;
    return xs.map((v) => (isNum(v) ? v : median));
  };
  const w = params.weights;
  const z = {
    revision: zClip(fill(pick("revAvg")), params.zClip),
    breadth: zClip(fill(pick("breadth")), params.zClip),
    sue: zClip(fill(pick("sue")), params.zClip),
    momentum: zClip(fill(pick("mom121")), params.zClip),
  };
  const momentumWeight = 1 - w.revision - w.breadth - w.sue;
  survivors.forEach((r, i) => {
    r.composite =
      w.revision * z.revision[i] +
      w.breadth * z.breadth[i] +
      w.sue * z.sue[i] +
      momentumWeight * z.momentum[i];
  });

  const rscore = (i: number) => z.revision[i] + z.breadth[i];
  const quantile = (xs: number[], q: number) => {
    const s = xs.slice().sort((a, b) => a - b);
    const pos = q * (s.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  const cutoff = quantile(
    survivors.map((_, i) => rscore(i)),
    1 - params.topQuintile,
  );
  survivors.forEach((r, i) => {
    r.strict = rscore(i) >= cutoff;
  });

  survivors.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
  const weight = 1 / Math.max(survivors.length, 1);
  survivors.forEach((r) => {
    r.weight = weight;
  });
}
