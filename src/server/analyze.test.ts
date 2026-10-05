import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import type { Db } from "../lib/db";
import { Database } from "../lib/effect/services/database";
import { Secrets } from "../lib/effect/services/secrets";
import { ExternalServiceError, UnauthorizedError } from "../lib/effect/errors";
import { toResponse } from "../lib/effect/respond";
import { analyzeProgram } from "./analyze";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  snapshot: vi.fn(),
  news: vi.fn(),
  evaluate: vi.fn(),
  save: vi.fn(),
  charge: vi.fn(),
}));
vi.mock("../lib/db", () => ({ getDb: vi.fn() }));
vi.mock("../lib/auth", () => ({ authenticatedUserEffect: mocks.auth }));
vi.mock("../lib/analysis-reservation", () => ({
  reserveAnalysis: mocks.reserve,
  releaseAnalysis: mocks.release,
}));
vi.mock("./recommend", () => ({
  gatherAnalysisSnapshot: mocks.snapshot,
  saveAnalysisDecision: mocks.save,
  chargeUserForUsage: mocks.charge,
}));
vi.mock("./jev", () => ({
  evaluateChoices: mocks.evaluate,
  gatherNewsEvidence: mocks.news,
  revisionQuestion: {},
  momentumQuestion: {},
}));

const layer = Layer.merge(
  Layer.succeed(Database, { db: {} as Db }),
  Layer.succeed(Secrets, {
    get: () => Effect.succeed("test-key"),
    getOrThrow: () => Effect.succeed("test-key"),
  }),
);
const run = (body: string = JSON.stringify({ symbol: "aapl" })) =>
  toResponse(
    analyzeProgram(new Request("http://localhost/api/analyze", { method: "POST", body })).pipe(
      Effect.provide(layer),
    ),
    (response) => response,
  );
const answer = {
  type: "choice",
  value: "INSUFFICIENT_EVIDENCE",
  probability: 1,
  confidence: 1,
  probabilities: { INSUFFICIENT_EVIDENCE: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue(Effect.succeed({ sub: "user-1", isAdmin: false }));
  mocks.reserve.mockResolvedValue({ id: "reservation-1", isAdmin: false });
  mocks.release.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({
    stockData: {
      companyName: "Apple",
      businessSummary: "Consumer electronics",
      earningsEstimateDelta90dPct: 1,
      revenueGrowth: 0.1,
      earningsGrowth: 0.1,
    },
    simpleAnalysis: null,
    dividendData: null,
  });
  mocks.news.mockResolvedValue([]);
  mocks.evaluate.mockReturnValue(
    Effect.succeed({
      result: {
        meta: { model: "typesafe/jev-1.13-20260917" },
        revisionQuality: answer,
        businessMomentum: answer,
      },
      usage: {
        model: "typesafe/jev-1.13-20260917",
        promptTokens: 100,
        completionTokens: 30,
        totalTokens: 130,
        costUsd: 0.0000042,
      },
    }),
  );
  mocks.save.mockResolvedValue("analysis-1");
  mocks.charge.mockResolvedValue({ billedCents: 1 });
});

describe("non-streaming analysis lifecycle", () => {
  it("returns JSON after saving and settling billing, then releases the reservation", async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      analysisId: "analysis-1",
      billing: { billedCents: 1 },
    });
    expect(mocks.save.mock.calls[0][0].symbol).toBe("AAPL");
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.charge.mock.invocationCallOrder[0],
    );
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), "user-1", "reservation-1");
  });

  it("rejects unauthenticated requests before reserving funds", async () => {
    mocks.auth.mockReturnValue(Effect.fail(new UnauthorizedError()));
    expect((await run()).status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([
    "not json",
    JSON.stringify({ symbol: "" }),
    JSON.stringify({ symbol: "AAPL injected instructions" }),
  ])("rejects invalid input %s", async (body) => {
    expect((await run(body)).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ["busy", 409],
    ["rate-limited", 429],
    ["insufficient-funds", 402],
  ])("preserves reservation failure %s", async (failure, status) => {
    mocks.reserve.mockResolvedValue({ failure });
    expect((await run()).status).toBe(status);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("releases funds and does not save or charge on provider failure", async () => {
    mocks.evaluate.mockReturnValue(
      Effect.fail(new ExternalServiceError({ service: "openrouter", cause: "unavailable" })),
    );
    expect((await run()).status).toBe(502);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("does not bill a failed save", async () => {
    mocks.save.mockRejectedValue(new Error("database failed"));
    expect((await run()).status).toBe(502);
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("releases admin reservations without billing", async () => {
    mocks.reserve.mockResolvedValue({ id: "reservation-1", isAdmin: true });
    expect((await run()).status).toBe(200);
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
