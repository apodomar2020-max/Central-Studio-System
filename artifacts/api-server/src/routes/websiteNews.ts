import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, websiteNewsPostsTable, websitePerformancesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import { logger } from "../lib/logger";
import { captureError } from "../lib/errorMonitoring";
import type { DbClient } from "../lib/dbTypes";
import {
  validateWebsiteNewsImageUrl,
  WebsiteNewsImageUrlValidationError,
} from "../lib/websiteNewsMediaUrl";
import {
  ListPublicWebsiteNewsResponse,
  GetPublicWebsiteNewsParams,
  GetPublicWebsiteNewsResponse,
  ListAdminWebsiteNewsResponse,
  CreateWebsiteNewsPostBody,
  CreateWebsiteNewsPostResponse,
  GetAdminWebsiteNewsParams,
  GetAdminWebsiteNewsResponse,
  UpdateWebsiteNewsPostParams,
  UpdateWebsiteNewsPostBody,
  UpdateWebsiteNewsPostResponse,
  DeactivateWebsiteNewsPostParams,
  DeactivateWebsiteNewsPostResponse,
} from "@workspace/api-zod";

/**
 * Website CMS Wave 2 — News routes. No Performance routes here (see
 * websitePerformances.ts, added in Wave 3).
 *
 * Modeled on websiteBackgrounds.ts (public unauthenticated read + admin-
 * guarded read/write, Zod-validated bodies, activity-logged mutations) and
 * heroItems.ts (full CRUD shape, 23505-unique-violation → 409). DELETE is a
 * soft-deactivate only — see the module's own handler doc comment.
 *
 * WAVE-3 UPDATE: this file's `resolveRelatedItems`/`validateRelatedRefs`
 * 'performance'-type branches now resolve/validate against the real
 * website_performances table (Wave 3) instead of returning nulls/accepting
 * any slug on faith (Wave 2's temporary bridge, now complete). This is the
 * News-side half of the Wave-3 related-resolver handoff — see the Wave 3
 * report for the full picture. No stored News relatedRefs value changes;
 * only how a 'performance' ref is resolved changes.
 */

const router: IRouter = Router();

const ACTIVITY_FIELDS = [
  "category", "categoryLabel", "title", "subtitle", "excerpt",
  "heroImageUrl", "listingImageUrl", "publishedDate", "publishedAt",
  "readTime", "isFeatured", "authorName", "authorRole", "authorAvatarUrl",
  "tags", "galleryImages", "content", "relatedRefs", "isActive",
] as const;

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type NewsRow = typeof websiteNewsPostsTable.$inferSelect;
type RelatedRef = { type: "news" | "performance"; slug: string };

function pick<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

// ─── Public projections ────────────────────────────────────────────────────

function toPublicListItem(row: NewsRow) {
  return {
    slug: row.slug,
    category: row.category,
    categoryLabel: row.categoryLabel,
    title: row.title,
    excerpt: row.excerpt ?? row.subtitle,
    image: row.listingImageUrl ?? row.heroImageUrl,
    publishedDate: row.publishedDate,
    readTime: row.readTime,
    isFeatured: row.isFeatured,
  };
}

/**
 * Resolve a post's ordered relatedRefs into public-safe related items.
 * 'news' refs are resolved from THIS table; 'performance' refs are resolved
 * from the Wave-3 website_performances table (using its canonical
 * title/subtitle/heroImageUrl/eventDateDisplay fields, mirroring exactly
 * what the Wave-2 static bridge used to return via the full static Article
 * object — never the Performance-side card-specific fields — so current
 * visual output doesn't change). Active rows only for both types — a
 * deactivated related item is silently dropped rather than surfaced as a
 * broken link, matching getRelatedArticles' original tolerance for missing
 * entries. `subtitle` is included because the website's existing
 * related-card rendering (ArticleDetailView.tsx) renders it. Order is
 * preserved exactly as stored (locked requirement).
 */
