import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Bookmark,
  Check,
  RefreshCcw,
  Search as SearchIcon,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "#/lib/utils";

import { LongTermBadge, SignalBadge, type Signal } from "./ui/badge";
import {
  getLongTermRecommendationFromJson,
  getWeeklyRecommendationDisplay,
} from "../lib/recommendation-labels";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type SharedAnalysisRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  reasoning?: string | null;
  thesisJson?: string | null;
  macroThesisJson?: string | null;
  name: string | null;
  perfDay?: number | null;
  perfWtd?: number | null;
  perfMtd?: number | null;
  isSaved?: boolean;
  isWatching?: boolean;
};

const ANALYSIS_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

type AnalysisStatus = "missing" | "stale" | "recent";

function formatPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function changeTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "text-muted-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

function getStateRank(row: SharedAnalysisRow) {
  if (row.isWatching) return 2;
  if (row.isSaved) return 1;
  return 0;
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined) {
  return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);
}

function getSignalRank(signal: string) {
  if (signal === "BUY" || signal === "STRONG_BUY") return 2;
  if (signal === "WAIT" || signal === "HOLD") return 1;
  if (signal === "SELL" || signal === "STRONG_SELL") return 0;
  return -1;
}

function getAnalysisTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getAnalysisStatus(row: SharedAnalysisRow): AnalysisStatus {
  const time = getAnalysisTime(row.updatedAt);
  if (time == null) return "missing";
  return Date.now() - time >= ANALYSIS_FRESH_MS ? "stale" : "recent";
}

function getAnalysisRank(row: SharedAnalysisRow) {
  const status = getAnalysisStatus(row);
  if (status === "recent") return 2;
  if (status === "stale") return 1;
  return 0;
}

function formatAnalysisDate(value: Date | string | null | undefined) {
  const time = getAnalysisTime(value);
  if (time == null) return "—";
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function analyzeHref(symbol: string) {
  return `/${symbol}?analyze=1`;
}

function SortableHeader({
  column,
  title,
  align = "left",
}: {
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
  title: string;
  align?: "left" | "center";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground cursor-pointer",
        align === "center" && "mx-auto",
      )}
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown className="size-3" />
    </button>
  );
}

