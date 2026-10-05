import { describe, expect, it } from "vitest";
import { buildClassifyUserPrompt, extractVerdict, parseVerdict } from "./jev";

describe("buildClassifyUserPrompt", () => {
  it("includes metrics, headlines and business summary", () => {
    const prompt = buildClassifyUserPrompt(
      {
        symbol: "RR.L",
        name: "Rolls-Royce",
        region: "EU",
        sector: "Industrials",
        revAvg: 0.15,
        fy1Rev: 0.18,
        fy2Rev: 0.12,
        sue: 2.1,
        upLast30d: 14,
        downLast30d: 1,
        mom121: 0.4,
      },
      "Power systems for aerospace.",
      ["Rolls-Royce raises guidance on strong Trent demand"],
    );
    expect(prompt).toContain('"symbol":"RR.L"');
    expect(prompt).toContain("guidance raises from core operations");
    expect(prompt).toContain("Rolls-Royce raises guidance");
    expect(prompt).toContain("Power systems for aerospace.");
  });

  it("omits empty evidence sections", () => {
    const prompt = buildClassifyUserPrompt(
      {
        symbol: "X",
        name: "X",
        region: null,
        sector: null,
        revAvg: 0.1,
        fy1Rev: 0.1,
        fy2Rev: 0.1,
        sue: null,
        upLast30d: null,
        downLast30d: null,
        mom121: null,
      },
      null,
      [],
    );
    expect(prompt).not.toContain("Recent headlines");
    expect(prompt).not.toContain("Business:");
  });
});

describe("parseVerdict", () => {
  it("accepts a valid verdict and clamps probability", () => {
    const v = parseVerdict({ classification: "RECURRING", probability: 1.7, rationale: "x" });
    expect(v).toEqual({ classification: "RECURRING", probability: 1, rationale: "x" });
  });

  it("rejects unknown classifications and non-numeric probabilities", () => {
    expect(
      parseVerdict({ classification: "SOMETHING", probability: 0.5, rationale: "" }),
    ).toBeNull();
    expect(parseVerdict({ classification: "RECURRING", probability: "high" })).toBeNull();
    expect(parseVerdict({})).toBeNull();
  });
});

describe("extractVerdict", () => {
  it("parses OpenRouter chat completions content", () => {
    const payload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              classification: "ONE_OFF",
              probability: 0.8,
              rationale: "FX-driven.",
            }),
          },
        },
      ],
    };
    expect(extractVerdict(payload)).toEqual({
      classification: "ONE_OFF",
      probability: 0.8,
      rationale: "FX-driven.",
    });
  });

  it("returns null on malformed payloads", () => {
    expect(extractVerdict({ choices: [{ message: { content: "not json" } }] })).toBeNull();
    expect(extractVerdict({})).toBeNull();
  });
});
