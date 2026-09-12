/**
 * editorialPostsService — Unified Editorial CMS Wave 1 lifecycle, revision,
 * and integrity rules.
 *
 * Everything here is pure application logic over a `DbClient` (root db OR a
 * transaction handle), so the route layer stays thin and every rule is
 * testable without HTTP.
 *
 * THE THREE INVARIANTS THIS FILE EXISTS TO GUARANTEE
 *
 * 1. LIFECYCLE. draft -> published | archived; published -> archived;
 *    archived -> draft. `published -> draft` is NOT a legal transition:
 *    unpublishing must go through `archived` so there is always an explicit,
 *    audited "taken off the site" event rather than a post silently
 *    reverting to a working copy. Publishing enforces a full readiness gate
 *    (title, body, feature image + alt, an active author WITH a biography,
 *    alt text on every image block, and every media URL re-validated).
 *    `published_at` is stamped once, on the first publish, and is never
 *    changed by a later edit or re-publish.
 *
 * 2. REVISIONS. Any change to a post that is CURRENTLY PUBLISHED — content,
 *    author, topics, or recommendations — first snapshots the pre-change
 *    live state into editorial_post_revisions, in the SAME transaction as
 *    the mutation. If the revision insert fails, the transaction rolls back
 *    and the mutation does not happen. Drafts are working copy and make no
 *    revisions (that is the point of a draft).
 *
 * 3. AUDIT ATOMICITY. The audit row for the publish transition is written
 *    inside that same transaction via logActivityWithActorStrict (the
 *    existing activityLog service's transactional variant, which propagates
 *    failures instead of swallowing them). No shared infrastructure was
 *    changed to achieve this — the strict variant already existed and
 *    already accepts an arbitrary client.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  editorialAuthorsTable,
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostRevisionsTable,
  editorialPostTopicsTable,
  editorialPostsTable,
  editorialTopicsTable,
  type EditorialAuthorSnapshot,
  type EditorialChannel,
  type EditorialPost,
  type EditorialPostStatus,
  type EditorialRevisionEventType,
  type EditorialRevisionSnapshot,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import {
  logActivityWithActorStrict,
  type ActivityActorSnapshot,
  type ActivityLogEntry,
} from "./activityLog";
import { collectBodyImageUrls, findBlocksMissingAlt } from "./editorialBody";
import {
  validateEditorialMediaUrls,
  type EditorialMediaValidationDeps,
} from "./editorialMediaUrl";

/** Domain error carrying the HTTP status the route should answer with. */
export class EditorialRuleError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "EditorialRuleError";
  }
}

export const EDITORIAL_AUDIT_MODULE = "website.posts";
const EDITORIAL_ENTITY_TYPE = "editorial_post";

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * The complete legal transition table. Anything not listed is rejected —
 * notably published -> draft, which is deliberately absent.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<EditorialPostStatus, readonly EditorialPostStatus[]>> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export function assertTransitionAllowed(from: EditorialPostStatus, to: EditorialPostStatus): void {
  if (from === to) {
    throw new EditorialRuleError(`This post is already ${to}.`, 409);
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const hint =
      from === "published" && to === "draft"
        ? " Archive the post first, then restore it to draft."
        : "";
    throw new EditorialRuleError(`Cannot move a post from ${from} to ${to}.${hint}`, 409);
  }
}

// ─── Author snapshot ────────────────────────────────────────────────────────

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
 * posts keep their frozen snapshot, which is the whole reason the snapshot
 * exists.
 */
export async function loadAssignableAuthorOrThrow(client: DbClient, authorId: number) {
  const author = await loadAuthorOrThrow(client, authorId);
  if (author.status !== "active") {
    throw new EditorialRuleError(`Author "${author.publicName}" is archived and cannot be assigned.`);
  }
  return author;
}

// ─── Publish readiness ──────────────────────────────────────────────────────

export interface PublishReadinessDeps {
  media?: EditorialMediaValidationDeps;
}

/**
 * The full draft -> published gate. Throws EditorialRuleError on the FIRST
 * failing rule, with a message naming exactly what the editor must fix.
 */
