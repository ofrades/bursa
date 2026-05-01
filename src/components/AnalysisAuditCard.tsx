import { ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import type { AnalysisDiff } from "../lib/analysis-diff";

function SignalChip({ value }: { value: string }) {
  const base = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold";
  if (value === "BUY")
    return (
      <span
        className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300`}
      >
        {value}
      </span>
    );
  if (value === "SELL")
    return (
      <span className={`${base} bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300`}>
        {value}
      </span>
    );
  return <span className={`${base} bg-muted text-muted-foreground`}>{value}</span>;
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (delta > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
        <TrendingUp className="size-3" />+{delta}%
      </span>
    );
  if (delta < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-red-500 dark:text-red-400 text-xs font-semibold">
        <TrendingDown className="size-3" />
        {delta}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs">
      <Minus className="size-3" />
      no change
    </span>
  );
}

function FactorList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "negative" | "neutral";
}) {
  if (!items.length) return null;
  const dot =
    tone === "positive"
      ? "bg-emerald-500"
      : tone === "negative"
        ? "bg-red-500"
        : "bg-muted-foreground";
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed"
          >
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function dateStr(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
}

export function AnalysisAuditCard({ diff }: { diff: AnalysisDiff }) {
  const signalFlipped = diff.signal.flipped;
  const ltChanged = diff.longTerm.changed;
  const hasFactorChanges =
    diff.bullish.added.length > 0 ||
    diff.bullish.removed.length > 0 ||
    diff.bearish.added.length > 0 ||
    diff.bearish.removed.length > 0;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div>
          <CardDescription className="text-xs uppercase tracking-wider mb-0.5">
            What changed
          </CardDescription>
          <CardTitle className="text-xl">
            {dateStr(diff.olderDate)} → {dateStr(diff.newerDate)}
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Signal + confidence row */}
        <div className="flex flex-wrap items-center gap-6">
          {/* Weekly signal */}
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Weekly call</p>
            <div className="flex items-center gap-1.5">
              <SignalChip value={diff.signal.from} />
              <ArrowRight
                className={`size-3.5 ${signalFlipped ? "text-amber-500" : "text-muted-foreground/40"}`}
              />
              <SignalChip value={diff.signal.to} />
              {signalFlipped && (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300 text-[10px]"
                >
                  Flipped
                </Badge>
              )}
            </div>
          </div>

          {/* Long-term stance */}
          {(diff.longTerm.from || diff.longTerm.to) && (
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Long-term</p>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="text-muted-foreground">{diff.longTerm.from ?? "—"}</span>
                <ArrowRight
                  className={`size-3.5 ${ltChanged ? "text-amber-500" : "text-muted-foreground/40"}`}
                />
                <span className="text-foreground">{diff.longTerm.to ?? "—"}</span>
                {ltChanged && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300 text-[10px]"
                  >
                    Shifted
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Conviction</p>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">
                {diff.confidence.from != null ? `${Math.round(diff.confidence.from)}%` : "—"}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground/40" />
              <span className="font-semibold">
                {diff.confidence.to != null ? `${Math.round(diff.confidence.to)}%` : "—"}
              </span>
              <DeltaChip delta={diff.confidence.delta} />
            </div>
          </div>

          {/* Price move */}
          {diff.price.pct != null && (
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Price move</p>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">
                  {diff.price.from != null ? `$${diff.price.from.toFixed(2)}` : "—"}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground/40" />
                <span className="font-semibold">
                  {diff.price.to != null ? `$${diff.price.to.toFixed(2)}` : "—"}
                </span>
                <DeltaChip delta={diff.price.pct} />
              </div>
            </div>
          )}
        </div>

        {/* Cycle change */}
        {diff.cycle.changed && diff.cycle.from && diff.cycle.to && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              Cycle phase
            </p>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{diff.cycle.from}</span>
              <ArrowRight className="size-3.5 text-amber-500" />
              <span className="font-semibold">{diff.cycle.to}</span>
            </div>
          </div>
        )}

        {/* Factor diffs */}
        {hasFactorChanges && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="flex flex-col gap-4">
              <FactorList
                title="New reasons to be cautious"
                items={diff.bearish.added}
                tone="negative"
              />
              <FactorList title="Lost conviction on" items={diff.bullish.removed} tone="neutral" />
            </div>
            <div className="flex flex-col gap-4">
              <FactorList
                title="New tailwinds spotted"
                items={diff.bullish.added}
                tone="positive"
              />
              <FactorList
                title="Risks no longer flagged"
                items={diff.bearish.removed}
                tone="neutral"
              />
            </div>
          </div>
        )}

        {/* Model's own explanation */}
        {diff.reasoning && (
          <div className="rounded-lg bg-muted/50 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Model's explanation for the new call
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">{diff.reasoning}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
