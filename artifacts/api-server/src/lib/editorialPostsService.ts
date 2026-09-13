/**
 * editorialPostsService — Unified Editorial CMS Wave 1.1 lifecycle,
 * revision, and integrity rules for the MULTILINGUAL model.
 *
 * Everything here is pure application logic over a `DbClient` (root db OR a
 * transaction handle), so the route layer stays thin and every rule is
 * testable without HTTP.
 *
 * ─── THE MODEL IN ONE PARAGRAPH ──────────────────────────────────────────
 *
 * A POST is the shared spine of a story: channel, one byline, one feature
 * image URL, its topics, its recommendations, its placements. A
 * TRANSLATION is one language's rendering of that story — title, slug,
 * deck, body, SEO, localized feature-image alt — and carries its OWN
 * lifecycle. "Publish" is something you do to a translation, never to a
 * post. A post is not draft or published; its translations are.
 *
 * ─── THE FIVE INVARIANTS THIS FILE EXISTS TO GUARANTEE ───────────────────
 *
 * 1. PER-TRANSLATION LIFECYCLE. draft -> published | archived;
 *    published -> archived; archived -> draft. `published -> draft` is NOT
 *    a legal transition — unpublishing must go through `archived` so there
 *    is always an explicit, audited "taken off the site" event. This is
 *    Wave 1's contract, re-verified against Wave 1's own transition table
 *    and its test ("published -> draft must never be allowed", 409), now
 *    applied per translation. Publishing enforces a full readiness gate
 *    (see assertTranslationPublishReady). `published_at` is stamped once,
 *    on THAT translation's first publish, is never changed by a later edit
 *    or re-publish, and never affects any other translation of the post.
 *
 * 2. TRANSLATION INDEPENDENCE. No write path in this file touches more
 *    than one translation row. Every translation mutation is keyed by a
 *    single translation id resolved from (postId, languageId), so
 *    publishing, editing, archiving, or restoring the Arabic translation
 *    cannot reach the English one. Shared-field changes go the other way:
 *    they write only editorial_posts / editorial_post_topics and no
 *    translation row at all.
 *
 * 3. REVISIONS, TWO SCOPES. Any change to a translation that is CURRENTLY
 *    PUBLISHED first snapshots that translation's pre-change state into
 *    editorial_post_revisions with `translation_id` set, in the SAME
 *    transaction as the mutation. Any change to a SHARED field (author,
 *    topics, feature image URL) on a post that has AT LEAST ONE PUBLISHED
 *    TRANSLATION snapshots the shared spine with `translation_id` NULL. If
 *    the revision insert fails, the transaction rolls back and the
 *    mutation does not happen — Wave 1's guarantee, preserved. Drafts are
 *    working copy and make no revisions.
 *
 * 4. AUTHOR CHANNEL MATCH. A post's author must belong to the post's
 *    channel. Checked here on every write path that sets or changes
 *    author_id, and independently by a database trigger
 *    (guard_editorial_post_integrity) so the invariant holds even against
 *    hand-written SQL.
 *
 * 5. AUDIT ATOMICITY. The audit row for every transition is written inside
 *    that same transaction via logActivityWithActorStrict (see
 *    editorialCore.ts) — the existing activityLog service's transactional
 *    variant, which propagates failures instead of swallowing them. No
 *    shared infrastructure was changed to achieve this in Wave 1 or in
 *    Wave 1.1: the strict variant already existed and already accepts an
 *    arbitrary client.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  editorialAuthorsTable,
  editorialLanguagesTable,
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostRevisionsTable,
  editorialPostTopicsTable,
  editorialPostTranslationsTable,
  editorialPostsTable,
  editorialTopicsTable,
  type EditorialAuthorSnapshot,
  type EditorialChannel,
  type EditorialLanguage,
  type EditorialPost,
  type EditorialPostStatus,
  type EditorialPostTranslation,
  type EditorialSharedRevisionEventType,
  type EditorialSharedRevisionSnapshot,
  type EditorialTranslationRevisionEventType,
  type EditorialTranslationRevisionSnapshot,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import type { ActivityActorSnapshot } from "./activityLog";
import { EditorialRuleError, EDITORIAL_AUDIT_MODULE, auditEditorial } from "./editorialCore";
import { collectBodyImageUrls, findBlocksMissingAlt } from "./editorialBody";
import {
  validateEditorialMediaUrls,
  type EditorialMediaValidationDeps,
} from "./editorialMediaUrl";
import { assertLanguageAssignable, assertLanguagePublishable, loadLanguageOrThrow } from "./editorialLanguagesService";
import { disambiguateEditorialSlug, describeSlugProblem, slugifyEditorialTitle } from "./editorialSlug";

// Re-exported so Wave 1 import sites (routes, tests) keep working.
export { EditorialRuleError, EDITORIAL_AUDIT_MODULE, auditEditorial };

const EDITORIAL_TRANSLATION_ENTITY_TYPE = "editorial_post_translation";

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * The complete legal transition table for ONE TRANSLATION. Anything not
 * listed is rejected — notably published -> draft, deliberately absent.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<EditorialPostStatus, readonly EditorialPostStatus[]>> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export function assertTransitionAllowed(from: EditorialPostStatus, to: EditorialPostStatus): void {
  if (from === to) {
    throw new EditorialRuleError(`This translation is already ${to}.`, 409);
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const hint =
      from === "published" && to === "draft"
        ? " Archive the translation first, then restore it to draft."
        : "";
    throw new EditorialRuleError(`Cannot move a translation from ${from} to ${to}.${hint}`, 409);
  }
}

// ─── Author snapshot + channel scoping ──────────────────────────────────────

export function buildAuthorSnapshot(author: {
  publicName: string;
  role: string;
  avatarUrl: string | null;
  biography: string | null;
}): EditorialAuthorSnapshot {
  return {
    name: author.publicName,
    role: author.role,
    avatarUrl: author.avatarUrl,
    biography: author.biography,
  };
}

export async function loadAuthorOrThrow(client: DbClient, authorId: number) {
  const [author] = await client
    .select()
    .from(editorialAuthorsTable)
    .where(eq(editorialAuthorsTable.id, authorId))
    .limit(1);
  if (!author) throw new EditorialRuleError(`Author ${authorId} not found.`, 404);
  return author;
}

/**
 * An author may only be NEWLY assigned while active. Archiving an author
 * never retroactively invalidates posts already carrying them — published
 * translations keep their frozen snapshot, which is the whole reason the
 * snapshot exists.
 */
