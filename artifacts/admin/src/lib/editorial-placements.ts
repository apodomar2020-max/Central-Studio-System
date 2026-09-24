/**
 * editorial-placements — the PURE half of Website → Editorial → Placements
 * (Final Editorial, Phase A).
 *
 * Pure: no React, no imports beyond generated types. Same shape as
 * `lib/editorial-recommendations.ts`, which this module deliberately
 * mirrors — Placements and Recommended reading are the SAME contract shape
 * (a channel-scoped, server-backed candidate search feeding an ordered list
 * that is written by one replace-on-Save PUT), so they get the same
 * vocabulary rather than two dialects.
 *
 * ─── A SLOT IS (channel, key), NEVER key ALONE ───────────────────────────
 *
 * Verified in source, not assumed:
 *   lib/db/src/schema/editorialPlacements.ts
 *       UNIQUE (channel, key, post_id); index (channel, key, position);
 *       `key` is FREE TEXT with only a "not blank" CHECK.
 *   artifacts/api-server/src/routes/adminEditorial.ts
 *       GET /admin/editorial/placements?channel&key   website.posts:view
 *       PUT /admin/editorial/placements?key  body {channel, items}
 *                                                    website.posts:edit
 *   artifacts/api-server/src/lib/editorialPostsService.ts
 *       replacePlacement() DELETEs on (channel, key) then reinserts.
 *       assertPlacementValid() rejects a duplicate post, a missing post,
 *       and a post whose channel differs from the placement's.
 *
 * `key` IS OPERATOR-DEFINED FREE TEXT. There is no enum, no table of slot
 * names and no migration behind a new slot — that is the explicit design
 * ("`key` is free text rather than an enum so a new slot never needs a
 * migration"). This module therefore does NOT invent a fixed list of slot
 * names. It offers the two keys the codebase itself already names in that
 * header comment as SUGGESTIONS an operator may ignore, and the field
 * stays free text.
 *
 * ─── ONE PUT PER DELIBERATE SAVE ─────────────────────────────────────────
 *
 * Every PUT deletes and reinserts the whole slot and writes an audit row, so
 * a mutation per click would pollute the activity log with one row per
 * click. Add, remove and move are LOCAL array edits; Save sends the list
 * once. Identical to RecommendationsCard's rule, for the identical reason.
 *
 * ─── ORDER IS THE PAYLOAD ────────────────────────────────────────────────
 *
 * `position` IS a real persisted column here (checked: `position` integer
 * NOT NULL DEFAULT 0, with a >= 0 CHECK and a (channel, key, position)
 * index), and the service writes `position: item.position ?? index` —
 * exactly the Recommendations pattern. So the array's ORDER is
 * authoritative and the payload deliberately OMITS `position`, which
 * removes a whole class of client bug (gaps, duplicates, off-by-one).
 *
 * `startAt` / `endAt` are real nullable columns the contract accepts, but
 * NOTHING reads them for display anywhere in the system yet (no public
 * resolver exists). This module therefore omits them from the payload too
 * rather than shipping a scheduling UI that schedules nothing.
 */
import type {
  EditorialPlacementEntry,
  ListEditorialPostsParams,
} from "@workspace/api-client-react";

/** The channel union the list endpoint actually accepts — not a bare string. */
export type PlacementChannel = NonNullable<ListEditorialPostsParams["channel"]>;

export const PLACEMENT_CHANNELS: ReadonlyArray<{ value: PlacementChannel; label: string }> = [
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
];

// ─── Copy ────────────────────────────────────────────────────────────────────

export const PLACEMENTS_PAGE_DESCRIPTION =
  "Curated, ordered slots of posts. A slot is identified by a channel and a key together, so News “featured” and Experience “featured” are two independent lists.";

export const PLACEMENT_KEY_EXPLANATION =
  "A slot key is free text — type any name your website will ask for. A new slot needs no migration and no release; saving a key that has never been used creates that slot.";

/**
 * SUGGESTIONS ONLY. These two are the names the schema's own header comment
 * uses as examples; they are NOT a fixed set and NOT enforced anywhere.
 */
