import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db,
  editorialAuthorsTable,
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostRevisionsTable,
  editorialPostTopicsTable,
  editorialPostsTable,
  editorialTopicsTable,
  type EditorialChannel,
  type EditorialPost,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { adminActivityActor, logActivity } from "../lib/activityLog";
import { logger } from "../lib/logger";
import { captureError } from "../lib/errorMonitoring";
import { editorialBodySchema, collectBodyImageUrls } from "../lib/editorialBody";
import { validateEditorialMediaUrls } from "../lib/editorialMediaUrl";
import {
  EditorialRuleError,
  archivePost,
  assertPlacementValid,
  assertRecommendationsValid,
  assertTopicsAssignable,
  auditEditorial,
  buildAuthorSnapshot,
  loadAssignableAuthorOrThrow,
  loadPostOrThrow,
  loadPostTopicIds,
  lockPostForUpdate,
  publishPost,
  recordRevision,
  recordRevisionIfPublished,
  replacePlacement,
  replacePostRecommendations,
  replacePostTopics,
  restorePostToDraft,
} from "../lib/editorialPostsService";
import {
  ListEditorialPostsQueryParams,
  ListEditorialPostsResponse,
  CreateEditorialPostBody,
  CreateEditorialPostResponse,
  GetEditorialPostParams,
  GetEditorialPostResponse,
  UpdateEditorialPostParams,
  UpdateEditorialPostBody,
  UpdateEditorialPostResponse,
  PublishEditorialPostParams,
  PublishEditorialPostResponse,
  ArchiveEditorialPostParams,
  ArchiveEditorialPostResponse,
  RestoreEditorialPostParams,
  RestoreEditorialPostResponse,
  ListEditorialPostTopicsParams,
  ListEditorialPostTopicsResponse,
  ReplaceEditorialPostTopicsParams,
  ReplaceEditorialPostTopicsBody,
  ReplaceEditorialPostTopicsResponse,
  ListEditorialPostRecommendationsParams,
  ListEditorialPostRecommendationsResponse,
  ReplaceEditorialPostRecommendationsParams,
  ReplaceEditorialPostRecommendationsBody,
  ReplaceEditorialPostRecommendationsResponse,
  ListEditorialPostRevisionsParams,
  ListEditorialPostRevisionsResponse,
  GetEditorialPostRevisionParams,
  GetEditorialPostRevisionResponse,
  RestoreEditorialPostRevisionParams,
  RestoreEditorialPostRevisionResponse,
  ListEditorialTopicsQueryParams,
  ListEditorialTopicsResponse,
  CreateEditorialTopicBody,
  CreateEditorialTopicResponse,
  GetEditorialTopicParams,
  GetEditorialTopicResponse,
  UpdateEditorialTopicParams,
  UpdateEditorialTopicBody,
  UpdateEditorialTopicResponse,
  ListEditorialAuthorsQueryParams,
  ListEditorialAuthorsResponse,
  CreateEditorialAuthorBody,
  CreateEditorialAuthorResponse,
  GetEditorialAuthorParams,
  GetEditorialAuthorResponse,
  UpdateEditorialAuthorParams,
  UpdateEditorialAuthorBody,
  UpdateEditorialAuthorResponse,
  GetEditorialPlacementQueryParams,
  GetEditorialPlacementResponse,
  ReplaceEditorialPlacementQueryParams,
  ReplaceEditorialPlacementBody,
  ReplaceEditorialPlacementResponse,
} from "@workspace/api-zod";

