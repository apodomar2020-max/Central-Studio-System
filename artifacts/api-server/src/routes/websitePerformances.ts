import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, websitePerformancesTable, websiteNewsPostsTable } from "@workspace/db";
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
  ListPublicWebsitePerformancesResponse,
  GetPublicWebsitePerformanceFeaturedResponse,
  GetPublicWebsitePerformanceParams,
  GetPublicWebsitePerformanceResponse,
  ListAdminWebsitePerformancesResponse,
  CreateWebsitePerformanceBody,
  CreateWebsitePerformanceResponse,
  GetAdminWebsitePerformanceParams,
  GetAdminWebsitePerformanceResponse,
  UpdateWebsitePerformanceParams,
  UpdateWebsitePerformanceBody,
  UpdateWebsitePerformanceResponse,
  DeactivateWebsitePerformanceParams,
  DeactivateWebsitePerformanceResponse,
} from "@workspace/api-zod";

/**
 * Website CMS Wave 3 — Performance only. News/Backgrounds already migrated
 * (Waves 1-2).
 *
 * Modeled directly on websiteNews.ts (Wave 2): public unauthenticated read
 * + admin-guarded read/write, Zod-validated bodies, activity-logged
 * mutations, DELETE = soft deactivate only. The image validator is reused
 * verbatim from Wave 2 (image-only, same host allowlist — no Performance-
 * specific media rules were needed, see the Wave 3 investigation report).
 *
 * ROUTE ORDER: "/website/performances/featured" MUST be registered before
 * "/website/performances/:slug" — otherwise Express would match the literal
 * word "featured" as a :slug value and this route would never be reached.
 */

const router: IRouter = Router();

const ACTIVITY_FIELDS = [
  "sortOrder", "category", "categoryLabel", "title", "subtitle", "heroImageUrl",
  "eventDateDisplay", "season", "featuredHeroImageUrl", "featuredHeroDateBadge",
  "isFeatured", "cardTitle", "cardDescription", "cardImageUrl", "cardVenue",
  "cardDatesDisplay", "cardTime", "dateDay", "dateMonth", "cardBadgeLabel",
  "venue", "times", "orchestra", "runtime", "ticketLink", "ticketPriceRange",
  "detailBadgeLabel", "badgeVariant", "authorName", "authorRole", "authorAvatarUrl",
  "tags", "galleryImages", "content", "keyHighlights", "scheduleOverview",
  "castAndFaculty", "relatedRefs", "isActive",
] as const;

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type PerformanceRow = typeof websitePerformancesTable.$inferSelect;
type RelatedRef = { type: "news" | "performance"; slug: string };

function pick<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

// ─── Public projections ────────────────────────────────────────────────────

function toPublicListItem(row: PerformanceRow) {
  return {
    slug: row.slug,
    cardTitle: row.cardTitle,
    cardDescription: row.cardDescription,
    cardImageUrl: row.cardImageUrl,
    cardVenue: row.cardVenue,
    cardDatesDisplay: row.cardDatesDisplay,
    cardTime: row.cardTime,
    dateDay: row.dateDay,
    dateMonth: row.dateMonth,
    cardBadgeLabel: row.cardBadgeLabel,
    badgeVariant: row.badgeVariant,
  };
}

function toPublicFeatured(row: PerformanceRow) {
  return {
    slug: row.slug,
    title: row.title,
    heroImageUrl: row.featuredHeroImageUrl ?? row.heroImageUrl,
    dateBadge: row.featuredHeroDateBadge ?? row.eventDateDisplay,
  };
}

/**
 * Resolve a Performance's ordered relatedRefs into public-safe related
 * items. 'performance' refs resolve from THIS table (active only, using
 * canonical detail-oriented fields — title/subtitle/heroImageUrl/
 * eventDateDisplay — exactly matching what the Wave-2 static bridge used
 * to return via the full static Article object, never the card-specific
 * fields, to preserve current visual output exactly). 'news' refs resolve
 * from the News CMS table (active only) — this is the Wave-3 resolver
 * handoff's other direction, structurally identical to how News already
 * resolves its own News-type refs. An unresolvable ref of either type is
 * silently dropped, never surfaced as a broken link. Order is preserved
 * exactly as stored.
 */
