import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";

type DividendPayment = {
  date: string | Date;
  amount: number;
};

type DividendData = {
  dividendRate: number | null;
  dividendYield: number | null;
  trailingAnnualDividendRate: number | null;
  trailingAnnualDividendYield: number | null;
  exDividendDate: string | Date | null;
  history: DividendPayment[];
};

type Props = {
  data: DividendData;
};

function fmt(v: number | null | undefined, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(decimals)}`;
}

function fmtPct(v: number | null | undefined, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  // Yahoo returns yield as a decimal (0.0153 = 1.53%)
  const pct = v < 1 ? v * 100 : v;
  return `${pct.toFixed(decimals)}%`;
}

function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

/** Roll up individual dividend payments into annual totals. */
function buildAnnualSeries(history: DividendPayment[]) {
  const byYear = new Map<number, number>();
  for (const item of history) {
    const d = new Date(item.date);
    if (Number.isNaN(d.getTime())) continue;
    const year = d.getUTCFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + item.amount);
  }
  return Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, total]) => ({ year: String(year), total: parseFloat(total.toFixed(4)) }));
}

const chartConfig = {
  total: { label: "Annual dividend ($/share)", color: "var(--chart-1)" },
};

export function DividendCard({ data }: Props) {
  const annual = buildAnnualSeries(data.history);

  // If no dividend data at all, don't render
  const hasYield =
    data.dividendYield != null ||
    data.trailingAnnualDividendYield != null ||
    data.dividendRate != null ||
    data.trailingAnnualDividendRate != null;
  if (!hasYield && annual.length === 0) return null;

  const displayYield = data.dividendYield ?? data.trailingAnnualDividendYield;
  const displayRate = data.dividendRate ?? data.trailingAnnualDividendRate;

  const stats = [
    { label: "Annual rate", value: fmt(displayRate) },
    { label: "Dividend yield", value: fmtPct(displayYield) },
    { label: "Ex-div date", value: fmtDate(data.exDividendDate) },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-muted-foreground" />
          <div>
            <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
              Income
            </CardDescription>
            <CardTitle className="text-xl">Dividends</CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Key stats row */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-muted/60 px-3 py-3">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-base font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* Historical bar chart */}
        {annual.length >= 2 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Annual dividends per share
            </p>
            <ChartContainer config={chartConfig} className="h-40 w-full">
              <BarChart data={annual} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  className="fill-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  className="fill-muted-foreground"
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const v = payload[0]?.value as number;
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
                        <p className="font-semibold">{label}</p>
                        <p className="text-muted-foreground">
                          ${Number.isFinite(v) ? v.toFixed(4) : "—"} / share
                        </p>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} className="stroke-border" />
                <Bar dataKey="total" radius={[3, 3, 0, 0]} maxBarSize={36}>
                  {annual.map((entry) => (
                    <Cell
                      key={entry.year}
                      fill={entry.total > 0 ? "var(--chart-1)" : "var(--destructive)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