/**
 * Unified Editorial CMS Wave 1 — Admin-only routes.
 *
 * Layering copied from websiteNews.ts: express Router, generated zod
 * schemas from @workspace/api-zod for every param/body/response,
 * requireAdminAuth + requireAdminPermission on every handler, activity
 * logging on every mutation, 23505 -> 409 mapping.
 *
 * DELIBERATELY NO PUBLIC ROUTES. This wave ships the Admin backend only;
 * the public website keeps reading /website/news and /website/performances,
 * which this file does not touch, import, or re-point.
 *
 * PERMISSIONS: `website.posts` (new family). view/create/edit/delete follow
 * the same relationship as website.news; every transition that changes what
 * the public would see (publish, archive, restore, revision-restore)
 * requires the extra `publish` action.
 *
 * SLUG rules and the 409 mapping mirror websiteNews.ts exactly; uniqueness
 * is per (channel, slug), so the same slug may legitimately exist once on
 * each channel.
 */
const router: IRouter = Router();

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const POST_ACTIVITY_FIELDS = [
  "slug", "title", "deck", "contextLabel", "body", "bodyVersion",
  "featureImageUrl", "featureImageAlt", "authorId", "readingTimeOverrideMinutes",
  "seoTitle", "seoDescription", "ogImageUrl", "status", "publishedAt",
] as const;

function pick<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

/**
 * Single error funnel. EditorialRuleError carries its own status and a
 * user-facing message; anything else is reported and answered generically
 * so an internal failure never leaks through an editorial route.
 */
function handleRouteError(err: unknown, res: import("express").Response, route: string, fallback: string): void {
  if (err instanceof EditorialRuleError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const pgCode = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (pgCode === "23505") {
    res.status(409).json({ error: "That slug is already in use for this channel." });
    return;
  }
  captureError(err, { route });
  logger.error({ err }, `${route} failed`);
  res.status(500).json({ error: fallback });
}

/** Every media URL a post payload would cause the published page to load. */
function postMediaUrls(input: {
  featureImageUrl?: string | null;
  ogImageUrl?: string | null;
  body?: { blocks: Array<Record<string, unknown>> };
}): string[] {
  const urls: string[] = [];
  if (input.featureImageUrl) urls.push(input.featureImageUrl);
  if (input.ogImageUrl) urls.push(input.ogImageUrl);
  if (input.body) urls.push(...collectBodyImageUrls(input.body as never));
  return urls;
}

// ─── Post projections ───────────────────────────────────────────────────────

async function loadRecommendations(postId: number) {
  const rows = await db
    .select({
      targetPostId: editorialPostRelationsTable.targetPostId,
      position: editorialPostRelationsTable.position,
      targetTitle: editorialPostsTable.title,
      targetSlug: editorialPostsTable.slug,
      targetStatus: editorialPostsTable.status,
    })
    .from(editorialPostRelationsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostsTable.id, editorialPostRelationsTable.targetPostId))
    .where(
      and(
        eq(editorialPostRelationsTable.sourcePostId, postId),
        eq(editorialPostRelationsTable.relationType, "recommended"),
      ),
    )
    .orderBy(asc(editorialPostRelationsTable.position), asc(editorialPostRelationsTable.id));
  return rows;
}

async function loadTopics(postId: number) {
  return db
    .select({
      id: editorialTopicsTable.id,
      channel: editorialTopicsTable.channel,
      name: editorialTopicsTable.name,
      slug: editorialTopicsTable.slug,
      status: editorialTopicsTable.status,
      createdAt: editorialTopicsTable.createdAt,
      updatedAt: editorialTopicsTable.updatedAt,
    })
    .from(editorialPostTopicsTable)
    .innerJoin(editorialTopicsTable, eq(editorialTopicsTable.id, editorialPostTopicsTable.topicId))
    .where(eq(editorialPostTopicsTable.postId, postId))
    .orderBy(asc(editorialTopicsTable.name));
}

