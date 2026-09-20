/**
 * editorial-posts — presentation logic for Website → Editorial → Posts and
 * the Post Editor (Wave 2.1D).
 *
 * Pure: no React, no imports, no `import.meta.env` — the same convention as
 * `lib/editorial-authors.ts`, `lib/editorial-topics.ts` and
 * `lib/editorial-languages.ts`.
 *
 * ─── THE DOMAIN, RESTATED FROM THE REAL CONTRACT ─────────────────────────
 *
 * A POST is a shared spine: `channel` (immutable — absent from
 * UpdateEditorialPostSharedBody entirely), `authorId`, `featureImageUrl`,
 * and its topics. A TRANSLATION is one language's prose with its OWN
 * lifecycle: title, slug, deck, contextLabel, body, featureImageAlt,
 * readingTimeOverrideMinutes, seoTitle, seoDescription, ogImageUrl.
 *
 * "Publish" happens to a TRANSLATION, never to a post. A post is not draft
 * or published; its translations are.
 *
 * ─── SLUG (D6) — WHAT WAS ACTUALLY FOUND ─────────────────────────────────
 *
 * Re-verified in artifacts/api-server/src/lib/editorialPostsService.ts:
 *
 *     export function assertSlugEditable(translation) {
 *       if (translation.publishedAt != null) throw new EditorialRuleError(
 *         "This translation's slug cannot be changed — it has already been
 *          published, and the URL is public. Create a new post if the
 *          address must change.", 409);
 *     }
 *
 * The lock is REAL, it is keyed on `publishedAt != null` (not on
 * `status === "published"`), and it therefore also covers a translation that
 * was published and has since been ARCHIVED. So the field is rendered
 * read-only with that exact explanation in both of those states — not a
 * warning, not an invented Admin-side lock.
 *
 * Auto-generation stays SERVER-OWNED: the slug preview below is a display
 * string only. On create the Admin sends `slug: null` while the operator has
 * not typed one, so `resolveTranslationSlug` derives it and applies
 * deterministic collision suffixing ("opening-night-2"). A MANUALLY typed
 * slug is submitted verbatim and its collision is a 409 the operator must
 * resolve — never a silent rename. This module never submits its own
 * preview.
 */

export type EditorialChannelValue = "news" | "experience";
export type EditorialTranslationStatusValue = "draft" | "published" | "archived";

export const POST_TITLE_MAX = 300;
export const POST_SLUG_MAX = 120;

// ─── Slug preview ────────────────────────────────────────────────────────────

/**
 * Client-side port of `slugifyEditorialTitle` in
 * artifacts/api-server/src/lib/editorialSlug.ts. Re-derived from that source
 * line by line: NFC-normalize → lowercase → every run of non-(letter|number)
 * becomes one hyphen → trim hyphens → cap on a hyphen boundary.
 *
 * NOT transliterated: an Arabic title produces an Arabic slug, exactly as the
 * server does. KEEP IN SYNC BY HAND — a test pins this against the server
 * function's own documented examples.
 *
 * Display only. The stored slug is always the server's answer.
 */
export function slugPreview(title: string): string {
  const base = title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (base.length <= POST_SLUG_MAX) return base;
  const cut = base.slice(0, POST_SLUG_MAX);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/u, "");
}

/** Mirror of `EDITORIAL_SLUG_RE`. */
export const EDITORIAL_SLUG_RE = /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u;

/**
 * Mirror of `describeSlugProblem`, message for message, so the inline hint
 * and the server's 400 cannot say two different things.
 */
export function describeSlugProblem(slug: string): string | null {
  if (slug.length === 0) return "A slug cannot be empty.";
  if (slug.length > POST_SLUG_MAX) return `A slug cannot exceed ${POST_SLUG_MAX} characters.`;
  if (slug.normalize("NFC") !== slug) {
    return "That slug is not in Unicode NFC normal form. Retype it (or leave it blank to have one generated) so the URL has exactly one spelling.";
  }
  if (slug.toLowerCase() !== slug) return "A slug must be lowercase.";
  if (!EDITORIAL_SLUG_RE.test(slug)) {
    return 'A slug must be letters or numbers (any script) separated by single hyphens — for example "opening-night" or "ليلة-الافتتاح".';
  }
  return null;
}

