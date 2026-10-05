import { z } from "zod";

const resultSchema = z.object({ analysisId: z.string().min(1) });
const errorSchema = z.object({ error: z.string() });

export async function requestAnalysis(symbol: string, signal?: AbortSignal) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error : `Analysis failed (${response.status})`);
  }
  return resultSchema.parse(body);
}
