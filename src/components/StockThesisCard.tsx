import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { StockThesis, ThesisPillar, ThesisTone } from "../lib/stock-thesis";

function toneBadgeClasses(tone: ThesisTone) {
  switch (tone) {
    case "supportive":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "cautious":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-300";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

function toneDotClasses(tone: ThesisTone) {
  switch (tone) {
    case "supportive":
      return "bg-emerald-500";
    case "cautious":
      return "bg-red-500";
    default:
      return "bg-amber-500";
  }
}

/**
 * Compact one-line pillar — kept short so all four fit on a single row on
 * desktop, and the conviction/summary don't get pushed below the fold.
 */
function PillarRow({ pillar }: { pillar: ThesisPillar }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${toneDotClasses(pillar.tone)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {pillar.title}
          </p>
          <p className="text-sm font-semibold text-foreground">{pillar.value}</p>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {pillar.summary}
        </p>
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StockThesisCard({ thesis }: { thesis: StockThesis }) {
  const convictionPct = thesis.confidence.adjusted;
  const hasConviction = convictionPct != null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Short-term thesis
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={toneBadgeClasses(thesis.alignment.tone)}>
              {thesis.alignment.value}
            </Badge>
            {hasConviction && (
              <Badge variant="outline" className="tabular-nums">
                {convictionPct}% conviction
                {thesis.confidence.base != null && thesis.confidence.delta !== 0 && (
                  <span className="ml-1.5 text-muted-foreground font-normal">
                    {thesis.confidence.delta > 0 ? "+" : ""}
                    {thesis.confidence.delta} pts
                  </span>
                )}
              </Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">
              {thesis.version}
            </Badge>
          </div>
        </div>
        <CardTitle className="mt-2 text-lg font-semibold leading-relaxed text-balance">
          {thesis.title}
        </CardTitle>
        {thesis.summary && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-balance">
            {thesis.summary}
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PillarRow pillar={thesis.ownability} />
          <PillarRow pillar={thesis.actionability} />
          <PillarRow pillar={thesis.survivability} />
          <PillarRow pillar={thesis.alignment} />
        </div>

        {(thesis.support.length > 0 || thesis.limits.length > 0) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {thesis.support.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  What supports it
                </p>
                <BulletList items={thesis.support} />
              </div>
            )}
            {thesis.limits.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  What limits it
                </p>
                <BulletList items={thesis.limits} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