// ─── Posts ──────────────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/posts",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const query = ListEditorialPostsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    const { channel, status, authorId, topicId, search } = query.data;
    const page = query.data.page ?? 1;
    const limit = query.data.limit ?? 25;

    const filters = [
      channel ? eq(editorialPostsTable.channel, channel) : undefined,
      status ? eq(editorialPostsTable.status, status) : undefined,
      authorId ? eq(editorialPostsTable.authorId, authorId) : undefined,
      search
        ? or(ilike(editorialPostsTable.title, `%${search}%`), ilike(editorialPostsTable.slug, `%${search}%`))
        : undefined,
      // Topic filter is a subquery rather than a join so a post is never
      // duplicated in the page when it matches on multiple rows.
      topicId
        ? sql`EXISTS (SELECT 1 FROM ${editorialPostTopicsTable} pt WHERE pt.post_id = ${editorialPostsTable.id} AND pt.topic_id = ${topicId})`
        : undefined,
    ].filter(Boolean);
    const where = filters.length > 0 ? and(...(filters as never[])) : undefined;

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(editorialPostsTable)
        .where(where)
        .orderBy(desc(editorialPostsTable.updatedAt), desc(editorialPostsTable.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(editorialPostsTable).where(where),
    ]);

    res.json(
      ListEditorialPostsResponse.parse({
        items: rows,
        page,
        limit,
        total: Number(totals?.total ?? 0),
      }),
    );
  },
);

router.post(
  "/admin/editorial/posts",
  requireAdminAuth,
  requireAdminPermission("website.posts", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateEditorialPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    if (!SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only (e.g. \"my-post\")." });
      return;
    }
    // Re-validate the body through the domain schema: the generated schema
    // enforces the wire shape, this one enforces the block-model rules
    // (block cap, image-block cap, per-type limits) with domain messages.
    const bodyCheck = editorialBodySchema.safeParse(body.body);
    if (!bodyCheck.success) {
      res.status(400).json({ error: bodyCheck.error.issues[0]?.message ?? "Invalid body content" });
      return;
    }

    try {
      const mediaError = await validateEditorialMediaUrls(postMediaUrls(body as never));
      if (mediaError) {
        res.status(400).json(mediaError);
        return;
      }
      if (body.authorId != null) await loadAssignableAuthorOrThrow(db, body.authorId);

      const [row] = await db
        .insert(editorialPostsTable)
        .values({
          channel: body.channel as EditorialChannel,
          slug: body.slug,
          // Always a DRAFT — putting content live is the publish endpoint's
          // job, and requires the separate `publish` permission.
          status: "draft",
          title: body.title,
          deck: body.deck ?? null,
          contextLabel: body.contextLabel ?? null,
          body: bodyCheck.data,
          featureImageUrl: body.featureImageUrl ?? null,
          featureImageAlt: body.featureImageAlt ?? null,
          authorId: body.authorId ?? null,
          readingTimeOverrideMinutes: body.readingTimeOverrideMinutes ?? null,
          seoTitle: body.seoTitle ?? null,
          seoDescription: body.seoDescription ?? null,
          ogImageUrl: body.ogImageUrl ?? null,
          updatedByAdminId: req.adminUser?.id ?? null,
        })
        .returning();

      await logActivity(req, {
        action: "create",
        module: "website.posts",
        entityType: "editorial_post",
        entityId: row.id,
        entityLabel: row.title,
        after: pick(row, POST_ACTIVITY_FIELDS),
        summary: `Created ${row.channel} draft post "${row.title}"`,
      });
      res.status(201).json(CreateEditorialPostResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts", "Failed to create editorial post");
    }
  },
);

router.get(
  "/admin/editorial/posts/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const post = await loadPostOrThrow(db, params.data.id);
      const [topics, recommendations] = await Promise.all([loadTopics(post.id), loadRecommendations(post.id)]);
      res.json(GetEditorialPostResponse.parse({ post, topics, recommendations }));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id", "Failed to load editorial post");
    }
  },
);

/**
 * Content edit.
 *
 * When the post is CURRENTLY PUBLISHED the revision insert and the update
 * happen in one transaction, revision FIRST — if the revision write fails
 * the mutation is rolled back and the live post is untouched. Drafts and
 * archived posts are working copy and make no revision.
 *
 * `publishedAt` is never written here, on any path.
 */