export async function loadAssignableAuthorOrThrow(client: DbClient, authorId: number) {
  const author = await loadAuthorOrThrow(client, authorId);
  if (author.status !== "active") {
    throw new EditorialRuleError(`Author "${author.publicName}" is archived and cannot be assigned.`);
  }
  return author;
}

/**
 * THE AUTHOR CHANNEL RULE. An author belongs to exactly one channel and can
 * only be the byline of a post in that same channel.
 *
 * This is the SERVICE-LAYER enforcement point, called from every write path
 * that sets or changes `author_id` (post create, post shared-field update).
 * It exists to produce a readable 400 naming both channels. The DATABASE
 * enforces the same rule independently via the
 * `guard_editorial_post_integrity` trigger, so a write that bypassed this
 * function entirely would still be refused — see editorialAuthors.ts for
 * why a trigger rather than a composite FK.
 */
export async function assertAuthorAssignableToChannel(
  client: DbClient,
  channel: EditorialChannel,
  authorId: number,
) {
  const author = await loadAssignableAuthorOrThrow(client, authorId);
  if (author.channel !== channel) {
    throw new EditorialRuleError(
      `Author "${author.publicName}" belongs to the ${author.channel} channel and cannot be the byline of a ${channel} post.`,
    );
  }
  return author;
}

// ─── Posts (shared spine) ───────────────────────────────────────────────────

/** SELECT ... FOR UPDATE on one post — serializes concurrent editors. */
export async function lockPostForUpdate(tx: DbClient, postId: number): Promise<EditorialPost> {
  const [post] = await tx
    .select()
    .from(editorialPostsTable)
    .where(eq(editorialPostsTable.id, postId))
    .limit(1)
    .for("update");
  if (!post) throw new EditorialRuleError(`Post ${postId} not found.`, 404);
  return post;
}

export async function loadPostOrThrow(client: DbClient, postId: number): Promise<EditorialPost> {
  const [post] = await client
    .select()
    .from(editorialPostsTable)
    .where(eq(editorialPostsTable.id, postId))
    .limit(1);
  if (!post) throw new EditorialRuleError(`Post ${postId} not found.`, 404);
  return post;
}

/** Does this post have at least one PUBLISHED translation? */
export async function postHasPublishedTranslation(client: DbClient, postId: number): Promise<boolean> {
  const [row] = await client
    .select({ n: sql<number>`count(*)` })
    .from(editorialPostTranslationsTable)
    .where(
      and(
        eq(editorialPostTranslationsTable.postId, postId),
        eq(editorialPostTranslationsTable.status, "published"),
      ),
    );
  return Number(row?.n ?? 0) > 0;
}

// ─── Translations ───────────────────────────────────────────────────────────