async function resolveRelatedItems(refs: RelatedRef[]) {
  const newsSlugsNeeded = refs.filter((r) => r.type === "news").map((r) => r.slug);
  const performanceSlugsNeeded = refs.filter((r) => r.type === "performance").map((r) => r.slug);
  const [newsRows, performanceRows] = await Promise.all([
    newsSlugsNeeded.length
      ? db
          .select()
          .from(websiteNewsPostsTable)
          .where(and(inArray(websiteNewsPostsTable.slug, newsSlugsNeeded), eq(websiteNewsPostsTable.isActive, true)))
      : Promise.resolve([]),
    performanceSlugsNeeded.length
      ? db
          .select()
          .from(websitePerformancesTable)
          .where(and(inArray(websitePerformancesTable.slug, performanceSlugsNeeded), eq(websitePerformancesTable.isActive, true)))
      : Promise.resolve([]),
  ]);
  const newsBySlug = new Map(newsRows.map((r) => [r.slug, r]));
  const performanceBySlug = new Map(performanceRows.map((r) => [r.slug, r]));

  const items: Array<{
    type: "news" | "performance";
    slug: string;
    title: string | null;
    subtitle: string | null;
    categoryLabel: string | null;
    image: string | null;
    date: string | null;
  }> = [];
  for (const ref of refs) {
    if (ref.type === "news") {
      const match = newsBySlug.get(ref.slug);
      if (!match) continue; // unknown/inactive news ref — silently dropped, not surfaced as a broken link
      items.push({
        type: "news",
        slug: match.slug,
        title: match.title,
        subtitle: match.subtitle,
        categoryLabel: match.categoryLabel,
        image: match.listingImageUrl ?? match.heroImageUrl,
        date: match.publishedDate,
      });
    } else {
      const match = performanceBySlug.get(ref.slug);
      if (!match) continue; // unknown/inactive performance ref — silently dropped
      items.push({
        type: "performance",
        slug: match.slug,
        title: match.title,
        subtitle: match.subtitle,
        categoryLabel: match.categoryLabel,
        image: match.heroImageUrl,
        date: match.eventDateDisplay,
      });
    }
  }
  return items;
}

// ─── Public routes ──────────────────────────────────────────────────────────

router.get("/website/news", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(websiteNewsPostsTable)
    .where(eq(websiteNewsPostsTable.isActive, true))
    .orderBy(desc(websiteNewsPostsTable.publishedAt), desc(websiteNewsPostsTable.id));

  res.set("Cache-Control", "no-store, max-age=0");
  res.json(ListPublicWebsiteNewsResponse.parse(rows.map(toPublicListItem)));
});

router.get("/website/news/:slug", async (req, res): Promise<void> => {
  const params = GetPublicWebsiteNewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(websiteNewsPostsTable)
    .where(and(eq(websiteNewsPostsTable.slug, params.data.slug), eq(websiteNewsPostsTable.isActive, true)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "News post not found" });
    return;
  }

  const relatedItems = await resolveRelatedItems(row.relatedRefs as RelatedRef[]);

  res.set("Cache-Control", "no-store, max-age=0");
  res.json(
    GetPublicWebsiteNewsResponse.parse({
      slug: row.slug,
      category: row.category,
      categoryLabel: row.categoryLabel,
      title: row.title,
      subtitle: row.subtitle,
      heroImageUrl: row.heroImageUrl,
      publishedDate: row.publishedDate,
      readTime: row.readTime,
      authorName: row.authorName,
      authorRole: row.authorRole,
      authorAvatarUrl: row.authorAvatarUrl,
      galleryImages: row.galleryImages,
      tags: row.tags,
      content: row.content,
      relatedItems,
    }),
  );
});

// ─── Admin validation helpers ───────────────────────────────────────────────

/** Validate every Admin-editable image URL field present in a (create or partial-update) body. */
async function validateBodyImageUrls(body: {
  heroImageUrl?: string;
  listingImageUrl?: string | null;
  authorAvatarUrl?: string | null;
  galleryImages?: string[];
  content?: { sections: Array<{ image?: string }> };
}): Promise<{ error: string } | null> {
  const candidates: string[] = [];
  if (body.heroImageUrl) candidates.push(body.heroImageUrl);
  if (body.listingImageUrl) candidates.push(body.listingImageUrl);
  if (body.authorAvatarUrl) candidates.push(body.authorAvatarUrl);
  if (body.galleryImages) candidates.push(...body.galleryImages);
  if (body.content) {
    for (const section of body.content.sections) {
      if (section.image) candidates.push(section.image);
    }
  }
  for (const url of candidates) {
    try {
      await validateWebsiteNewsImageUrl(url);
    } catch (err) {
      if (err instanceof WebsiteNewsImageUrlValidationError) {
        return { error: `${url}: ${err.message}` };
      }
      throw err;
    }
  }
  return null;
}

/**
 * Validate relatedRefs shape/type and, for BOTH ref types now, that the
 * referenced slug actually exists (any state). Wave 2 could only validate
 * 'news' refs (Performance had no CMS table); Wave 3 completes this by
 * validating 'performance' refs against the real website_performances
 * table too — this is the News-side half of the Wave-3 News follow-up (see
 * websitePerformances.ts's own validateRelatedRefs for the mirror image).
 */
