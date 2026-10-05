// Revision-quality classification: a Jev-style typed judgment layer over the
// screen. Deterministic math stays in compute.ts; this asks a small model for
// one structured judgment the numbers can't make — whether the 90-day estimate
// revisions reflect recurring operating momentum or one-offs (M&A, FX, base
// effects, subsidies). Verdicts are advisory flags, never gate inputs.
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { getMarketSummary } from "../market-data";
import { getSecret } from "../../secrets";
import { screenRun, screenStock } from "../schema";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_NEWS = 5;
const CONCURRENCY = 3;

export type RevisionVerdict = {
  classification: "RECURRING" | "ONE_OFF" | "MIXED";
  probability: number;
  rationale: string;
};

const VERDICT_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "revision_quality",
    strict: true,
    schema: {
      type: "object",
      properties: {
        classification: { type: "string", enum: ["RECURRING", "ONE_OFF", "MIXED"] },
        probability: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["classification", "probability", "rationale"],
      additionalProperties: false,
    },
  },
};

export function buildClassifyUserPrompt(
  row: {
    symbol: string;
    name: string;
    region: string | null;
    sector: string | null;
    revAvg: number | null;
    fy1Rev: number | null;
    fy2Rev: number | null;
    sue: number | null;
    upLast30d: number | null;
    downLast30d: number | null;
    mom121: number | null;
  },
  businessSummary: string | null,
  headlines: string[],
): string {
  const metrics = {
    symbol: row.symbol,
    name: row.name,
    region: row.region,
    sector: row.sector,
    revision_90d_fy1: row.fy1Rev,
    revision_90d_fy2: row.fy2Rev,
    revision_90d_avg: row.revAvg,
    earnings_surprise_score: row.sue,
    analyst_up_revisions_30d: row.upLast30d,
    analyst_down_revisions_30d: row.downLast30d,
    momentum_12_1: row.mom121,
  };
  const lines = [
    "Classify what is driving this company's 90-day analyst EPS estimate revisions.",
    "",
    `Metrics: ${JSON.stringify(metrics)}`,
  ];
  if (headlines.length) lines.push(`Recent headlines: ${JSON.stringify(headlines)}`);
  if (businessSummary) {
    lines.push(`Business: ${businessSummary.slice(0, 500)}`);
  }
  lines.push(
    "",
    "RECURRING = demand, pricing power, share gains, margin execution, guidance raises from core operations.",
    "ONE_OFF = M&A, disposals, FX swings, litigation/tax items, subsidies, rebates, base effects, single large orders.",
    "MIXED = clearly both. Judge only from the evidence given; do not speculate beyond it.",
  );
  return lines.join("\n");
}

type VerdictWire = {
  classification?: unknown;
  probability?: unknown;
  rationale?: unknown;
};

const verdictSchema = z.object({
  classification: z.enum(["RECURRING", "ONE_OFF", "MIXED"]),
  probability: z.number(),
  rationale: z.string(),
});

export function parseVerdict(input: VerdictWire): RevisionVerdict | null {
  const parsed = verdictSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    classification: parsed.data.classification,
    probability: Math.min(Math.max(parsed.data.probability, 0), 1),
    rationale: parsed.data.rationale.slice(0, 400),
  };
}

type ChatCompletionsResponse = { choices?: unknown };

const chatCompletionsSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export function extractVerdict(payload: ChatCompletionsResponse): RevisionVerdict | null {
  const envelope = chatCompletionsSchema.safeParse(payload);
  if (!envelope.success) return null;
  try {
    return parseVerdict(JSON.parse(envelope.data.choices[0].message.content));
  } catch {
    return null;
  }
}

async function fetchHeadlines(symbol: string): Promise<string[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=${MAX_NEWS}&quotesCount=0`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const payload = z
      .object({ news: z.array(z.object({ title: z.string() })).default([]) })
      .catch({ news: [] })
      .parse(await res.json());
    return payload.news.map((n) => n.title).slice(0, MAX_NEWS);
  } catch {
    return [];
  }
}

async function classifyOne(
  model: string,
  apiKey: string,
  row: ScreenVerdictRow,
): Promise<RevisionVerdict | null> {
  const [summary, headlines] = await Promise.all([
    getMarketSummary(row.symbol).catch(() => null),
    fetchHeadlines(row.symbol),
  ]);
  const businessSummary = summary?.assetProfile?.longBusinessSummary ?? null;
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: VERDICT_SCHEMA,
      messages: [
        {
          role: "system",
          content:
            "You are a rigorous equity analyst. Given estimate-revision metrics, recent headlines and a business description, judge whether analyst EPS revisions are driven by recurring operating momentum or by one-offs. Answer only with the structured verdict. Keep rationale under 40 words and cite the strongest evidence.",
        },
        { role: "user", content: buildClassifyUserPrompt(row, businessSummary, headlines) },
      ],
    }),
  });
  if (!response.ok) return null;
  return extractVerdict(await response.json());
}

type ScreenVerdictRow = {
  id: string;
  symbol: string;
  name: string;
  region: string | null;
  sector: string | null;
  revAvg: number | null;
  fy1Rev: number | null;
  fy2Rev: number | null;
  sue: number | null;
  upLast30d: number | null;
  downLast30d: number | null;
  mom121: number | null;
};

/** Classifies the strict quintile of the latest done run. Advisory output only. */
export async function classifyLatestRun(
  db: Db,
  options: { all?: boolean } = {},
): Promise<{ classified: number; failed: number; skipped?: string }> {
  const apiKey = await getSecret("OPENROUTER_API_KEY");
  if (!apiKey) return { classified: 0, failed: 0, skipped: "OPENROUTER_API_KEY not configured" };

  const [run] = await db
    .select()
    .from(screenRun)
    .where(eq(screenRun.status, "done"))
    .orderBy(desc(screenRun.runAt))
    .limit(1);
  if (!run) return { classified: 0, failed: 0, skipped: "no completed screen run" };

  const rows = options.all
    ? await db
        .select()
        .from(screenStock)
        .where(
          and(
            eq(screenStock.runId, run.id),
            eq(screenStock.passUniverse, true),
            eq(screenStock.passRevision, true),
            eq(screenStock.passQuality, true),
          ),
        )
    : await db
        .select()
        .from(screenStock)
        .where(and(eq(screenStock.runId, run.id), eq(screenStock.strict, true)));

  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  let classified = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (row): Promise<RevisionVerdict | null> => {
        try {
          return await classifyOne(model, apiKey, row);
        } catch {
          return null;
        }
      }),
    );
    await Promise.all(
      chunk.map((row, j) => {
        const verdict = results[j];
        if (!verdict) {
          failed += 1;
          return Promise.resolve();
        }
        classified += 1;
        return db
          .update(screenStock)
          .set({
            jevVerdict: verdict.classification,
            jevProbability: verdict.probability,
            jevRationale: verdict.rationale,
          })
          .where(eq(screenStock.id, row.id));
      }),
    );
  }
  return { classified, failed };
}