export async function assertPublishReady(
  client: DbClient,
  post: EditorialPost,
  deps: PublishReadinessDeps = {},
): Promise<void> {
  if (post.title.trim().length === 0) {
    throw new EditorialRuleError("A post needs a title before it can be published.");
  }
  const blocks = post.body?.blocks ?? [];
  if (blocks.length === 0) {
    throw new EditorialRuleError("A post needs at least one body block before it can be published.");
  }
  if (!post.featureImageUrl || post.featureImageUrl.trim().length === 0) {
    throw new EditorialRuleError("A post needs a feature image before it can be published.");
  }
  if (!post.featureImageAlt || post.featureImageAlt.trim().length === 0) {
    throw new EditorialRuleError("A post's feature image needs alt text before it can be published.");
  }

  // Alt text on EVERY image block — re-asserted over stored rows, not only
  // over the incoming payload.
  const missingAlt = findBlocksMissingAlt({ blocks: blocks as unknown as Array<Record<string, unknown>> });
  if (missingAlt.length > 0) {
    throw new EditorialRuleError(
      `Every image needs alt text before publishing (missing on block ${missingAlt.map((i) => i + 1).join(", ")}).`,
    );
  }

  if (post.authorId == null) {
    throw new EditorialRuleError("A post needs an author before it can be published.");
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
  if (post.ogImageUrl) mediaUrls.push(post.ogImageUrl);
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

export function buildRevisionSnapshot(post: EditorialPost, topicIds: number[]): EditorialRevisionSnapshot {
  return {
    title: post.title,
    deck: post.deck,
    contextLabel: post.contextLabel,
    body: post.body,
    bodyVersion: post.bodyVersion,
    featureImageUrl: post.featureImageUrl,
    featureImageAlt: post.featureImageAlt,
    authorId: post.authorId,
    authorSnapshot: post.authorSnapshot ?? null,
    topics: topicIds,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    ogImageUrl: post.ogImageUrl,
    status: post.status,
    publishedAt: post.publishedAt,
  };
}

/**
 * Insert the pre-change snapshot of a currently-published post.
 *
 * MUST be called with a TRANSACTION client and BEFORE the mutation, so a
 * failure here (unique collision, constraint violation, connection loss)
 * rolls the whole thing back and the post is left untouched rather than
 * mutated without history.
 *
 * revision_number is computed as MAX+1 inside the same transaction; the
 * caller is expected to have taken a row lock on the parent post
 * (lockPostForUpdate) so two concurrent editors serialize rather than race
 * onto the same number.
 */
export async function recordRevision(
  tx: DbClient,
  post: EditorialPost,
  eventType: EditorialRevisionEventType,
  actorAdminId: number | null,
  topicIds?: number[],
): Promise<number> {
  const topics = topicIds ?? (await loadPostTopicIds(tx, post.id));
  const [{ maxNumber }] = await tx
    .select({ maxNumber: sql<number>`coalesce(max(${editorialPostRevisionsTable.revisionNumber}), 0)` })
    .from(editorialPostRevisionsTable)
    .where(eq(editorialPostRevisionsTable.postId, post.id));

  const revisionNumber = Number(maxNumber) + 1;
  await tx.insert(editorialPostRevisionsTable).values({
    postId: post.id,
    revisionNumber,
    snapshot: buildRevisionSnapshot(post, topics),
    eventType,
    createdByAdminId: actorAdminId,
  });
  return revisionNumber;
}

/**
 * Snapshot-if-published. Returns the revision number when one was written,
 * or null for a draft/archived post (no history is kept for working copy).
 */
export async function recordRevisionIfPublished(
  tx: DbClient,
  post: EditorialPost,
  eventType: EditorialRevisionEventType,
  actorAdminId: number | null,
  topicIds?: number[],
): Promise<number | null> {
  if (post.status !== "published") return null;
  return recordRevision(tx, post, eventType, actorAdminId, topicIds);
}

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

// ─── Topics ─────────────────────────────────────────────────────────────────

/**
 * A topic may be assigned only when it is in the SAME channel as the post
 * and is still active. Both rules are cross-row and so cannot be database
 * CHECK constraints — this is their single enforcement point.
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
 * Recommendations must point at a real post, in the same channel, never at
 * the source itself, and never repeat a target. (Self-reference is also a
 * DB CHECK; the channel and existence rules need cross-row lookups.)
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
    .select({ id: editorialPostsTable.id, channel: editorialPostsTable.channel, title: editorialPostsTable.title })
    .from(editorialPostsTable)
    .where(inArray(editorialPostsTable.id, unique));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const targetId of unique) {
    const target = byId.get(targetId);
    if (!target) throw new EditorialRuleError(`Recommended post ${targetId} not found.`, 404);
    if (target.channel !== source.channel) {
      throw new EditorialRuleError(
        `"${target.title}" is in the ${target.channel} channel and cannot be recommended from a ${source.channel} post.`,
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
    .select({ id: editorialPostsTable.id, channel: editorialPostsTable.channel, title: editorialPostsTable.title })
    .from(editorialPostsTable)
    .where(inArray(editorialPostsTable.id, unique));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const postId of unique) {
    const post = byId.get(postId);
    if (!post) throw new EditorialRuleError(`Post ${postId} not found.`, 404);
    if (post.channel !== channel) {
      throw new EditorialRuleError(
        `"${post.title}" is in the ${post.channel} channel and cannot be placed in a ${channel} placement.`,
      );
    }
  }
  for (const item of items) {
    if (item.startAt && item.endAt && new Date(item.startAt) >= new Date(item.endAt)) {
      throw new EditorialRuleError("A placement's start must be before its end.");
    }
  }
}

export async function replacePlacement(
  tx: DbClient,
  key: string,
  channel: EditorialChannel,
  items: readonly PlacementInput[],
): Promise<void> {
  await tx.delete(editorialPlacementsTable).where(eq(editorialPlacementsTable.key, key));
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

// ─── Audit helper ───────────────────────────────────────────────────────────

/**
 * Write an editorial audit row on the given client. Called with a
 * transaction handle for transitions whose audit row is part of the atomic
 * outcome (publish/archive/restore) — logActivityWithActorStrict
 * propagates failures so an unaudited state change cannot commit.
 */
export async function auditEditorial(
  client: DbClient,
  actor: ActivityActorSnapshot,
  entry: Omit<ActivityLogEntry, "module" | "entityType"> & { entityType?: string },
): Promise<void> {
  await logActivityWithActorStrict(client, actor, {
    module: EDITORIAL_AUDIT_MODULE,
    entityType: entry.entityType ?? EDITORIAL_ENTITY_TYPE,
    action: entry.action,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    before: entry.before,
    after: entry.after,
    summary: entry.summary,
  });
}

// ─── Transitions ────────────────────────────────────────────────────────────

export interface TransitionContext {
  actor: ActivityActorSnapshot;
  actorAdminId: number | null;
  deps?: PublishReadinessDeps;
}

/**
 * draft -> published, entirely inside ONE transaction:
 *   lock post -> assert transition legal -> assert publish-ready ->
 *   update status/publishedAt/authorSnapshot -> write the audit row.
 *
 * `published_at` is stamped only when currently null, so re-publishing an
 * archived post preserves its original publication date.
 */
export async function publishPost(postId: number, ctx: TransitionContext): Promise<EditorialPost> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);
    assertTransitionAllowed(post.status, "published");
    await assertPublishReady(tx, post, ctx.deps);

    const author = await loadAuthorOrThrow(tx, post.authorId!);
    const [updated] = await tx
      .update(editorialPostsTable)
      .set({
        status: "published",
        publishedAt: post.publishedAt ?? new Date().toISOString(),
        authorSnapshot: buildAuthorSnapshot(author),
        updatedByAdminId: ctx.actorAdminId,
      })
      .where(eq(editorialPostsTable.id, postId))
      .returning();

    // Inside the SAME transaction as the state change — a failed audit
    // write rolls the publish back rather than publishing silently.
    await auditEditorial(tx, ctx.actor, {
      action: "publish",
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: post.status, publishedAt: post.publishedAt },
      after: { status: updated.status, publishedAt: updated.publishedAt },
      summary: `Published ${updated.channel} post "${updated.title}"`,
    });
    return updated;
  });
}

