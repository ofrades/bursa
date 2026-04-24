import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Star } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "#/lib/utils";

import { type Signal, SignalBadge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Pagination } from "./ui/pagination";

export type SharedAnalysisRow = {
  symbol: string;
  signal: string;
  confidence: number | null;
  updatedAt: Date | null;
  name: string | null;
  isSaved?: boolean;
};

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
        "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
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
  savingSymbol,
  pageSize = 10,
}: {
  rows: SharedAnalysisRow[];
  onToggleSave?: (symbol: string, isSaved: boolean) => void;
  savingSymbol?: string | null;
  pageSize?: number;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: onToggleSave ? "favorite" : "updatedAt", desc: true },
  ]);

  const columns = React.useMemo<ColumnDef<SharedAnalysisRow>[]>(
    () => [
      ...(onToggleSave
        ? [
            {
              id: "favorite",
              header: ({ column }: { column: any }) => (
                <SortableHeader column={column} title="" align="center" />
              ),
              cell: ({ row }: { row: any }) => (
                <div className="flex justify-center">
                  <button
                    className="cursor-pointer disabled:opacity-50"
                    disabled={savingSymbol === row.original.symbol}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleSave?.(row.original.symbol, !!row.original.isSaved);
                    }}
                  >
                    <Star
                      size={16}
                      className={cn(
                        row.original.isSaved
                          ? "text-amber-400"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      fill={row.original.isSaved ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              ),
              sortingFn: (a: any, b: any) => {
                return (b.original.isSaved ? 1 : 0) - (a.original.isSaved ? 1 : 0);
              },
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
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <div className="flex flex-col gap-4">
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
      <Pagination
        page={currentPage}
        pageCount={pageCount}
        onPageChange={(p) => table.setPageIndex(p - 1)}
      />
    </div>
  );
}
