import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
  type EditorialChannel,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { adminActivityActor, logActivity } from "../lib/activityLog";
import { logger } from "../lib/logger";
import { captureError } from "../lib/errorMonitoring";
import { editorialBodySchema, collectBodyImageUrls } from "../lib/editorialBody";
import { validateEditorialMediaUrls } from "../lib/editorialMediaUrl";
import { loadLanguageByCodeOrThrow } from "../lib/editorialLanguagesService";
import {
  EditorialRuleError,
  archiveTranslation,
  assertPlacementValid,
  assertRecommendationsValid,
  assertTopicsAssignable,
  auditEditorial,
  createPost,
  createTranslation,
  listTranslations,
  loadPostOrThrow,
  loadPostTopicIds,
  loadTranslationOrThrow,
  lockPostForUpdate,
  publishTranslation,
  recordSharedRevisionIfAnyPublished,
  replacePlacement,
  replacePostRecommendations,
  replacePostTopics,
  restoreTranslationRevision,
  restoreTranslationToDraft,
  updatePostSharedFields,
  updateTranslation,
} from "../lib/editorialPostsService";
import {
  ListEditorialPostsQueryParams,
  ListEditorialPostsResponse,
  CreateEditorialPostBody,
  CreateEditorialPostResponse,
  GetEditorialPostParams,
  GetEditorialPostResponse,
  UpdateEditorialPostSharedParams,
  UpdateEditorialPostSharedBody,
  UpdateEditorialPostSharedResponse,
  ListEditorialPostTranslationsParams,
  ListEditorialPostTranslationsResponse,
  CreateEditorialPostTranslationParams,
  CreateEditorialPostTranslationBody,
  CreateEditorialPostTranslationResponse,
  GetEditorialPostTranslationParams,
  GetEditorialPostTranslationResponse,
  UpdateEditorialPostTranslationParams,
  UpdateEditorialPostTranslationBody,
  UpdateEditorialPostTranslationResponse,
  PublishEditorialPostTranslationParams,
  PublishEditorialPostTranslationResponse,
  ArchiveEditorialPostTranslationParams,
  ArchiveEditorialPostTranslationResponse,
  RestoreEditorialPostTranslationParams,
  RestoreEditorialPostTranslationResponse,
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
  ListEditorialPostRevisionsQueryParams,
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
 * Unified Editorial CMS Wave 1.1 — Admin-only CONTENT routes.
 *
 * Layering unchanged from Wave 1 (and from websiteNews.ts): express Router,
 * generated zod schemas from @workspace/api-zod for every param/body/
 * response, requireAdminAuth + requireAdminPermission on every handler,
 * activity logging on every mutation, 23505 -> 409 mapping.
 *
 * DELIBERATELY NO PUBLIC ROUTES. This wave still ships the Admin backend
 * only; the public website keeps reading /website/news and
 * /website/performances, which this file does not touch, import, or
 * re-point. There is no public cutover in Wave 1.1.
 *
 * THE MODEL. A POST is the shared spine (channel, byline, one feature image
 * URL, topics, recommendations, placements). A TRANSLATION is one
 * language's prose with its OWN lifecycle. Publish/archive/restore are
 * therefore nested under
 * /posts/:id/translations/:languageCode/... — a post has no status.
 *
 * PERMISSIONS: `website.posts` for everything in this file. view/create/
 * edit/delete follow the same relationship as website.news; every
 * transition that changes what the public would see (publish, archive,
 * restore, revision-restore) requires the extra `publish` action. WEBSITE
 * SETTINGS (Languages, Links) live in adminEditorialSettings.ts behind the
 * separate `website.settings` family.
 *
 * SLUG uniqueness is per (channel, language, slug) — the same slug may
 * legitimately exist once per channel and once per language. The 23505
 * mapping below reflects that.
 */
const router: IRouter = Router();

/** Topic slugs stay ASCII: they are Admin-facing taxonomy keys, not public URLs. */
const TOPIC_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
    // The authoritative guarantee behind the service layer's
    // check-then-insert: (channel, language_id, slug) UNIQUE. A concurrent
    // writer that wins the race lands here rather than corrupting the key.
    res.status(409).json({ error: "That slug is already in use for this channel and language." });
    return;
  }
  captureError(err, { route });
  logger.error({ err }, `${route} failed`);
  res.status(500).json({ error: fallback });
}

