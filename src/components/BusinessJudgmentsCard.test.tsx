import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessJudgmentsCard } from "./BusinessJudgmentsCard";

describe("business judgment cards", () => {
  it("renders explicit uncertainty and source links, not a generated transcript", () => {
    const answer = {
      type: "choice",
      value: "INSUFFICIENT_EVIDENCE",
      probability: 0.9,
      confidence: 0.8,
      probabilities: { INSUFFICIENT_EVIDENCE: 0.9 },
    };
    const reasoning = JSON.stringify({
      judgments: {
        model: "typesafe/jev-1.13-20260917",
        revisionQuality: answer,
        businessMomentum: answer,
        evidence: [{ title: "Example quarterly results", url: "https://example.com/results" }],
      },
    });
    const html = renderToStaticMarkup(<BusinessJudgmentsCard reasoning={reasoning} />);
    expect(html).toContain("Insufficient evidence");
    expect(html).toContain("not return forecasts");
    expect(html).toContain('href="https://example.com/results"');
    expect(html).not.toContain("probabilities");
  });

  it("does not invent decisions when saved judgment data is absent or malformed", () => {
    expect(renderToStaticMarkup(<BusinessJudgmentsCard reasoning={null} />)).toBe("");
    expect(renderToStaticMarkup(<BusinessJudgmentsCard reasoning="not json" />)).toBe("");
  });
});