async function resolveRelatedItems(refs: RelatedRef[]) {
  const performanceSlugsNeeded = refs.filter((r) => r.type === "performance").map((r) => r.slug);
  const newsSlugsNeeded = refs.filter((r) => r.type === "news").map((r) => r.slug);

  const [performanceRows, newsRows] = await Promise.all([
    performanceSlugsNeeded.length
      ? db
          .select()
          .from(websitePerformancesTable)
          .where(and(inArray(websitePerformancesTable.slug, performanceSlugsNeeded), eq(websitePerformancesTable.isActive, true)))
      : Promise.resolve([]),
    newsSlugsNeeded.length
      ? db
          .select()
          .from(websiteNewsPostsTable)
          .where(and(inArray(websiteNewsPostsTable.slug, newsSlugsNeeded), eq(websiteNewsPostsTable.isActive, true)))
      : Promise.resolve([]),
  ]);
  const performanceBySlug = new Map(performanceRows.map((r) => [r.slug, r]));
  const newsBySlug = new Map(newsRows.map((r) => [r.slug, r]));

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
    if (ref.type === "performance") {
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
    } else {
      const match = newsBySlug.get(ref.slug);
      if (!match) continue; // unknown/inactive news ref — silently dropped
      items.push({
        type: "news",
        slug: match.slug,
        title: match.title,
        subtitle: match.subtitle,
        categoryLabel: match.categoryLabel,
        image: match.listingImageUrl ?? match.heroImageUrl,
        date: match.publishedDate,
      });
    }
  }
  return items;
}

// ─── Public routes ──────────────────────────────────────────────────────────

router.get("/website/performances", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(websitePerformancesTable)
    .where(eq(websitePerformancesTable.isActive, true))
    .orderBy(asc(websitePerformancesTable.sortOrder), asc(websitePerformancesTable.id));

  res.set("Cache-Control", "no-store, max-age=0");
  res.json(ListPublicWebsitePerformancesResponse.parse(rows.map(toPublicListItem)));
});

/**
 * Featured resolution (LOCKED): (1) the active row with isFeatured=true, if
 * any; (2) otherwise the first ACTIVE row by sortOrder; (3) otherwise null
 * (no featured production) — never a stale/static fallback. Route
 * registered before "/:slug" — see module doc comment.
 */
router.get("/website/performances/featured", async (_req, res): Promise<void> => {
  const [featuredRow] = await db
    .select()
    .from(websitePerformancesTable)
    .where(and(eq(websitePerformancesTable.isActive, true), eq(websitePerformancesTable.isFeatured, true)))
    .limit(1);

  const row = featuredRow ?? (await db
    .select()
    .from(websitePerformancesTable)
    .where(eq(websitePerformancesTable.isActive, true))
    .orderBy(asc(websitePerformancesTable.sortOrder), asc(websitePerformancesTable.id))
    .limit(1)
    .then((rows) => rows[0]));

  res.set("Cache-Control", "no-store, max-age=0");
  res.json(GetPublicWebsitePerformanceFeaturedResponse.parse(row ? toPublicFeatured(row) : null));
});