/** The exact server message, restated so the read-only field can explain itself. */
export const SLUG_LOCKED_EXPLANATION =
  "This translation's slug cannot be changed — it has already been published, and the URL is public. Create a new post if the address must change.";

/**
 * `assertSlugEditable` keys on publishedAt, NOT on status. A translation that
 * was published and then archived still has a frozen slug.
 */
export function isSlugLocked(translation: { publishedAt: string | null }): boolean {
  return translation.publishedAt != null;
}

export const SLUG_AUTO_HINT =
  "Leave blank and the address is generated from the title when you save — including a numbered suffix if that address is already taken in this language.";

// ─── Channel ─────────────────────────────────────────────────────────────────

export const CHANNEL_OPTIONS: ReadonlyArray<{ value: EditorialChannelValue; label: string }> = [
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
];

export function channelLabel(channel: EditorialChannelValue): string {
  return channel === "news" ? "News" : "Experience";
}

/**
 * `channel` is structurally absent from UpdateEditorialPostSharedBody — there
 * is no write path at all, not merely a guarded one.
 */
export const POST_CHANNEL_IMMUTABLE_EXPLANATION =
  "A post's channel is fixed when it is created — its author, its topics and its public address all depend on it. Create a new post to publish the same story on the other channel.";

export const SHARED_ACROSS_LANGUAGES_LABEL = "Shared across all languages.";
export const TRANSLATION_SPECIFIC_LABEL = "This language only.";

// ─── Translation status ──────────────────────────────────────────────────────

/** What the language switcher shows for one registered language. */
export type LanguageSlotState =
  | "draft"
  | "published"
  | "archived"
  /** No translation row exists, and the language is active — can be added. */
  | "missing"
  /** No translation row exists and the language is inactive — cannot be added. */
  | "missing-inactive";

export interface LanguageSlot {
  code: string;
  name: string;
  nativeName?: string;
  direction?: "ltr" | "rtl";
  isActive: boolean;
  displayOrder: number;
  state: LanguageSlotState;
  /** Present when a translation row exists. */
  title?: string;
  /**
   * TRUE when a translation exists in a language that has been retired.
   * Wave 2.0 semantics: it stays live and stays EDITABLE; only new
   * translations and new publishes are blocked.
   */
  inLanguageThatIsInactive: boolean;
}

export interface LanguageRowLike {
  code: string;
  name: string;
  nativeName?: string;
  direction?: "ltr" | "rtl";
  isActive: boolean;
  displayOrder: number;
}

export interface TranslationSummaryLike {
  languageCode: string;
  title: string;
  status: EditorialTranslationStatusValue;
}

/**
 * Build the complete language switcher model: every REGISTERED language, in
 * the API's own order (displayOrder then code), each carrying its
 * translation's state or "missing".
 *
 * An existing translation is NEVER hidden because its language was
 * deactivated — that is the exact case Wave 2.0 kept live and editable, and
 * hiding it would strand published content with no way to edit it.
 */
export function buildLanguageSlots(
  languages: readonly LanguageRowLike[],
  translations: readonly TranslationSummaryLike[],
): LanguageSlot[] {
  const byCode = new Map(translations.map((translation) => [translation.languageCode, translation]));
  return [...languages]
    .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code))
    .map((language) => {
      const translation = byCode.get(language.code);
      if (!translation) {
        return {
          ...language,
          state: language.isActive ? ("missing" as const) : ("missing-inactive" as const),
          inLanguageThatIsInactive: false,
        };
      }
      return {
        ...language,
        state: translation.status,
        title: translation.title,
        inLanguageThatIsInactive: !language.isActive,
      };
    });
}

export function slotStateLabel(state: LanguageSlotState): string {
  switch (state) {
    case "draft": return "Draft";
    case "published": return "Published";
    case "archived": return "Archived";
    case "missing": return "Not translated";
    case "missing-inactive": return "Unavailable";
  }
}

export function canAddTranslation(slot: LanguageSlot): boolean {
  return slot.state === "missing";
}

export const INACTIVE_LANGUAGE_ADD_BLOCKED =
  "This language has been retired, so no new translation can be created in it. Activate it again in Website → Configuration → Languages first.";

export const INACTIVE_LANGUAGE_EDIT_NOTICE =
  "This language has been retired. This translation stays live and stays editable, but it cannot be published or re-published until the language is activated again.";

