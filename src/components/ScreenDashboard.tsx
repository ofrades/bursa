import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import {
  advanceScreenRun,
  classifyScreenSurvivors,
  getScreenDashboard,
  getScreenTrackRecord,
  type RunRecord,
  type ScreenDashboard as ScreenDashboardData,
} from "../server/screen";
import { exclusionReasons, isSurvivor } from "../lib/screen/report";
import { backtestSnapshot } from "../lib/screen/backtest-snapshot";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(digits);

export function ScreenDashboard({
  initial,
  isAdmin,
}: {
  initial: ScreenDashboardData;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [strictOnly, setStrictOnly] = useState(false);
  const [garpOverlay, setGarpOverlay] = useState(false);
  const [running, setRunning] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const query = useQuery<ScreenDashboardData, Error>({
    queryKey: ["screen"],
    queryFn: () => getScreenDashboard(),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.latest?.status === "running" ? 5000 : false),
  });
  const data: ScreenDashboardData = query.data ?? initial;
  const recordQuery = useQuery<RunRecord[], Error>({
    queryKey: ["screen-record"],
    queryFn: () => getScreenTrackRecord(),
  });
  const record = recordQuery.data ?? [];

  const survivors = data.rows
    .filter(isSurvivor)
    .sort((a, b) => (b.composite ?? -Infinity) - (a.composite ?? -Infinity));
  const base = garpOverlay ? survivors.filter((r) => r.passExpectations) : survivors;
  const shown = strictOnly ? base.filter((r) => r.strict) : base;
  const excluded = data.rows.filter((r) => !isSurvivor(r));
  const errors = data.rows.filter((r) => r.error).length;
  const stale = data.run ? Date.now() - Date.parse(data.run.runAt) > 8 * 86400000 : false;

  async function runScreen() {
    setRunning(true);
    setRunError(null);
    try {
      // One POST per batch; keep going until the run reports done.
      let completed = false;
      let runId: string | undefined;
      for (let guard = 0; guard < 120; guard += 1) {
        const result = await advanceScreenRun({ data: { runId } });
        runId = result.runId;
        if (result.status === "failed")
          throw new Error("Screen failed; previous completed results remain visible.");
        if (result.status === "done") {
          completed = true;
          break;
        }
        await queryClient.invalidateQueries({ queryKey: ["screen"] });
        if (result.batchProcessed === 0) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (!completed) throw new Error("Run still incomplete. Resume it with Run screen.");
      await queryClient.invalidateQueries({ queryKey: ["screen"] });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "run failed");
    } finally {
      setRunning(false);
    }
  }

  async function classify() {
    setClassifying(true);
    setRunError(null);
    try {
      const result = await classifyScreenSurvivors();
      if (result.skipped) setRunError(result.skipped);
      await queryClient.invalidateQueries({ queryKey: ["screen"] });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "classification failed");
    } finally {
      setClassifying(false);
    }
  }

  const run = data.run;
  const financials = survivors.filter((r) => r.sector?.includes("Financial")).length;
  const financialShare = survivors.length ? financials / survivors.length : 0;
  const breaches =
    financialShare > 0.3
      ? [`Financial Services ${financials} (${(financialShare * 100).toFixed(0)}%)`]
      : [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">EPS-revision screen</h1>
          <p className="text-sm text-muted-foreground">
            90-day FY1/FY2 consensus revisions + quality gates (ROIC, leverage, Piotroski). Curated
            global large-cap shortlist, not all listed stocks. Research leads, not buy signals.
          </p>
        </div>
        {isAdmin ? (
          <div className="flex gap-2">
            <Button onClick={runScreen} disabled={running || classifying}>
              {running ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {running
                ? `Screening… ${data.latest?.processedCount ?? 0}/${data.latest?.universeCount ?? 0}`
                : "Run screen"}
            </Button>
            <Button
              variant="outline"
              onClick={classify}
              disabled={running || classifying || run?.status !== "done"}
            >
              {classifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Classify revisions (paid AI)
            </Button>
          </div>
        ) : null}
      </div>
      {query.error ? (
        <p role="alert">Could not refresh the dashboard: {query.error.message}</p>
      ) : null}
      {runError ? (
        <p role="alert" className="text-sm text-rose-600">
          {runError}
        </p>
      ) : null}
      {data.latest?.status === "running" ? (
        <p role="status">
          Run in progress: {data.latest.processedCount}/{data.latest.universeCount}. Showing
          previous completed results.
        </p>
      ) : null}
      {data.latest?.status === "failed" ? (
        <p role="alert">Latest run failed. Results below are from the previous completed run.</p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Before buying in Trade Republic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Check the same company and listing is available to you. Review analyst buy/long share
            against your own threshold, analyst count, consensus date and target-price upside. These
            ratings are not fetched here and are not EPS-revision breadth.
          </p>
          <p>
            Read the earnings release, upcoming earnings date, valuation, spread and portfolio
            concentration. GARP is an optional filter, not a validated forecast.
          </p>
          <p>
            Screen limits: market cap ≥ €40bn, daily turnover ≥ €100m, analyst coverage ≥ 20.
            Consensus freshness is unverified; snapshots record fetch time, not estimate update
            time.
          </p>
          <p>
            Daily FX conversion:{" "}
            <a href="https://www.exchangerate-api.com" className="underline">
              Rates By Exchange Rate API
            </a>
            . Missing or stale currency rates block screening rather than exclude stocks.
          </p>
        </CardContent>
      </Card>
      {run ? (
        <p className="text-sm text-muted-foreground">
          Completed snapshot: {run.runAt.slice(0, 16).replace("T", " ")} UTC.{" "}
          {data.previousRunAt
            ? `Compared with ${data.previousRunAt.slice(0, 10)}.`
            : "No previous comparable snapshot yet."}{" "}
          {stale ? "STALE: over eight days old." : ""}{" "}
          {errors > 0 ? `${errors} symbols had data errors; coverage is incomplete.` : ""}
        </p>
      ) : null}
      {data.previousRunAt ? (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p>Entered strict shortlist: {data.entered.join(", ") || "None"}</p>
            <p>
              Exited strict shortlist: {data.exited.join(", ") || "None"}. Check exclusions below
              before interpreting an exit as deterioration.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {run ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{run.status}</Badge>
          <Badge variant="secondary">universe {run.universeCount}</Badge>
          <Badge variant="secondary">pass universe {run.passedUniverse}</Badge>
          <Badge variant="secondary">pass revision {run.passedRevision}</Badge>
          <Badge variant="secondary">survivors {run.survivorCount}</Badge>
          {breaches.length ? (
            <Badge variant="destructive">sector &gt;30%: {breaches.join(", ")}</Badge>
          ) : null}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No completed run for the corrected methodology yet.
            {isAdmin ? " Use “Run screen” to start one." : ""}
          </CardContent>
        </Card>
      )}

      {record.some((r) => r.horizons.some((h) => h.names > 0)) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Track record — excess vs STOXX 600</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Names</TableHead>
                  <TableHead className="text-right">1M win / avg</TableHead>
                  <TableHead className="text-right">3M win / avg</TableHead>
                  <TableHead className="text-right">6M win / avg</TableHead>
                  <TableHead className="text-right">12M win / avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.map((r) => (
                  <TableRow key={r.runId}>
                    <TableCell>{r.runAt.slice(0, 10)}</TableCell>
                    <TableCell>{r.names}</TableCell>
                    {r.horizons.map((h) => (
                      <TableCell key={h.horizonDays} className="text-right">
                        {h.names === 0
                          ? "—"
                          : `${((h.beatMarketRate ?? 0) * 100).toFixed(0)}% · ${
                              (h.avgExcess ?? 0) >= 0 ? "+" : ""
                            }${((h.avgExcess ?? 0) * 100).toFixed(1)}%`}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Win = positive excess vs STOXX 600 over 21/63/126/252-session horizons; avg = mean
              excess return. Cells fill in as windows elapse.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {backtestSnapshot.quarters.some((q) => q.picks > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Retro proxy backtest — quality + GARP + momentum skeleton
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Generated {backtestSnapshot.generatedAt.slice(0, 10)}. NOT the revision algorithm: no
              consensus data retroactively. Survivorship bias (today's universe) and hindsight
              growth apply. Win = beat STOXX 600.
            </p>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm">
              Averages — 3M: win {(backtestSnapshot.averages.win63 * 100).toFixed(0)}%, excess{" "}
              {pct(backtestSnapshot.averages.excess63)} ({backtestSnapshot.averages.quarters63}{" "}
              quarters) · 12M: win {(backtestSnapshot.averages.win252 * 100).toFixed(0)}%, excess{" "}
              {pct(backtestSnapshot.averages.excess252)} ({backtestSnapshot.averages.quarters252}{" "}
              quarters)
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter-end</TableHead>
                  <TableHead className="text-right">Quality</TableHead>
                  <TableHead className="text-right">GARP</TableHead>
                  <TableHead className="text-right">Picks</TableHead>
                  <TableHead className="text-right">3M win</TableHead>
                  <TableHead className="text-right">3M excess</TableHead>
                  <TableHead className="text-right">12M win</TableHead>
                  <TableHead className="text-right">12M excess</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtestSnapshot.quarters
                  .filter((q) => q.picks > 0)
                  .map((q) => (
                    <TableRow key={q.date}>
                      <TableCell>{q.date}</TableCell>
                      <TableCell className="text-right">{q.qualityPass}</TableCell>
                      <TableCell className="text-right">{q.garpPass}</TableCell>
                      <TableCell className="text-right">{q.picks}</TableCell>
                      <TableCell className="text-right">
                        {q.win63 == null ? "—" : `${(q.win63 * 100).toFixed(0)}%`}
                      </TableCell>
                      <TableCell className="text-right">{pct(q.excess63)}</TableCell>
                      <TableCell className="text-right">
                        {q.win252 == null ? "—" : `${(q.win252 * 100).toFixed(0)}%`}
                      </TableCell>
                      <TableCell className="text-right">{pct(q.excess252)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {survivors.length ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {strictOnly ? "Strict spec — top revision quintile" : "All survivors"}
            </CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setGarpOverlay((v) => !v)}>
                {garpOverlay ? "\u2713 GARP" : "GARP (optional)"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStrictOnly((v) => !v)}>
                {strictOnly ? "Show all survivors" : "Show strict only"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Missing surprise/momentum factors use the survivor median, or zero when none are
              available. Strict means at or above the 80th percentile of revision + breadth; ties
              are included. AI percentages, if requested, are uncalibrated model judgments.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">Rev 90d</TableHead>
                  <TableHead className="text-right">Δ revision</TableHead>
                  <TableHead className="text-right">Breadth 30d</TableHead>
                  <TableHead className="text-right">Analysts</TableHead>
                  <TableHead className="text-right">SUE</TableHead>
                  <TableHead className="text-right">ROIC</TableHead>
                  <TableHead className="text-right">ND/EBITDA</TableHead>
                  <TableHead className="text-right">F</TableHead>
                  <TableHead className="text-right">Mom 12-1</TableHead>
                  <TableHead className="text-right">Growth FY1</TableHead>
                  <TableHead className="text-right">ROE fwd</TableHead>
                  <TableHead className="text-right">FCF yld</TableHead>
                  <TableHead className="text-right">FCF/NI</TableHead>
                  <TableHead className="text-right">Composite</TableHead>
                  <TableHead className="text-right">Jev</TableHead>
                  <TableHead className="text-right">Forward P/E</TableHead>
                  <TableHead>Data notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>
                      <Link
                        to="/stocks/$symbol"
                        params={{ symbol: r.symbol }}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{r.symbol}</span>
                      {r.strict ? (
                        <Badge variant="secondary" className="ml-2">
                          strict
                        </Badge>
                      ) : null}
                      {data.entered.includes(r.symbol) ? <Badge className="ml-2">new</Badge> : null}
                      {data.exited.includes(r.symbol) ? (
                        <Badge variant="outline" className="ml-2">
                          exited last run
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.region}</TableCell>
                    <TableCell className="text-muted-foreground">{r.sector ?? "—"}</TableCell>
                    <TableCell className="text-right">{pct(r.revAvg)}</TableCell>
                    <TableCell className="text-right">
                      {data.changes[r.symbol]?.revision == null
                        ? "—"
                        : `${(data.changes[r.symbol].revision! * 100).toFixed(1)} pp`}
                    </TableCell>
                    <TableCell className="text-right">{pct(r.breadth)}</TableCell>
                    <TableCell className="text-right">{r.analysts ?? "—"}</TableCell>
                    <TableCell className="text-right">{num(r.sue)}</TableCell>
                    <TableCell className="text-right">
                      {r.roic == null ? "—" : pct(r.roic, 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.ndEbitda == null ? "—" : `${r.ndEbitda.toFixed(1)}x`}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.fscore == null ? "—" : r.fscore.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right">{pct(r.mom121)}</TableCell>
                    <TableCell className="text-right">
                      {r.epsGrowthFy1 == null ? "\u2014" : pct(r.epsGrowthFy1, 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.roeFwd == null ? "\u2014" : pct(r.roeFwd, 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.fcfYield == null ? "\u2014" : pct(r.fcfYield)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.fcfConversion == null
                        ? "\u2014"
                        : `${(r.fcfConversion * 100).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      {num(r.composite)}
                      <span className="block text-xs text-muted-foreground">
                        Δ {num(data.changes[r.symbol]?.composite)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.jevVerdict ? (
                        <span
                          title={r.jevRationale ?? ""}
                          className={
                            r.jevVerdict === "RECURRING"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : r.jevVerdict === "ONE_OFF"
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-amber-600 dark:text-amber-400"
                          }
                        >
                          {r.jevVerdict.toLowerCase()}{" "}
                          {r.jevProbability != null
                            ? `${(r.jevProbability * 100).toFixed(0)}%`
                            : ""}
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="text-right">{num(r.fwdPe, 1)}</TableCell>
                    <TableCell>
                      <details>
                        <summary>Limitations</summary>
                        <ul>
                          {(JSON.parse(r.dataIssues) as string[]).map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!shown.length ? (
              <p className="py-4 text-sm">No candidates match the selected filters.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {run && !survivors.length ? (
        <p>No candidates passed. Review missing data and exclusions below.</p>
      ) : null}
      {excluded.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Excluded / insufficient data ({excluded.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary>Show reasons — missing data is not a negative investment signal</summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {excluded.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.symbol}</TableCell>
                      <TableCell>{exclusionReasons(r).join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