async function validateRelatedRefs(refs: RelatedRef[], selfSlug?: string): Promise<{ error: string } | null> {
  const newsSlugs = refs.filter((r) => r.type === "news").map((r) => r.slug);
  const performanceSlugs = refs.filter((r) => r.type === "performance").map((r) => r.slug);
  if (selfSlug && newsSlugs.includes(selfSlug)) {
    return { error: "A News post cannot list itself as related content" };
  }
  if (newsSlugs.length > 0) {
    const found = await db
      .select({ slug: websiteNewsPostsTable.slug })
      .from(websiteNewsPostsTable)
      .where(inArray(websiteNewsPostsTable.slug, newsSlugs));
    const foundSet = new Set(found.map((r) => r.slug));
    const missing = newsSlugs.filter((s) => !foundSet.has(s));
    if (missing.length > 0) {
      return { error: `Related news post(s) not found: ${missing.join(", ")}` };
    }
  }
  if (performanceSlugs.length > 0) {
    const found = await db
      .select({ slug: websitePerformancesTable.slug })
      .from(websitePerformancesTable)
      .where(inArray(websitePerformancesTable.slug, performanceSlugs));
    const foundSet = new Set(found.map((r) => r.slug));
    const missing = performanceSlugs.filter((s) => !foundSet.has(s));
    if (missing.length > 0) {
      return { error: `Related Performance(s) not found: ${missing.join(", ")}` };
    }
  }
  return null;
}

/**
 * Atomically enforce "at most one featured News post" (Wave 0 finding:
 * exactly one post is featured today; no evidence of intentional multi-
 * featured support). Unsets isFeatured on every OTHER row inside the same
 * transaction as the write that sets it — never relies on read-then-write
 * ordering or first-row-returned semantics.
 */
async function unfeatureOthers(tx: DbClient, keepId: number | null) {
  await tx
    .update(websiteNewsPostsTable)
    .set({ isFeatured: false })
    .where(keepId == null ? eq(websiteNewsPostsTable.isFeatured, true) : and(eq(websiteNewsPostsTable.isFeatured, true), ne(websiteNewsPostsTable.id, keepId)));
}

// ─── Admin routes ────────────────────────────────────────────────────────────

router.get(
  "/admin/website/news",
  requireAdminAuth,
  requireAdminPermission("website.news", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(websiteNewsPostsTable)
      .orderBy(desc(websiteNewsPostsTable.publishedAt), desc(websiteNewsPostsTable.id));
    res.json(ListAdminWebsiteNewsResponse.parse(rows));
  },
);

router.get(
  "/admin/website/news/:slug",
  requireAdminAuth,
  requireAdminPermission("website.news", "view"),
  async (req, res): Promise<void> => {
    const params = GetAdminWebsiteNewsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .select()
      .from(websiteNewsPostsTable)
      .where(eq(websiteNewsPostsTable.slug, params.data.slug))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "News post not found" });
      return;
    }
    res.json(GetAdminWebsiteNewsResponse.parse(row));
  },
);

router.post(
  "/admin/website/news",
  requireAdminAuth,
  requireAdminPermission("website.news", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateWebsiteNewsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    if (!SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only (e.g. \"my-news-post\")." });
      return;
    }

    const imageError = await validateBodyImageUrls(body);
    if (imageError) {
      res.status(400).json(imageError);
      return;
    }
    const relatedError = await validateRelatedRefs((body.relatedRefs ?? []) as RelatedRef[], body.slug);
    if (relatedError) {
      res.status(400).json(relatedError);
      return;
    }

    try {
      const row = await db.transaction(async (tx) => {
        if (body.isFeatured) {
          await unfeatureOthers(tx, null);
        }
        const [inserted] = await tx
          .insert(websiteNewsPostsTable)
          .values({
            slug: body.slug,
            category: body.category,
            categoryLabel: body.categoryLabel,
            title: body.title,
            subtitle: body.subtitle,
            excerpt: body.excerpt ?? null,
            heroImageUrl: body.heroImageUrl,
            listingImageUrl: body.listingImageUrl ?? null,
            publishedDate: body.publishedDate,
            publishedAt: body.publishedAt,
            readTime: body.readTime ?? null,
            isFeatured: body.isFeatured ?? false,
            authorName: body.authorName,
            authorRole: body.authorRole,
            authorAvatarUrl: body.authorAvatarUrl ?? null,
            tags: body.tags ?? [],
            galleryImages: body.galleryImages ?? [],
            content: body.content,
            relatedRefs: body.relatedRefs ?? [],
            isActive: body.isActive ?? true,
            updatedByAdminId: req.adminUser?.id ?? null,
          })
          .returning();
        return inserted;
      });

      await logActivity(req, {
        action: "create",
        module: "website.news",
        entityType: "website_news_post",
        entityId: row.slug,
        entityLabel: row.title,
        after: pick(row, ACTIVITY_FIELDS),
        summary: `Created News post "${row.title}"${row.isFeatured ? " (set as featured; previous featured post, if any, was unfeatured)" : ""}`,
      });
      res.status(201).json(CreateWebsiteNewsPostResponse.parse(row));
    } catch (err: any) {
      // drizzle-orm wraps the underlying pg driver error as `.cause` (its
      // own DrizzleQueryError is thrown, not the raw pg error) — check both
      // shapes so the unique-violation code is found regardless of which
      // layer it surfaces on.
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: `A News post with slug "${body.slug}" already exists` });
        return;
      }
      captureError(err, { route: "POST /admin/website/news" });
      logger.error({ err }, "News post creation failed");
      res.status(500).json({ error: "Failed to create News post" });
    }
  },
);

