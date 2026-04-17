import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { addToWatchlist } from "../server/stocks";

type SearchResult = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
};

type Props = {
  onAdded: () => void;
  watchlistSymbols: string[];
};

export function StockSearchBar({ onAdded, watchlistSymbols }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
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
        // Search via Yahoo Finance server function
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
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const handleAdd = async (r: SearchResult) => {
    setAdding(r.symbol);
    try {
      await addToWatchlist({
        data: {
          symbol: r.symbol,
          name: r.shortname ?? r.longname,
          exchange: r.exchDisp,
        },
      });
      onAdded();
      setQuery("");
      setResults([]);
      setOpen(false);
    } finally {
      setAdding(null);
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
          {loading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
        </span>
        <Input
          style={{ paddingLeft: 38 }}
          placeholder="Search stocks — AAPL, Tesla, SPY…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
        />
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>
          {error}
        </p>
      )}
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
          {results.map((r) => {
            const added = watchlistSymbols.includes(r.symbol);
            return (
              <div
                key={r.symbol}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                      {r.symbol.slice(0, 4)}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {r.symbol}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                      {r.shortname ?? r.longname ?? "—"} · {r.exchDisp}
                    </div>
                  </div>
                </div>
                <Button
                  variant={added ? "ghost" : "default"}
                  size="sm"
                  disabled={added || adding === r.symbol}
                  onClick={() => handleAdd(r)}
                >
                  {adding === r.symbol ? (
                    <Loader2 size={12} className="spin" />
                  ) : added ? (
                    "Added"
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
