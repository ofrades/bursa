import { Badge } from "./ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { StockThesis, ThesisPillar, ThesisTone } from "../lib/stock-thesis";

function toneSurfaceClasses(tone: ThesisTone) {
  switch (tone) {
    case "supportive":
      return "border-emerald-300/70 bg-card dark:border-emerald-800/40";
    case "cautious":
      return "border-red-300/70 bg-card dark:border-red-800/40";
    default:
      return "border-amber-300/70 bg-card dark:border-amber-800/40";
  }
}

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

function deltaLabel(delta: number) {
  if (delta === 0) return "No change from the last run";
  if (delta > 0) return `+${delta} points after cross-checking the business backdrop`;
  return `${delta} points after cross-checking the business backdrop`;
}

function PillarCard({ pillar, titleOverride }: { pillar: ThesisPillar; titleOverride?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {titleOverride ?? pillar.title}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className={`size-2.5 rounded-full ${toneDotClasses(pillar.tone)}`} />
        <p className="text-lg font-semibold text-balance">{pillar.value}</p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{pillar.summary}</p>
    </div>
  );
}

function BulletPanel({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="mt-3 flex flex-col gap-2 pl-4 text-sm leading-relaxed text-muted-foreground list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function StockThesisCard({
  thesis,
  periodLabel,
}: {
  thesis: StockThesis;
  periodLabel?: string;
}) {
  return (
    <Card className={toneSurfaceClasses(thesis.tone)}>
      <CardHeader>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Stock thesis</p>
          {periodLabel ? (
            <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
              {periodLabel}
            </p>
          ) : null}
          <CardTitle className="mt-2 text-2xl font-semibold text-balance md:text-3xl">
            {thesis.title}
          </CardTitle>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {thesis.summary}
          </p>
        </div>
        <CardAction>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Badge variant="outline">{thesis.version}</Badge>
              <Badge variant="outline" className={toneBadgeClasses(thesis.alignment.tone)}>
                {thesis.alignment.value}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Adjusted conviction
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {thesis.confidence.adjusted != null ? `${thesis.confidence.adjusted}%` : "—"}
              </p>
              {thesis.confidence.base != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {deltaLabel(thesis.confidence.delta)}
                </p>
              )}
            </div>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PillarCard pillar={thesis.ownability} />
          <PillarCard
            pillar={thesis.actionability}
            titleOverride={periodLabel ?? thesis.actionability.title}
          />
          <PillarCard pillar={thesis.survivability} />
          <PillarCard pillar={thesis.alignment} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <BulletPanel title="What supports it" items={thesis.support} />
          <BulletPanel title="What limits it" items={thesis.limits} />
        </div>
      </CardContent>
    </Card>
  );
}