/** Every media URL a translation payload would cause the published page to load. */
function translationMediaUrls(input: {
  ogImageUrl?: string | null;
  body?: { blocks: Array<Record<string, unknown>> };
}): string[] {
  const urls: string[] = [];
  if (input.ogImageUrl) urls.push(input.ogImageUrl);
  if (input.body) urls.push(...collectBodyImageUrls(input.body as never));
  return urls;
}

// ─── Projections ────────────────────────────────────────────────────────────

/**
 * Resolve the language CODE in a route path to a language row. A 404 here
 * means "that locale is not registered at all", which is a different
 * problem from "this post has no translation in it" — both are 404s but
 * with distinguishable messages.
 */
async function languageFromPath(code: string) {
  return loadLanguageByCodeOrThrow(db, code);
}

/**
 * One readable label per post for the Admin lists that point AT a post
 * rather than at a language — recommendations and placements.
 *
 * Uses the post's DEFAULT-language translation, falling back to any
 * translation. This is presentation only: the relation itself is
 * language-agnostic, and the website resolves a target into whichever
 * language the reader is in.
 */
async function postLabels(postIds: readonly number[]): Promise<Map<number, { title: string; slug: string; languageCode: string }>> {
  if (postIds.length === 0) return new Map();
  const rows = await db
    .select({
      postId: editorialPostTranslationsTable.postId,
      title: editorialPostTranslationsTable.title,
      slug: editorialPostTranslationsTable.slug,
      languageCode: editorialLanguagesTable.code,
      isDefault: editorialLanguagesTable.isDefault,
      displayOrder: editorialLanguagesTable.displayOrder,
    })
    .from(editorialPostTranslationsTable)
    .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
    .where(inArray(editorialPostTranslationsTable.postId, [...new Set(postIds)]))
    .orderBy(desc(editorialLanguagesTable.isDefault), asc(editorialLanguagesTable.displayOrder));

  const byPost = new Map<number, { title: string; slug: string; languageCode: string }>();
  for (const row of rows) {
    if (!byPost.has(row.postId)) {
      byPost.set(row.postId, { title: row.title, slug: row.slug, languageCode: row.languageCode });
    }
  }
  return byPost;
}