/**
 * The translation the `/editorial/posts/:id` route should redirect to.
 *
 * Preference order, most useful first: the language whose translation is
 * PUBLISHED (an operator arriving at a bare post id is most often going to
 * the live one), then draft, then archived — ties broken by the language
 * registry's own display order, which `buildLanguageSlots` has already
 * applied. `null` means the post has zero translations and the recovery
 * screen must render instead.
 */
export function preferredTranslationCode(slots: readonly LanguageSlot[]): string | null {
  const rank: Record<string, number> = { published: 0, draft: 1, archived: 2 };
  const existing = slots.filter((slot) => slot.state in rank);
  if (existing.length === 0) return null;
  return [...existing].sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9))[0]!.code;
}

// ─── List rows ───────────────────────────────────────────────────────────────

export interface PostListRowLike {
  post: { id: number; channel: EditorialChannelValue; authorId: number | null; updatedAt: string };
  translations: ReadonlyArray<{
    languageCode: string;
    title: string;
    status: EditorialTranslationStatusValue;
  }>;
}

/**
 * A post has no title of its own — the title lives on each translation. The
 * list shows the published translation's title when there is one, else the
 * first translation's, else an explicit untitled marker. Never a blank cell.
 */
export function listRowTitle(row: PostListRowLike): string {
  const published = row.translations.find((translation) => translation.status === "published");
  const chosen = published ?? row.translations[0];
  if (!chosen) return "Untitled post";
  return chosen.title.trim().length > 0 ? chosen.title : "Untitled post";
}

