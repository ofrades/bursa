import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "#/lib/utils";
import { Button } from "./button";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;

  const getVisiblePages = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = [];
    if (pageCount <= 7) {
      for (let i = 1; i <= pageCount; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (page > 3) pages.push("ellipsis");
    const start = Math.max(2, page - 1);
    const end = Math.min(pageCount - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < pageCount - 2) pages.push("ellipsis");
    pages.push(pageCount);
    return pages;
  };

  const visible = getVisiblePages();

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="h-8 w-8 px-0"
      >
        <ChevronLeft className="size-4" />
      </Button>
      {visible.map((item, i) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${i}`}
            className="flex h-8 w-8 items-center justify-center text-muted-foreground"
          >
            <MoreHorizontal className="size-4" />
          </span>
        ) : (
          <Button
            key={item}
            variant={item === page ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
            className="h-8 min-w-8 px-2"
          >
            {item}
          </Button>
        ),
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="h-8 w-8 px-0"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