async function loadRecommendations(postId: number) {
  const rows = await db
    .select({
      targetPostId: editorialPostRelationsTable.targetPostId,
      position: editorialPostRelationsTable.position,
      id: editorialPostRelationsTable.id,
    })
    .from(editorialPostRelationsTable)
    .where(
      and(
        eq(editorialPostRelationsTable.sourcePostId, postId),
        eq(editorialPostRelationsTable.relationType, "recommended"),
      ),
    )
    .orderBy(asc(editorialPostRelationsTable.position), asc(editorialPostRelationsTable.id));

  const labels = await postLabels(rows.map((row) => row.targetPostId));
  return rows.map((row) => {
    const label = labels.get(row.targetPostId);
    return {
      targetPostId: row.targetPostId,
      position: row.position,
      // A post with no translation yet still has to render in the list.
      targetTitle: label?.title ?? `Post #${row.targetPostId} (no translation yet)`,
      targetSlug: label?.slug ?? "",
      targetLanguageCode: label?.languageCode ?? null,
    };
  });
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

// ─── Posts (shared spine) ───────────────────────────────────────────────────

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
    const { channel, translationStatus, languageCode, authorId, topicId, search } = query.data;
    const page = query.data.page ?? 1;
    const limit = query.data.limit ?? 25;

    try {
      // A language code that is not registered is a 404, not silently
      // ignored — otherwise a typo would return an unfiltered page.
      const language = languageCode ? await languageFromPath(languageCode) : null;

      /**
       * Translation-derived filters are EXISTS subqueries rather than a
       * join, so a post is never duplicated in the page when several of
       * its translations match. Combined, languageCode + translationStatus
       * mean "posts whose <code> translation is <status>"; either alone
       * means "posts with ANY translation matching".
       */
      const translationPredicates = [
        language ? sql`t.language_id = ${language.id}` : undefined,
        translationStatus ? sql`t.status = ${translationStatus}` : undefined,
        search ? sql`(t.title ILIKE ${`%${search}%`} OR t.slug ILIKE ${`%${search}%`})` : undefined,
      ].filter(Boolean);

      const filters = [
        channel ? eq(editorialPostsTable.channel, channel) : undefined,
        authorId ? eq(editorialPostsTable.authorId, authorId) : undefined,
        topicId
          ? sql`EXISTS (SELECT 1 FROM ${editorialPostTopicsTable} pt WHERE pt.post_id = ${editorialPostsTable.id} AND pt.topic_id = ${topicId})`
          : undefined,
        translationPredicates.length > 0
          ? sql`EXISTS (
              SELECT 1 FROM ${editorialPostTranslationsTable} t
              WHERE t.post_id = ${editorialPostsTable.id}
                AND ${sql.join(translationPredicates as never[], sql` AND `)}
            )`
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

      // One extra query for the whole page's translation summaries, rather
      // than N queries or a row-multiplying join.
      const summaries = rows.length === 0
        ? []
        : await db
            .select({
              id: editorialPostTranslationsTable.id,
              postId: editorialPostTranslationsTable.postId,
              languageId: editorialPostTranslationsTable.languageId,
              languageCode: editorialLanguagesTable.code,
              languageDirection: editorialLanguagesTable.direction,
              title: editorialPostTranslationsTable.title,
              slug: editorialPostTranslationsTable.slug,
              status: editorialPostTranslationsTable.status,
              publishedAt: editorialPostTranslationsTable.publishedAt,
              updatedAt: editorialPostTranslationsTable.updatedAt,
            })
            .from(editorialPostTranslationsTable)
            .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
            .where(inArray(editorialPostTranslationsTable.postId, rows.map((row) => row.id)))
            .orderBy(asc(editorialLanguagesTable.displayOrder), asc(editorialLanguagesTable.code));

      const byPost = new Map<number, typeof summaries>();
      for (const summary of summaries) {
        const list = byPost.get(summary.postId) ?? [];
        list.push(summary);
        byPost.set(summary.postId, list);
      }

      res.json(
        ListEditorialPostsResponse.parse({
          items: rows.map((post) => ({ post, translations: byPost.get(post.id) ?? [] })),
          page,
          limit,
          total: Number(totals?.total ?? 0),
        }),
      );
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts", "Failed to list editorial posts");
    }
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

    try {
      const mediaUrls: string[] = [];
      if (body.featureImageUrl) mediaUrls.push(body.featureImageUrl);

      let translationInput: Parameters<typeof createPost>[0]["translation"];
      // Held so the response can carry the language's own fields —
      // EditorialPostTranslation includes languageCode/Name/Direction,
      // which the raw table row does not.
      let translationLanguage: Awaited<ReturnType<typeof languageFromPath>> | null = null;
      if (body.translation) {
        // Re-validate the body through the domain schema: the generated
        // schema enforces the wire shape, this one enforces the
        // block-model rules (block cap, image-block cap, per-type limits)
        // with domain messages.
        const bodyCheck = editorialBodySchema.safeParse(body.translation.body);
        if (!bodyCheck.success) {
          res.status(400).json({ error: bodyCheck.error.issues[0]?.message ?? "Invalid body content" });
          return;
        }
        mediaUrls.push(...translationMediaUrls(body.translation as never));
        const language = await languageFromPath(body.translation.languageCode);
        translationLanguage = language;
        translationInput = {
          languageId: language.id,
          title: body.translation.title,
          slug: body.translation.slug ?? null,
          deck: body.translation.deck ?? null,
          contextLabel: body.translation.contextLabel ?? null,
          featureImageAlt: body.translation.featureImageAlt ?? null,
          body: bodyCheck.data as never,
          readingTimeOverrideMinutes: body.translation.readingTimeOverrideMinutes ?? null,
          seoTitle: body.translation.seoTitle ?? null,
          seoDescription: body.translation.seoDescription ?? null,
          ogImageUrl: body.translation.ogImageUrl ?? null,
        };
      }

      const mediaError = await validateEditorialMediaUrls(mediaUrls);
      if (mediaError) {
        res.status(400).json(mediaError);
        return;
      }

      const result = await createPost(
        {
          channel: body.channel as EditorialChannel,
          authorId: body.authorId ?? null,
          featureImageUrl: body.featureImageUrl ?? null,
          translation: translationInput,
        },
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );

      res.status(201).json(
        CreateEditorialPostResponse.parse({
          post: result.post,
          translation:
            result.translation && translationLanguage
              ? {
                  ...result.translation,
                  languageCode: translationLanguage.code,
                  languageName: translationLanguage.name,
                  languageDirection: translationLanguage.direction,
                  languageIsActive: translationLanguage.isActive,
                }
              : null,
        }),
      );
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
      const [translations, topics, recommendations] = await Promise.all([
        listTranslations(db, post.id),
        loadTopics(post.id),
        loadRecommendations(post.id),
      ]);
      res.json(GetEditorialPostResponse.parse({ post, translations, topics, recommendations }));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id", "Failed to load editorial post");
    }
  },
);