router.patch(
  "/admin/editorial/posts/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = UpdateEditorialPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    if (body.slug !== undefined && !SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only." });
      return;
    }
    if (body.body !== undefined) {
      const bodyCheck = editorialBodySchema.safeParse(body.body);
      if (!bodyCheck.success) {
        res.status(400).json({ error: bodyCheck.error.issues[0]?.message ?? "Invalid body content" });
        return;
      }
    }

    try {
      const existing = await loadPostOrThrow(db, params.data.id);
      const mediaError = await validateEditorialMediaUrls(postMediaUrls(body as never));
      if (mediaError) {
        res.status(400).json(mediaError);
        return;
      }

      const authorChanged = body.authorId !== undefined && body.authorId !== existing.authorId;
      if (authorChanged && body.authorId != null) await loadAssignableAuthorOrThrow(db, body.authorId);

      const actor = adminActivityActor(req);
      const actorAdminId = req.adminUser?.id ?? null;

      const row = await db.transaction(async (tx) => {
        const locked = await lockPostForUpdate(tx, params.data.id);

        // (a) revision of the PRE-change live state, before any mutation.
        await recordRevisionIfPublished(
          tx,
          locked,
          authorChanged ? "author_change" : "published_edit",
          actorAdminId,
        );

        const updates: Record<string, unknown> = { updatedByAdminId: actorAdminId };
        for (const key of [
          "slug", "title", "deck", "contextLabel", "body", "featureImageUrl",
          "featureImageAlt", "authorId", "readingTimeOverrideMinutes",
          "seoTitle", "seoDescription", "ogImageUrl",
        ] as const) {
          if (body[key] !== undefined) updates[key] = body[key];
        }

        // Author change on a PUBLISHED post regenerates the frozen byline
        // from the new author. On a draft the snapshot stays null and is
        // generated at publish time instead.
        if (authorChanged && locked.status === "published") {
          updates["authorSnapshot"] =
            body.authorId == null
              ? null
              : buildAuthorSnapshot(await loadAssignableAuthorOrThrow(tx, body.authorId));
        }

        // (b) the mutation.
        const [updated] = await tx
          .update(editorialPostsTable)
          .set(updates)
          .where(eq(editorialPostsTable.id, params.data.id))
          .returning();

        // (c) audit, same transaction.
        await auditEditorial(tx, actor, {
          action: authorChanged ? "author_changed" : locked.status === "published" ? "edit_published" : "edit_draft",
          entityId: updated.id,
          entityLabel: updated.title,
          before: pick(locked, POST_ACTIVITY_FIELDS),
          after: pick(updated, POST_ACTIVITY_FIELDS),
          summary: authorChanged
            ? `Changed the author of ${updated.channel} post "${updated.title}"`
            : `Edited ${locked.status} ${updated.channel} post "${updated.title}"`,
        });
        return updated;
      });

      res.json(UpdateEditorialPostResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/posts/:id", "Failed to update editorial post");
    }
  },
);

// ─── Transitions (all require website.posts:publish) ────────────────────────

