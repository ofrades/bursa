import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
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
  perfWtd: number | null;
  perfMtd: number | null;
  perfYtd: number | null;
  nextEarningsDate: string | null;
};

function pctColor(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-400" : "text-muted-foreground";
}

function pctStr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
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

export function SharedAnalysisTable({ rows }: { rows: SharedAnalysisRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "updatedAt", desc: true }]);

  const columns = React.useMemo<ColumnDef<SharedAnalysisRow>[]>(
    () => [
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
        accessorKey: "perfWtd",
        header: ({ column }) => <SortableHeader column={column} title="WTD" align="center" />,
        cell: ({ row }) => (
          <div className={`text-center font-semibold ${pctColor(row.original.perfWtd)}`}>
            {pctStr(row.original.perfWtd)}
          </div>
        ),
      },
      {
        accessorKey: "perfMtd",
        header: ({ column }) => <SortableHeader column={column} title="MTD" align="center" />,
        cell: ({ row }) => (
          <div className={`text-center font-semibold ${pctColor(row.original.perfMtd)}`}>
            {pctStr(row.original.perfMtd)}
          </div>
        ),
      },
      {
        accessorKey: "perfYtd",
        header: ({ column }) => <SortableHeader column={column} title="YTD" align="center" />,
        cell: ({ row }) => (
          <div className={`text-center font-semibold ${pctColor(row.original.perfYtd)}`}>
            {pctStr(row.original.perfYtd)}
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
  });

  return (
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
  );
}
