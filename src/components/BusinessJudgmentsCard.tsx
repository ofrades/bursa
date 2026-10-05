import { businessJudgmentsSchema } from "../lib/judgments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const labels = {
  RECURRING: "Recurring operations",
  ONE_OFF: "One-off effects",
  MIXED: "Mixed drivers",
  IMPROVING: "Improving",
  STABLE: "Stable",
  WEAKENING: "Weakening",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export function BusinessJudgmentsCard({ reasoning }: { reasoning: string | null }) {
  let judgments;
  try {
    const parsed = businessJudgmentsSchema.safeParse(JSON.parse(reasoning ?? "null")?.judgments);
    if (!parsed.success) return null;
    judgments = parsed.data;
  } catch {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business judgments</CardTitle>
        <CardDescription>
          {judgments.model} · Evidence-based classifications, not return forecasts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Revision drivers", judgments.revisionQuality],
              ["Operating momentum", judgments.businessMomentum],
            ] as const
          ).map(([title, answer]) => (
            <div key={title}>
              <dt className="text-xs text-muted-foreground">{title}</dt>
              <dd className="text-sm font-medium">{labels[answer.value]}</dd>
              <dd className="text-xs text-muted-foreground">
                Judgment confidence: {Math.round(answer.confidence * 100)}%
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Supplied evidence · headlines only, not verified causal attribution
          </p>
          <ul className="space-y-2 text-sm">
            {judgments.evidence.map((item, index) => (
              <li key={`${index}:${item.title}`}>
                {item.url ? (
                  <a className="underline" href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </li>
            ))}
          </ul>
          {judgments.evidence.length === 0 && (
            <p className="text-sm text-muted-foreground">No recent headlines available.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
