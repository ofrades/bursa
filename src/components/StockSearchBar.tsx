import { useEffect, useRef, useState } from "react";
import { Bookmark, Loader2, Search as SearchIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import { Input } from "./ui/input";
import { saveStock, unsaveStock, watchStock, unwatchStock } from "../server/stocks";

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

type TrackedStock = {
  symbol: string;
  isSaved: boolean;
  isWatching: boolean;
};

type Props = {
  onChanged: () => void | Promise<void>;
  trackedStocks: TrackedStock[];
};

export function StockSearchBar({ onChanged, trackedStocks }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { searchStocksYF } = await import("../server/search");
        const res = await searchStocksYF({ data: { query: query.trim() } });
        setResults(res as SearchResult[]);
        setOpen((res as SearchResult[]).length > 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [query]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const trackedBySymbol = new Map(trackedStocks.map((stock) => [stock.symbol, stock]));

  const handleSaveToggle = async (result: SearchResult) => {
    const state = trackedBySymbol.get(result.symbol);
    setMutating(`save:${result.symbol}`);
    try {
      if (state?.isWatching) {
        await unwatchStock({ data: { symbol: result.symbol } });
      } else if (state?.isSaved) {
        await unsaveStock({ data: { symbol: result.symbol } });
      } else {
        await saveStock({
          data: {
            symbol: result.symbol,
            name: result.shortname ?? result.longname,
            exchange: result.exchDisp,
          },
        });
      }
      await onChanged();
    } finally {
      setMutating(null);
    }
  };

  const handleWatchToggle = async (result: SearchResult) => {
    const state = trackedBySymbol.get(result.symbol);
    setMutating(`watch:${result.symbol}`);
    try {
      if (state?.isWatching) {
        await unwatchStock({ data: { symbol: result.symbol } });
      } else {
        await watchStock({
          data: {
            symbol: result.symbol,
            name: result.shortname ?? result.longname,
            exchange: result.exchDisp,
          },
        });
      }
      await onChanged();
    } finally {
      setMutating(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 520 }}>
      <div style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--fg-subtle)",
            display: "flex",
            pointerEvents: "none",
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <SearchIcon size={15} />}
        </span>
        <Input
          style={{ paddingLeft: 38 }}
          placeholder="Search stocks — save or watch AAPL, Tesla, SPY…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
        />
      </div>
      {error && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{error}</p>}
      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            overflow: "hidden",
          }}
        >
          {results.map((result) => {
            const state = trackedBySymbol.get(result.symbol);
            const isSaved = !!state?.isSaved;
            const isWatching = !!state?.isWatching;
            const isSavedOnly = isSaved && !isWatching;
            const saveLabel = isWatching
              ? "Set to saved"
              : isSaved
                ? "Remove from saved"
                : "Save stock";
            const isBusy = mutating?.endsWith(`:${result.symbol}`) ?? false;

            return (
              <div
                key={result.symbol}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "var(--bg-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--fg-muted)",
                      }}
                    >
                      {result.symbol.slice(0, 4)}
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{result.symbol}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                      {result.shortname ?? result.longname ?? "—"} · {result.exchDisp}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    title={saveLabel}
                    aria-label={saveLabel}
                    disabled={isBusy}
                    onClick={() => handleSaveToggle(result)}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 cursor-pointer",
                      isSavedOnly
                        ? "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-400"
                        : isWatching
                          ? "border-transparent text-amber-500/70 hover:bg-accent hover:text-amber-500"
                          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {mutating === `save:${result.symbol}` ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Bookmark size={15} fill={isSavedOnly ? "currentColor" : "none"} />
                    )}
                  </button>
                  <button
                    type="button"
                    title={isWatching ? "Stop watching" : "Start watching"}
                    aria-label={isWatching ? "Stop watching" : "Start watching"}
                    disabled={isBusy}
                    onClick={() => handleWatchToggle(result)}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 cursor-pointer",
                      isWatching
                        ? "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-400"
                        : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {mutating === `watch:${result.symbol}` ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <SearchIcon size={15} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
