/**
 * editorial-performance-refs — pure helpers for a News article's "Related
 * Performance" list (GET/PUT /admin/editorial/posts/:id/performance-refs).
 *
 * Pure. No React, no imports.
 *
 * The PUT is a FULL REPLACE whose array order is the display order (the
 * server writes `position: item.position ?? index`), exactly like the
 * recommendations PUT — so the payload deliberately omits `position`.
 * Publicly, a native News article lists its News recommendations first and
 * then these Performance refs.
 */

export const PERFORMANCE_REFS_MAX = 20;

export const PERFORMANCE_REFS_CARD_TITLE = "Related Performance";

export const PERFORMANCE_REFS_EXPLANATION =
  "Performances shown as related items on this article, after any recommended News.";

export const PERFORMANCE_REFS_EMPTY_STATE = "No related Performance.";

export const PERFORMANCE_REFS_UNAVAILABLE =
  "The Performance list is not available for your role.";

export const PERFORMANCE_REFS_CAP_MESSAGE = `An article can relate to at most ${PERFORMANCE_REFS_MAX} Performances.`;

export const PERFORMANCE_REFS_SAVE_LABEL = "Save related Performance";

export interface PerformanceOptionLike {
  id: number;
  title: string;
  slug: string;
  isActive: boolean;
}

export function toPerformanceRefsPayload(ids: readonly number[]): { items: Array<{ performanceId: number }> } {
  return { items: [...new Set(ids)].map((performanceId) => ({ performanceId })) };
}

/** Order-sensitive: the array order IS the public order. */
export function arePerformanceRefsDirty(selected: readonly number[], original: readonly number[]): boolean {
  return selected.length !== original.length || selected.some((id, index) => id !== original[index]);
}

export function canAddPerformanceRef(selected: readonly number[]): boolean {
  return selected.length < PERFORMANCE_REFS_MAX;
}

export function addPerformanceRef(selected: readonly number[], id: number): number[] {
  if (selected.includes(id) || !canAddPerformanceRef(selected)) return [...selected];
  return [...selected, id];
}

export function removePerformanceRef(selected: readonly number[], id: number): number[] {
  return selected.filter((current) => current !== id);
}

/** Only ACTIVE Performances can be newly chosen; already-chosen ones are hidden. */
export function performanceCandidates<T extends PerformanceOptionLike>(
  performances: readonly T[],
  selected: readonly number[],
  search: string,
): T[] {
  const needle = search.trim().toLowerCase();
  const taken = new Set(selected);
  return performances.filter(
    (performance) =>
      performance.isActive &&
      !taken.has(performance.id) &&
      (needle.length === 0 ||
        performance.title.toLowerCase().includes(needle) ||
        performance.slug.toLowerCase().includes(needle)),
  );
}

/**
 * A post that came from the earlier News records keeps its public related
 * links from that record, so Performance refs edited here would not show
 * publicly. The editor therefore offers no editable card for such a post.
 */
export function isMigratedPost(post: { migrationSourceTable: string | null }): boolean {
  return post.migrationSourceTable != null;
}