/**
 * SHARED-field edit: byline and/or feature image URL.
 *
 * Non-destructive to every translation's prose. When the post has at least
 * one published translation, a shared revision is written first, in the
 * same transaction — and if an author change touches published
 * translations' frozen bylines, each gets its own translation-scoped
 * revision too (see updatePostSharedFields).
 */
router.patch(
  "/admin/editorial/posts/:id",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialPostSharedParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = UpdateEditorialPostSharedBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    try {
      if (body.featureImageUrl) {
        const mediaError = await validateEditorialMediaUrls([body.featureImageUrl]);
        if (mediaError) {
          res.status(400).json(mediaError);
          return;
        }
      }
      const row = await updatePostSharedFields(
        params.data.id,
        {
          ...(body.authorId !== undefined ? { authorId: body.authorId } : {}),
          ...(body.featureImageUrl !== undefined ? { featureImageUrl: body.featureImageUrl } : {}),
        },
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );
      res.json(UpdateEditorialPostSharedResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/posts/:id", "Failed to update editorial post");
    }
  },
);

// ─── Translations ───────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/posts/:id/translations",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = ListEditorialPostTranslationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      await loadPostOrThrow(db, params.data.id);
      res.json(ListEditorialPostTranslationsResponse.parse(await listTranslations(db, params.data.id)));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id/translations", "Failed to load translations");
    }
  },
);

router.post(
  "/admin/editorial/posts/:id/translations",
  requireAdminAuth,
  requireAdminPermission("website.posts", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = CreateEditorialPostTranslationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = CreateEditorialPostTranslationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    const bodyCheck = editorialBodySchema.safeParse(body.body);
    if (!bodyCheck.success) {
      res.status(400).json({ error: bodyCheck.error.issues[0]?.message ?? "Invalid body content" });
      return;
    }

    try {
      const mediaError = await validateEditorialMediaUrls(translationMediaUrls(body as never));
      if (mediaError) {
        res.status(400).json(mediaError);
        return;
      }
      const language = await languageFromPath(body.languageCode);
      const row = await createTranslation(
        params.data.id,
        {
          languageId: language.id,
          title: body.title,
          slug: body.slug ?? null,
          deck: body.deck ?? null,
          contextLabel: body.contextLabel ?? null,
          featureImageAlt: body.featureImageAlt ?? null,
          body: bodyCheck.data as never,
          readingTimeOverrideMinutes: body.readingTimeOverrideMinutes ?? null,
          seoTitle: body.seoTitle ?? null,
          seoDescription: body.seoDescription ?? null,
          ogImageUrl: body.ogImageUrl ?? null,
        },
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );
      res.status(201).json(
        CreateEditorialPostTranslationResponse.parse({
          ...row,
          languageCode: language.code,
          languageName: language.name,
          languageDirection: language.direction,
          languageIsActive: language.isActive,
        }),
      );
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/posts/:id/translations", "Failed to create translation");
    }
  },
);

router.get(
  "/admin/editorial/posts/:id/translations/:languageCode",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialPostTranslationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid parameters" });
      return;
    }
    try {
      const language = await languageFromPath(params.data.languageCode);
      const row = await loadTranslationOrThrow(db, params.data.id, language.id);
      res.json(
        GetEditorialPostTranslationResponse.parse({
          ...row,
          languageCode: language.code,
          languageName: language.name,
          languageDirection: language.direction,
          languageIsActive: language.isActive,
        }),
      );
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/posts/:id/translations/:languageCode", "Failed to load translation");
    }
  },
);