export async function loadTranslationOrThrow(
  client: DbClient,
  postId: number,
  languageId: number,
): Promise<EditorialPostTranslation> {
  const [row] = await client
    .select()
    .from(editorialPostTranslationsTable)
    .where(
      and(
        eq(editorialPostTranslationsTable.postId, postId),
        eq(editorialPostTranslationsTable.languageId, languageId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new EditorialRuleError(`This post has no translation in that language yet.`, 404);
  }
  return row;
}

/**
 * SELECT ... FOR UPDATE on ONE translation row.
 *
 * The parent post is locked FIRST by every caller (lockPostForUpdate), so
 * revision numbering — which is MAX+1 per POST — serializes across
 * concurrent edits to DIFFERENT translations of the same post. Locking only
 * the translation would let two languages compute the same next revision
 * number.
 */
export async function lockTranslationForUpdate(
  tx: DbClient,
  postId: number,
  languageId: number,
): Promise<EditorialPostTranslation> {
  const [row] = await tx
    .select()
    .from(editorialPostTranslationsTable)
    .where(
      and(
        eq(editorialPostTranslationsTable.postId, postId),
        eq(editorialPostTranslationsTable.languageId, languageId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new EditorialRuleError(`This post has no translation in that language yet.`, 404);
  return row;
}

export async function listTranslations(
  client: DbClient,
  postId: number,
): Promise<Array<EditorialPostTranslation & { languageCode: string; languageName: string; languageDirection: string; languageIsActive: boolean }>> {
  const rows = await client
    .select({
      translation: editorialPostTranslationsTable,
      languageCode: editorialLanguagesTable.code,
      languageName: editorialLanguagesTable.name,
      languageDirection: editorialLanguagesTable.direction,
      languageIsActive: editorialLanguagesTable.isActive,
    })
    .from(editorialPostTranslationsTable)
    .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
    .where(eq(editorialPostTranslationsTable.postId, postId))
    .orderBy(asc(editorialLanguagesTable.displayOrder), asc(editorialLanguagesTable.code));
  return rows.map((row) => ({
    ...row.translation,
    languageCode: row.languageCode,
    languageName: row.languageName,
    languageDirection: row.languageDirection,
    languageIsActive: row.languageIsActive,
  }));
}

// ─── Slug resolution ────────────────────────────────────────────────────────

/**
 * Every slug already taken in one (channel, languageId) scope — the exact
 * scope of the database's UNIQUE constraint.
 *
 * `excludeTranslationId` lets a translation keep its own slug when being
 * edited (otherwise a no-op save would always look like a collision).
 */
async function takenSlugsInScope(
  client: DbClient,
  channel: EditorialChannel,
  languageId: number,
  excludeTranslationId?: number,
): Promise<Set<string>> {
  const rows = await client
    .select({ id: editorialPostTranslationsTable.id, slug: editorialPostTranslationsTable.slug })
    .from(editorialPostTranslationsTable)
    .where(
      and(
        eq(editorialPostTranslationsTable.channel, channel),
        eq(editorialPostTranslationsTable.languageId, languageId),
      ),
    );
  return new Set(rows.filter((row) => row.id !== excludeTranslationId).map((row) => row.slug));
}

export interface SlugResolution {
  slug: string;
  /** True when the slug was derived from the title rather than supplied. */
  generated: boolean;
}

/**
 * Decide the slug for a translation write.
 *
 * MANUAL slug: validated for canonical form (see editorialSlug.ts) and
 * checked for a collision in (channel, language). A manual collision is a
 * 409 the editor must resolve — NEVER silently suffixed or altered, because
 * an editor who typed a slug is making a URL promise and a silent rename
 * breaks it invisibly.
 *
 * AUTO-GENERATED slug: derived from the title, Unicode-safe (Arabic titles
 * yield Arabic slugs; no transliteration), then deterministically suffixed
 * "-2", "-3", … on collision within the same (channel, language).
 *
 * The check-then-insert here is a nicety, not the guarantee: the
 * (channel, language_id, slug) UNIQUE constraint is what actually prevents
 * a duplicate under concurrency, and the route maps its 23505 to a 409.
 * This function exists so the common case gets a good message.
 */
export async function resolveTranslationSlug(
  client: DbClient,
  opts: {
    channel: EditorialChannel;
    languageId: number;
    title: string;
    manualSlug?: string | null;
    excludeTranslationId?: number;
  },
): Promise<SlugResolution> {
  const taken = await takenSlugsInScope(client, opts.channel, opts.languageId, opts.excludeTranslationId);

  if (opts.manualSlug != null && opts.manualSlug.trim().length > 0) {
    const slug = opts.manualSlug.trim();
    const problem = describeSlugProblem(slug);
    if (problem) throw new EditorialRuleError(problem);
    if (taken.has(slug)) {
      throw new EditorialRuleError(
        `The slug "${slug}" is already used by another ${opts.channel} post in this language. Choose a different one.`,
        409,
      );
    }
    return { slug, generated: false };
  }

  const base = slugifyEditorialTitle(opts.title);
  if (base.length === 0) {
    throw new EditorialRuleError(
      "A slug could not be generated from this title (it contains no letters or numbers). Provide one explicitly.",
    );
  }
  return { slug: disambiguateEditorialSlug(base, taken), generated: true };
}

/**
 * SLUG IMMUTABILITY AFTER FIRST PUBLISH.
 *
 * A translation's slug may be changed freely until that translation is
 * published for the first time, and never afterwards — the URL has been
 * public, so changing it would break inbound links and silently orphan
 * anything pointing at it. Keyed on `published_at` rather than on the
 * current status, deliberately: a translation that was published and then
 * archived HAS had a public URL, so archiving must not reopen the slug for
 * editing.
 */
export function assertSlugEditable(translation: EditorialPostTranslation): void {
  if (translation.publishedAt != null) {
    throw new EditorialRuleError(
      "This translation's slug cannot be changed — it has already been published, and the URL is public. Create a new post if the address must change.",
      409,
    );
  }
}

// ─── Publish readiness (per translation) ────────────────────────────────────

export interface PublishReadinessDeps {
  media?: EditorialMediaValidationDeps;
}

/**
 * The full draft -> published gate FOR ONE TRANSLATION. Throws
 * EditorialRuleError on the FIRST failing rule, with a message naming
 * exactly what the editor must fix.
 *
 * Note which side of the model each rule reads from:
 *   translation  title, body, feature-image ALT, per-block alt, og image
 *   post         feature image URL, author
 *   language     must be active
 * That split is the readiness gate's whole point: a translation is not
 * publishable on its own prose alone — the shared spine has to be ready
 * too, and the language has to still be offered.
 */
export async function assertTranslationPublishReady(
  client: DbClient,
  post: EditorialPost,
  translation: EditorialPostTranslation,
  deps: PublishReadinessDeps = {},
): Promise<void> {
  // The language must still be offered. Checked FIRST: publishing into a
  // retired language is a category error, not a content problem.
  await assertLanguagePublishable(client, translation.languageId);

  if (translation.title.trim().length === 0) {
    throw new EditorialRuleError("A translation needs a title before it can be published.");
  }
  const blocks = translation.body?.blocks ?? [];
  if (blocks.length === 0) {
    throw new EditorialRuleError("A translation needs at least one body block before it can be published.");
  }
  // SHARED: the image belongs to the post...
  if (!post.featureImageUrl || post.featureImageUrl.trim().length === 0) {
    throw new EditorialRuleError("A post needs a feature image before any translation can be published.");
  }
  // ...but its ALT TEXT is prose, so it belongs to this translation.
  if (!translation.featureImageAlt || translation.featureImageAlt.trim().length === 0) {
    throw new EditorialRuleError(
      "This translation needs alt text for the feature image, in its own language, before it can be published.",
    );
  }

  // Alt text on EVERY image block — re-asserted over stored rows, not only
  // over the incoming payload.
  const missingAlt = findBlocksMissingAlt({ blocks: blocks as unknown as Array<Record<string, unknown>> });
  if (missingAlt.length > 0) {
    throw new EditorialRuleError(
      `Every image needs alt text before publishing (missing on block ${missingAlt.map((i) => i + 1).join(", ")}).`,
    );
  }

  // SHARED: the byline lives on the parent post.
  if (post.authorId == null) {
    throw new EditorialRuleError("A post needs an author before any translation can be published.");
  }
  const author = await loadAuthorOrThrow(client, post.authorId);
  if (author.status !== "active") {
    throw new EditorialRuleError(`Author "${author.publicName}" is archived — pick an active author before publishing.`);
  }
  if (!author.biography || author.biography.trim().length === 0) {
    throw new EditorialRuleError(
      `Author "${author.publicName}" has no biography — add one before publishing a post under this byline.`,
    );
  }

  // Every media URL the published page would load, re-validated at the
  // trust boundary at publish time (not merely at write time).
  const mediaUrls = [post.featureImageUrl, ...collectBodyImageUrls({ blocks: blocks as never })];
  if (translation.ogImageUrl) mediaUrls.push(translation.ogImageUrl);
  const mediaError = await validateEditorialMediaUrls(mediaUrls, deps.media);
  if (mediaError) throw new EditorialRuleError(mediaError.error);
}

// ─── Revisions ──────────────────────────────────────────────────────────────

export async function loadPostTopicIds(client: DbClient, postId: number): Promise<number[]> {
  const rows = await client
    .select({ topicId: editorialPostTopicsTable.topicId })
    .from(editorialPostTopicsTable)
    .where(eq(editorialPostTopicsTable.postId, postId))
    .orderBy(asc(editorialPostTopicsTable.topicId));
  return rows.map((row) => row.topicId);
}

/**
 * The prior state of ONE translation. Holds NOTHING that belongs to another
 * translation, and nothing post-level that a restore could clobber — which
 * is what makes restoring an Arabic revision structurally incapable of
 * touching English.
 */
export function buildTranslationRevisionSnapshot(
  translation: EditorialPostTranslation,
  languageCode: string,
): EditorialTranslationRevisionSnapshot {
  return {
    scope: "translation",
    languageId: translation.languageId,
    languageCode,
    title: translation.title,
    slug: translation.slug,
    deck: translation.deck,
    contextLabel: translation.contextLabel,
    body: translation.body,
    bodyVersion: translation.bodyVersion,
    featureImageAlt: translation.featureImageAlt,
    authorSnapshot: translation.authorSnapshot ?? null,
    readingTimeOverrideMinutes: translation.readingTimeOverrideMinutes,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    ogImageUrl: translation.ogImageUrl,
    status: translation.status,
    publishedAt: translation.publishedAt,
  };
}

/** The prior state of the SHARED spine. Deliberately holds no prose. */
export function buildSharedRevisionSnapshot(
  post: EditorialPost,
  topicIds: number[],
): EditorialSharedRevisionSnapshot {
  return {
    scope: "shared",
    authorId: post.authorId,
    featureImageUrl: post.featureImageUrl,
    topics: topicIds,
  };
}

/**
 * Next revision number for a post, computed as MAX+1 inside the caller's
 * transaction. Per-POST rather than per-translation: one coherent timeline
 * for the story, with `translation_id` naming the scope of each entry. The
 * caller must already hold a row lock on the parent post
 * (lockPostForUpdate) so two concurrent editors serialize rather than race
 * onto the same number.
 */
async function nextRevisionNumber(tx: DbClient, postId: number): Promise<number> {
  const [{ maxNumber }] = await tx
    .select({ maxNumber: sql<number>`coalesce(max(${editorialPostRevisionsTable.revisionNumber}), 0)` })
    .from(editorialPostRevisionsTable)
    .where(eq(editorialPostRevisionsTable.postId, postId));
  return Number(maxNumber) + 1;
}

/**
 * Insert the pre-change snapshot of ONE translation.
 *
 * MUST be called with a TRANSACTION client and BEFORE the mutation, so a
 * failure here (constraint violation, connection loss) rolls the whole
 * thing back and the translation is left untouched rather than mutated
 * without history. This is Wave 1's rollback guarantee, unchanged.
 */
export async function recordTranslationRevision(
  tx: DbClient,
  translation: EditorialPostTranslation,
  languageCode: string,
  eventType: EditorialTranslationRevisionEventType,
  actorAdminId: number | null,
): Promise<number> {
  const revisionNumber = await nextRevisionNumber(tx, translation.postId);
  await tx.insert(editorialPostRevisionsTable).values({
    postId: translation.postId,
    translationId: translation.id,
    revisionNumber,
    snapshot: buildTranslationRevisionSnapshot(translation, languageCode),
    eventType,
    createdByAdminId: actorAdminId,
  });
  return revisionNumber;
}

/** Snapshot-if-published, for one translation. Drafts keep no history. */
export async function recordTranslationRevisionIfPublished(
  tx: DbClient,
  translation: EditorialPostTranslation,
  languageCode: string,
  eventType: EditorialTranslationRevisionEventType,
  actorAdminId: number | null,
): Promise<number | null> {
  if (translation.status !== "published") return null;
  return recordTranslationRevision(tx, translation, languageCode, eventType, actorAdminId);
}

/**
 * Insert the pre-change snapshot of the SHARED spine.
 *
 * Written when a shared field changes on a post that currently has AT LEAST
 * ONE PUBLISHED TRANSLATION — i.e. when the change is visible to the
 * public in some language. Non-destructive to every translation's own
 * content by construction: the snapshot contains no prose and the restore
 * path for it writes only post-level columns and topic rows.
 */
export async function recordSharedRevisionIfAnyPublished(
  tx: DbClient,
  post: EditorialPost,
  eventType: EditorialSharedRevisionEventType,
  actorAdminId: number | null,
  topicIds?: number[],
): Promise<number | null> {
  if (!(await postHasPublishedTranslation(tx, post.id))) return null;
  const topics = topicIds ?? (await loadPostTopicIds(tx, post.id));
  const revisionNumber = await nextRevisionNumber(tx, post.id);
  await tx.insert(editorialPostRevisionsTable).values({
    postId: post.id,
    translationId: null,
    revisionNumber,
    snapshot: buildSharedRevisionSnapshot(post, topics),
    eventType,
    createdByAdminId: actorAdminId,
  });
  return revisionNumber;
}

// ─── Topics ─────────────────────────────────────────────────────────────────

/**
 * A topic may be assigned only when it is in the SAME channel as the post
 * and is still active. Both rules are cross-row and so cannot be database
 * CHECK constraints — this is their single enforcement point.
 *
 * Topics are assigned to the POST, shared by every translation. No Topic
 * localization was added in this wave.
 */
export async function assertTopicsAssignable(
  client: DbClient,
  channel: EditorialChannel,
  topicIds: readonly number[],
  currentTopicIds: readonly number[] = [],
): Promise<void> {
  const unique = [...new Set(topicIds)];
  if (unique.length !== topicIds.length) {
    throw new EditorialRuleError("The same topic was listed more than once.");
  }
  if (unique.length === 0) return;

  const rows = await client
    .select()
    .from(editorialTopicsTable)
    .where(inArray(editorialTopicsTable.id, unique));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const topicId of unique) {
    const topic = byId.get(topicId);
    if (!topic) throw new EditorialRuleError(`Topic ${topicId} not found.`, 404);
    if (topic.channel !== channel) {
      throw new EditorialRuleError(
        `Topic "${topic.name}" belongs to the ${topic.channel} channel and cannot be assigned to a ${channel} post.`,
      );
    }
    // An archived topic already on the post stays (history is never
    // rewritten); it simply cannot be NEWLY added.
    if (topic.status !== "active" && !currentTopicIds.includes(topicId)) {
      throw new EditorialRuleError(`Topic "${topic.name}" is archived and cannot be newly assigned.`);
    }
  }
}

export async function replacePostTopics(
  tx: DbClient,
  postId: number,
  topicIds: readonly number[],
): Promise<void> {
  await tx.delete(editorialPostTopicsTable).where(eq(editorialPostTopicsTable.postId, postId));
  const unique = [...new Set(topicIds)];
  if (unique.length === 0) return;
  await tx.insert(editorialPostTopicsTable).values(unique.map((topicId) => ({ postId, topicId })));
}

// ─── Recommendations (post relations) ───────────────────────────────────────

export interface RecommendationInput {
  targetPostId: number;
  position?: number;
}

/**
 * Recommendations must point at a real POST (not a translation), in the
 * same channel, never at the source itself, and never repeat a target. The
 * website resolves a recommended post into whichever language the reader is
 * in — which is why the relation is post-to-post and not
 * translation-to-translation.
 */
export async function assertRecommendationsValid(
  client: DbClient,
  source: EditorialPost,
  items: readonly RecommendationInput[],
): Promise<void> {
  const targetIds = items.map((item) => item.targetPostId);
  const unique = [...new Set(targetIds)];
  if (unique.length !== targetIds.length) {
    throw new EditorialRuleError("The same recommended post was listed more than once.");
  }
  if (unique.includes(source.id)) {
    throw new EditorialRuleError("A post cannot recommend itself.");
  }
  if (unique.length === 0) return;

  const rows = await client
    .select({ id: editorialPostsTable.id, channel: editorialPostsTable.channel })
    .from(editorialPostsTable)
    .where(inArray(editorialPostsTable.id, unique));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const targetId of unique) {
    const target = byId.get(targetId);
    if (!target) throw new EditorialRuleError(`Recommended post ${targetId} not found.`, 404);
    if (target.channel !== source.channel) {
      throw new EditorialRuleError(
        `Post ${targetId} is in the ${target.channel} channel and cannot be recommended from a ${source.channel} post.`,
      );
    }
  }
}

export async function replacePostRecommendations(
  tx: DbClient,
  sourcePostId: number,
  items: readonly RecommendationInput[],
): Promise<void> {
  await tx
    .delete(editorialPostRelationsTable)
    .where(
      and(
        eq(editorialPostRelationsTable.sourcePostId, sourcePostId),
        eq(editorialPostRelationsTable.relationType, "recommended"),
      ),
    );
  if (items.length === 0) return;
  await tx.insert(editorialPostRelationsTable).values(
    items.map((item, index) => ({
      sourcePostId,
      targetPostId: item.targetPostId,
      relationType: "recommended" as const,
      position: item.position ?? index,
    })),
  );
}

// ─── Placements ─────────────────────────────────────────────────────────────

export interface PlacementInput {
  postId: number;
  position?: number;
  startAt?: string | null;
  endAt?: string | null;
}

/**
 * Every post in a placement must be in the placement's channel, and a post
 * may appear at most once per key (also a DB UNIQUE, checked here first so
 * the editor gets a real message instead of a 23505).
 */
export async function assertPlacementValid(
  client: DbClient,
  channel: EditorialChannel,
  items: readonly PlacementInput[],
): Promise<void> {
  const postIds = items.map((item) => item.postId);
  const unique = [...new Set(postIds)];
  if (unique.length !== postIds.length) {
    throw new EditorialRuleError("A post can appear at most once in a placement.");
  }
  if (unique.length === 0) return;

  const rows = await client
    .select({ id: editorialPostsTable.id, channel: editorialPostsTable.channel })
    .from(editorialPostsTable)
    .where(inArray(editorialPostsTable.id, unique));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const postId of unique) {
    const post = byId.get(postId);
    if (!post) throw new EditorialRuleError(`Post ${postId} not found.`, 404);
    if (post.channel !== channel) {
      throw new EditorialRuleError(
        `Post ${postId} is in the ${post.channel} channel and cannot be placed in a ${channel} placement.`,
      );
    }
  }
  for (const item of items) {
    if (item.startAt && item.endAt && new Date(item.startAt) >= new Date(item.endAt)) {
      throw new EditorialRuleError("A placement's start must be before its end.");
    }
  }
}

/**
 * Replace one slot's entries wholesale.
 *
 * CHANNEL SCOPING (Wave 2.0 — Issue #23). The DELETE predicate names BOTH
 * `channel` and `key`. Scoped by `key` alone — as Wave 1 had it — a PUT of
 * experience:featured would DELETE every news:featured row as its first
 * statement, because the two channels share one free-text key namespace and
 * "featured" is the obvious slot name in each. They are independent
 * curation surfaces: a write to one must never be able to reach the other.
 */
export async function replacePlacement(
  tx: DbClient,
  key: string,
  channel: EditorialChannel,
  items: readonly PlacementInput[],
): Promise<void> {
  await tx
    .delete(editorialPlacementsTable)
    .where(
      and(
        eq(editorialPlacementsTable.channel, channel),
        eq(editorialPlacementsTable.key, key),
      ),
    );
  if (items.length === 0) return;
  await tx.insert(editorialPlacementsTable).values(
    items.map((item, index) => ({
      key,
      channel,
      postId: item.postId,
      position: item.position ?? index,
      startAt: item.startAt ?? null,
      endAt: item.endAt ?? null,
    })),
  );
}

// ─── Translation transitions ────────────────────────────────────────────────

export interface TransitionContext {
  actor: ActivityActorSnapshot;
  actorAdminId: number | null;
  deps?: PublishReadinessDeps;
}

/** Everything a transition needs, loaded and locked in the right order. */
async function lockPostAndTranslation(
  tx: DbClient,
  postId: number,
  languageId: number,
): Promise<{ post: EditorialPost; translation: EditorialPostTranslation; language: EditorialLanguage }> {
  // Parent post FIRST: revision numbering is per-post, so the post row is
  // the serialization point for edits to any of its translations.
  const post = await lockPostForUpdate(tx, postId);
  const translation = await lockTranslationForUpdate(tx, postId, languageId);
  const language = await loadLanguageOrThrow(tx, languageId);
  return { post, translation, language };
}

/**
 * draft|archived -> published, for ONE translation, entirely inside one
 * transaction:
 *   lock post -> lock translation -> assert transition legal ->
 *   assert publish-ready (incl. language active) ->
 *   update status/publishedAt/authorSnapshot -> write the audit row.
 *
 * `published_at` is stamped only when currently NULL, so re-publishing an
 * archived translation preserves its original publication date — and,
 * because the WHERE clause names this translation's id alone, stamping it
 * cannot touch any sibling translation's own publishedAt.
 */
export async function publishTranslation(
  postId: number,
  languageId: number,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const { post, translation, language } = await lockPostAndTranslation(tx, postId, languageId);
    assertTransitionAllowed(translation.status, "published");
    await assertTranslationPublishReady(tx, post, translation, ctx.deps);

    const author = await loadAuthorOrThrow(tx, post.authorId!);
    const [updated] = await tx
      .update(editorialPostTranslationsTable)
      .set({
        status: "published",
        publishedAt: translation.publishedAt ?? new Date().toISOString(),
        // Frozen at THIS translation's publish moment.
        authorSnapshot: buildAuthorSnapshot(author),
        updatedByAdminId: ctx.actorAdminId,
      })
      .where(eq(editorialPostTranslationsTable.id, translation.id))
      .returning();

    // Inside the SAME transaction as the state change — a failed audit
    // write rolls the publish back rather than publishing silently.
    await auditEditorial(tx, ctx.actor, {
      action: "translation_published",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: translation.status, publishedAt: translation.publishedAt },
      after: { status: updated.status, publishedAt: updated.publishedAt },
      summary: `Published the ${language.code} translation of ${post.channel} post #${post.id} — "${updated.title}"`,
    });
    return updated;
  });
}