function AnalysisCell({
  row,
  canTriggerAnalysis,
}: {
  row: SharedAnalysisRow;
  canTriggerAnalysis: boolean;
}) {
  const status = getAnalysisStatus(row);
  const dateLabel = formatAnalysisDate(row.updatedAt);

  if (status === "missing") {
    return (
      <div className="flex justify-center">
        {canTriggerAnalysis ? (
          <Button asChild size="icon-xs" variant="outline" className="cursor-pointer">
            <a
              href={analyzeHref(row.symbol)}
              title="Start analysis"
              aria-label={`Start analysis for ${row.symbol}`}
            >
              <Sparkles className="size-3.5" />
            </a>
          </Button>
        ) : (
          <Sparkles className="size-3.5 text-muted-foreground/50" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (status === "stale") {
    return (
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-xs text-muted-foreground tabular-nums">{dateLabel}</span>
        {canTriggerAnalysis ? (
          <Button asChild size="icon-xs" variant="outline" className="cursor-pointer">
            <a
              href={analyzeHref(row.symbol)}
              title="Analyze again"
              aria-label={`Analyze ${row.symbol} again`}
            >
              <RefreshCcw className="size-3.5" />
            </a>
          </Button>
        ) : (
          <RefreshCcw className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-xs text-muted-foreground tabular-nums">{dateLabel}</span>
      <span
        className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        title="Analysis is fresh"
        aria-label="Analysis is fresh"
      >
        <Check className="size-3" />
      </span>
    </div>
  );
}

function SharedAnalysisTable({
  rows,
  onToggleSave,
  onToggleWatch,
  mutatingKey,
}: {
  rows: SharedAnalysisRow[];
  onToggleSave?: (row: SharedAnalysisRow) => void;
  onToggleWatch?: (row: SharedAnalysisRow) => void;
  mutatingKey?: string | null;
}) {
  const hasStateControls = !!onToggleSave || !!onToggleWatch;
  const [sorting, setSorting] = React.useState<SortingState>(
    hasStateControls
      ? [
          { id: "state", desc: true },
          { id: "updatedAt", desc: true },
        ]
      : [{ id: "updatedAt", desc: true }],
  );

  const columns = React.useMemo<ColumnDef<SharedAnalysisRow>[]>(
    () => [
      ...(hasStateControls
        ? [
            {
              id: "state",
              header: ({ column }: { column: any }) => (
                <SortableHeader column={column} title="State" align="center" />
              ),
              cell: ({ row }: { row: any }) => {
                const rowData = row.original as SharedAnalysisRow;
                const isBusy = mutatingKey?.endsWith(`:${rowData.symbol}`) ?? false;

                const isSavedOnly = !!rowData.isSaved && !rowData.isWatching;
                const saveLabel = rowData.isWatching
                  ? "Set to saved"
                  : rowData.isSaved
                    ? "Remove from saved"
                    : "Save stock";

                return (
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      title={saveLabel}
                      aria-label={saveLabel}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 cursor-pointer",
                        isSavedOnly
                          ? "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-400"
                          : rowData.isWatching
                            ? "border-transparent text-amber-500/70 hover:bg-accent hover:text-amber-500"
                            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      disabled={isBusy}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleSave?.(rowData);
                      }}
                    >
                      <Bookmark
                        size={15}
                        fill={isSavedOnly ? "currentColor" : "none"}
                        className={isSavedOnly ? "" : "opacity-80"}
                      />
                    </button>
                    <button
                      type="button"
                      title={rowData.isWatching ? "Stop watching" : "Start watching"}
                      aria-label={rowData.isWatching ? "Stop watching" : "Start watching"}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 cursor-pointer",
                        rowData.isWatching
                          ? "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-400"
                          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      disabled={isBusy}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleWatch?.(rowData);
                      }}
                    >
                      <SearchIcon size={15} />
                    </button>
                  </div>
                );
              },
              sortingFn: (a: any, b: any) => getStateRank(a.original) - getStateRank(b.original),
            } as ColumnDef<SharedAnalysisRow>,
          ]
        : []),
      {
        accessorKey: "symbol",
        header: ({ column }) => <SortableHeader column={column} title="Symbol" />,
        cell: ({ row }) => (
          <Link
            to="/$symbol"
            params={{ symbol: row.original.symbol }}
            className="flex items-center gap-3 text-inherit no-underline"
          >
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
              {row.original.symbol.slice(0, 4)}
            </div>
            <div className="min-w-0">
              <div className="font-semibold">{row.original.symbol}</div>
              <div className="truncate text-xs text-muted-foreground">
                {row.original.name ?? "—"}
              </div>
            </div>
          </Link>
        ),
      },
      {
        id: "updatedAt",
        accessorFn: (row) => getAnalysisTime(row.updatedAt) ?? 0,
        header: ({ column }) => <SortableHeader column={column} title="Analysis" align="center" />,
        sortingFn: (a, b) => {
          const rankDelta = getAnalysisRank(a.original) - getAnalysisRank(b.original);
          if (rankDelta !== 0) return rankDelta;
          return (
            (getAnalysisTime(a.original.updatedAt) ?? 0) -
            (getAnalysisTime(b.original.updatedAt) ?? 0)
          );
        },
        cell: ({ row }) => (
          <AnalysisCell row={row.original} canTriggerAnalysis={hasStateControls} />
        ),
      },
      {
        id: "signal",
        accessorFn: (row) =>
          getWeeklyRecommendationDisplay(row.reasoning ?? null, row.signal, row.confidence).value,
        header: ({ column }) => <SortableHeader column={column} title="Weekly" align="center" />,
        sortingFn: (a, b) => {
          const aWeekly = getWeeklyRecommendationDisplay(
            a.original.reasoning ?? null,
            a.original.signal,
            a.original.confidence,
          );
          const bWeekly = getWeeklyRecommendationDisplay(
            b.original.reasoning ?? null,
            b.original.signal,
            b.original.confidence,
          );
          const rankDelta = getSignalRank(aWeekly.value) - getSignalRank(bWeekly.value);
          if (rankDelta !== 0) return rankDelta;
          return compareNullableNumber(a.original.confidence, b.original.confidence);
        },
        cell: ({ row }) => {
          const weekly = getWeeklyRecommendationDisplay(
            row.original.reasoning ?? null,
            row.original.signal,
            row.original.confidence,
          );
          return (
            <div className="flex flex-col items-center gap-0.5 text-center">
              <SignalBadge signal={weekly.value as Signal} />
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {weekly.confidence != null ? `${Math.round(weekly.confidence)}% conf` : "—"}
              </span>
            </div>
          );
        },
      },
      {
        id: "longTerm",
        accessorFn: (row) => {
          const lt = getLongTermRecommendationFromJson(
            row.thesisJson ?? null,
            row.macroThesisJson ?? null,
          );
          return lt?.value ?? null;
        },
        header: ({ column }) => <SortableHeader column={column} title="Long term" align="center" />,
        sortingFn: (a, b) => {
          const rank: Record<string, number> = { Own: 2, "Maybe own": 1, Avoid: 0 };
          const aVal = getLongTermRecommendationFromJson(
            a.original.thesisJson ?? null,
            a.original.macroThesisJson ?? null,
          )?.value;
          const bVal = getLongTermRecommendationFromJson(
            b.original.thesisJson ?? null,
            b.original.macroThesisJson ?? null,
          )?.value;
          return (rank[aVal ?? ""] ?? -1) - (rank[bVal ?? ""] ?? -1);
        },
        cell: ({ row }) => {
          const longTerm = getLongTermRecommendationFromJson(
            row.original.thesisJson ?? null,
            row.original.macroThesisJson ?? null,
          );
          if (!longTerm) {
            return <span className="text-[11px] text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-col items-center gap-0.5 text-center">
              <LongTermBadge stance={longTerm.value} />
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {longTerm.confidence != null ? `${Math.round(longTerm.confidence)}% conf` : "—"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "perfDay",
        header: ({ column }) => <SortableHeader column={column} title="Day" align="center" />,
        sortingFn: (a, b, id) =>
          compareNullableNumber(a.getValue<number | null>(id), b.getValue<number | null>(id)),
        cell: ({ row }) => (
          <div
            className={cn("text-center font-medium tabular-nums", changeTone(row.original.perfDay))}
          >
            {formatPct(row.original.perfDay)}
          </div>
        ),
      },
      {
        accessorKey: "perfWtd",
        header: ({ column }) => <SortableHeader column={column} title="Week" align="center" />,
        sortingFn: (a, b, id) =>
          compareNullableNumber(a.getValue<number | null>(id), b.getValue<number | null>(id)),
        cell: ({ row }) => (
          <div
            className={cn("text-center font-medium tabular-nums", changeTone(row.original.perfWtd))}
          >
            {formatPct(row.original.perfWtd)}
          </div>
        ),
      },
      {
        accessorKey: "perfMtd",
        header: ({ column }) => <SortableHeader column={column} title="Month" align="center" />,
        sortingFn: (a, b, id) =>
          compareNullableNumber(a.getValue<number | null>(id), b.getValue<number | null>(id)),
        cell: ({ row }) => (
          <div
            className={cn("text-center font-medium tabular-nums", changeTone(row.original.perfMtd))}
          >
            {formatPct(row.original.perfMtd)}
          </div>
        ),
      },
    ],
    [hasStateControls, mutatingKey, onToggleSave, onToggleWatch],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        {rows.length === 0
          ? "No results"
          : `${rows.length} ${rows.length === 1 ? "stock" : "stocks"}`}
      </div>
    </div>
  );
}

export { SharedAnalysisTable };
