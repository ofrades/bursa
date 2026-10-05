import { afterEach, expect, it, vi } from "vitest";
import { requestAnalysis } from "./analyze-client";

afterEach(() => vi.unstubAllGlobals());

it("makes one normal JSON request and waits for a saved analysis id", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ analysisId: "saved-1" }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await requestAnalysis("AAPL")).toEqual({ analysisId: "saved-1" });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyze",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ symbol: "AAPL" }) }),
  );
});

it("surfaces server errors rather than silently refreshing", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ error: "Insufficient wallet balance" }, { status: 402 })),
  );
  await expect(requestAnalysis("AAPL")).rejects.toThrow("Insufficient wallet balance");
});

it("rejects success responses without a persisted id", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  await expect(requestAnalysis("AAPL")).rejects.toThrow();
});