router.post(
  "/admin/editorial/posts/:id/publish",
  requireAdminAuth,
  requireAdminPermission("website.posts", "publish"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = PublishEditorialPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await publishPost(params.data.id, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(PublishEditorialPostResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts/:id/publish", "Failed to publish editorial post");
    }
  },
);

router.post(
  "/admin/editorial/posts/:id/archive",
  requireAdminAuth,
  requireAdminPermission("website.posts", "publish"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = ArchiveEditorialPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await archivePost(params.data.id, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(ArchiveEditorialPostResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts/:id/archive", "Failed to archive editorial post");
    }
  },
);

router.post(
  "/admin/editorial/posts/:id/restore",
  requireAdminAuth,
  requireAdminPermission("website.posts", "publish"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = RestoreEditorialPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await restorePostToDraft(params.data.id, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(RestoreEditorialPostResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts/:id/restore", "Failed to restore editorial post");
    }
  },
);

// ─── Topics on a post ───────────────────────────────────────────────────────

router.get(
  "/admin/editorial/posts/:id/topics",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = ListEditorialPostTopicsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      await loadPostOrThrow(db, params.data.id);
      res.json(ListEditorialPostTopicsResponse.parse(await loadTopics(params.data.id)));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id/topics", "Failed to load post topics");
    }
  },
);

router.put(
  "/admin/editorial/posts/:id/topics",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = ReplaceEditorialPostTopicsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = ReplaceEditorialPostTopicsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const topicIds = parsed.data.topicIds;

    try {
      const post = await loadPostOrThrow(db, params.data.id);
      const current = await loadPostTopicIds(db, post.id);
      await assertTopicsAssignable(db, post.channel, topicIds, current);

      const actor = adminActivityActor(req);
      const actorAdminId = req.adminUser?.id ?? null;

      await db.transaction(async (tx) => {
        const locked = await lockPostForUpdate(tx, post.id);
        await recordRevisionIfPublished(tx, locked, "topics_change", actorAdminId, current);
        await replacePostTopics(tx, post.id, topicIds);
        await auditEditorial(tx, actor, {
          action: "topics_changed",
          entityId: locked.id,
          entityLabel: locked.title,
          before: { topics: current },
          after: { topics: [...new Set(topicIds)] },
          summary: `Updated topics on ${locked.channel} post "${locked.title}"`,
        });
      });

      res.json(ReplaceEditorialPostTopicsResponse.parse(await loadTopics(post.id)));
    } catch (err) {
      handleRouteError(err, res, "PUT /admin/editorial/posts/:id/topics", "Failed to update post topics");
    }
  },
);

// ─── Recommendations ────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/posts/:id/recommendations",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = ListEditorialPostRecommendationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      await loadPostOrThrow(db, params.data.id);
      res.json(ListEditorialPostRecommendationsResponse.parse(await loadRecommendations(params.data.id)));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id/recommendations", "Failed to load recommendations");
    }
  },
);

router.put(
  "/admin/editorial/posts/:id/recommendations",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = ReplaceEditorialPostRecommendationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = ReplaceEditorialPostRecommendationsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const items = parsed.data.items;

    try {
      const post = await loadPostOrThrow(db, params.data.id);
      await assertRecommendationsValid(db, post, items);

      const actor = adminActivityActor(req);
      const actorAdminId = req.adminUser?.id ?? null;
      const before = (await loadRecommendations(post.id)).map((r) => r.targetPostId);

      await db.transaction(async (tx) => {
        const locked = await lockPostForUpdate(tx, post.id);
        await recordRevisionIfPublished(tx, locked, "published_edit", actorAdminId);
        await replacePostRecommendations(tx, post.id, items);
        await auditEditorial(tx, actor, {
          action: "recommendations_changed",
          entityId: locked.id,
          entityLabel: locked.title,
          before: { recommendations: before },
          after: { recommendations: items.map((i) => i.targetPostId) },
          summary: `Updated recommendations on ${locked.channel} post "${locked.title}"`,
        });
      });

      res.json(ReplaceEditorialPostRecommendationsResponse.parse(await loadRecommendations(post.id)));
    } catch (err) {
      handleRouteError(err, res, "PUT /admin/editorial/posts/:id/recommendations", "Failed to update recommendations");
    }
  },
);

// ─── Revisions ──────────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/posts/:id/revisions",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = ListEditorialPostRevisionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      await loadPostOrThrow(db, params.data.id);
      // Metadata only — the full snapshot is deliberately not returned in
      // the list, so a post with a long history is a cheap response.
      const rows = await db
        .select({
          id: editorialPostRevisionsTable.id,
          postId: editorialPostRevisionsTable.postId,
          revisionNumber: editorialPostRevisionsTable.revisionNumber,
          eventType: editorialPostRevisionsTable.eventType,
          createdAt: editorialPostRevisionsTable.createdAt,
          createdByAdminId: editorialPostRevisionsTable.createdByAdminId,
        })
        .from(editorialPostRevisionsTable)
        .where(eq(editorialPostRevisionsTable.postId, params.data.id))
        .orderBy(desc(editorialPostRevisionsTable.revisionNumber));
      res.json(ListEditorialPostRevisionsResponse.parse(rows));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id/revisions", "Failed to load revisions");
    }
  },
);