/** draft|published -> archived, for one translation. Revision when leaving published. */
export async function archiveTranslation(
  postId: number,
  languageId: number,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const { post, translation, language } = await lockPostAndTranslation(tx, postId, languageId);
    assertTransitionAllowed(translation.status, "archived");
    await recordTranslationRevisionIfPublished(
      tx,
      translation,
      language.code,
      "translation_status_change",
      ctx.actorAdminId,
    );

    const [updated] = await tx
      .update(editorialPostTranslationsTable)
      .set({ status: "archived", updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialPostTranslationsTable.id, translation.id))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "translation_archived",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: translation.status },
      after: { status: updated.status },
      summary: `Archived the ${language.code} translation of ${post.channel} post #${post.id} — "${updated.title}"`,
    });
    return updated;
  });
}

/** archived -> draft, for one translation. publishedAt is preserved, never cleared. */
export async function restoreTranslationToDraft(
  postId: number,
  languageId: number,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const { post, translation, language } = await lockPostAndTranslation(tx, postId, languageId);
    assertTransitionAllowed(translation.status, "draft");

    const [updated] = await tx
      .update(editorialPostTranslationsTable)
      .set({ status: "draft", updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialPostTranslationsTable.id, translation.id))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "translation_restored",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: translation.status },
      after: { status: updated.status },
      summary: `Restored the ${language.code} translation of ${post.channel} post #${post.id} to draft`,
    });
    return updated;
  });
}

