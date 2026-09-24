/**
 * editorial-post-form — payload mapping, dirty comparison and the advisory
 * publish-readiness checklist for the Post Editor (Wave 2.1D).
 *
 * Pure. No React, no imports.
 *
 * ─── DOMAIN SEPARATION IS ENFORCED HERE, STRUCTURALLY ────────────────────
 *
 * There are three independent save endpoints and this module builds one
 * payload for each, from separate inputs:
 *
 *   PATCH /admin/editorial/posts/:id           authorId, featureImageUrl
 *   PATCH /…/translations/:languageCode        title, slug, deck,
 *                                              contextLabel, featureImageAlt,
 *                                              listingImageUrl,
 *                                              body, readingTimeOverride-
 *                                              Minutes, seoTitle,
 *                                              seoDescription, ogImageUrl
 *   PUT   /…/posts/:id/topics                  topicIds (FULL REPLACE)
 *
 * `channel` has NO write path anywhere (absent from
 * UpdateEditorialPostSharedBody). `status` and `publishedAt` are NEVER in a
 * translation PATCH — status moves only through the publish / archive /
 * restore transitions, each of which is its own POST behind
 * website.posts:publish. `authorSnapshot` is server-owned and frozen at
 * publish. Tests assert the forbidden keys never appear in the wrong
 * payload.
 *
 * ─── NULL vs UNDEFINED ───────────────────────────────────────────────────
 *
 * Both routes copy a key only when `body[key] !== undefined`, so:
 *   undefined → leave alone (the key is omitted from the request entirely)
 *   null      → clear it
 * An emptied textarea must therefore send `null`, never `""`. This is the
 * same rule `lib/editorial-authors.ts` established in Wave 2.1C.
 */

// Explicit `.ts` extensions: `allowImportingTsExtensions` is on in the Admin
// tsconfig, Vite resolves them, and `node --test --experimental-strip-types`
// (this package's only test runner) requires them.
import { toBodyPayload, type EditableBlock, type StoredBody } from "./editorial-post-body.ts";
import type { EditorialChannelValue, EditorialTranslationStatusValue } from "./editorial-posts.ts";

// ─── Form shapes ─────────────────────────────────────────────────────────────

/** Everything the translation PATCH can write, as the form holds it. */
export interface TranslationFormValues {
  title: string;
  slug: string;
  deck: string;
  contextLabel: string;
  featureImageAlt: string;
  /**
   * The image THIS language shows in a listing. A separate stored value
   * from the post's shared Feature image — never a fallback to it.
   */
  listingImageUrl: string;
  readingTimeOverrideMinutes: string;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
  blocks: EditableBlock[];
}

/** Everything the SHARED post PATCH can write. */
export interface SharedFormValues {
  authorId: number | null;
  featureImageUrl: string;
}

export const EMPTY_TRANSLATION_FORM: TranslationFormValues = {
  title: "",
  slug: "",
  deck: "",
  contextLabel: "",
  featureImageAlt: "",
  listingImageUrl: "",
  readingTimeOverrideMinutes: "",
  seoTitle: "",
  seoDescription: "",
  ogImageUrl: "",
  blocks: [],
};

export interface TranslationRowLike {
  title: string;
  slug: string;
  deck: string | null;
  contextLabel: string | null;
  featureImageAlt: string | null;
  listingImageUrl: string | null;
  readingTimeOverrideMinutes: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  status: EditorialTranslationStatusValue;
  publishedAt: string | null;
}

export function toTranslationFormValues(
  row: TranslationRowLike,
  blocks: EditableBlock[],
): TranslationFormValues {
  return {
    title: row.title,
    slug: row.slug,
    deck: row.deck ?? "",
    contextLabel: row.contextLabel ?? "",
    featureImageAlt: row.featureImageAlt ?? "",
    listingImageUrl: row.listingImageUrl ?? "",
    readingTimeOverrideMinutes:
      row.readingTimeOverrideMinutes == null ? "" : String(row.readingTimeOverrideMinutes),
    seoTitle: row.seoTitle ?? "",
    seoDescription: row.seoDescription ?? "",
    ogImageUrl: row.ogImageUrl ?? "",
    blocks,
  };
}

// ─── Payload mappers ─────────────────────────────────────────────────────────

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface TranslationUpdatePayload {
  title?: string;
  slug?: string;
  deck?: string | null;
  contextLabel?: string | null;
  featureImageAlt?: string | null;
  listingImageUrl?: string | null;
  body?: StoredBody;
  readingTimeOverrideMinutes?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
}

