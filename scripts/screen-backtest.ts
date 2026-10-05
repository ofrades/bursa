#!/usr/bin/env bun
/**
 * Retroactive PROXY backtest of the screen — NOT the full algorithm.
 *
 * Testable point-in-time: quality gates (ROIC, ND/EBITDA, Piotroski), GARP
 * overlay on REALIZED NI growth (not consensus), FCF yield/conversion, 12-1
 * momentum, universe size/liquidity. NOT testable on free data: the consensus
 * revision signal (90-day FY1/FY2 drift), breadth counts, SUE, analyst
 * coverage. The universe is today's candidates — survivorship bias applies.
 * Treat results as the track record of a weaker cousin of the strategy.
 *
 * Usage:
 *   bun scripts/screen-backtest.ts --sectors data/backtest/sectors.json \
 *     [--start 2021-12-31] [--cache data/backtest/cache.json] \
 *     [--out data/backtest/report.md]
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { getFundamentalsTimeSeries, getRevisionPrices } from "../src/lib/market-data";
import {
  computeNdEbitda,
  computePiotroski,
  computeRoic,
  DEFAULT_PARAMS,
} from "../src/lib/screen/compute";
import { METHODOLOGY_VERSION } from "../src/lib/screen/report";
import { UNIVERSE } from "../src/lib/screen/universe";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT_DIR = arg("out", "data/backtest/report.md").split("/").slice(0, -1).join("/");
const CACHE = arg("cache", `${OUT_DIR}/cache.json`);
const SECTORS_FILE = arg("sectors", `${OUT_DIR}/sectors.json`);
const START = arg("start", "2021-12-31");
mkdirSync(OUT_DIR, { recursive: true });

const UNIVERSE_PARAMS = {
  ...DEFAULT_PARAMS,
  epsGrowthMin: 0.08,
  epsGrowthMax: 0.15,
  roeFwdMin: 0.15,
  fcfYieldMin: 0.04,
  fcfConversionMin: 0.8,
};

const STATEMENT_TYPES = [
  "annualEBIT",
  "annualPretaxIncome",
  "annualTaxProvision",
  "annualGrossProfit",
  "annualTotalRevenue",
  "annualNetIncome",
  "annualTotalAssets",
  "annualCurrentAssets",
  "annualCurrentLiabilities",
  "annualLongTermDebt",
  "annualCurrentDebt",
  "annualTotalDebt",
  "annualStockholdersEquity",
  "annualCashAndCashEquivalents",
  "annualOtherShortTermInvestments",
  "annualOrdinarySharesNumber",
  "annualShareIssued",
  "annualReconciledDepreciation",
  "annualDepreciationAmortizationDepletion",
  "annualCapitalExpenditure",
  "annualOperatingCashFlow",
];

const FX_PAIRS = ["EURUSD", "EURGBP", "EURCHF", "EURSEK", "EURDKK", "EURNOK", "EURJPY"];
const BENCHMARK = "^STOXX";

type Bar = { date: string; adjClose: number; close: number; volume: number };
type Cached = { bars: Bar[]; series: Record<string, [string, number][]>; fetchedAt: string };

// ─── fetching with disk cache ────────────────────────────────────────────────

const cacheFile: Record<string, Cached> = existsSync(CACHE)
  ? JSON.parse(readFileSync(CACHE, "utf8"))
  : {};

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) return res.json();
    await res.body?.cancel().catch(() => {});
    if (attempt < 2 && [429, 500, 502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    // Yahoo intermittently 404s valid symbols; one delayed retry.
    if (attempt < 2 && res.status === 404) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()),
          indicators: z.object({
            adjclose: z.array(z.object({ adjclose: z.array(z.number().nullable()) })).min(1),
            quote: z
              .array(
                z.object({
                  close: z.array(z.number().nullable()),
                  volume: z.array(z.number().nullable()),
                }),
              )
              .min(1),
          }),
        }),
      )
      .min(1),
  }),
});

async function fetchBars(symbol: string, from: Date, to: Date): Promise<Bar[]> {
  const search = new URLSearchParams({
    period1: String(Math.floor(from.getTime() / 1000)),
    period2: String(Math.floor(to.getTime() / 1000)),
    interval: "1d",
  });
  const parsed = chartSchema.safeParse(
    await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${search}`,
    ),
  );
  if (!parsed.success) return [];
  const { timestamp, indicators } = parsed.data.chart.result[0];
  const adj = indicators.adjclose?.[0]?.adjclose;
  const quote = indicators.quote[0];
  return timestamp
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      adjClose: (adj ? adj[i] : null) ?? quote.close[i],
      close: quote.close[i],
      volume: quote.volume[i],
    }))
    .filter((b): b is Bar => b.adjClose !== null && b.adjClose > 0 && b.close !== null);
}

async function fetchSymbol(symbol: string, from: Date, to: Date): Promise<Cached> {
  const bars = await fetchBars(symbol, from, to);
  // Yahoo caps fundamentals-timeseries to ~the last 5 fiscal years per request;
  // an older window extends point-in-time depth for the early backtest quarters.
  const [recent, older] = await Promise.all([
    getFundamentalsTimeSeries(symbol, { period1: new Date("2022-06-30"), period2: to }, [
      ...STATEMENT_TYPES,
    ]),
    getFundamentalsTimeSeries(symbol, { period1: from, period2: new Date("2023-01-31") }, [
      ...STATEMENT_TYPES,
    ]),
  ]);
  const series: Record<string, [string, number][]> = {};
  for (const points of [older, recent]) {
    for (const [type, pts] of Object.entries(points)) {
      const seen = new Set((series[type] ?? []).map((p) => p[0]));
      series[type] = [
        ...(series[type] ?? []),
        ...pts
          .filter((p) => p.value !== null && !seen.has(p.date))
          .map((p) => [p.date, p.value] as [string, number]),
      ];
    }
  }
  return { bars, series, fetchedAt: new Date().toISOString() };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

// ─── point-in-time reads ─────────────────────────────────────────────────────

type Statements = Parameters<typeof computeRoic>[0];

function statementsAsOf(series: Record<string, [string, number][]>, cutoff: string): Statements {
  const dates = [...new Set((series.annualTotalAssets ?? []).map((p) => p[0]))]
    .filter((d) => d <= cutoff)
    .sort()
    .reverse();
  const at = (type: string, when: string | undefined) =>
    when ? (series[type]?.find((p) => p[0] === when)?.[1] ?? null) : null;
  const latest = (type: string) => at(type, dates[0]);
  const two = (type: string): [number | null, number | null] => [
    at(type, dates[0]),
    at(type, dates[1]),
  ];
  const ltd = latest("annualLongTermDebt");
  const currentDebt = latest("annualCurrentDebt");
  return {
    ebit: latest("annualEBIT"),
    depreciation:
      latest("annualReconciledDepreciation") ?? latest("annualDepreciationAmortizationDepletion"),
    pretaxIncome: latest("annualPretaxIncome"),
    taxProvision: latest("annualTaxProvision"),
    netIncome: two("annualNetIncome"),
    totalRevenue: two("annualTotalRevenue"),
    grossProfit: two("annualGrossProfit"),
    totalAssets: two("annualTotalAssets"),
    currentAssets: two("annualCurrentAssets"),
    currentLiabilities: two("annualCurrentLiabilities"),
    totalDebt:
      latest("annualTotalDebt") ??
      (ltd !== null && currentDebt !== null ? ltd + currentDebt : null),
    longTermDebt: two("annualLongTermDebt"),
    stockholdersEquity: latest("annualStockholdersEquity"),
    cash: latest("annualCashAndCashEquivalents"),
    shortTermInvestments: latest("annualOtherShortTermInvestments"),
    capitalExpenditure: latest("annualCapitalExpenditure"),
    sharesOutstanding: [
      latest("annualOrdinarySharesNumber") ?? latest("annualShareIssued"),
      at("annualOrdinarySharesNumber", dates[1]) ?? at("annualShareIssued", dates[1]),
    ],
    operatingCashFlow: latest("annualOperatingCashFlow"),
  };
}

function priceAt(bars: Bar[], date: string): number | null {
  const prior = bars.filter((b) => b.date <= date);
  return prior.length ? prior[prior.length - 1].adjClose : null;
}

function momentum121(bars: Bar[], date: string, back = 252, skip = 21): number | null {
  const prior = bars.filter((b) => b.date <= date);
  if (prior.length < skip + back + 1) return null;
  const end = prior[prior.length - 1 - skip].adjClose;
  const start = prior[prior.length - 1 - skip - back].adjClose;
  return start > 0 && end > 0 ? end / start - 1 : null;
}

function advAt(bars: Bar[], date: string, sessions = 63): number | null {
  const prior = bars.filter((b) => b.date <= date).slice(-sessions);
  if (prior.length < sessions) return null;
  const values = prior.map((b) => b.close * b.volume).filter((v) => Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function zScores(values: number[], clip: number): number[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => Math.min(Math.max((v - mean) / sd, -clip), clip));
}

function forwardReturn(bars: Bar[], date: string, horizon: number): number | null {
  let idx = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (bars[i].date <= date) idx = i;
    else break;
  }
  if (idx < 0) return null;
  const end = bars[idx + horizon];
  if (!end) return null;
  return end.adjClose / bars[idx].adjClose - 1;
}

// ─── main ────────────────────────────────────────────────────────────────────

type Meta = { sector?: string; currency?: string };
const meta: Record<string, Meta> = existsSync(SECTORS_FILE)
  ? JSON.parse(readFileSync(SECTORS_FILE, "utf8"))
  : {};
const today = new Date().toISOString().slice(0, 10);
const HISTORY_FROM = new Date(Date.parse(START) - 3 * 365 * 86400000);

async function main() {
  const symbols = UNIVERSE.map((u) => u.symbol);
  const fresh = symbols.filter((s) => !cacheFile[s]);
  console.log(`symbols: ${symbols.length} total, ${fresh.length} to fetch`);
  let done = 0;
  await pool(fresh, 4, async (symbol) => {
    try {
      cacheFile[symbol] = await fetchSymbol(symbol, HISTORY_FROM, new Date());
    } catch (cause) {
      console.warn(`[backtest] ${symbol} failed:`, cause instanceof Error ? cause.message : cause);
      cacheFile[symbol] = { bars: [], series: {}, fetchedAt: new Date().toISOString() };
    }
    done += 1;
    if (done % 25 === 0) {
      writeFileSync(CACHE, JSON.stringify(cacheFile));
      console.log(`  ${done}/${fresh.length} fetched`);
    }
  });
  writeFileSync(CACHE, JSON.stringify(cacheFile));

  // FX + benchmark series
  const fxRaw = await Promise.all(
    FX_PAIRS.map((p) => fetchBars(`${p}=X`, HISTORY_FROM, new Date())),
  );
  const fxSeries = Object.fromEntries(
    FX_PAIRS.map((p, i) => [p.replace("EUR", ""), fxRaw[i]]),
  ) as Record<string, Bar[]>;
  const bench = await fetchBars(BENCHMARK, HISTORY_FROM, new Date());

  const perEurAt = (ccy: string, date: string): number | null => {
    const bars = fxSeries[ccy === "GBp" ? "GBP" : ccy];
    const rate = bars ? priceAt(bars, date) : null; // units per EUR
    return rate ? 1 / rate : null;
  };

  const quarterEnds: string[] = [];
  const startY = Number(START.slice(0, 4));
  for (let y = startY; y <= Number(today.slice(0, 4)); y += 1) {
    for (const md of ["1231", "0331", "0630", "0930"]) {
      const d = `${y}-${md.slice(0, 2)}-${md.slice(2)}`;
      if (d >= START && d <= today) quarterEnds.push(d);
    }
  }
  quarterEnds.sort();

  type Pick2 = {
    symbol: string;
    strictGarp: boolean;
    excess63: number | null;
    excess252: number | null;
  };
  const results: {
    date: string;
    evaluated: number;
    survivors: number;
    garp: number;
    picks: number;
    win63: number | null;
    win252: number | null;
    excess63: number | null;
    excess252: number | null;
  }[] = [];
  const picksLog: (Pick2 & { date: string })[] = [];

  for (const date of quarterEnds) {
    const universe: {
      symbol: string;
      mom: number | null;
      roic: number | null;
      fcfYield: number | null;
      garp: boolean;
    }[] = [];
    let evaluated = 0;
    for (const { symbol } of UNIVERSE) {
      const cached = cacheFile[symbol];
      if (!cached || !cached.bars.length) continue;
      const sector = meta[symbol]?.sector ?? "";
      const financial = sector.includes("Financial");
      const listingCcy = meta[symbol]?.currency ?? "EUR";
      const priceCcy = listingCcy === "GBp" ? "GBp" : listingCcy;
      const perEur = perEurAt(priceCcy, date) ?? (priceCcy === "EUR" ? 1 : null);
      const price = priceAt(cached.bars, date);
      const stmts = statementsAsOf(cached.series, date);
      const shares = stmts.sharesOutstanding[0];
      const mom = momentum121(cached.bars, date);
      const ni = stmts.netIncome[0];
      const equity = stmts.stockholdersEquity;
      const ocf = stmts.operatingCashFlow;
      const capex = stmts.capitalExpenditure;
      const [niPrev] = [stmts.netIncome[1]];
      const growth = isNum(ni) && isNum(niPrev) && niPrev > 0 ? ni / niPrev - 1 : null;
      const fcf = isNum(ocf) && isNum(capex) ? ocf - Math.abs(capex) : null;
      const penceDiv = priceCcy === "GBp" ? 100 : 1;
      const mcapEur =
        isNum(price) && isNum(shares) && perEur ? (price * shares * perEur) / penceDiv / 1e9 : null;
      const fcfEur = isNum(fcf) && perEur ? fcf * perEur : null;
      const fcfYield = fcfEur !== null && mcapEur ? fcfEur / mcapEur : null;
      const conversion = isNum(fcf) && isNum(ni) && ni > 0 ? fcf / ni : null;
      const roic = computeRoic(stmts);
      const nd = computeNdEbitda(stmts.totalDebt, stmts.cash, null, stmts);
      const fscore = computePiotroski(stmts);
      const advEur = advAt(cached.bars, date);

      evaluated += 1;
      const passUniverse =
        (mcapEur ?? -1) >= UNIVERSE_PARAMS.minMarketCapEur / 1e9 &&
        (advEur ?? -1) >= UNIVERSE_PARAMS.minAdvEur / 1e6;
      const roeNow = isNum(ni) && isNum(equity) && equity > 0 ? ni / equity : null;
      const garp =
        growth !== null &&
        growth >= UNIVERSE_PARAMS.epsGrowthMin &&
        growth <= UNIVERSE_PARAMS.epsGrowthMax &&
        roeNow !== null &&
        roeNow >= UNIVERSE_PARAMS.roeFwdMin &&
        (financial ||
          (fcfYield !== null &&
            fcfYield >= UNIVERSE_PARAMS.fcfYieldMin &&
            conversion !== null &&
            conversion >= UNIVERSE_PARAMS.fcfConversionMin));
      const quality =
        roic !== null &&
        roic >= UNIVERSE_PARAMS.minRoic &&
        (financial || (nd !== null && nd <= UNIVERSE_PARAMS.maxNetDebtEbitda)) &&
        fscore !== null &&
        fscore >= UNIVERSE_PARAMS.minPiotroski;
      if (!passUniverse || !quality) continue;
      universe.push({ symbol, mom, roic, fcfYield, garp });
    }

    const momZ = zScores(
      universe.map((u) => u.mom ?? Number.NaN),
      UNIVERSE_PARAMS.zClip,
    ).map((v) => (Number.isNaN(v) ? 0 : v));
    const roicZ = zScores(
      universe.map((u) => u.roic ?? Number.NaN),
      UNIVERSE_PARAMS.zClip,
    ).map((v) => (Number.isNaN(v) ? 0 : v));
    const fcfZ = zScores(
      universe.map((u) => u.fcfYield ?? Number.NaN),
      UNIVERSE_PARAMS.zClip,
    ).map((v) => (Number.isNaN(v) ? 0 : v));

    const scored = universe
      .map((u, i) => ({
        ...u,
        score: momZ[i] + roicZ[i] + fcfZ[i],
        excess63: forwardReturn(cacheFile[u.symbol].bars, date, 63) ?? null,
        excess252: forwardReturn(cacheFile[u.symbol].bars, date, 252),
      }))
      .sort((a, b) => b.score - a.score);
    const quintile = Math.max(1, Math.ceil(scored.length * UNIVERSE_PARAMS.topQuintile));
    const picks = scored.slice(0, quintile).map((p) => ({
      date,
      symbol: p.symbol,
      strictGarp: p.garp,
      excess63: p.excess63,
      excess252: p.excess252,
    }));
    picksLog.push(...picks);

    const bench63 = forwardReturn(bench, date, 63);
    const bench252 = forwardReturn(bench, date, 252);
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const e63 = avg(picks.map((p) => p.excess63));
    const e252 = avg(picks.map((p) => p.excess252));
    const win63 =
      e63 !== null && bench63 !== null
        ? picks.filter((p) => p.excess63 !== null && p.excess63 > bench63).length /
          picks.filter((p) => p.excess63 !== null).length
        : null;
    const win252 =
      e252 !== null && bench252 !== null
        ? picks.filter((p) => p.excess252 !== null && p.excess252 > bench252).length /
          picks.filter((p) => p.excess252 !== null).length
        : null;
    results.push({
      date,
      evaluated,
      survivors: universe.length,
      garp: universe.filter((u) => u.garp).length,
      picks: picks.length,
      win63,
      win252,
      excess63: e63,
      excess252: e252,
    });
    console.log(
      `${date}: evaluated ${evaluated}, quality ${universe.length}, garp ${universe.filter((u) => u.garp).length}, picks ${picks.length}, win63 ${win63?.toFixed(2) ?? "—"}, excess63 ${e63?.toFixed(3) ?? "—"}`,
    );
  }

  writeFileSync(
    `${OUT_DIR}/picks.csv`,
    "date,symbol,garp,excess63,excess252\n" +
      picksLog
        .map(
          (p) => `${p.date},${p.symbol},${p.strictGarp},${p.excess63 ?? ""},${p.excess252 ?? ""}`,
        )
        .join("\n") +
      "\n",
  );

  const elapsed = results.filter((r) => r.win63 !== null);
  const full = results.filter((r) => r.win252 !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const report = [
    `# PROXY backtest — quality + GARP + momentum (NOT the revision algorithm)`,
    ``,
    `Universe: today's candidates (SURVIVORSHIP BIAS). No consensus data:`,
    `revision gate, breadth and SUE are absent; GARP uses REALIZED NI growth.`,
    `Coverage gate not enforceable retroactively. Methodology v2 gates only.`,
    ``,
    `Quarter-ends evaluated: ${results.length} (${results[0]?.date} → ${results[results.length - 1]?.date})`,
    `Quarters with 63-session outcomes: ${elapsed.length}; with 252-session: ${full.length}`,
    ``,
    `| Quarter-end | Evaluated | Quality pass | GARP pass | Picks | Win 3M | Avg excess 3M | Win 12M | Avg excess 12M |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.date} | ${r.evaluated} | ${r.survivors} | ${r.garp} | ${r.picks} | ${fmtRate(r.win63)} | ${fmtPct(r.excess63)} | ${fmtRate(r.win252)} | ${fmtPct(r.excess252)} |`,
    ),
    ``,
    `## Averages`,
    ``,
    `- Mean win rate 3M: ${fmtRate(mean(elapsed.map((r) => r.win63 ?? 0)) ?? null)} (n=${elapsed.length} quarters)`,
    `- Mean excess 3M: ${fmtPct(mean(elapsed.map((r) => r.excess63 ?? 0)) ?? null)}`,
    `- Mean win rate 12M: ${fmtRate(mean(full.map((r) => r.win252 ?? 0)) ?? null)} (n=${full.length} quarters)`,
    `- Mean excess 12M: ${fmtPct(mean(full.map((r) => r.excess252 ?? 0)) ?? null)}`,
    ``,
    `## Biases`,
    ``,
    `- Survivorship: today's universe applied to the past; failures absent.`,
    `- No point-in-time consensus: revision/breadth/SUE gates absent by necessity.`,
    `- GARP uses realized NI growth (hindsight-observable), not forward consensus.`,
    `- Coverage (>=20 analysts) not retroactively checkable.`,
  ].join("\n");
  writeFileSync(arg("out", `${OUT_DIR}/report.md`), report);
  const snapshot = {
    methodologyVersion: METHODOLOGY_VERSION,
    kind: "proxy" as const,
    generatedAt: new Date().toISOString(),
    quarters: results.map((r) => ({
      date: r.date,
      evaluated: r.evaluated,
      qualityPass: r.survivors,
      garpPass: r.garp,
      picks: r.picks,
      win63: r.win63,
      excess63: r.excess63,
      win252: r.win252,
      excess252: r.excess252,
    })),
    averages: {
      win63: meanOf(results.filter((r) => r.win63 !== null).map((r) => r.win63!)),
      excess63: meanOf(results.filter((r) => r.excess63 !== null).map((r) => r.excess63!)),
      quarters63: results.filter((r) => r.win63 !== null).length,
      win252: meanOf(results.filter((r) => r.win252 !== null).map((r) => r.win252!)),
      excess252: meanOf(results.filter((r) => r.excess252 !== null).map((r) => r.excess252!)),
      quarters252: results.filter((r) => r.win252 !== null).length,
    },
  };
  const snapshotTs = [
    "// GENERATED by scripts/screen-backtest.ts — do not edit by hand.",
    "// PROXY retro results: quality + GARP + momentum skeleton, WITHOUT the",
    "// consensus-revision signal; survivorship and hindsight biases apply.",
    'import { METHODOLOGY_VERSION } from "./report";',
    "",
    "export type BacktestQuarter = {",
    "  date: string;",
    "  evaluated: number;",
    "  qualityPass: number;",
    "  garpPass: number;",
    "  picks: number;",
    "  win63: number | null;",
    "  excess63: number | null;",
    "  win252: number | null;",
    "  excess252: number | null;",
    "};",
    "",
    "export const backtestSnapshot = {",
    `  methodologyVersion: METHODOLOGY_VERSION,`,
    `  kind: "${snapshot.kind}" as const,`,
    `  generatedAt: "${snapshot.generatedAt}",`,
    "  quarters: [",
    ...snapshot.quarters.map(
      (q) =>
        `    { date: "${q.date}", evaluated: ${q.evaluated}, qualityPass: ${q.qualityPass}, garpPass: ${q.garpPass}, picks: ${q.picks}, win63: ${q.win63 === null ? "null" : q.win63.toFixed(4)}, excess63: ${q.excess63 === null ? "null" : q.excess63.toFixed(4)}, win252: ${q.win252 === null ? "null" : q.win252.toFixed(4)}, excess252: ${q.excess252 === null ? "null" : q.excess252.toFixed(4)} },`,
    ),
    "  ],",
    "  averages: {",
    `    win63: ${snapshot.averages.win63 === null ? "null" : snapshot.averages.win63!.toFixed(4)},`,
    `    excess63: ${snapshot.averages.excess63 === null ? "null" : snapshot.averages.excess63!.toFixed(4)},`,
    `    quarters63: ${snapshot.averages.quarters63},`,
    `    win252: ${snapshot.averages.win252 === null ? "null" : snapshot.averages.win252!.toFixed(4)},`,
    `    excess252: ${snapshot.averages.excess252 === null ? "null" : snapshot.averages.excess252!.toFixed(4)},`,
    `    quarters252: ${snapshot.averages.quarters252},`,
    "  },",
    "} satisfies { methodologyVersion: number; kind: \u0022proxy\u0022; generatedAt: string; quarters: BacktestQuarter[]; averages: Record<string, number | null> };",
    "",
  ].join("\n");
  writeFileSync(
    new URL("../src/lib/screen/backtest-snapshot.ts", import.meta.url).pathname,
    snapshotTs,
  );
  writeFileSync(arg("out", `${OUT_DIR}/report.md`), report);
  console.log(`snapshot -> src/lib/screen/backtest-snapshot.ts`);
  console.log(`report -> ${arg("out", `${OUT_DIR}/report.md`)}`);
}

function meanOf(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function fmtRate(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(0)}%`;
}
function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
function isNum(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

main();