router.get(
  "/admin/editorial/posts/:id/revisions/:revisionId",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialPostRevisionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(editorialPostRevisionsTable)
      .where(
        and(
          eq(editorialPostRevisionsTable.id, params.data.revisionId),
          eq(editorialPostRevisionsTable.postId, params.data.id),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    res.json(GetEditorialPostRevisionResponse.parse(row));
  },
);

/**
 * Restore a post's content from a revision.
 *
 * Implemented rather than deferred because it fits the same
 * revision-then-mutate shape as every other published edit: a NEW revision
 * of the pre-restore state is written first (eventType 'restore'), in the
 * same transaction, so restoring is itself undoable.
 *
 * DELIBERATELY DOES NOT restore `status` or `publishedAt` from the
 * snapshot: a revision restores CONTENT, never lifecycle. Bringing a post
 * back online stays an explicit publish/archive/restore action.
 */
router.post(
  "/admin/editorial/posts/:id/revisions/:revisionId/restore",
  requireAdminAuth,
  requireAdminPermission("website.posts", "publish"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = RestoreEditorialPostRevisionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const actor = adminActivityActor(req);
      const actorAdminId = req.adminUser?.id ?? null;

      const row = await db.transaction(async (tx): Promise<EditorialPost> => {
        const locked = await lockPostForUpdate(tx, params.data.id);
        const [revision] = await tx
          .select()
          .from(editorialPostRevisionsTable)
          .where(
            and(
              eq(editorialPostRevisionsTable.id, params.data.revisionId),
              eq(editorialPostRevisionsTable.postId, params.data.id),
            ),
          )
          .limit(1);
        if (!revision) throw new EditorialRuleError("Revision not found.", 404);

        // Snapshot the CURRENT state first — restoring is undoable.
        await recordRevision(tx, locked, "restore", actorAdminId);

        const snapshot = revision.snapshot;
        const [updated] = await tx
          .update(editorialPostsTable)
          .set({
            title: snapshot.title,
            deck: snapshot.deck,
            contextLabel: snapshot.contextLabel,
            body: snapshot.body,
            bodyVersion: snapshot.bodyVersion,
            featureImageUrl: snapshot.featureImageUrl,
            featureImageAlt: snapshot.featureImageAlt,
            authorId: snapshot.authorId,
            authorSnapshot: snapshot.authorSnapshot,
            seoTitle: snapshot.seoTitle,
            seoDescription: snapshot.seoDescription,
            ogImageUrl: snapshot.ogImageUrl,
            updatedByAdminId: actorAdminId,
          })
          .where(eq(editorialPostsTable.id, params.data.id))
          .returning();

        await replacePostTopics(tx, params.data.id, snapshot.topics ?? []);

        await auditEditorial(tx, actor, {
          action: "revision_restored",
          entityId: updated.id,
          entityLabel: updated.title,
          before: { revisionNumber: null },
          after: { revisionNumber: revision.revisionNumber },
          summary: `Restored ${updated.channel} post "${updated.title}" from revision #${revision.revisionNumber}`,
        });
        return updated;
      });

      res.json(RestoreEditorialPostRevisionResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts/:id/revisions/:revisionId/restore", "Failed to restore revision");
    }
  },
);

// ─── Topics (entity) ────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/topics",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const query = ListEditorialTopicsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    const filters = [
      query.data.channel ? eq(editorialTopicsTable.channel, query.data.channel) : undefined,
      query.data.status ? eq(editorialTopicsTable.status, query.data.status) : undefined,
    ].filter(Boolean);
    const rows = await db
      .select()
      .from(editorialTopicsTable)
      .where(filters.length > 0 ? and(...(filters as never[])) : undefined)
      .orderBy(asc(editorialTopicsTable.channel), asc(editorialTopicsTable.name));
    res.json(ListEditorialTopicsResponse.parse(rows));
  },
);