/** "2 published · 1 draft" — computed from the summaries the list already returns. */
export function translationSummaryLabel(
  translations: readonly { status: EditorialTranslationStatusValue }[],
): string {
  if (translations.length === 0) return "No translations";
  const counts: Record<EditorialTranslationStatusValue, number> = { draft: 0, published: 0, archived: 0 };
  for (const translation of translations) counts[translation.status] += 1;
  return (["published", "draft", "archived"] as const)
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${status}`)
    .join(" · ");
}

export function languageCodesLabel(translations: readonly { languageCode: string }[]): string {
  if (translations.length === 0) return "—";
  return translations.map((translation) => translation.languageCode).join(", ");
}

// ─── Filters (SERVER-side — the list endpoint is paginated) ──────────────────

/**
 * Exactly the filters `ListEditorialPostsQueryParams` actually accepts:
 * channel, translationStatus, languageCode, authorId, topicId, search, page,
 * limit. Nothing is filtered client-side: the response is ONE page, so a
 * client-side filter would silently hide matches on other pages.
 *
 * There is deliberately NO sort control (D9): the endpoint's ORDER BY is
 * fixed (`updated_at DESC, id DESC`) and exposes no sort parameter, so a
 * column header would either lie or reorder one page out of many.
 */
export interface PostListFilters {
  search: string;
  channel: "all" | EditorialChannelValue;
  translationStatus: "all" | EditorialTranslationStatusValue;
  languageCode: "all" | string;
  authorId: "all" | number;
  topicId: "all" | number;
}

export const DEFAULT_POST_LIST_FILTERS: PostListFilters = {
  search: "",
  channel: "all",
  translationStatus: "all",
  languageCode: "all",
  authorId: "all",
  topicId: "all",
};

export const POST_LIST_PAGE_SIZE = 25;

export interface PostListQueryParams {
  channel?: EditorialChannelValue;
  translationStatus?: EditorialTranslationStatusValue;
  languageCode?: string;
  authorId?: number;
  topicId?: number;
  search?: string;
  page: number;
  limit: number;
}

/**
 * Map UI filter state onto the query object. "all" and an empty search become
 * ABSENT keys rather than empty strings — the route's zod schema treats an
 * empty `languageCode` as a real value and answers 404 for an unregistered
 * code, so sending "" would break the page rather than widen it.
 */
export function toPostListQuery(
  filters: PostListFilters,
  page: number,
  limit: number = POST_LIST_PAGE_SIZE,
): PostListQueryParams {
  const query: PostListQueryParams = { page, limit };
  if (filters.channel !== "all") query.channel = filters.channel;
  if (filters.translationStatus !== "all") query.translationStatus = filters.translationStatus;
  if (filters.languageCode !== "all") query.languageCode = filters.languageCode;
  if (filters.authorId !== "all") query.authorId = filters.authorId;
  if (filters.topicId !== "all") query.topicId = filters.topicId;
  const search = filters.search.trim();
  if (search.length > 0) query.search = search;
  return query;
}

export function activePostFilterCount(filters: PostListFilters): number {
  return (
    (filters.channel !== "all" ? 1 : 0) +
    (filters.translationStatus !== "all" ? 1 : 0) +
    (filters.languageCode !== "all" ? 1 : 0) +
    (filters.authorId !== "all" ? 1 : 0) +
    (filters.topicId !== "all" ? 1 : 0)
  );
}

export function totalPages(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

export function pageRangeLabel(page: number, limit: number, total: number): string {
  if (total === 0) return "No posts";
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return `${from}–${to} of ${total}`;
}

// ─── Capability predicates (RBAC) ────────────────────────────────────────────

/**
 * The real action split, re-derived from adminEditorial.ts route by route:
 *   view    — every GET
 *   create  — POST /posts, POST /posts/:id/translations
 *   edit    — PATCH /posts/:id, PATCH /posts/:id/translations/:code,
 *             PUT /posts/:id/topics
 *   publish — publish / archive / restore transitions (ALL THREE)
 *   delete  — listed in the permission catalog but wired to NO post route.
 *             There is no DELETE endpoint for a post or a translation, so
 *             this wave exposes no delete control. Rendering one would
 *             promise an operation the API cannot perform.
 */
export interface PostCapabilities {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
}

export function postCapabilities(
  can: (module: string, action: string) => boolean,
): PostCapabilities {
  return {
    canView: can("website.posts", "view"),
    canCreate: can("website.posts", "create"),
    canEdit: can("website.posts", "edit"),
    // Separate from canEdit on purpose: an editor may be allowed to write
    // drafts without being allowed to put them live.
    canPublish: can("website.posts", "publish"),
  };
}

export const NO_PUBLISH_PERMISSION_NOTICE =
  "You can edit this content but not change what is live. Publishing, archiving and restoring need the Publish permission on Website Editorial Posts.";

// ─── Save-label copy (D7) ────────────────────────────────────────────────────

/** Never one generic "Save" — the label states what the save will do. */
export function translationSaveLabel(status: EditorialTranslationStatusValue): string {
  switch (status) {
    case "draft": return "Save draft";
    case "published": return "Update";
    case "archived": return "Save changes";
  }
}

export const LIVE_CONTENT_WARNING =
  "You are editing live content. Saving publishes these changes to the website immediately.";

export function statusBadgeLabel(status: EditorialTranslationStatusValue): string {
  switch (status) {
    case "draft": return "Draft";
    case "published": return "Published";
    case "archived": return "Archived";
  }
}

// ─── Lifecycle confirmations ─────────────────────────────────────────────────

export interface PostConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

export function publishConfirmation(context: { title: string; languageName: string }): PostConfirmation {
  return {
    title: `Publish the ${context.languageName} translation?`,
    description: `"${context.title}" becomes readable on the public website in ${context.languageName}. Its public address is fixed at this moment and cannot be changed afterwards, and the byline is frozen as it stands today.`,
    confirmLabel: "Publish",
    destructive: false,
  };
}

export function archivePublishedConfirmation(context: { title: string; languageName: string }): PostConfirmation {
  return {
    title: `Take the ${context.languageName} translation off the website?`,
    description: `"${context.title}" stops being readable in ${context.languageName}. Nothing is deleted — every other language is untouched, and you can restore this one to draft at any time.`,
    confirmLabel: "Archive translation",
    destructive: true,
  };
}

/**
 * The real transition table (ALLOWED_TRANSITIONS in editorialPostsService.ts):
 *   draft     → published | archived
 *   published → archived
 *   archived  → draft
 * `published → draft` is deliberately absent, so there is no "Unpublish"
 * control anywhere on this screen: taking something off the site is Archive,
 * which is an explicit audited event.
 */
export function allowedTransitions(status: EditorialTranslationStatusValue): EditorialTranslationStatusValue[] {
  switch (status) {
    case "draft": return ["published", "archived"];
    case "published": return ["archived"];
    case "archived": return ["draft"];
  }
}

export const RESTORE_EXPLANATION =
  "Restoring brings this translation back as a draft. It does not go live again until you publish it.";

// ─── Dates ───────────────────────────────────────────────────────────────────

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toISOString().slice(0, 10);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toISOString().slice(0, 16).replace("T", " ");
}