/**
 * Edit ONE language's content.
 *
 * When that translation is CURRENTLY PUBLISHED the revision insert and the
 * update happen in one transaction, revision FIRST — if the revision write
 * fails the mutation is rolled back and the live translation is untouched.
 * Drafts and archived translations are working copy and make no revision.
 *
 * `publishedAt` is never written here, on any path, and no sibling
 * translation row is read or written.
 */
router.patch(
  "/admin/editorial/posts/:id/translations/:languageCode",
  requireAdminAuth,
  requireAdminPermission("website.posts", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialPostTranslationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid parameters" });
      return;
    }
    const parsed = UpdateEditorialPostTranslationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    if (body.body !== undefined) {
      const bodyCheck = editorialBodySchema.safeParse(body.body);
      if (!bodyCheck.success) {
        res.status(400).json({ error: bodyCheck.error.issues[0]?.message ?? "Invalid body content" });
        return;
      }
    }

    try {
      const mediaError = await validateEditorialMediaUrls(translationMediaUrls(body as never));
      if (mediaError) {
        res.status(400).json(mediaError);
        return;
      }
      const language = await languageFromPath(params.data.languageCode);
      const row = await updateTranslation(
        params.data.id,
        language.id,
        body as never,
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );
      res.json(
        UpdateEditorialPostTranslationResponse.parse({
          ...row,
          languageCode: language.code,
          languageName: language.name,
          languageDirection: language.direction,
          languageIsActive: language.isActive,
        }),
      );
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/posts/:id/translations/:languageCode", "Failed to update translation");
    }
  },
);

// ─── Translation transitions (all require website.posts:publish) ────────────

/** The three transitions share one shape; only the service call differs. */
function translationTransitionRoute(
  path: string,
  paramsSchema: { safeParse: (input: unknown) => { success: boolean; data?: { id: number; languageCode: string }; error?: { issues: Array<{ message?: string }> } } },
  responseSchema: { parse: (input: unknown) => unknown },
  run: (postId: number, languageId: number, ctx: { actor: ReturnType<typeof adminActivityActor>; actorAdminId: number | null }) => Promise<unknown>,
  fallback: string,
) {
  router.post(
    path,
    requireAdminAuth,
    requireAdminPermission("website.posts", "publish"),
    async (req: AdminRequest, res): Promise<void> => {
      const params = paramsSchema.safeParse(req.params);
      if (!params.success || !params.data) {
        res.status(400).json({ error: params.error?.issues[0]?.message ?? "Invalid parameters" });
        return;
      }
      try {
        const language = await languageFromPath(params.data.languageCode);
        const row = await run(params.data.id, language.id, {
          actor: adminActivityActor(req),
          actorAdminId: req.adminUser?.id ?? null,
        });
        res.json(
          responseSchema.parse({
            ...(row as Record<string, unknown>),
            languageCode: language.code,
            languageName: language.name,
            languageDirection: language.direction,
            languageIsActive: language.isActive,
          }),
        );
      } catch (err) {
        handleRouteError(err, res, `POST ${path}`, fallback);
      }
    },
  );
}

translationTransitionRoute(
  "/admin/editorial/posts/:id/translations/:languageCode/publish",
  PublishEditorialPostTranslationParams as never,
  PublishEditorialPostTranslationResponse,
  (postId, languageId, ctx) => publishTranslation(postId, languageId, ctx),
  "Failed to publish translation",
);

translationTransitionRoute(
  "/admin/editorial/posts/:id/translations/:languageCode/archive",
  ArchiveEditorialPostTranslationParams as never,
  ArchiveEditorialPostTranslationResponse,
  (postId, languageId, ctx) => archiveTranslation(postId, languageId, ctx),
  "Failed to archive translation",
);

translationTransitionRoute(
  "/admin/editorial/posts/:id/translations/:languageCode/restore",
  RestoreEditorialPostTranslationParams as never,
  RestoreEditorialPostTranslationResponse,
  (postId, languageId, ctx) => restoreTranslationToDraft(postId, languageId, ctx),
  "Failed to restore translation",
);