router.post(
  "/admin/editorial/topics",
  requireAdminAuth,
  requireAdminPermission("website.posts", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateEditorialTopicBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;
    if (!SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only." });
      return;
    }
    try {
      const [row] = await db
        .insert(editorialTopicsTable)
        .values({
          channel: body.channel as EditorialChannel,
          name: body.name,
          slug: body.slug,
          status: body.status ?? "active",
        })
        .returning();
      await logActivity(req, {
        action: "create",
        module: "website.posts",
        entityType: "editorial_topic",
        entityId: row.id,
        entityLabel: row.name,
        after: { channel: row.channel, name: row.name, slug: row.slug, status: row.status },
        summary: `Created ${row.channel} topic "${row.name}"`,
      });
      res.status(201).json(CreateEditorialTopicResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/topics", "Failed to create topic");
    }
  },
);

router.get(
  "/admin/editorial/topics/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialTopicParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const [row] = await db.select().from(editorialTopicsTable).where(eq(editorialTopicsTable.id, params.data.id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Topic not found" });
      return;
    }
    res.json(GetEditorialTopicResponse.parse(row));
  },
);

router.patch(
  "/admin/editorial/topics/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialTopicParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = UpdateEditorialTopicBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;
    if (body.slug !== undefined && !SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only." });
      return;
    }
    const [existing] = await db.select().from(editorialTopicsTable).where(eq(editorialTopicsTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Topic not found" });
      return;
    }
    try {
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "slug", "status"] as const) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      const [row] = await db
        .update(editorialTopicsTable)
        .set(updates)
        .where(eq(editorialTopicsTable.id, params.data.id))
        .returning();
      await logActivity(req, {
        action: "update",
        module: "website.posts",
        entityType: "editorial_topic",
        entityId: row.id,
        entityLabel: row.name,
        before: { name: existing.name, slug: existing.slug, status: existing.status },
        after: { name: row.name, slug: row.slug, status: row.status },
        summary: `Updated ${row.channel} topic "${row.name}"`,
      });
      res.json(UpdateEditorialTopicResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/topics/:id", "Failed to update topic");
    }
  },
);

// ─── Authors ────────────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/authors",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const query = ListEditorialAuthorsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    const rows = await db
      .select()
      .from(editorialAuthorsTable)
      .where(query.data.status ? eq(editorialAuthorsTable.status, query.data.status) : undefined)
      .orderBy(asc(editorialAuthorsTable.publicName));
    res.json(ListEditorialAuthorsResponse.parse(rows));
  },
);

router.post(
  "/admin/editorial/authors",
  requireAdminAuth,
  requireAdminPermission("website.posts", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateEditorialAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;
    try {
      if (body.avatarUrl) {
        const mediaError = await validateEditorialMediaUrls([body.avatarUrl]);
        if (mediaError) {
          res.status(400).json(mediaError);
          return;
        }
      }
      const [row] = await db
        .insert(editorialAuthorsTable)
        .values({
          publicName: body.publicName,
          role: body.role,
          biography: body.biography ?? null,
          avatarUrl: body.avatarUrl ?? null,
          systemUserId: body.systemUserId ?? null,
          status: body.status ?? "active",
        })
        .returning();
      await logActivity(req, {
        action: "create",
        module: "website.posts",
        entityType: "editorial_author",
        entityId: row.id,
        entityLabel: row.publicName,
        after: { publicName: row.publicName, role: row.role, status: row.status },
        summary: `Created editorial author "${row.publicName}"`,
      });
      res.status(201).json(CreateEditorialAuthorResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/authors", "Failed to create author");
    }
  },
);

router.get(
  "/admin/editorial/authors/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialAuthorParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const [row] = await db.select().from(editorialAuthorsTable).where(eq(editorialAuthorsTable.id, params.data.id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    res.json(GetEditorialAuthorResponse.parse(row));
  },
);

