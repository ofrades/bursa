import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Bookmark, Search as SearchIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "#/lib/utils";

import { type Signal, SignalBadge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type SharedAnalysisRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  name: string | null;
  perfDay?: number | null;
  perfWtd?: number | null;
  perfMtd?: number | null;
  isSaved?: boolean;
  isWatching?: boolean;
};

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

export function SharedAnalysisTable({
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
        accessorKey: "signal",
        header: ({ column }) => <SortableHeader column={column} title="Signal" align="center" />,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <SignalBadge signal={row.original.signal as Signal} />
          </div>
        ),
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
      {
        accessorKey: "confidence",
        header: ({ column }) => <SortableHeader column={column} title="Conf." align="center" />,
        cell: ({ row }) => (
          <div className="text-center text-muted-foreground">
            {row.original.confidence != null ? `${row.original.confidence}%` : "—"}
          </div>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: ({ column }) => <SortableHeader column={column} title="Updated" align="center" />,
        sortingFn: (a, b, id) => {
          const av = a.getValue<Date | null>(id);
          const bv = b.getValue<Date | null>(id);
          return (av ? new Date(av).getTime() : 0) - (bv ? new Date(bv).getTime() : 0);
        },
        cell: ({ row }) => (
          <div className="text-center text-muted-foreground">
            {row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleDateString() : "—"}
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
