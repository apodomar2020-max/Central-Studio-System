/**
 * hooks/useDataState.ts
 *
 * Normalizes a React Query result into one of six canonical data states.
 *
 * All data screens should derive their render branch from this hook (or the
 * getDataState() function for non-component contexts) rather than writing
 * ad-hoc combinations of isLoading / isError / data checks.
 *
 * ─── States ───────────────────────────────────────────────────────────────────
 *
 *  initialLoading  First fetch in progress; no data available yet.
 *                  → Render skeleton placeholders.
 *
 *  refreshing      A pull-to-refresh or background refetch is running, but
 *                  the screen already has data from a previous fetch.
 *                  → Keep showing existing data; animate the RefreshControl.
 *
 *  success         Fetch succeeded and data is present (non-empty).
 *                  → Render the list / detail.
 *
 *  empty           Fetch succeeded but the backend returned zero records.
 *                  → Render EmptyState (never show mock/sample data here).
 *
 *  offline         Network unreachable (TypeError from customFetch).
 *                  → Render OfflineState with a Retry button.
 *
 *  error           Server responded with an HTTP error (4xx / 5xx).
 *                  → Render ErrorState with a Retry button.
 */

import { isOfflineError } from "@/services/connectivity";

export type DataState =
  | "initialLoading"
  | "refreshing"
  | "success"
  | "empty"
  | "offline"
  | "error";

export interface DataStateInput<T> {
  /** True while the very first fetch is in progress (no cached data yet). */
  isLoading: boolean;
  /** True while a background refetch or pull-to-refresh is running. */
  isFetching?: boolean;
  isError: boolean;
  error?: unknown;
  data: T | undefined | null;
  /**
   * Optional predicate for the "empty" state.
   * Defaults to: Array.isArray(data) && data.length === 0.
   * Supply your own for objects, paginated responses, etc.
   */
  isEmpty?: (data: T) => boolean;
}

/**
 * Pure function — usable outside React components (e.g., in render helpers).
 */
export function getDataState<T>(opts: DataStateInput<T>): DataState {
  const { isLoading, isFetching, isError, error, data, isEmpty } = opts;

  if (isLoading) return "initialLoading";

  if (isError) {
    return isOfflineError(error) ? "offline" : "error";
  }

  const dataIsEmpty =
    data == null ||
    (isEmpty
      ? isEmpty(data)
      : Array.isArray(data) && (data as unknown[]).length === 0);

  if (dataIsEmpty) return "empty";

  // Data is present. If a background refetch is running, call it "refreshing"
  // so the UI can show the RefreshControl spinner without wiping the list.
  if (isFetching) return "refreshing";

  return "success";
}

/**
 * Hook wrapper — use inside React components.
 * Identical logic to getDataState(); the hook form is provided for symmetry
 * and to allow future optimisations (e.g., memoisation via useMemo).
 */
export function useDataState<T>(opts: DataStateInput<T>): DataState {
  return getDataState(opts);
}
