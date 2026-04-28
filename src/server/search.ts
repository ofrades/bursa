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
    const { searchStocks } = await import("../lib/market-data");
    return searchStocks(data.query);
  });