router.patch(
  "/admin/website/news/:slug",
  requireAdminAuth,
  requireAdminPermission("website.news", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateWebsiteNewsPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateWebsiteNewsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    const [existing] = await db
      .select()
      .from(websiteNewsPostsTable)
      .where(eq(websiteNewsPostsTable.slug, params.data.slug))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "News post not found" });
      return;
    }

    const imageError = await validateBodyImageUrls(body);
    if (imageError) {
      res.status(400).json(imageError);
      return;
    }
    if (body.relatedRefs) {
      const relatedError = await validateRelatedRefs(body.relatedRefs as RelatedRef[], existing.slug);
      if (relatedError) {
        res.status(400).json(relatedError);
        return;
      }
    }

    const updates: Record<string, unknown> = { updatedByAdminId: req.adminUser?.id ?? null };
    for (const key of [
      "category", "categoryLabel", "title", "subtitle", "excerpt",
      "heroImageUrl", "listingImageUrl", "publishedDate", "publishedAt",
      "readTime", "isFeatured", "authorName", "authorRole", "authorAvatarUrl",
      "tags", "galleryImages", "content", "relatedRefs", "isActive",
    ] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const row = await db.transaction(async (tx) => {
      if (body.isFeatured === true) {
        await unfeatureOthers(tx, existing.id);
      }
      const [updated] = await tx
        .update(websiteNewsPostsTable)
        .set(updates)
        .where(eq(websiteNewsPostsTable.slug, params.data.slug))
        .returning();
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: "News post not found" });
      return;
    }

    const { before, after } = diffFields(pick(existing, ACTIVITY_FIELDS), pick(row, ACTIVITY_FIELDS), ACTIVITY_FIELDS);
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== row.isActive ? (row.isActive ? "activate" : "deactivate") : "update";
      await logActivity(req, {
        action,
        module: "website.news",
        entityType: "website_news_post",
        entityId: row.slug,
        entityLabel: row.title,
        before,
        after,
        summary:
          action === "activate"
            ? `Reactivated News post "${row.title}"`
            : action === "deactivate"
              ? `Deactivated News post "${row.title}"`
              : `Updated News post "${row.title}": ${changedKeys.join(", ")}`,
      });
    }
    res.json(UpdateWebsiteNewsPostResponse.parse(row));
  },
);

/**
 * DELETE = soft deactivate ONLY. Never a physical row delete — Admin still
 * sees the post (isActive: false), history/relations remain intact, and it
 * can be reactivated via PATCH { isActive: true }. Equivalent to
 * PATCH { isActive: false } but kept as its own endpoint/verb for a clear,
 * discoverable "remove from site" action in the Admin UI, with its own
 * "deactivate" audit action instead of a generic "update".
 */
router.delete(
  "/admin/website/news/:slug",
  requireAdminAuth,
  requireAdminPermission("website.news", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = DeactivateWebsiteNewsPostParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(websiteNewsPostsTable)
      .where(eq(websiteNewsPostsTable.slug, params.data.slug))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "News post not found" });
      return;
    }
    if (!existing.isActive) {
      res.json(DeactivateWebsiteNewsPostResponse.parse(existing));
      return;
    }

    const [row] = await db
      .update(websiteNewsPostsTable)
      .set({ isActive: false, updatedByAdminId: req.adminUser?.id ?? null })
      .where(eq(websiteNewsPostsTable.slug, params.data.slug))
      .returning();

    await logActivity(req, {
      action: "deactivate",
      module: "website.news",
      entityType: "website_news_post",
      entityId: row.slug,
      entityLabel: row.title,
      before: { isActive: true },
      after: { isActive: false },
      summary: `Deactivated News post "${row.title}"`,
    });
    res.json(DeactivateWebsiteNewsPostResponse.parse(row));
  },
);

export default router;
