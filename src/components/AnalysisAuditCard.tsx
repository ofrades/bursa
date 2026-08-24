import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { AnalysisDiff, FactorDiff } from "../lib/analysis-diff";

function outcomeBadge(diff: AnalysisDiff) {
  switch (diff.callOutcome) {
    case "right":
      return {
        label: "Prior call was right",
        icon: CheckCircle2,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
    case "wrong":
      return {
        label: "Prior call was wrong",
        icon: XCircle,
        className:
          "border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-300",
      };
    default:
      return {
        label: "Prior call was neutral",
        icon: CircleHelp,
        className: "border-border bg-muted text-muted-foreground",
      };
  }
}

function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPrice(v: string | number) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(v);
}

function daysAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function StatCell({
  label,
  from,
  to,
  flipped,
  delta,
  formatter = (v: string | number) => String(v),
}: {
  label: string;
  from: string | number | null;
  to: string | number | null;
  flipped?: boolean;
  delta?: string | null;
  formatter?: (v: string | number) => string;
}) {
  const Arrow =
    delta && delta.startsWith("+")
      ? TrendingUp
      : delta && delta.startsWith("-")
        ? TrendingDown
        : null;
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1.5 text-sm">
        <span className="tabular-nums text-muted-foreground line-through decoration-muted-foreground/40">
          {from == null ? "—" : formatter(from)}
        </span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="font-semibold tabular-nums">{to == null ? "—" : formatter(to)}</span>
        {flipped && (
          <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[10px]">
            Flipped
          </Badge>
        )}
        {!flipped && delta && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
            {Arrow && <Arrow className="size-3" />}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

function FactorList({
  title,
  diff,
  emptyLabel,
  added,
}: {
  title: string;
  diff: FactorDiff;
  emptyLabel: string;
  added: boolean;
}) {
  const items = added ? diff.added : diff.removed;
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground/70 italic">{emptyLabel}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1 text-sm leading-relaxed text-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  added ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnalysisAuditCard({ diff }: { diff: AnalysisDiff }) {
  const outcome = outcomeBadge(diff);
  const OutcomeIcon = outcome.icon;

  const hasFactorChanges =
    diff.bullish.added.length +
      diff.bullish.removed.length +
      diff.bearish.added.length +
      diff.bearish.removed.length >
    0;

  // The "added" list combines new tailwinds + new risks; the "removed" list
  // combines lost tailwinds + risks no longer flagged. This compresses the
  // 4-list layout into 2 lists with no information loss.
  const addedDiff: FactorDiff = {
    added: [...diff.bullish.added, ...diff.bearish.added],
    removed: [],
  };
  const removedDiff: FactorDiff = {
    added: [...diff.bullish.removed, ...diff.bearish.removed],
    removed: [],
  };

  const reflection = diff.priorCallAssessment;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">What changed</p>
            <CardTitle className="mt-1 text-base font-semibold">
              Since the previous run · {daysAgo(diff.olderDate)}
            </CardTitle>
          </div>
          <Badge variant="outline" className={outcome.className}>
            <OutcomeIcon className="size-3.5" />
            {outcome.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Top row: 4 stat cells for the most material changes */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCell
            label="Signal"
            from={diff.signal.from}
            to={diff.signal.to}
            flipped={diff.signal.flipped}
          />
          <StatCell
            label="Conviction"
            from={diff.confidence.from != null ? `${diff.confidence.from}%` : null}
            to={diff.confidence.to != null ? `${diff.confidence.to}%` : null}
            delta={
              diff.confidence.delta != null
                ? `${diff.confidence.delta > 0 ? "+" : ""}${diff.confidence.delta} pts`
                : null
            }
          />
          <StatCell
            label="Long term"
            from={diff.longTerm.from}
            to={diff.longTerm.to}
            flipped={diff.longTerm.changed}
            delta={diff.longTerm.changed ? "shifted" : null}
          />
          <StatCell
            label="Stock"
            from={diff.price.from}
            to={diff.price.to}
            delta={fmtPct(diff.price.pct)}
            formatter={fmtPrice}
          />
        </div>

        {/* Factor diffs: 2 compact lists (added / removed) */}
        {hasFactorChanges && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <FactorList
              title="Added since last run"
              diff={addedDiff}
              emptyLabel="No new factors this run"
              added
            />
            <FactorList
              title="No longer flagged"
              diff={removedDiff}
              emptyLabel="Nothing dropped this run"
              added={false}
            />
          </div>
        )}

        {/* Model's self-assessment of the prior call */}
        {reflection && (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="size-3" />
              <span>Model's reflection on the prior call</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90 text-balance">
              {reflection}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
