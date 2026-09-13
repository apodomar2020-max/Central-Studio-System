/**
 * table-pagination-state — the pure, dependency-free maths behind the shared
 * <TablePagination> footer (Wave 2.1A foundation).
 *
 * Extracted verbatim from the behaviour table-pagination.tsx already shipped
 * (the `paginationRange` window and the Previous/Next disabled conditions), so
 * every existing consumer — Package Orders, Attendance, the Ballet tables, the
 * Finance transactions view, the activity/notification log panels — renders
 * exactly what it rendered before. Extracting it buys two things:
 *   1. the boundary/edge behaviour becomes unit-testable without React;
 *   2. `totalPages` can now be derived from `total` + `pageSize` for callers
 *      whose API returns only a row count (the Editorial list endpoints).
 *
 * No business logic, no entity types — this is generic table plumbing.
 */

export interface TablePaginationStateInput {
  /** 1-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total rows across all pages. */
  total: number;
  /**
   * Total pages, when the API reports it. Omit (or pass null) to derive it
   * from `total` / `pageSize`.
   */
  totalPages?: number | null;
}

export interface TablePaginationState {
  page: number;
  totalPages: number;
  /** 1-based index of the first row shown, or 0 when there are no rows. */
  startItem: number;
  /** 1-based index of the last row shown, or 0 when there are no rows. */
  endItem: number;
  canPrevious: boolean;
  canNext: boolean;
  /** The windowed page numbers to render (first, last, and ±2 around current). */
  pages: number[];
  /** No rows at all. */
  isEmpty: boolean;
  /** Zero or one page — there is nothing to page between. */
  isSinglePage: boolean;
}

/** First page, last page, and a ±2 window around the current page. */
export function paginationRange(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const pages = new Set<number>([1, totalPages]);
  for (let p = currentPage - 2; p <= currentPage + 2; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export function derivedTotalPages(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function buildTablePaginationState({
  page,
  pageSize,
  total,
  totalPages,
}: TablePaginationStateInput): TablePaginationState {
  const resolvedTotalPages =
    totalPages == null ? derivedTotalPages(total, pageSize) : Math.max(0, Math.trunc(totalPages));
  const safePage = Math.max(1, Math.trunc(page) || 1);

  return {
    page: safePage,
    totalPages: resolvedTotalPages,
    startItem: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    endItem: total === 0 ? 0 : Math.min(safePage * pageSize, total),
    canPrevious: safePage > 1,
    canNext: resolvedTotalPages > 0 && safePage < resolvedTotalPages,
    pages: paginationRange(safePage, resolvedTotalPages),
    isEmpty: total === 0 || resolvedTotalPages === 0,
    isSinglePage: resolvedTotalPages <= 1,
  };
}
