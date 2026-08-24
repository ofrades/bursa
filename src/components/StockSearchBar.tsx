import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import { Input } from "./ui/input";
import { watchStock } from "../server/stocks";

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  onChanged?: () => void | Promise<void>;
  existingSymbols?: string[];
  maxWidth?: number | string;
  mode?: "full" | "guest";
  placeholder?: string;
};

export function StockSearchBar({
  query,
  onQueryChange,
  onChanged,
  existingSymbols = [],
  maxWidth = 520,
  mode = "full",
  placeholder = "Filter your table or add a stock…",
}: Props) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (mode !== "full") {
      setResults([]);
      setLoading(false);
      setError(null);
      setDropdownOpen(false);
      return;
    }

    if (!debouncedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      setDropdownOpen(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const { searchStocksYF } = await import("../server/search");
        const res = (await searchStocksYF({ data: { query: debouncedQuery } })) as SearchResult[];
        if (cancelled) return;
        setResults(res);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, mode]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const existingSymbolsSet = useMemo(() => new Set(existingSymbols), [existingSymbols]);
  const addableResults = useMemo(
    () => results.filter((result) => !existingSymbolsSet.has(result.symbol)).slice(0, 6),
    [existingSymbolsSet, results],
  );
  const shouldShowDropdown =
    mode === "full" &&
    dropdownOpen &&
    query.trim().length > 0 &&
    (loading || addableResults.length > 0 || !!error);

  useEffect(() => {
    if (!addableResults.length && !loading && !error) {
      setDropdownOpen(false);
    }
  }, [addableResults.length, error, loading]);

  const handleSelectResult = async (result: SearchResult) => {
    setMutating(result.symbol);
    try {
      await watchStock({
        data: {
          symbol: result.symbol,
          name: result.shortname ?? result.longname,
          exchange: result.exchDisp,
        },
      });
      await onChanged?.();
      setDropdownOpen(false);
    } finally {
      setMutating(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ width: "100%", maxWidth, position: "relative" }}>
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
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            if (mode === "full") setDropdownOpen(true);
          }}
          onFocus={() => {
            if (mode === "full" && query.trim()) setDropdownOpen(true);
          }}
          autoComplete="off"
        />
      </div>

      {shouldShowDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {error ? (
            <div className="px-3 py-2 text-sm text-destructive">{error}</div>
          ) : loading && addableResults.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="spin" />
              Searching market…
            </div>
          ) : addableResults.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No new market matches.</div>
          ) : (
            <>
              <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Add from market
              </div>
              <div className="max-h-80 overflow-y-auto">
                {addableResults.map((result, index) => {
                  const isBusy = mutating === result.symbol;

                  return (
                    <button
                      key={result.symbol}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleSelectResult(result)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50 cursor-pointer",
                        index !== addableResults.length - 1 && "border-b border-border",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{result.symbol}</span>
                          {result.exchDisp && (
                            <span className="text-[11px] text-muted-foreground">
                              {result.exchDisp}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {result.shortname ?? result.longname ?? "—"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                        <span>Add to watchlist</span>
                        {isBusy ? <Loader2 size={13} className="spin" /> : <SearchIcon size={13} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
