import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const searchInput = z.object({
  query: z.string().trim().min(1).max(80),
});

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

export const searchStocksYF = createServerFn({ method: "GET" })
  .inputValidator((data) => searchInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const { searchStocks } = await import("../lib/market-data");
    return searchStocks(data.query);
  });
