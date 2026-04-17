import { createServerFn } from "@tanstack/react-start";

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

export const searchStocksYF = createServerFn({ method: "GET" })
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const res = (await yf.search(data.query, { quotesCount: 8, newsCount: 0 })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (res.quotes as any[]).filter(
      (q) => q.quoteType === "EQUITY" || q.quoteType === "ETF",
    ) as SearchResult[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  });