/**
 * Editing the author ENTITY. This NEVER rewrites any editorial_posts row's
 * frozen `author_snapshot` — that is the entire point of the snapshot, and
 * is why no update to editorial_posts happens here. A published post's
 * byline changes only through an explicit author change on that post
 * (PATCH /posts/:id with a new authorId), which writes a revision.
 */
router.patch(
  "/admin/editorial/authors/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialAuthorParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = UpdateEditorialAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;
    const [existing] = await db.select().from(editorialAuthorsTable).where(eq(editorialAuthorsTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    try {
      if (body.avatarUrl) {
        const mediaError = await validateEditorialMediaUrls([body.avatarUrl]);
        if (mediaError) {
          res.status(400).json(mediaError);
          return;
        }
      }
      const updates: Record<string, unknown> = {};
      for (const key of ["publicName", "role", "biography", "avatarUrl", "systemUserId", "status"] as const) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      const [row] = await db
        .update(editorialAuthorsTable)
        .set(updates)
        .where(eq(editorialAuthorsTable.id, params.data.id))
        .returning();
      await logActivity(req, {
        action: "update",
        module: "website.posts",
        entityType: "editorial_author",
        entityId: row.id,
        entityLabel: row.publicName,
        before: { publicName: existing.publicName, role: existing.role, status: existing.status },
        after: { publicName: row.publicName, role: row.role, status: row.status },
        summary: `Updated editorial author "${row.publicName}" (frozen bylines on published posts are unchanged)`,
      });
      res.json(UpdateEditorialAuthorResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/authors/:id", "Failed to update author");
    }
  },
);

// ─── Placements ─────────────────────────────────────────────────────────────

async function loadPlacement(key: string) {
  return db
    .select({
      id: editorialPlacementsTable.id,
      key: editorialPlacementsTable.key,
      channel: editorialPlacementsTable.channel,
      postId: editorialPlacementsTable.postId,
      position: editorialPlacementsTable.position,
      startAt: editorialPlacementsTable.startAt,
      endAt: editorialPlacementsTable.endAt,
      postTitle: editorialPostsTable.title,
      postStatus: editorialPostsTable.status,
    })
    .from(editorialPlacementsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostsTable.id, editorialPlacementsTable.postId))
    .where(eq(editorialPlacementsTable.key, key))
    .orderBy(asc(editorialPlacementsTable.position), asc(editorialPlacementsTable.id));
}

router.get(
  "/admin/editorial/placements",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const query = GetEditorialPlacementQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "A placement key is required." });
      return;
    }
    res.json(GetEditorialPlacementResponse.parse(await loadPlacement(query.data.key)));
  },
);

router.put(
  "/admin/editorial/placements",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const query = ReplaceEditorialPlacementQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "A placement key is required." });
      return;
    }
    const parsed = ReplaceEditorialPlacementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const { channel, items } = parsed.data;
    const key = query.data.key;

    try {
      await assertPlacementValid(db, channel as EditorialChannel, items);
      const before = (await loadPlacement(key)).map((entry) => entry.postId);
      const actor = adminActivityActor(req);

      await db.transaction(async (tx) => {
        await replacePlacement(tx, key, channel as EditorialChannel, items);
        await auditEditorial(tx, actor, {
          action: "placement_changed",
          entityType: "editorial_placement",
          entityId: key,
          entityLabel: key,
          before: { postIds: before },
          after: { postIds: items.map((item) => item.postId) },
          summary: `Updated editorial placement "${key}" (${channel})`,
        });
      });

      res.json(ReplaceEditorialPlacementResponse.parse(await loadPlacement(key)));
    } catch (err) {
      handleRouteError(err, res, "PUT /admin/editorial/placements", "Failed to update placement");
    }
  },
);

export default router;