export const PLACEMENT_KEY_SUGGESTIONS: readonly string[] = ["featured", "hero"];

export const PLACEMENTS_EMPTY_STATE =
  "This slot is empty. Nothing is placed in it.";

export const PLACEMENTS_SAVE_LABEL = "Save placement";

export const PLACEMENTS_CHANNEL_NOTE =
  "Only posts in this slot’s channel can be placed in it, so the search is limited to that channel. The server enforces the same rule.";

/**
 * The single most important honest statement on this screen. There is NO
 * public resolver for placements anywhere in the system yet — Editorial is
 * not connected to the public website at all. So nothing here may imply that
 * placing a post makes it publicly visible, whatever that post's lifecycle
 * state is. This is a known, documented Phase C dependency.
 */
export const PLACEMENTS_NOT_PUBLIC_YET_NOTE =
  "Nothing placed here is live. The public website does not read Editorial placements yet, so a slot’s contents — including drafts — are not published by being placed.";

/**
 * The backend permits a draft or archived target: `assertPlacementValid`
 * checks the post EXISTS and is in the right CHANNEL, and checks nothing
 * about any translation's status. That behaviour is deliberately left
 * unchanged; the UI's job is to make the state VISIBLE, not to silently
 * narrow a backend rule.
 */
export const PLACEMENTS_LIFECYCLE_NOTE =
  "A post that is not published can still be placed. Its state is shown beside it so the choice is deliberate.";

/** The contract cap: `items` is `maxItems: 50` on the PUT body. */
export const PLACEMENTS_MAX = 50;

export const PLACEMENTS_CAP_MESSAGE =
  `A slot can hold at most ${PLACEMENTS_MAX} posts. Remove one before adding another.`;

export const UNTITLED_POST_LABEL = "Untitled post";

// ─── Slot key ────────────────────────────────────────────────────────────────

/**
 * The server's only rule is the `editorial_placements_key_not_blank` CHECK
 * plus the route's zod `key` param. Blank is the one genuinely invalid
 * value, so that is the one thing checked — nothing stricter is invented.
 */
export function validatePlacementKey(raw: string): string | null {
  if (raw.trim().length === 0) return "A slot key is required.";
  return null;
}

export function normalizePlacementKey(raw: string): string {
  return raw.trim();
}