// ─── Topics on a post (shared, not localized) ───────────────────────────────

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
        // SHARED revision — topics belong to the logical post, so the
        // snapshot is post-scoped (translation_id NULL) and no
        // translation's content is read or written.
        await recordSharedRevisionIfAnyPublished(tx, locked, "topics_change", actorAdminId, current);
        await replacePostTopics(tx, post.id, topicIds);
        await auditEditorial(tx, actor, {
          action: "topics_changed",
          entityId: locked.id,
          entityLabel: `${locked.channel} post #${locked.id}`,
          before: { topics: current },
          after: { topics: [...new Set(topicIds)] },
          summary: `Updated topics on ${locked.channel} post #${locked.id}`,
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
      const before = (await loadRecommendations(post.id)).map((entry) => entry.targetPostId);

      await db.transaction(async (tx) => {
        const locked = await lockPostForUpdate(tx, post.id);
        await recordSharedRevisionIfAnyPublished(tx, locked, "shared_field_change", actorAdminId);
        await replacePostRecommendations(tx, post.id, items);
        await auditEditorial(tx, actor, {
          action: "recommendations_changed",
          entityId: locked.id,
          entityLabel: `${locked.channel} post #${locked.id}`,
          before: { recommendations: before },
          after: { recommendations: items.map((item) => item.targetPostId) },
          summary: `Updated recommendations on ${locked.channel} post #${locked.id}`,
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
    const query = ListEditorialPostRevisionsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    try {
      await loadPostOrThrow(db, params.data.id);

      // Filtering by language gives that ONE language's history. The join
      // is a LEFT join so shared/post-scoped entries (translation_id NULL)
      // still appear in the unfiltered list, where an editor needs to see
      // them interleaved.
      const languageFilter = query.data.languageCode
        ? (await languageFromPath(query.data.languageCode)).id
        : null;

      // Metadata only — the full snapshot is deliberately not returned in
      // the list, so a post with a long history is a cheap response.
      const rows = await db
        .select({
          id: editorialPostRevisionsTable.id,
          postId: editorialPostRevisionsTable.postId,
          translationId: editorialPostRevisionsTable.translationId,
          languageCode: editorialLanguagesTable.code,
          revisionNumber: editorialPostRevisionsTable.revisionNumber,
          eventType: editorialPostRevisionsTable.eventType,
          createdAt: editorialPostRevisionsTable.createdAt,
          createdByAdminId: editorialPostRevisionsTable.createdByAdminId,
        })
        .from(editorialPostRevisionsTable)
        .leftJoin(
          editorialPostTranslationsTable,
          eq(editorialPostTranslationsTable.id, editorialPostRevisionsTable.translationId),
        )
        .leftJoin(
          editorialLanguagesTable,
          eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId),
        )
        .where(
          languageFilter
            ? and(
                eq(editorialPostRevisionsTable.postId, params.data.id),
                eq(editorialPostTranslationsTable.languageId, languageFilter),
              )
            : eq(editorialPostRevisionsTable.postId, params.data.id),
        )
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
 * Restore ONE translation's content from a translation-scoped revision.
 *
 * A NEW revision of the pre-restore state is written first (eventType
 * 'restore'), in the same transaction, so restoring is itself undoable.
 *
 * The revision NAMES its own translation, so restoring the Arabic history
 * cannot reach the English row — see restoreTranslationRevision. A
 * shared/post-scoped revision has no translation to restore and is
 * rejected with a 400 that says so.
 *
 * DELIBERATELY DOES NOT restore `status`, `publishedAt`, or `slug`: a
 * revision restores CONTENT, never lifecycle, and never a live URL.
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
      const row = await restoreTranslationRevision(params.data.id, params.data.revisionId, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      const [language] = await db
        .select()
        .from(editorialLanguagesTable)
        .where(eq(editorialLanguagesTable.id, row.languageId))
        .limit(1);
      res.json(
        RestoreEditorialPostRevisionResponse.parse({
          ...row,
          languageCode: language?.code ?? "",
          languageName: language?.name ?? "",
          languageDirection: language?.direction ?? "ltr",
          languageIsActive: language?.isActive ?? true,
        }),
      );
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
    if (!TOPIC_SLUG_RE.test(body.slug)) {
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
    if (body.slug !== undefined && !TOPIC_SLUG_RE.test(body.slug)) {
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

// ─── Authors (CHANNEL-SCOPED) ───────────────────────────────────────────────

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
    const filters = [
      query.data.channel ? eq(editorialAuthorsTable.channel, query.data.channel) : undefined,
      query.data.status ? eq(editorialAuthorsTable.status, query.data.status) : undefined,
    ].filter(Boolean);
    const rows = await db
      .select()
      .from(editorialAuthorsTable)
      .where(filters.length > 0 ? and(...(filters as never[])) : undefined)
      .orderBy(asc(editorialAuthorsTable.channel), asc(editorialAuthorsTable.publicName));
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
          // REQUIRED. An author belongs to exactly one channel; the same
          // person writing for both surfaces is two rows.
          channel: body.channel as EditorialChannel,
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
        after: { channel: row.channel, publicName: row.publicName, role: row.role, status: row.status },
        summary: `Created ${row.channel} editorial author "${row.publicName}"`,
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
 * Editing the author ENTITY. This NEVER rewrites any translation's frozen
 * `author_snapshot` — that is the entire point of the snapshot, and is why
 * no update to editorial_post_translations happens here. A published
 * translation's byline changes only through an explicit author change on
 * the parent POST (PATCH /posts/:id with a new authorId), which writes
 * revisions.
 *
 * `channel` is NOT accepted here: changing an author's channel would break
 * the author-channel-match invariant for every post already carrying the
 * byline. The database refuses it too
 * (guard_editorial_author_channel_immutable).
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
        summary: `Updated editorial author "${row.publicName}" (frozen bylines on published translations are unchanged)`,
      });
      res.json(UpdateEditorialAuthorResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/authors/:id", "Failed to update author");
    }
  },
);

// ─── Placements ─────────────────────────────────────────────────────────────

/**
 * Read one slot's entries in order.
 *
 * CHANNEL SCOPING (Wave 2.0 — Issue #23). A placement is identified by
 * (channel, key), never by `key` alone: `key` is free text and both
 * channels naturally want a slot called "featured", so a key-only predicate
 * returned BOTH channels' rows interleaved — and, via the `before` snapshot
 * below, wrote the other channel's post ids into this channel's audit row.
 */
async function loadPlacement(channel: EditorialChannel, key: string) {
  const rows = await db
    .select({
      id: editorialPlacementsTable.id,
      key: editorialPlacementsTable.key,
      channel: editorialPlacementsTable.channel,
      postId: editorialPlacementsTable.postId,
      position: editorialPlacementsTable.position,
      startAt: editorialPlacementsTable.startAt,
      endAt: editorialPlacementsTable.endAt,
    })
    .from(editorialPlacementsTable)
    .where(
      and(
        eq(editorialPlacementsTable.channel, channel),
        eq(editorialPlacementsTable.key, key),
      ),
    )
    .orderBy(asc(editorialPlacementsTable.position), asc(editorialPlacementsTable.id));

  const labels = await postLabels(rows.map((row) => row.postId));
  return rows.map((row) => {
    const label = labels.get(row.postId);
    return {
      ...row,
      postTitle: label?.title ?? `Post #${row.postId} (no translation yet)`,
      postLanguageCode: label?.languageCode ?? null,
    };
  });
}

router.get(
  "/admin/editorial/placements",
  requireAdminAuth,
  requireAdminPermission("website.posts", "view"),
  async (req, res): Promise<void> => {
    const query = GetEditorialPlacementQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "A placement channel and key are both required." });
      return;
    }
    res.json(
      GetEditorialPlacementResponse.parse(
        await loadPlacement(query.data.channel as EditorialChannel, query.data.key),
      ),
    );
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
      const before = (await loadPlacement(channel as EditorialChannel, key)).map((entry) => entry.postId);
      const actor = adminActivityActor(req);

      await db.transaction(async (tx) => {
        await replacePlacement(tx, key, channel as EditorialChannel, items);
        await auditEditorial(tx, actor, {
          action: "placement_changed",
          entityType: "editorial_placement",
          // The audited entity is the SLOT, and a slot is (channel, key) —
          // auditing `key` alone made news:featured and experience:featured
          // indistinguishable in the activity log (Issue #23).
          entityId: `${channel}:${key}`,
          entityLabel: `${channel}:${key}`,
          before: { postIds: before },
          after: { postIds: items.map((item) => item.postId) },
          summary: `Updated editorial placement "${key}" (${channel})`,
        });
      });

      res.json(
        ReplaceEditorialPlacementResponse.parse(
          await loadPlacement(channel as EditorialChannel, key),
        ),
      );
    } catch (err) {
      handleRouteError(err, res, "PUT /admin/editorial/placements", "Failed to update placement");
    }
  },
);

export default router;