/**
 * Only changed fields are sent. `slug` is additionally omitted whenever the
 * translation has ever been published — the server refuses the change with a
 * 409 (assertSlugEditable keys on `publishedAt != null`), and the field is
 * read-only in that state, so including it could only ever produce a
 * spurious rejection of an otherwise valid save.
 *
 * `status` and `publishedAt` are structurally absent from the return type.
 */
export function toTranslationUpdatePayload(
  values: TranslationFormValues,
  original: TranslationFormValues,
  options: { slugLocked: boolean },
): TranslationUpdatePayload {
  const payload: TranslationUpdatePayload = {};

  const title = values.title.trim();
  if (title !== original.title.trim()) payload.title = title;

  if (!options.slugLocked) {
    const slug = values.slug.trim();
    // Only ever sent when the operator actually typed something different.
    // A blank slug field on an existing translation means "unchanged", not
    // "regenerate" — the PATCH route has no regenerate affordance.
    if (slug.length > 0 && slug !== original.slug.trim()) payload.slug = slug;
  }

  const deck = textOrNull(values.deck);
  if (deck !== textOrNull(original.deck)) payload.deck = deck;

  const contextLabel = textOrNull(values.contextLabel);
  if (contextLabel !== textOrNull(original.contextLabel)) payload.contextLabel = contextLabel;

  const featureImageAlt = textOrNull(values.featureImageAlt);
  if (featureImageAlt !== textOrNull(original.featureImageAlt)) {
    payload.featureImageAlt = featureImageAlt;
  }

  // A REAL field, never derived from featureImageUrl. Blank clears it to
  // NULL (the shared feature image is NOT substituted at rest — any such
  // fallback belongs to the future public renderer, not to storage).
  const listingImageUrl = textOrNull(values.listingImageUrl);
  if (listingImageUrl !== textOrNull(original.listingImageUrl)) {
    payload.listingImageUrl = listingImageUrl;
  }

  const readTime = readingTimeOrNull(values.readingTimeOverrideMinutes);
  if (readTime !== readingTimeOrNull(original.readingTimeOverrideMinutes)) {
    payload.readingTimeOverrideMinutes = readTime;
  }

  const seoTitle = textOrNull(values.seoTitle);
  if (seoTitle !== textOrNull(original.seoTitle)) payload.seoTitle = seoTitle;

  const seoDescription = textOrNull(values.seoDescription);
  if (seoDescription !== textOrNull(original.seoDescription)) payload.seoDescription = seoDescription;

  const ogImageUrl = textOrNull(values.ogImageUrl);
  if (ogImageUrl !== textOrNull(original.ogImageUrl)) payload.ogImageUrl = ogImageUrl;

  const body = toBodyPayload(values.blocks);
  if (!sameBody(body, toBodyPayload(original.blocks))) payload.body = body;

  return payload;
}

/**
 * `readingTimeOverrideMinutes` IS a real, stored, writable field — it appears
 * on UpdateEditorialPostTranslationBody as `zod.number().nullish()` and the
 * service copies it like any other content key. It is an override of a
 * server-derived estimate, so a blank field clears the override (null).
 *
 * ─── THE REAL CONTRACT (verified in this branch, not assumed) ────────────
 *
 * DB  lib/db/migrations/0126_editorial_foundation.sql — the column is
 *     `integer`, and the table CHECK is
 *       ("reading_time_override_minutes" IS NULL
 *        OR "reading_time_override_minutes" > 0)
 * API lib/api-zod/src/generated/api.ts — `zod.number().nullish()`. There is
 *     NO `.int()` and NO `.min()`, so the generated request schema ACCEPTS 0.
 * SVC editorialPostsService.updateTranslation copies the key straight onto
 *     the UPDATE with no domain check of its own.
 *
 * So `0` passes request validation, reaches the UPDATE and violates the
 * CHECK constraint inside the transaction — a raw driver error, which the
 * Security Phase G ExposableHttpError allowlist renders as a generic 500.
 * The real minimum is 1 and `null` (blank) is the only other legal value.
 * This module is the last gate before the request, so BOTH helpers are
 * pinned to that minimum rather than only the message-producing one.
 */
export const READING_TIME_MIN_MINUTES = 1;

export const READING_TIME_ERROR_MESSAGE =
  "Enter a whole number of minutes of 1 or more, or leave blank to use the estimate.";

export function readingTimeOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < READING_TIME_MIN_MINUTES) return null;
  return parsed;
}

export function readingTimeError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < READING_TIME_MIN_MINUTES) {
    return READING_TIME_ERROR_MESSAGE;
  }
  return undefined;
}

