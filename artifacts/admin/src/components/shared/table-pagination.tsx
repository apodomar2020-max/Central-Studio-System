/**
 * TablePagination — shared pagination footer for admin tables (Phase 4B).
 *
 * Extracted from the pattern already used inline on the Students/Parents
 * pages (Previous / numbered pages with ellipses / Next + "Showing X–Y of Z").
 * Consumed by Package Orders, Attendance, the Ballet tables, the Finance
 * transactions view and the activity/notification log panels.
 *
 * Wave 2.1A (Editorial Admin foundation) hardened this component in place
 * rather than shipping a second, parallel pagination control:
 *  - the boundary maths moved to the dependency-free ./table-pagination-state
 *    module so it is unit-testable without React;
 *  - `totalPages` became optional — omit it and it is derived from
 *    `total` / `pageSize`, for APIs that report only a row count;
 *  - accessibility: the control is a labelled <nav> landmark, every numbered
 *    page button carries a real "Go to page N" label plus aria-current, and
 *    boundary buttons stay genuinely `disabled` (never disabled-by-styling);
 *  - `hideWhenSinglePage` optionally collapses the pager when there is
 *    nothing to page between. It defaults to `false`, so every pre-existing
 *    consumer renders exactly what it rendered before.
 */
import { Button } from "@/components/ui/button";
import { buildTablePaginationState } from "./table-pagination-state";

export function TablePagination({
  page,
  totalPages,
  total,
  pageSize,
  isLoading = false,
  itemLabel = "items",
  hideWhenSinglePage = false,
  label = "Table pagination",
  onPageChange,
}: {
  page: number;
  /** Total pages from the API. Omit to derive from `total` / `pageSize`. */
  totalPages?: number | null;
  total: number;
  pageSize: number;
  isLoading?: boolean;
  /** Plural noun for the summary line, e.g. "orders". */
  itemLabel?: string;
  /** Collapse the whole control when there are zero or one pages. */
  hideWhenSinglePage?: boolean;
  /** Accessible name for the pagination landmark. */
  label?: string;
  onPageChange: (page: number) => void;
}) {
  const state = buildTablePaginationState({ page, pageSize, total, totalPages });

  if (hideWhenSinglePage && state.isSinglePage) return null;

  const pages = state.pages;

  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm text-muted-foreground" data-testid="pagination-summary">
        Showing {state.startItem}–{state.endItem} of {total.toLocaleString()} {itemLabel}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!state.canPrevious || isLoading}
          onClick={() => onPageChange(Math.max(1, state.page - 1))}
          data-testid="pagination-previous"
        >
          Previous
        </Button>
        <div className="flex flex-wrap items-center gap-1">
          {pages.map((p, index) => {
            const previous = pages[index - 1];
            return (
              <div key={p} className="flex items-center gap-1">
                {previous != null && p - previous > 1 && (
                  <span className="px-1 text-sm text-muted-foreground" aria-hidden="true">...</span>
                )}
                <Button
                  type="button"
                  variant={p === state.page ? "default" : "outline"}
                  size="sm"
                  className="h-8 min-w-8 px-2"
                  aria-label={`Go to page ${p}`}
                  aria-current={p === state.page ? "page" : undefined}
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
          disabled={!state.canNext || isLoading}
          onClick={() => onPageChange(Math.min(state.totalPages, state.page + 1))}
          data-testid="pagination-next"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
