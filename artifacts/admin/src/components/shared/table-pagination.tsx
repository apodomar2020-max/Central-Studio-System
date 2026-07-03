/**
 * TablePagination — shared pagination footer for admin tables (Phase 4B).
 *
 * Extracted from the pattern already used inline on the Students/Parents
 * pages (Previous / numbered pages with ellipses / Next + "Showing X–Y of Z").
 * Currently consumed by Package Orders; other tables can adopt it later
 * without visual change.
 */
import { Button } from "@/components/ui/button";

function paginationRange(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const pages = new Set<number>([1, totalPages]);
  for (let p = currentPage - 2; p <= currentPage + 2; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export function TablePagination({
  page,
  totalPages,
  total,
  pageSize,
  isLoading = false,
  itemLabel = "items",
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  isLoading?: boolean;
  /** Plural noun for the summary line, e.g. "orders". */
  itemLabel?: string;
  onPageChange: (page: number) => void;
}) {
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = total === 0 ? 0 : Math.min(page * pageSize, total);
  const pages = paginationRange(page, totalPages);

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground" data-testid="pagination-summary">
        Showing {startItem}–{endItem} of {total.toLocaleString()} {itemLabel}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1 || isLoading}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          data-testid="pagination-previous"
        >
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {pages.map((p, index) => {
            const previous = pages[index - 1];
            return (
              <div key={p} className="flex items-center gap-1">
                {previous != null && p - previous > 1 && (
                  <span className="px-1 text-sm text-muted-foreground">...</span>
                )}
                <Button
                  type="button"
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="h-8 min-w-8 px-2"
                  disabled={isLoading}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={totalPages === 0 || page >= totalPages || isLoading}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          data-testid="pagination-next"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
