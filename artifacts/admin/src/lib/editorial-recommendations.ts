/**
 * editorial-recommendations — the PURE half of "Recommended reading"
 * (Wave 2.1E).
 *
 * ─── THE DOMAIN, NAMED ACCURATELY ────────────────────────────────────────
 *
 * The table is `editorial_post_relations`, the API is
 * `GET|PUT /admin/editorial/posts/:id/recommendations`, and the only legal
 * relation type is `"recommended"`. The editor-facing name is **Recommended
 * reading**, never "Related posts": the relation is STRICTLY DIRECTIONAL.
 * The read filters `source_post_id` only and the write deletes and reinserts
 * `WHERE source_post_id = ?`, so editing post A's list changes only A → target.
 * Nothing writes the reverse pointer, no endpoint answers "who recommends
 * this post", and cycles are legal and harmless — so this module invents no
 * inbound view and no cycle detection, because the backend shares neither.
 *
 * ─── THE ONLY WRITE IS A FULL REPLACE ────────────────────────────────────
 *
 * There is no add endpoint, no delete endpoint and no reorder endpoint. Every
 * add, remove and move is a LOCAL array edit, and Save sends the whole list
 * once. That is not a stylistic choice: each PUT takes a post row lock, may
 * write a `shared_field_change` revision and always writes an audit row, so a
 * mutation per chip click would pollute history with a revision per click.
 *
 * ─── ORDER IS THE PAYLOAD ────────────────────────────────────────────────
 *
 * The server assigns `position: item.position ?? index`, so array order is
 * authoritative and this module deliberately OMITS `position` — removing a
 * whole class of client bug (gaps, duplicates, off-by-one) by making the
 * server the only thing that assigns positions.
 */
import type {
  EditorialRecommendation,
  ListEditorialPostsParams,
} from "@workspace/api-client-react";

/** The channel union the list endpoint actually accepts — not a bare string. */
export type CandidateChannel = NonNullable<ListEditorialPostsParams["channel"]>;

// ─── Copy ────────────────────────────────────────────────────────────────────

export const RECOMMENDATIONS_CARD_TITLE = "Recommended reading";

export const RECOMMENDATIONS_DIRECTION_EXPLANATION =
  "Posts recommended from this post. It is one-way: adding a post here does not add this post to its list.";

export const RECOMMENDATIONS_EMPTY_STATE = "No recommended posts.";

/**
 * The contract cap is `items.max(20)` on the PUT body. Naming the real number
 * rather than a vague "limit reached" is the same rule blockCapMessage follows.
 */
export const RECOMMENDATIONS_MAX = 20;

export const RECOMMENDATIONS_CAP_MESSAGE =
  `A post can recommend at most ${RECOMMENDATIONS_MAX} other posts. Remove one before adding another.`;

export const RECOMMENDATIONS_SAVE_LABEL = "Save recommended posts";

export const RECOMMENDATIONS_CHANNEL_NOTE =
  "Only posts in the same channel can be recommended, so the search is limited to this post's channel.";

/**
 * Said plainly as a UI convention, because it IS one: the backend imposes no
 * status rule at all on a recommendation target. Claiming otherwise would be
 * inventing a server rule.
 */
export const RECOMMENDATIONS_PUBLISHED_FILTER_NOTE =
  "Showing published posts only. This is a suggestion, not a rule — switch to Any to recommend a post that is not published yet.";

// ─── Labels (§20) ────────────────────────────────────────────────────────────

export interface TargetTranslationLike {
  languageCode: string;
  title: string;
  status: "draft" | "published" | "archived";
}

export interface LanguagePreferenceLike {
  code: string;
  isDefault: boolean;
  displayOrder: number;
}

export const UNTITLED_POST_LABEL = "Untitled post";

/**
 * Reproduces the SERVER's own label preference exactly —
 * `ORDER BY languages.is_default DESC, languages.display_order ASC`, first row
 * wins — so a post's label does not change the moment it is added to the list
 * and the saved chip re-renders from the server's answer.
 *
 * Falls back, in order: the preferred translation, any translation, then the
 * stable `Post #<id>` form the server itself uses for a post with no
 * translation yet. Never blank, never invented.
 */