/** draft|published -> archived. Revision is taken when leaving published. */
export async function archivePost(postId: number, ctx: TransitionContext): Promise<EditorialPost> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);
    assertTransitionAllowed(post.status, "archived");
    await recordRevisionIfPublished(tx, post, "published_edit", ctx.actorAdminId);

    const [updated] = await tx
      .update(editorialPostsTable)
      .set({ status: "archived", updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialPostsTable.id, postId))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "archive",
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: post.status },
      after: { status: updated.status },
      summary: `Archived ${updated.channel} post "${updated.title}"`,
    });
    return updated;
  });
}

/** archived -> draft. publishedAt is preserved, never cleared. */
export async function restorePostToDraft(postId: number, ctx: TransitionContext): Promise<EditorialPost> {
  return db.transaction(async (tx) => {
    const post = await lockPostForUpdate(tx, postId);
    assertTransitionAllowed(post.status, "draft");

    const [updated] = await tx
      .update(editorialPostsTable)
      .set({ status: "draft", updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialPostsTable.id, postId))
      .returning();

    await auditEditorial(tx, ctx.actor, {
      action: "restore",
      entityId: updated.id,
      entityLabel: updated.title,
      before: { status: post.status },
      after: { status: updated.status },
      summary: `Restored ${updated.channel} post "${updated.title}" to draft`,
    });
    return updated;
  });
}
