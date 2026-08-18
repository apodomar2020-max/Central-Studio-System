import { Router, type IRouter } from "express";
import { asc, eq, sql } from "drizzle-orm";
import {
  db,
  websiteBackgroundSettingsTable,
  getWebsiteBackgroundSection,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  validateWebsiteBackgroundUrl,
  WebsiteBackgroundUrlValidationError,
} from "../lib/websiteBackgroundMediaUrl";
import {
  ListPublicWebsiteBackgroundsResponse,
  ListAdminWebsiteBackgroundsResponse,
  UpdateWebsiteBackgroundParams,
  UpdateWebsiteBackgroundBody,
  UpdateWebsiteBackgroundResponse,
} from "@workspace/api-zod";

/**
 * Website CMS Wave 1 — Backgrounds only. No News/Performance routes here
 * (see the Wave 1 report). Fixed set of 8 approved section keys
 * (lib/db/src/websiteBackgroundSections.ts is the authoritative registry) —
 * deliberately no POST (create) or DELETE: rows are created once by the
 * seed step (scripts/src/seedWebsiteBackgrounds.ts) and only ever updated.
 *
 * Modeled directly on heroItems.ts / backgroundMusic.ts: public
 * unauthenticated read (projected fields only) + admin-guarded read/write,
 * Zod-validated bodies, activity-logged mutations.
 */

const router: IRouter = Router();
const ACTIVITY_FIELDS = ["mediaUrl", "mediaKind"] as const;

type WebsiteBackgroundSettingRow = typeof websiteBackgroundSettingsTable.$inferSelect;

/**
 * Enrich a row with the section's fixed allowedMediaKind from the registry
 * (never a stored column — see websiteBackgroundSections.ts). Admin-only;
 * the public projection never includes this field.
 */
function withAllowedMediaKind(row: WebsiteBackgroundSettingRow) {
  const section = getWebsiteBackgroundSection(row.sectionKey);
  return { ...row, allowedMediaKind: section?.allowedMediaKind ?? "image" };
}

// Public — no auth. Website BFF (app/api/website-backgrounds/route.ts)
// calls this once per page load. Projection excludes id/version/
// updatedByAdminId/timestamps — see the public vs. admin response-shape
// review in the Wave 1 report.
router.get("/website/backgrounds", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      sectionKey: websiteBackgroundSettingsTable.sectionKey,
      page: websiteBackgroundSettingsTable.page,
      sectionLabel: websiteBackgroundSettingsTable.sectionLabel,
      mediaUrl: websiteBackgroundSettingsTable.mediaUrl,
      mediaKind: websiteBackgroundSettingsTable.mediaKind,
    })
    .from(websiteBackgroundSettingsTable)
    .orderBy(asc(websiteBackgroundSettingsTable.sectionKey));

  // no-store (Locked Decision: CMS public data uses a no-stale-content
  // strategy) — matches app/api/faqs/route.ts's Cache-Control on the
  // website side; media/CDN caching is separate and untouched.
  res.set("Cache-Control", "no-store, max-age=0");
  res.json(ListPublicWebsiteBackgroundsResponse.parse(rows));
});

router.get(
  "/admin/website/backgrounds",
  requireAdminAuth,
  requireAdminPermission("website.backgrounds", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(websiteBackgroundSettingsTable)
      .orderBy(asc(websiteBackgroundSettingsTable.sectionKey));
    res.json(ListAdminWebsiteBackgroundsResponse.parse(rows.map(withAllowedMediaKind)));
  },
);

router.patch(
  "/admin/website/backgrounds/:sectionKey",
  requireAdminAuth,
  requireAdminPermission("website.backgrounds", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateWebsiteBackgroundParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // Server-side registry is authoritative — an unknown sectionKey (or one
    // that isn't one of the 8 approved keys) is rejected before anything
    // else, regardless of what the DB's own CHECK constraint would also
    // catch on write.
    const section = getWebsiteBackgroundSection(params.data.sectionKey);
    if (!section) {
      res.status(404).json({ error: "Unknown section key" });
      return;
    }

    const parsed = UpdateWebsiteBackgroundBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid background media" });
      return;
    }

    const [existing] = await db
      .select()
      .from(websiteBackgroundSettingsTable)
      .where(eq(websiteBackgroundSettingsTable.sectionKey, section.sectionKey))
      .limit(1);
    if (!existing) {
      // This table has no admin-facing create path (see module doc comment
      // above) — a missing row here means the seed step has not run yet.
      res.status(404).json({ error: "This section has not been seeded yet." });
      return;
    }

    const inputUrl = parsed.data.mediaUrl?.trim() || null;
    let nextMediaUrl: string | null = null;
    let nextMediaKind: "image" | "video" | null = null;

    if (inputUrl) {
      // Trust boundary: format, protocol, approved-host, AND media-kind
      // (Admin cannot set mediaKind directly — it is always re-derived
      // here from a live check, never accepted as input).
      try {
        const validation = await validateWebsiteBackgroundUrl(inputUrl, section.allowedMediaKind);
        nextMediaUrl = validation.normalizedUrl;
        nextMediaKind = validation.mediaKind;
      } catch (err) {
        if (err instanceof WebsiteBackgroundUrlValidationError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    }
    // inputUrl === null (blank/cleared submission) => nextMediaUrl/nextMediaKind
    // stay null, i.e. "use the section's own built-in default" — this is a
    // normal edit (Clear / Use Default), never a delete.

    const [updated] = await db
      .update(websiteBackgroundSettingsTable)
      .set({
        mediaUrl: nextMediaUrl,
        mediaKind: nextMediaKind,
        version: sql`${websiteBackgroundSettingsTable.version} + 1`,
        updatedByAdminId: req.adminUser?.id ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(websiteBackgroundSettingsTable.sectionKey, section.sectionKey))
      .returning();
    if (!updated) {
      res.status(500).json({ error: "Failed to save background media" });
      return;
    }

    const { before, after } = diffFields(
      { mediaUrl: existing.mediaUrl, mediaKind: existing.mediaKind },
      { mediaUrl: updated.mediaUrl, mediaKind: updated.mediaKind },
      ACTIVITY_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "update",
        module: "website.backgrounds",
        entityType: "website_background",
        entityId: section.sectionKey,
        entityLabel: section.sectionLabel,
        before,
        after,
        summary: nextMediaUrl
          ? `Updated background media for ${section.sectionLabel}`
          : `Cleared background media for ${section.sectionLabel} (reverted to default)`,
      });
    }

    res.json(UpdateWebsiteBackgroundResponse.parse(withAllowedMediaKind(updated)));
  },
);

export default router;