router.get("/website/performances/:slug", async (req, res): Promise<void> => {
  const params = GetPublicWebsitePerformanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(websitePerformancesTable)
    .where(and(eq(websitePerformancesTable.slug, params.data.slug), eq(websitePerformancesTable.isActive, true)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Performance not found" });
    return;
  }

  const relatedItems = await resolveRelatedItems(row.relatedRefs as RelatedRef[]);

  res.set("Cache-Control", "no-store, max-age=0");
  res.json(
    GetPublicWebsitePerformanceResponse.parse({
      slug: row.slug,
      category: row.category,
      categoryLabel: row.categoryLabel,
      title: row.title,
      subtitle: row.subtitle,
      heroImageUrl: row.heroImageUrl,
      eventDateDisplay: row.eventDateDisplay,
      venue: row.venue,
      times: row.times,
      orchestra: row.orchestra,
      runtime: row.runtime,
      ticketLink: row.ticketLink,
      ticketPriceRange: row.ticketPriceRange,
      detailBadgeLabel: row.detailBadgeLabel,
      badgeVariant: row.badgeVariant,
      season: row.season,
      authorName: row.authorName,
      authorRole: row.authorRole,
      authorAvatarUrl: row.authorAvatarUrl,
      galleryImages: row.galleryImages,
      tags: row.tags,
      content: row.content,
      keyHighlights: row.keyHighlights,
      // scheduleOverview deliberately omitted — never publicly rendered, see schema doc comment.
      castAndFaculty: row.castAndFaculty,
      relatedItems,
    }),
  );
});

// ─── Admin validation helpers ───────────────────────────────────────────────

/** Validate every Admin-editable image URL field present in a (create or partial-update) body. */
async function validateBodyImageUrls(body: {
  heroImageUrl?: string;
  featuredHeroImageUrl?: string | null;
  cardImageUrl?: string;
  authorAvatarUrl?: string | null;
  galleryImages?: string[];
  content?: { sections: Array<{ image?: string }> };
  castAndFaculty?: Array<{ imageUrl: string }>;
}): Promise<{ error: string } | null> {
  const candidates: string[] = [];
  if (body.heroImageUrl) candidates.push(body.heroImageUrl);
  if (body.featuredHeroImageUrl) candidates.push(body.featuredHeroImageUrl);
  if (body.cardImageUrl) candidates.push(body.cardImageUrl);
  if (body.authorAvatarUrl) candidates.push(body.authorAvatarUrl);
  if (body.galleryImages) candidates.push(...body.galleryImages);
  if (body.content) {
    for (const section of body.content.sections) {
      if (section.image) candidates.push(section.image);
    }
  }
  if (body.castAndFaculty) {
    for (const member of body.castAndFaculty) {
      if (member.imageUrl) candidates.push(member.imageUrl);
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
 * referenced slug actually exists (any state) — unlike Wave 2's News
 * validator, which could only validate 'news' refs (Performance had no CMS
 * table yet). This is the Performance side of the Wave-3 News follow-up.
 */
async function validateRelatedRefs(refs: RelatedRef[], selfSlug?: string): Promise<{ error: string } | null> {
  const performanceSlugs = refs.filter((r) => r.type === "performance").map((r) => r.slug);
  const newsSlugs = refs.filter((r) => r.type === "news").map((r) => r.slug);
  if (selfSlug && performanceSlugs.includes(selfSlug)) {
    return { error: "A Performance cannot list itself as related content" };
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
  return null;
}

/**
 * Atomically enforce "at most one featured Performance" — same proven
 * db.transaction pattern Wave 2 built for News. Unsets isFeatured on every
 * OTHER row inside the same transaction as the write that sets it — never
 * relies on read-time row order.
 */
async function unfeatureOthers(tx: DbClient, keepId: number | null) {
  await tx
    .update(websitePerformancesTable)
    .set({ isFeatured: false })
    .where(keepId == null ? eq(websitePerformancesTable.isFeatured, true) : and(eq(websitePerformancesTable.isFeatured, true), ne(websitePerformancesTable.id, keepId)));
}

// ─── Admin routes ────────────────────────────────────────────────────────────

router.get(
  "/admin/website/performances",
  requireAdminAuth,
  requireAdminPermission("website.performance", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(websitePerformancesTable)
      .orderBy(asc(websitePerformancesTable.sortOrder), asc(websitePerformancesTable.id));
    res.json(ListAdminWebsitePerformancesResponse.parse(rows));
  },
);

router.get(
  "/admin/website/performances/:slug",
  requireAdminAuth,
  requireAdminPermission("website.performance", "view"),
  async (req, res): Promise<void> => {
    const params = GetAdminWebsitePerformanceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .select()
      .from(websitePerformancesTable)
      .where(eq(websitePerformancesTable.slug, params.data.slug))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Performance not found" });
      return;
    }
    res.json(GetAdminWebsitePerformanceResponse.parse(row));
  },
);

router.post(
  "/admin/website/performances",
  requireAdminAuth,
  requireAdminPermission("website.performance", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateWebsitePerformanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    if (!SLUG_RE.test(body.slug)) {
      res.status(400).json({ error: "Slug must be lowercase letters, numbers, and hyphens only (e.g. \"my-performance\")." });
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
          .insert(websitePerformancesTable)
          .values({
            slug: body.slug,
            sortOrder: body.sortOrder,
            category: body.category,
            categoryLabel: body.categoryLabel,
            title: body.title,
            subtitle: body.subtitle,
            heroImageUrl: body.heroImageUrl,
            eventDateDisplay: body.eventDateDisplay,
            season: body.season,
            featuredHeroImageUrl: body.featuredHeroImageUrl ?? null,
            featuredHeroDateBadge: body.featuredHeroDateBadge ?? null,
            isFeatured: body.isFeatured ?? false,
            cardTitle: body.cardTitle,
            cardDescription: body.cardDescription,
            cardImageUrl: body.cardImageUrl,
            cardVenue: body.cardVenue,
            cardDatesDisplay: body.cardDatesDisplay,
            cardTime: body.cardTime,
            dateDay: body.dateDay,
            dateMonth: body.dateMonth,
            cardBadgeLabel: body.cardBadgeLabel,
            venue: body.venue,
            times: body.times ?? [],
            orchestra: body.orchestra ?? null,
            runtime: body.runtime,
            ticketLink: body.ticketLink ?? null,
            ticketPriceRange: body.ticketPriceRange ?? null,
            detailBadgeLabel: body.detailBadgeLabel,
            badgeVariant: body.badgeVariant,
            authorName: body.authorName,
            authorRole: body.authorRole,
            authorAvatarUrl: body.authorAvatarUrl ?? null,
            tags: body.tags ?? [],
            galleryImages: body.galleryImages ?? [],
            content: body.content,
            keyHighlights: body.keyHighlights ?? [],
            scheduleOverview: body.scheduleOverview ?? [],
            castAndFaculty: body.castAndFaculty ?? [],
            relatedRefs: body.relatedRefs ?? [],
            isActive: body.isActive ?? true,
            updatedByAdminId: req.adminUser?.id ?? null,
          })
          .returning();
        return inserted;
      });

      await logActivity(req, {
        action: "create",
        module: "website.performance",
        entityType: "website_performance",
        entityId: row.slug,
        entityLabel: row.title,
        after: pick(row, ACTIVITY_FIELDS),
        summary: `Created Performance "${row.title}"${row.isFeatured ? " (set as featured; previous featured performance, if any, was unfeatured)" : ""}`,
      });
      res.status(201).json(CreateWebsitePerformanceResponse.parse(row));
    } catch (err: any) {
      // drizzle-orm wraps the underlying pg driver error as `.cause` (its
      // own DrizzleQueryError is thrown, not the raw pg error) — check both
      // shapes so the unique-violation code is found regardless of which
      // layer it surfaces on (the exact bug found and fixed for News' own
      // create route in Wave 2 — not reintroduced here).
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: `A Performance with slug "${body.slug}" already exists` });
        return;
      }
      captureError(err, { route: "POST /admin/website/performances" });
      logger.error({ err }, "Performance creation failed");
      res.status(500).json({ error: "Failed to create Performance" });
    }
  },
);