// ─── Translation create / edit ──────────────────────────────────────────────

export interface CreateTranslationInput {
  languageId: number;
  title: string;
  slug?: string | null;
  deck?: string | null;
  contextLabel?: string | null;
  featureImageAlt?: string | null;
  body: { blocks: unknown[] };
  readingTimeOverrideMinutes?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
}

/**
 * Add a language to an existing post. ALWAYS created as a DRAFT — putting
 * content live is the publish endpoint's job and requires the separate
 * `publish` permission.
 *
 * `channel` is NOT written here: the
 * `sync_editorial_translation_channel` database trigger derives it from
 * the parent post, so this code cannot get it wrong.
 */
export async function createTranslation(
  postId: number,
  input: CreateTranslationInput,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);
    // A NEW translation may only be added in an ACTIVE language.
    const language = await assertLanguageAssignable(tx, input.languageId);

    const existing = await tx
      .select({ id: editorialPostTranslationsTable.id })
      .from(editorialPostTranslationsTable)
      .where(
        and(
          eq(editorialPostTranslationsTable.postId, postId),
          eq(editorialPostTranslationsTable.languageId, input.languageId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new EditorialRuleError(
        `This post already has a ${language.code} translation. Edit that one instead.`,
        409,
      );
    }

    const { slug } = await resolveTranslationSlug(tx, {
      channel: post.channel,
      languageId: input.languageId,
      title: input.title,
      manualSlug: input.slug ?? null,
    });

    const [row] = await tx
      .insert(editorialPostTranslationsTable)
      .values({
        postId,
        languageId: input.languageId,
        // Overwritten by the trigger from the parent post; supplied only
        // because the column is NOT NULL and Drizzle requires a value.
        channel: post.channel,
        title: input.title,
        slug,
        status: "draft",
        deck: input.deck ?? null,
        contextLabel: input.contextLabel ?? null,
        featureImageAlt: input.featureImageAlt ?? null,
        body: input.body as never,
        readingTimeOverrideMinutes: input.readingTimeOverrideMinutes ?? null,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        ogImageUrl: input.ogImageUrl ?? null,
        updatedByAdminId: ctx.actorAdminId,
      })
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "translation_created",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: row.id,
      entityLabel: row.title,
      after: translationAuditFields(row),
      summary: `Added a ${language.code} draft translation to ${post.channel} post #${post.id} — "${row.title}"`,
    });
    return row;
  });
}

