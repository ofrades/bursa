import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { ExternalServiceError } from "../effect/errors";
import type { Db } from "../db";
import { classifyLatestRun } from "./jev";

const mocks = vi.hoisted(() => ({ key: vi.fn(), evaluate: vi.fn(), news: vi.fn() }));
vi.mock("../../secrets", () => ({ getSecret: mocks.key }));
vi.mock("../../server/jev", () => ({
  evaluateChoices: mocks.evaluate,
  gatherNewsEvidence: mocks.news,
  revisionQuestion: { type: "choice", criteria: { INSUFFICIENT_EVIDENCE: "Missing evidence" } },
}));

function database() {
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const db: Partial<Db> = {
    select: vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: async () => [{ id: "run-1" }] }) }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [
            {
              id: "row-1",
              symbol: "X",
              name: "Example",
              fy1Rev: 0.1,
              fy2Rev: 0.2,
              upLast30d: 4,
              downLast30d: 1,
            },
          ],
        }),
      }),
    update: vi.fn().mockReturnValue({ set }),
  };
  return { db: db as Db, set };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.key.mockResolvedValue("test-key");
  mocks.news.mockResolvedValue([]);
  mocks.evaluate.mockReturnValue(
    Effect.succeed({
      result: { revisionQuality: { value: "INSUFFICIENT_EVIDENCE", probability: 0.95 } },
    }),
  );
});

describe("screen revision judgments", () => {
  it("persists explicit insufficient evidence as an advisory classification, without changing gates", async () => {
    const { db, set } = database();
    expect(await classifyLatestRun(db)).toEqual({ classified: 1, failed: 0 });
    expect(set).toHaveBeenCalledWith({
      jevVerdict: "INSUFFICIENT_EVIDENCE",
      jevProbability: 0.95,
      jevRationale: "Supplied evidence does not identify a revision driver.",
    });
    expect(mocks.key).toHaveBeenCalledWith("OPENROUTER_API_KEY");
    expect(mocks.evaluate.mock.calls[0][0].evidence).toEqual([]);
  });

  it("skips before reading the run if the new credential is missing", async () => {
    mocks.key.mockResolvedValue(undefined);
    const { db } = database();
    expect(await classifyLatestRun(db)).toEqual({
      classified: 0,
      failed: 0,
      skipped: "OPENROUTER_API_KEY not configured",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("counts failed provider calls without fabricating a verdict", async () => {
    mocks.evaluate.mockReturnValue(
      Effect.fail(
        new ExternalServiceError({ service: "openrouter", cause: "provider unavailable" }),
      ),
    );
    const { db, set } = database();
    expect(await classifyLatestRun(db)).toEqual({ classified: 0, failed: 1 });
    expect(set).not.toHaveBeenCalled();
  });
});