router.patch(
  "/admin/website/performances/:slug",
  requireAdminAuth,
  requireAdminPermission("website.performance", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateWebsitePerformanceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateWebsitePerformanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    const [existing] = await db
      .select()
      .from(websitePerformancesTable)
      .where(eq(websitePerformancesTable.slug, params.data.slug))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Performance not found" });
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
      "sortOrder", "category", "categoryLabel", "title", "subtitle", "heroImageUrl",
      "eventDateDisplay", "season", "featuredHeroImageUrl", "featuredHeroDateBadge",
      "isFeatured", "cardTitle", "cardDescription", "cardImageUrl", "cardVenue",
      "cardDatesDisplay", "cardTime", "dateDay", "dateMonth", "cardBadgeLabel",
      "venue", "times", "orchestra", "runtime", "ticketLink", "ticketPriceRange",
      "detailBadgeLabel", "badgeVariant", "authorName", "authorRole", "authorAvatarUrl",
      "tags", "galleryImages", "content", "keyHighlights", "scheduleOverview",
      "castAndFaculty", "relatedRefs", "isActive",
    ] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const row = await db.transaction(async (tx) => {
      if (body.isFeatured === true) {
        await unfeatureOthers(tx, existing.id);
      }
      const [updated] = await tx
        .update(websitePerformancesTable)
        .set(updates)
        .where(eq(websitePerformancesTable.slug, params.data.slug))
        .returning();
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: "Performance not found" });
      return;
    }

    const { before, after } = diffFields(pick(existing, ACTIVITY_FIELDS), pick(row, ACTIVITY_FIELDS), ACTIVITY_FIELDS);
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== row.isActive ? (row.isActive ? "activate" : "deactivate") : "update";
      await logActivity(req, {
        action,
        module: "website.performance",
        entityType: "website_performance",
        entityId: row.slug,
        entityLabel: row.title,
        before,
        after,
        summary:
          action === "activate"
            ? `Reactivated Performance "${row.title}"`
            : action === "deactivate"
              ? `Deactivated Performance "${row.title}"`
              : `Updated Performance "${row.title}": ${changedKeys.join(", ")}`,
      });
    }
    res.json(UpdateWebsitePerformanceResponse.parse(row));
  },
);

/**
 * DELETE = soft deactivate ONLY. Never a physical row delete — Admin still
 * sees the Performance (isActive: false), history/relations remain intact,
 * and it can be reactivated via PATCH { isActive: true }.
 */
router.delete(
  "/admin/website/performances/:slug",
  requireAdminAuth,
  requireAdminPermission("website.performance", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = DeactivateWebsitePerformanceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(websitePerformancesTable)
      .where(eq(websitePerformancesTable.slug, params.data.slug))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Performance not found" });
      return;
    }
    if (!existing.isActive) {
      res.json(DeactivateWebsitePerformanceResponse.parse(existing));
      return;
    }

    const [row] = await db
      .update(websitePerformancesTable)
      .set({ isActive: false, updatedByAdminId: req.adminUser?.id ?? null })
      .where(eq(websitePerformancesTable.slug, params.data.slug))
      .returning();

    await logActivity(req, {
      action: "deactivate",
      module: "website.performance",
      entityType: "website_performance",
      entityId: row.slug,
      entityLabel: row.title,
      before: { isActive: true },
      after: { isActive: false },
      summary: `Deactivated Performance "${row.title}"`,
    });
    res.json(DeactivateWebsitePerformanceResponse.parse(row));
  },
);

export default router;