export function slotLabel(channel: PlacementChannel, key: string): string {
  return `${channel}:${normalizePlacementKey(key)}`;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export interface PlacementTranslationLike {
  languageCode: string;
  title: string;
  status: "draft" | "published" | "archived";
}

export interface LanguagePreferenceLike {
  code: string;
  isDefault: boolean;
  displayOrder: number;
}

/**
 * Reproduces the SERVER's own label preference exactly —
 * `ORDER BY languages.is_default DESC, languages.display_order ASC`, first
 * row wins — so a post's label does not change the moment it is added and
 * the saved row re-renders from the server's answer. Identical to
 * editorial-recommendations' `pickTargetLabel`; kept as its own function
 * rather than imported so neither module owns the other's contract.
 */
export function pickPostLabel(
  postId: number,
  translations: readonly PlacementTranslationLike[],
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

/** A saved entry renders the server's own `postTitle` verbatim. */
export function placementLabel(entry: EditorialPlacementEntry): string {
  return entry.postTitle.trim().length > 0 ? entry.postTitle : UNTITLED_POST_LABEL;
}

/**
 * The Topics "archived-but-assigned stays visible with a badge" pattern,
 * applied to placements. Returns null when the post is genuinely published.
 */
export function postStateAnnotation(
  translations: readonly PlacementTranslationLike[] | undefined,
): string | null {
  if (!translations) return null;
  if (translations.length === 0) return "no translation yet";
  if (translations.some((translation) => translation.status === "published")) return null;
  if (translations.every((translation) => translation.status === "archived")) return "archived";
  return "not published";
}

// ─── Candidate search ────────────────────────────────────────────────────────

export interface PlacementCandidateQuery {
  channel: PlacementChannel;
  page: number;
  limit: number;
  search?: string;
  translationStatus?: "published";
}

export const PLACEMENT_CANDIDATE_PAGE_SIZE = 10;

/**
 * `channel` is ALWAYS sent: the backend enforces the same-channel rule and
 * would answer 400, so scoping the picker turns a would-be error into an
 * option that simply never appears. An empty search becomes an ABSENT key
 * rather than an empty string, because the route's zod schema treats an
 * empty value as a real one.
 */
export function toPlacementCandidateQuery(input: {
  channel: PlacementChannel;
  search: string;
  publishedOnly: boolean;
  page?: number;
  limit?: number;
}): PlacementCandidateQuery {
  const query: PlacementCandidateQuery = {
    channel: input.channel,
    page: input.page ?? 1,
    limit: input.limit ?? PLACEMENT_CANDIDATE_PAGE_SIZE,
  };
  const search = input.search.trim();
  if (search.length > 0) query.search = search;
  if (input.publishedOnly) query.translationStatus = "published";
  return query;
}

export interface PlacementCandidateRowLike {
  post: { id: number };
}

/** The only legitimate client-side exclusion: ids already in this slot. */
export function filterPlacementCandidates<T extends PlacementCandidateRowLike>(
  rows: readonly T[],
  selected: readonly number[],
): T[] {
  const taken = new Set<number>(selected);
  return rows.filter((row) => !taken.has(row.post.id));
}

export function placementCandidateCountLabel(count: number, total: number): string {
  if (total === 0) return "No posts match.";
  if (count < total) return `${count} of ${total} matching posts shown — refine the search to narrow it.`;
  return count === 1 ? "1 post matches." : `${count} posts match.`;
}

// ─── Local list editing ──────────────────────────────────────────────────────

export function canAddPlacement(current: readonly number[]): boolean {
  return current.length < PLACEMENTS_MAX;
}

export function addPlacement(current: readonly number[], postId: number): number[] {
  // A post appears at most once per slot — a DB UNIQUE and an explicit
  // service check. Silently ignoring a duplicate is kinder than a 400.
  if (current.includes(postId)) return [...current];
  if (!canAddPlacement(current)) return [...current];
  return [...current, postId];
}

export function removePlacement(current: readonly number[], postId: number): number[] {
  return current.filter((id) => id !== postId);
}

export function movePlacementUp(current: readonly number[], index: number): number[] {
  if (index <= 0 || index >= current.length) return [...current];
  const next = [...current];
  const [moved] = next.splice(index, 1);
  next.splice(index - 1, 0, moved!);
  return next;
}

export function movePlacementDown(current: readonly number[], index: number): number[] {
  if (index < 0 || index >= current.length - 1) return [...current];
  const next = [...current];
  const [moved] = next.splice(index, 1);
  next.splice(index + 1, 0, moved!);
  return next;
}

export function placementMoveAnnouncement(label: string, index: number, total: number): string {
  return `${label} moved to position ${index + 1} of ${total}.`;
}

// ─── Dirty + payload ─────────────────────────────────────────────────────────

/** ORDER-SENSITIVE: `position` is persisted, so a reorder IS a change. */
export function arePlacementsDirty(
  current: readonly number[],
  baseline: readonly number[],
): boolean {
  if (current.length !== baseline.length) return true;
  return current.some((id, index) => id !== baseline[index]);
}

export function toPlacementPostIds(entries: readonly EditorialPlacementEntry[]): number[] {
  return entries.map((entry) => entry.postId);
}

/**
 * `position` is deliberately ABSENT — the server writes
 * `position: item.position ?? index`, so the array's order IS the order.
 * `startAt`/`endAt` are absent too: they are stored but nothing reads them,
 * and a scheduling control that schedules nothing would be a lie.
 */
export function toPlacementPayload(
  channel: PlacementChannel,
  current: readonly number[],
): { channel: PlacementChannel; items: Array<{ postId: number }> } {
  return { channel, items: current.map((postId) => ({ postId })) };
}
