import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { Secrets } from "../lib/effect/services/secrets";
import { NotConfiguredError } from "../lib/effect/errors";
import { evaluateChoices, revisionQuestion } from "./jev";

const secrets = Layer.succeed(Secrets, {
  get: () => Effect.succeed("test-key"),
  getOrThrow: () => Effect.succeed("test-key"),
});
const response = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    revisionQuality: {
      type: "choice",
      choice: "RECURRING",
      confidence: 0.8,
      probabilities: { RECURRING: 0.9, ONE_OFF: 0.03, MIXED: 0.02, INSUFFICIENT_EVIDENCE: 0.05 },
    },
  },
  usage: { input_tokens: 1000, output_tokens: 30, cost: 0.000037 },
};
const run = () =>
  Effect.runPromise(
    evaluateChoices(
      { evidence: ["Raised guidance on stronger demand"] },
      { revisionQuality: revisionQuestion },
    ).pipe(Effect.provide(secrets)),
  );

afterEach(() => vi.unstubAllGlobals());

describe("Jev decision adapter", () => {
  it("uses OpenRouter decisions with mapped answers and provider-reported billing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    const { result, usage } = await run();
    expect(result.revisionQuality.value).toBe("RECURRING");
    expect(result.revisionQuality.probability).toBe(0.9);
    expect(usage).toEqual({
      model: "typesafe/jev-1.13-20260917",
      promptTokens: 1000,
      completionTokens: 30,
      totalTokens: 1030,
      costUsd: 0.000037,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.questions.revisionQuality.type).toBe("choice");
    expect(body.questions.revisionQuality.criteria).toHaveProperty("INSUFFICIENT_EVIDENCE");
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("stream");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not call a provider when credentials are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const missing = Layer.succeed(Secrets, {
      get: () => Effect.sync(() => undefined),
      getOrThrow: () => Effect.fail(new NotConfiguredError({ setting: "OPENROUTER_API_KEY" })),
    });
    await expect(
      Effect.runPromise(
        evaluateChoices({}, { revisionQuality: revisionQuestion }).pipe(Effect.provide(missing)),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 429, 529])("surfaces provider HTTP %s without a model fallback", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider error", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(run()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid probabilities instead of clamping them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...response,
          answers: { revisionQuality: { ...response.answers.revisionQuality, confidence: 1.7 } },
        }),
      ),
    );
    await expect(run()).rejects.toThrow();
  });

  it("rejects missing cost rather than estimating a charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...response, usage: { input_tokens: 1000, output_tokens: 30 } }),
        ),
    );
    await expect(run()).rejects.toThrow();
  });
});