export interface UpdateTranslationInput {
  title?: string;
  slug?: string;
  deck?: string | null;
  contextLabel?: string | null;
  featureImageAlt?: string | null;
  body?: { blocks: unknown[] };
  readingTimeOverrideMinutes?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
}

/**
 * Edit ONE translation's own content.
 *
 * When that translation is CURRENTLY PUBLISHED, the revision insert and the
 * update happen in one transaction, REVISION FIRST — if the revision write
 * fails the mutation is rolled back and the live translation is untouched.
 * Drafts and archived translations are working copy and make no revision.
 * This is Wave 1's exact pattern, scoped to the translation.
 *
 * `publishedAt` is never written here, on any path. Neither is any other
 * translation's row: the UPDATE names this translation's id.
 */
export async function updateTranslation(
  postId: number,
  languageId: number,
  input: UpdateTranslationInput,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const { post, translation, language } = await lockPostAndTranslation(tx, postId, languageId);

    // (a) revision of the PRE-change live state, before any mutation.
    await recordTranslationRevisionIfPublished(
      tx,
      translation,
      language.code,
      "published_edit",
      ctx.actorAdminId,
    );

    const updates: Record<string, unknown> = { updatedByAdminId: ctx.actorAdminId };
    for (const key of [
      "title", "deck", "contextLabel", "featureImageAlt", "body",
      "readingTimeOverrideMinutes", "seoTitle", "seoDescription", "ogImageUrl",
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    // Slug: only before this translation's first publish, and a manual
    // collision is a 409 rather than a silent rename.
    let slugChanged = false;
    if (input.slug !== undefined && input.slug !== translation.slug) {
      assertSlugEditable(translation);
      const { slug } = await resolveTranslationSlug(tx, {
        channel: post.channel,
        languageId,
        title: input.title ?? translation.title,
        manualSlug: input.slug,
        excludeTranslationId: translation.id,
      });
      updates["slug"] = slug;
      slugChanged = true;
    }

    // (b) the mutation — scoped to this ONE translation row.
    const [updated] = await tx
      .update(editorialPostTranslationsTable)
      .set(updates)
      .where(eq(editorialPostTranslationsTable.id, translation.id))
      .returning();

    // (c) audit, same transaction.
    await auditEditorial(tx, ctx.actor, {
      action: slugChanged ? "translation_slug_changed" : "translation_edited",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: updated.id,
      entityLabel: updated.title,
      before: translationAuditFields(translation),
      after: translationAuditFields(updated),
      summary: slugChanged
        ? `Changed the ${language.code} slug of ${post.channel} post #${post.id} from "${translation.slug}" to "${updated.slug}" (pre-publish)`
        : `Edited the ${translation.status} ${language.code} translation of ${post.channel} post #${post.id} — "${updated.title}"`,
    });
    return updated;
  });
}