export function pickTargetLabel(
  postId: number,
  translations: readonly TargetTranslationLike[],
  languages: readonly LanguagePreferenceLike[],
): string {
  if (translations.length === 0) return `Post #${postId}`;
  const rank = new Map(
    languages.map((language) => [
      language.code,
      (language.isDefault ? 0 : 1_000_000) + language.displayOrder,
    ]),
  );
  const ranked = [...translations].sort((a, b) => {
    const left = rank.get(a.languageCode) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.languageCode) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
  const chosen = ranked[0]!;
  return chosen.title.trim().length > 0 ? chosen.title : UNTITLED_POST_LABEL;
}

/**
 * A saved entry renders the server's own `targetTitle` verbatim — it is
 * already the default-language title, and re-deriving it client-side risks
 * disagreeing with the post-detail payload.
 */
export function recommendationLabel(entry: EditorialRecommendation): string {
  return entry.targetTitle.trim().length > 0 ? entry.targetTitle : UNTITLED_POST_LABEL;
}

/**
 * The muted tag explaining why a chip reads in a language the operator is not
 * editing in. Null when the label already came from the open language, or when
 * the server could not attribute it to one.
 */
export function recommendationLanguageTag(
  entry: EditorialRecommendation,
  openLanguageCode: string,
): string | null {
  const code = entry.targetLanguageCode ?? null;
  if (!code || code === openLanguageCode) return null;
  return code;
}

/**
 * The Topics archived-chip pattern, applied to recommendations: an existing
 * entry whose target has since gone unpublished stays visible and removable,
 * annotated with its real state, rather than silently vanishing.
 */
export function targetStateAnnotation(
  translations: readonly TargetTranslationLike[] | undefined,
): string | null {
  if (!translations) return null;
  if (translations.length === 0) return "no translation yet";
  if (translations.some((translation) => translation.status === "published")) return null;
  if (translations.every((translation) => translation.status === "archived")) return "archived";
  return "not published";
}

// ─── Candidate search (§19) ──────────────────────────────────────────────────

export interface CandidateQuery {
  channel: CandidateChannel;
  page: number;
  limit: number;
  search?: string;
  translationStatus?: "published";
}

export const CANDIDATE_PAGE_SIZE = 10;

/**
 * `channel` is ALWAYS sent: the backend enforces the same-channel rule and
 * would answer 400, but the list endpoint knows nothing about the source post,
 * so scoping the picker turns a would-be error into an option that simply
 * never appears.
 *
 * An empty search becomes an ABSENT key rather than an empty string — the
 * same "empty ⇒ absent" rule toPostListQuery follows, because the route's zod
 * schema treats an empty value as a real one.
 */
export function toCandidateQuery(input: {
  channel: CandidateChannel;
  search: string;
  publishedOnly: boolean;
  page?: number;
  limit?: number;
}): CandidateQuery {
  const query: CandidateQuery = {
    channel: input.channel,
    page: input.page ?? 1,
    limit: input.limit ?? CANDIDATE_PAGE_SIZE,
  };
  const search = input.search.trim();
  if (search.length > 0) query.search = search;
  if (input.publishedOnly) query.translationStatus = "published";
  return query;
}

export interface CandidateRowLike {
  post: { id: number };
}

/**
 * The ONLY legitimate client-side exclusion: two ids the operator could never
 * select anyway. This is not a filter pretending to be a search — the search
 * itself is entirely server-side, and nothing here reaches across pages.
 */
export function filterCandidates<T extends CandidateRowLike>(
  rows: readonly T[],
  context: { sourcePostId: number; selected: readonly number[] },
): T[] {
  const taken = new Set<number>(context.selected);
  return rows.filter((row) => row.post.id !== context.sourcePostId && !taken.has(row.post.id));
}

export function candidateCountLabel(count: number, total: number): string {
  if (total === 0) return "No posts match.";
  if (count < total) return `${count} of ${total} matching posts shown — refine the search to narrow it.`;
  return count === 1 ? "1 post matches." : `${count} posts match.`;
}

// ─── Local list editing ──────────────────────────────────────────────────────

export function canAddRecommendation(current: readonly number[]): boolean {
  return current.length < RECOMMENDATIONS_MAX;
}

export function addRecommendation(current: readonly number[], targetPostId: number): number[] {
  if (current.includes(targetPostId)) return [...current];
  if (!canAddRecommendation(current)) return [...current];
  return [...current, targetPostId];
}

export function removeRecommendation(current: readonly number[], targetPostId: number): number[] {
  return current.filter((id) => id !== targetPostId);
}

/** Same semantics as moveBlockUp/moveBlockDown: pure, immutable, no-op at the ends. */
export function moveRecommendationUp(current: readonly number[], index: number): number[] {
  if (index <= 0 || index >= current.length) return [...current];
  const next = [...current];
  const [moved] = next.splice(index, 1);
  next.splice(index - 1, 0, moved!);
  return next;
}

export function moveRecommendationDown(current: readonly number[], index: number): number[] {
  if (index < 0 || index >= current.length - 1) return [...current];
  const next = [...current];
  const [moved] = next.splice(index, 1);
  next.splice(index + 1, 0, moved!);
  return next;
}

export function moveAnnouncement(label: string, index: number, total: number): string {
  return `${label} moved to position ${index + 1} of ${total}.`;
}

// ─── Dirty + payload ─────────────────────────────────────────────────────────

/**
 * ORDER-SENSITIVE on purpose. `position` is a real persisted column and
 * reordering IS a change, so comparing these as sets would let a reorder be
 * silently discarded on navigation.
 */
export function areRecommendationsDirty(
  current: readonly number[],
  baseline: readonly number[],
): boolean {
  if (current.length !== baseline.length) return true;
  return current.some((id, index) => id !== baseline[index]);
}

export function toRecommendationIds(entries: readonly EditorialRecommendation[]): number[] {
  return entries.map((entry) => entry.targetPostId);
}

/**
 * `position` is deliberately ABSENT. The server writes
 * `position: item.position ?? index`, so the array's order is the order, and
 * the client never computes a position it could get wrong.
 */
export function toRecommendationsPayload(
  current: readonly number[],
): { items: Array<{ targetPostId: number }> } {
  return { items: current.map((targetPostId) => ({ targetPostId })) };
}
