import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import {
  advanceScreenRun,
  classifyScreenSurvivors,
  getScreenDashboard,
  type ScreenDashboard,
} from "../server/screen";
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

export const Route = createFileRoute("/screen")({
  loader: () => getScreenDashboard(),
  component: ScreenPage,
});

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(digits);

function ScreenPage() {
  const initial = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [strictOnly, setStrictOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const query = useQuery<ScreenDashboard, Error>({
    queryKey: ["screen"],
    queryFn: () => getScreenDashboard(),
    initialData: initial,
    refetchInterval: (q) =>
      q.state.data?.run && q.state.data.run.status === "running" ? 5000 : false,
  });
  const data: ScreenDashboard = query.data ?? initial;
  const isAdmin = Route.useRouteContext().session?.isAdmin ?? false;

  const survivors = data.rows
    .filter((r) => r.passUniverse && r.passRevision && r.passQuality)
    .sort((a, b) => (b.composite ?? -Infinity) - (a.composite ?? -Infinity));
  const shown = strictOnly ? survivors.filter((r) => r.strict) : survivors;

  async function runScreen() {
    setRunning(true);
    setRunError(null);
    try {
      // One POST per batch; keep going until the run reports done.
      for (let guard = 0; guard < 60; guard += 1) {
        const result = await advanceScreenRun();
        if (result.status !== "running") break;
        await queryClient.invalidateQueries({ queryKey: ["screen"] });
      }
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
            90-day FY1/FY2 consensus revisions + quality gates (ROIC, leverage, Piotroski).
            Data-driven list: every survivor, ranked by composite.
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
                ? `Screening… ${run?.processedCount ?? 0}/${run?.universeCount ?? 0}`
                : "Run screen"}
            </Button>
            <Button
              variant="outline"
              onClick={classify}
              disabled={running || classifying || run?.status !== "done"}
            >
              {classifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Classify revisions
            </Button>
          </div>
        ) : null}
      </div>
      {runError ? <p className="text-sm text-rose-600">{runError}</p> : null}

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
            No run yet.{isAdmin ? " Use “Run screen” to start one." : ""}
          </CardContent>
        </Card>
      )}

      {survivors.length ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {strictOnly ? "Strict spec — top revision quintile" : "All survivors"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setStrictOnly((v) => !v)}>
              {strictOnly ? "Show all survivors" : "Show strict only"}
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">Rev 90d</TableHead>
                  <TableHead className="text-right">SUE</TableHead>
                  <TableHead className="text-right">ROIC</TableHead>
                  <TableHead className="text-right">ND/EBITDA</TableHead>
                  <TableHead className="text-right">F</TableHead>
                  <TableHead className="text-right">Mom 12-1</TableHead>
                  <TableHead className="text-right">Composite</TableHead>
                  <TableHead className="text-right">Jev</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
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
                    <TableCell className="text-right">{num(r.composite)}</TableCell>
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
                    <TableCell className="text-right">
                      {r.weight == null ? "—" : `${(r.weight * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