/**
 * Restore ONE translation's content from a revision.
 *
 * A NEW revision of the pre-restore state is written first (eventType
 * 'restore'), in the same transaction, so restoring is itself undoable.
 *
 * TRANSLATION ISOLATION, structurally: the revision row is required to be
 * translation-scoped (translation_id NOT NULL, enforced by a CHECK), the
 * composite FK guarantees it belongs to this post, the UPDATE is keyed on
 * that revision's own translation_id, and the snapshot carries no column
 * that exists on a sibling translation. Restoring an Arabic revision
 * therefore cannot write the English row.
 *
 * DELIBERATELY DOES NOT restore `status` or `publishedAt` from the
 * snapshot: a revision restores CONTENT, never lifecycle. Nor does it
 * restore `slug`, which is immutable once published and would otherwise
 * change a live URL behind the editor's back.
 */
export async function restoreTranslationRevision(
  postId: number,
  revisionId: number,
  ctx: TransitionContext,
): Promise<EditorialPostTranslation> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);
    const [revision] = await tx
      .select()
      .from(editorialPostRevisionsTable)
      .where(
        and(
          eq(editorialPostRevisionsTable.id, revisionId),
          eq(editorialPostRevisionsTable.postId, postId),
        ),
      )
      .limit(1);
    if (!revision) throw new EditorialRuleError("Revision not found.", 404);
    if (revision.translationId == null || revision.snapshot.scope !== "translation") {
      throw new EditorialRuleError(
        "That revision records a shared post change (author, topics, or feature image), not one language's content, so there is no translation to restore.",
      );
    }

    const translation = await lockTranslationForUpdate(tx, postId, revision.snapshot.languageId);
    const language = await loadLanguageOrThrow(tx, translation.languageId);

    // Snapshot the CURRENT state first — restoring is undoable.
    await recordTranslationRevision(tx, translation, language.code, "restore", ctx.actorAdminId);

    const snapshot = revision.snapshot;
    const [updated] = await tx
      .update(editorialPostTranslationsTable)
      .set({
        title: snapshot.title,
        deck: snapshot.deck,
        contextLabel: snapshot.contextLabel,
        body: snapshot.body,
        bodyVersion: snapshot.bodyVersion,
        featureImageAlt: snapshot.featureImageAlt,
        authorSnapshot: snapshot.authorSnapshot,
        readingTimeOverrideMinutes: snapshot.readingTimeOverrideMinutes,
        seoTitle: snapshot.seoTitle,
        seoDescription: snapshot.seoDescription,
        ogImageUrl: snapshot.ogImageUrl,
        updatedByAdminId: ctx.actorAdminId,
      })
      .where(eq(editorialPostTranslationsTable.id, translation.id))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "translation_revision_restored",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: updated.id,
      entityLabel: updated.title,
      before: { revisionNumber: null },
      after: { revisionNumber: revision.revisionNumber, languageCode: language.code },
      summary: `Restored the ${language.code} translation of ${post.channel} post #${post.id} from revision #${revision.revisionNumber}`,
    });
    return updated;
  });
}

// ─── Shared post field changes ──────────────────────────────────────────────

export interface UpdatePostSharedInput {
  authorId?: number | null;
  featureImageUrl?: string | null;
}

/**
 * Change the SHARED spine: the byline and/or the single feature image URL.
 *
 * Non-destructive to every translation by construction — no translation row
 * is written at all. In particular a feature-image URL change does NOT
 * clear or rewrite any translation's localized `featureImageAlt`: the alt
 * text may well still be accurate, and silently blanking it would
 * un-publish-ready every language at once. (An editor who swaps the image
 * for an unrelated one is expected to update the alt text per language; the
 * publish gate re-checks alt text on every subsequent publish.)
 *
 * When the post has AT LEAST ONE PUBLISHED TRANSLATION, a shared revision
 * is written first, in the same transaction, so the pre-change spine is
 * recoverable.
 *
 * AUTHOR CHANGE also regenerates the frozen `author_snapshot` on every
 * PUBLISHED translation — those are the ones whose byline the public is
 * currently seeing. Draft translations keep a null snapshot and generate
 * theirs at their own publish time. This is the one shared operation that
 * legitimately writes translation rows, and it writes only the byline
 * field, never any prose; a translation-scoped revision is taken for each
 * published translation it touches, so each language's history records it.
 */
