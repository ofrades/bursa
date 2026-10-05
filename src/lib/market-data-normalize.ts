import { z } from "zod";

const json = z.json();
type JsonValue = z.infer<typeof json>;

// Yahoo REST wraps numeric values in { raw, fmt }; normalize at the boundary.
export function unwrapYahoo(value: JsonValue): JsonValue {
  return z
    .union([
      z.object({ raw: json }).transform((v) => unwrapYahoo(v.raw)),
      z.array(json).transform((v) => v.map(unwrapYahoo)),
      z
        .record(z.string(), json)
        .transform((v) =>
          Object.fromEntries(Object.entries(v).map(([k, item]) => [k, unwrapYahoo(item)])),
        ),
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ])
    .parse(value);
}

// Yahoo encodes unavailable numeric values as {}, as well as null/absent.
const number = z
  .union([
    z.number().finite(),
    z
      .object({})
      .strict()
      .transform(() => null),
  ])
  .nullable()
  .optional();
const text = z.string().nullable().optional();

export const revisionSummarySchema = z.object({
  assetProfile: z.object({ sector: text, longBusinessSummary: text }).nullable().optional(),
  financialData: z
    .object({ numberOfAnalystOpinions: number, financialCurrency: text })
    .nullable()
    .optional(),
  price: z
    .object({ currency: text, marketCap: number, longName: text, shortName: text })
    .nullable()
    .optional(),
  summaryDetail: z.object({ forwardPE: number }).nullable().optional(),
  earningsTrend: z
    .object({
      trend: z
        .array(
          z.object({
            period: text,
            endDate: text,
            epsTrend: z
              .object({
                current: number,
                "30daysAgo": number,
                "90daysAgo": number,
                epsTrendCurrency: text,
              })
              .nullable()
              .optional(),
            earningsEstimate: z.object({ avg: number, yearAgoEps: number }).nullable().optional(),
            growth: number,
            epsRevisions: z
              .object({ upLast30days: number, downLast30days: number })
              .nullable()
              .optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  earningsHistory: z
    .object({
      history: z
        .array(
          z.object({
            quarter: z
              .union([z.string(), z.number(), z.object({ fmt: z.string() })])
              .nullable()
              .optional(),
            epsActual: number,
            epsEstimate: number,
          }),
        )
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const fundamentals = z.object({
  timeseries: z.object({ result: z.array(z.record(z.string(), z.unknown())).nullable() }),
});
const rowsSchema = z.array(
  z.object({
    asOfDate: z.string(),
    dataId: z.number().optional(),
    reportedValue: z.object({ raw: z.number().finite().nullable() }),
  }),
);

type Series = Record<string, { asOfDate: string; reportedValue: { raw: number | null } }[]>;

export function normalizeFundamentals(
  payload: z.input<typeof fundamentals>,
  types: string[],
  dataIds: Record<number, string>,
): Series {
  const parsed = fundamentals.parse(payload);
  const result: Series = Object.fromEntries(types.map((type) => [type, []]));
  for (const entry of parsed.timeseries.result ?? []) {
    for (const [key, value] of Object.entries(entry)) {
      const rows = rowsSchema.safeParse(value);
      if (!rows.success) continue;
      for (const row of rows.data) {
        const type = types.includes(key)
          ? key
          : row.dataId !== undefined
            ? dataIds[row.dataId]
            : undefined;
        const target = type ?? (types.length === 1 ? types[0] : undefined);
        if (target && result[target]) result[target].push(row);
      }
    }
  }
  return result;
}
