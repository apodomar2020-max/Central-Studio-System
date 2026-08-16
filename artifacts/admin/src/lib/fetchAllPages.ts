/**
 * fetchAllPages — Data Tables Enhancement, reference-data safety.
 *
 * Every Ballet catalog endpoint (instructors/classes/groups/schedules) is
 * genuinely paginated server-side (page/limit/total/totalPages), but every
 * *reference* consumer today (Create/Edit form option lists, cross-page
 * "-ref" queries) requests a single `?limit=100` page and treats it as the
 * complete catalog. Confirmed against the local disposable DB before this
 * workstream touched anything: ballet_instructors (115), ballet_groups
 * (115), and ballet_classes (168) already exceed 100 rows — so this is an
 * active truncation bug today, not a hypothetical one, and would only get
 * worse once real display-list pagination ships elsewhere in this same
 * workstream if reference consumers weren't also fixed.
 *
 * This is the "safest existing architecture" fix called for by the plan:
 * keep consuming the same paginated endpoint each caller already uses,
 * just loop through every page instead of assuming page 1 is everything.
 * No new endpoint. Each caller supplies its own already-correct
 * single-page fetcher (same auth headers/base URL it already builds) —
 * this utility only owns the "keep going until totalPages is covered"
 * loop, nothing about auth, URLs, or entity shape.
 */

export interface PagedListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * @param fetchPage Fetches one page given a 1-based page number. Must reuse
 *   the same limit the caller already uses (e.g. 100) so totalPages is
 *   consistent across calls.
 * @param maxPages Hard safety cap on how many pages this will ever request,
 *   independent of what the server reports — guards against a malformed
 *   totalPages value causing an unbounded loop. 50 pages at the existing
 *   100-row limit covers 5,000 rows, comfortably past any real catalog size
 *   for a single studio; raise only with evidence a real catalog needs it.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PagedListResponse<T>>,
  maxPages = 50,
): Promise<T[]> {
  const first = await fetchPage(1);
  const all = [...first.data];
  const totalPages = Math.min(first.totalPages, maxPages);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(page);
    all.push(...next.data);
  }
  return all;
}