export async function updatePostSharedFields(
  postId: number,
  input: UpdatePostSharedInput,
  ctx: TransitionContext,
): Promise<EditorialPost> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);

    const authorChanged = input.authorId !== undefined && input.authorId !== post.authorId;
    const imageChanged =
      input.featureImageUrl !== undefined && input.featureImageUrl !== post.featureImageUrl;
    if (!authorChanged && !imageChanged) return post;

    // THE AUTHOR CHANNEL RULE, at the write path that changes author_id.
    let newAuthor: Awaited<ReturnType<typeof loadAssignableAuthorOrThrow>> | null = null;
    if (authorChanged && input.authorId != null) {
      newAuthor = await assertAuthorAssignableToChannel(tx, post.channel, input.authorId);
    }

    const anyPublished = await postHasPublishedTranslation(tx, post.id);

    // (a) shared revision of the PRE-change spine.
    if (anyPublished) {
      await recordSharedRevisionIfAnyPublished(
        tx,
        post,
        authorChanged && !imageChanged ? "author_change" : "shared_field_change",
        ctx.actorAdminId,
      );
    }

    const updates: Record<string, unknown> = { updatedByAdminId: ctx.actorAdminId };
    if (authorChanged) updates["authorId"] = input.authorId;
    if (imageChanged) updates["featureImageUrl"] = input.featureImageUrl;

    const [updated] = await tx
      .update(editorialPostsTable)
      .set(updates)
      .where(eq(editorialPostsTable.id, postId))
      .returning();

    // (b) refresh the frozen byline on PUBLISHED translations only, taking
    // a per-translation revision for each so no language's history has a
    // gap. Prose is never touched.
    if (authorChanged) {
      const published = await tx
        .select({
          translation: editorialPostTranslationsTable,
          languageCode: editorialLanguagesTable.code,
        })
        .from(editorialPostTranslationsTable)
        .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
        .where(
          and(
            eq(editorialPostTranslationsTable.postId, postId),
            eq(editorialPostTranslationsTable.status, "published"),
          ),
        )
        .for("update");

      const snapshot = newAuthor ? buildAuthorSnapshot(newAuthor) : null;
      for (const row of published) {
        await recordTranslationRevision(
          tx,
          row.translation,
          row.languageCode,
          "published_edit",
          ctx.actorAdminId,
        );
        await tx
          .update(editorialPostTranslationsTable)
          .set({ authorSnapshot: snapshot, updatedByAdminId: ctx.actorAdminId })
          .where(eq(editorialPostTranslationsTable.id, row.translation.id));
      }
    }

    // (c) audit, same transaction.
    await auditEditorial(tx, ctx.actor, {
      action: authorChanged && imageChanged
        ? "shared_fields_changed"
        : authorChanged
          ? "author_changed"
          : "feature_image_changed",
      entityId: updated.id,
      entityLabel: `${updated.channel} post #${updated.id}`,
      before: { authorId: post.authorId, featureImageUrl: post.featureImageUrl },
      after: { authorId: updated.authorId, featureImageUrl: updated.featureImageUrl },
      summary: authorChanged && imageChanged
        ? `Changed the author and feature image of ${updated.channel} post #${updated.id}`
        : authorChanged
          ? `Changed the author of ${updated.channel} post #${updated.id}`
          : `Changed the feature image of ${updated.channel} post #${updated.id}`,
    });
    return updated;
  });
}

// ─── Post creation ──────────────────────────────────────────────────────────

export interface CreatePostInput {
  channel: EditorialChannel;
  authorId?: number | null;
  featureImageUrl?: string | null;
  /** Optional first translation, created in the same transaction. */
  translation?: CreateTranslationInput;
}

/**
 * Create the shared post record, optionally with its first translation in
 * the same transaction — a post with no translation at all is legal (an
 * editor may set up the spine first) but is not publishable in any
 * language, so the common path supplies one.
 */
export async function createPost(
  input: CreatePostInput,
  ctx: TransitionContext,
): Promise<{ post: EditorialPost; translation: EditorialPostTranslation | null }> {
  return db.transaction(async (tx) => {
    if (input.authorId != null) {
      await assertAuthorAssignableToChannel(tx, input.channel, input.authorId);
    }

    const [post] = await tx
      .insert(editorialPostsTable)
      .values({
        channel: input.channel,
        authorId: input.authorId ?? null,
        featureImageUrl: input.featureImageUrl ?? null,
        updatedByAdminId: ctx.actorAdminId,
      })
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "create",
      entityId: post.id,
      entityLabel: `${post.channel} post #${post.id}`,
      after: { channel: post.channel, authorId: post.authorId, featureImageUrl: post.featureImageUrl },
      summary: `Created ${post.channel} post #${post.id}`,
    });

    if (!input.translation) return { post, translation: null };

    const language = await assertLanguageAssignable(tx, input.translation.languageId);
    const { slug } = await resolveTranslationSlug(tx, {
      channel: post.channel,
      languageId: input.translation.languageId,
      title: input.translation.title,
      manualSlug: input.translation.slug ?? null,
    });

    const [translation] = await tx
      .insert(editorialPostTranslationsTable)
      .values({
        postId: post.id,
        languageId: input.translation.languageId,
        channel: post.channel, // derived by trigger; see createTranslation
        title: input.translation.title,
        slug,
        status: "draft",
        deck: input.translation.deck ?? null,
        contextLabel: input.translation.contextLabel ?? null,
        featureImageAlt: input.translation.featureImageAlt ?? null,
        body: input.translation.body as never,
        readingTimeOverrideMinutes: input.translation.readingTimeOverrideMinutes ?? null,
        seoTitle: input.translation.seoTitle ?? null,
        seoDescription: input.translation.seoDescription ?? null,
        ogImageUrl: input.translation.ogImageUrl ?? null,
        updatedByAdminId: ctx.actorAdminId,
      })
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "translation_created",
      entityType: EDITORIAL_TRANSLATION_ENTITY_TYPE,
      entityId: translation.id,
      entityLabel: translation.title,
      after: translationAuditFields(translation),
      summary: `Added a ${language.code} draft translation to ${post.channel} post #${post.id} — "${translation.title}"`,
    });
    return { post, translation };
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TRANSLATION_AUDIT_FIELDS = [
  "languageId", "title", "slug", "deck", "contextLabel", "featureImageAlt",
  "bodyVersion", "status", "publishedAt", "readingTimeOverrideMinutes",
  "seoTitle", "seoDescription", "ogImageUrl",
] as const;

/**
 * Audit projection for a translation. Deliberately EXCLUDES `body` — a
 * 250-block document in every audit row would bloat admin_activity_logs for
 * no benefit, and the full prior body is already preserved in
 * editorial_post_revisions where it belongs.
 */
export function translationAuditFields(row: EditorialPostTranslation): Record<string, unknown> {
  return Object.fromEntries(
    TRANSLATION_AUDIT_FIELDS.map((key) => [key, row[key as keyof EditorialPostTranslation]]),
  );
}