export interface SharedUpdatePayload {
  authorId?: number | null;
  featureImageUrl?: string | null;
}

/**
 * The SHARED payload. Structurally incapable of carrying `channel`, `title`
 * or `body` — a test asserts it.
 */
export function toSharedUpdatePayload(
  values: SharedFormValues,
  original: SharedFormValues,
): SharedUpdatePayload {
  const payload: SharedUpdatePayload = {};
  if (values.authorId !== original.authorId) payload.authorId = values.authorId;
  const featureImageUrl = textOrNull(values.featureImageUrl);
  if (featureImageUrl !== textOrNull(original.featureImageUrl)) {
    payload.featureImageUrl = featureImageUrl;
  }
  return payload;
}

/**
 * FULL REPLACE. Re-verified against `PUT /admin/editorial/posts/:id/topics`,
 * which deletes every existing row for the post and inserts exactly the ids
 * in the body — so the desired COMPLETE set is sent, never a delta.
 */
export function toTopicsPayload(topicIds: readonly number[]): { topicIds: number[] } {
  return { topicIds: [...new Set(topicIds)].sort((a, b) => a - b) };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreatePostFormValues {
  channel: EditorialChannelValue;
  languageCode: string;
  title: string;
  slug: string;
  authorId: number | null;
  featureImageUrl: string;
}

export const EMPTY_CREATE_FORM: CreatePostFormValues = {
  channel: "news",
  languageCode: "",
  title: "",
  slug: "",
  authorId: null,
  featureImageUrl: "",
};

export interface CreatePostPayload {
  channel: EditorialChannelValue;
  authorId?: number | null;
  featureImageUrl?: string | null;
  translation: {
    languageCode: string;
    title: string;
    slug: string | null;
    body: StoredBody;
  };
}

/**
 * ONE request. `POST /admin/editorial/posts` accepts the shared spine AND an
 * optional first draft translation in the same body, so no wizard is needed
 * and no intermediate half-created post can exist.
 *
 * `slug: null` when the operator did not type one — that is what hands
 * generation AND deterministic collision suffixing to the server (D6). The
 * client's own preview is never submitted.
 *
 * The body starts EMPTY (`{blocks: []}`): `blocks` has no minimum in either
 * schema, and a translation with no blocks is a perfectly legal draft — it
 * simply cannot be published until it has one.
 */
export function toCreatePostPayload(values: CreatePostFormValues): CreatePostPayload {
  const payload: CreatePostPayload = {
    channel: values.channel,
    translation: {
      languageCode: values.languageCode,
      title: values.title.trim(),
      slug: textOrNull(values.slug),
      body: { blocks: [] },
    },
  };
  if (values.authorId != null) payload.authorId = values.authorId;
  const featureImageUrl = textOrNull(values.featureImageUrl);
  if (featureImageUrl != null) payload.featureImageUrl = featureImageUrl;
  return payload;
}

export type CreateFormField = "channel" | "languageCode" | "title" | "slug";
export type CreateFormErrors = Partial<Record<CreateFormField, string>>;

export function validateCreateForm(
  values: CreatePostFormValues,
  slugProblem: (slug: string) => string | null,
): CreateFormErrors {
  const errors: CreateFormErrors = {};
  if (values.channel !== "news" && values.channel !== "experience") {
    errors.channel = "A channel is required.";
  }
  if (values.languageCode.trim().length === 0) errors.languageCode = "A language is required.";
  const title = values.title.trim();
  if (title.length === 0) errors.title = "A title is required.";
  else if (title.length > 300) errors.title = "A title can be at most 300 characters.";
  const slug = values.slug.trim();
  if (slug.length > 0) {
    const problem = slugProblem(slug);
    if (problem) errors.slug = problem;
  }
  return errors;
}

// ─── Dirty comparison ────────────────────────────────────────────────────────

function sameBody(a: StoredBody, b: StoredBody): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Structural equality over the SUBMITTABLE projection of the form, not over
 * the raw strings — so trailing whitespace an operator typed and then
 * removed does not leave the editor permanently "unsaved", and so a block's
 * client-only key never counts as a change.
 */
export function isTranslationDirty(
  values: TranslationFormValues,
  original: TranslationFormValues,
  options: { slugLocked: boolean },
): boolean {
  return Object.keys(toTranslationUpdatePayload(values, original, options)).length > 0;
}

export function isSharedDirty(values: SharedFormValues, original: SharedFormValues): boolean {
  return Object.keys(toSharedUpdatePayload(values, original)).length > 0;
}

export function areTopicsDirty(
  selected: readonly number[],
  original: readonly number[],
): boolean {
  const a = toTopicsPayload(selected).topicIds;
  const b = toTopicsPayload(original).topicIds;
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}

// ─── Publish readiness (advisory mirror of assertTranslationPublishReady) ────

export type ReadinessKey =
  | "language-active"
  | "title"
  | "body"
  | "feature-image"
  | "feature-image-alt"
  | "image-alt"
  | "author"
  | "author-active"
  | "author-biography";

export interface ReadinessItem {
  key: ReadinessKey;
  ok: boolean;
  /** The SERVER's own message when the rule is unmet. */
  message: string;
}

export interface ReadinessInputs {
  languageIsActive: boolean;
  title: string;
  blocks: ReadonlyArray<{ type: string; alt?: string }>;
  featureImageUrl: string | null;
  featureImageAlt: string | null;
  author: { publicName: string; status: "active" | "archived"; biography: string | null } | null;
}

/**
 * ADVISORY ONLY. The server re-runs `assertTranslationPublishReady` inside the
 * publish transaction and is the final authority; this list exists so an
 * operator sees what is missing before pressing a button that would fail.
 *
 * Every entry below is a rule that function ACTUALLY enforces, with its exact
 * message, re-read from editorialPostsService.ts on 2026-09-20. Nothing is
 * invented: there is deliberately no "deck required", no "SEO required", no
 * "topics required" — the server enforces none of those.
 *
 * The MEDIA rule (validateEditorialMediaUrls over the feature image, every
 * body image and the og:image) is NOT mirrored: it is live network I/O
 * against a host allowlist, DNS and Content-Type, and guessing at it in the
 * client would produce confident wrong answers. Its failure surfaces as the
 * server's verbatim 400.
 */
export function publishReadiness(inputs: ReadinessInputs): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  items.push({
    key: "language-active",
    ok: inputs.languageIsActive,
    message: "This language has been retired and nothing new can be published in it.",
  });

  items.push({
    key: "title",
    ok: inputs.title.trim().length > 0,
    message: "A translation needs a title before it can be published.",
  });

  items.push({
    key: "body",
    ok: inputs.blocks.length > 0,
    message: "A translation needs at least one body block before it can be published.",
  });

  items.push({
    key: "feature-image",
    ok: (inputs.featureImageUrl ?? "").trim().length > 0,
    message: "A post needs a feature image before any translation can be published.",
  });

  items.push({
    key: "feature-image-alt",
    ok: (inputs.featureImageAlt ?? "").trim().length > 0,
    message:
      "This translation needs alt text for the feature image, in its own language, before it can be published.",
  });

  const missingAlt: number[] = [];
  inputs.blocks.forEach((block, index) => {
    if (block.type !== "image") return;
    if ((block.alt ?? "").trim().length === 0) missingAlt.push(index + 1);
  });
  items.push({
    key: "image-alt",
    ok: missingAlt.length === 0,
    message: `Every image needs alt text before publishing (missing on block ${missingAlt.join(", ")}).`,
  });

  items.push({
    key: "author",
    ok: inputs.author != null,
    message: "A post needs an author before any translation can be published.",
  });

  items.push({
    key: "author-active",
    ok: inputs.author == null ? false : inputs.author.status === "active",
    message: inputs.author
      ? `Author "${inputs.author.publicName}" is archived — pick an active author before publishing.`
      : "A post needs an author before any translation can be published.",
  });

  items.push({
    key: "author-biography",
    ok: inputs.author == null ? false : (inputs.author.biography ?? "").trim().length > 0,
    message: inputs.author
      ? `Author "${inputs.author.publicName}" has no biography — add one before publishing a post under this byline.`
      : "A post needs an author before any translation can be published.",
  });

  return items;
}

export function isPublishReady(items: readonly ReadinessItem[]): boolean {
  return items.every((item) => item.ok);
}

export function blockingReadiness(items: readonly ReadinessItem[]): ReadinessItem[] {
  return items.filter((item) => !item.ok);
}

export const READINESS_ADVISORY_NOTE =
  "Checked again on the server when you publish — the server has the final say.";

/** Human labels for the checklist rows. */
export const READINESS_LABELS: Record<ReadinessKey, string> = {
  "language-active": "Language is active",
  title: "Title",
  body: "At least one body block",
  "feature-image": "Feature image (shared)",
  "feature-image-alt": "Feature image alt text (this language)",
  "image-alt": "Alt text on every body image",
  author: "Author assigned",
  "author-active": "Author is active",
  "author-biography": "Author has a biography",
};
