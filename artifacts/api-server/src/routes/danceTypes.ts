/**
 * Dance Types routes
 *
 * Public (requireAuth only — global API key):
 *   GET  /api/dance-types                      — active types only (for mobile & admin category reads)
 *
 * Admin (requireAuth + requireAdminAuth):
 *   GET    /api/admin/settings/dance-types      — all types incl. inactive
 *   POST   /api/admin/settings/dance-types      — create new type
 *   PATCH  /api/admin/settings/dance-types/:id  — update name/slug/isActive/sortOrder
 *   DELETE /api/admin/settings/dance-types/:id  — soft-delete (sets is_active = false)
 */

import express, { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, danceTypesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { sanitizeSvg } from "../lib/sanitizeSvg";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const DANCE_TYPE_ACTIVITY_FIELDS = ["name", "slug", "description", "iconUrl", "coverImageUrl", "color", "isActive", "sortOrder", "hasIconSvg"] as const;

/**
 * Shape a DB row for clients. Keeps the sanitized `iconSvg` inline so mobile can
 * render it with <SvgXml> (no second, unauthenticated request), and also exposes
 * `iconSvgUrl` (the serve endpoint) for admin/web consumers.
 */
function shapeDanceType(row: typeof danceTypesTable.$inferSelect) {
  const safeIcon = row.iconSvg ? sanitizeSvg(row.iconSvg) : null;
  const iconSvg = safeIcon && "svg" in safeIcon ? safeIcon.svg : null;
  return {
    ...row,
    iconSvg,
    iconMime: iconSvg ? "image/svg+xml" : null,
    hasIconSvg: !!iconSvg,
    iconSvgUrl: iconSvg ? `/api/dance-types/${row.id}/icon.svg` : null,
  };
}

function danceTypeActivitySnapshot(row: typeof danceTypesTable.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    iconUrl: row.iconUrl,
    coverImageUrl: row.coverImageUrl,
    color: row.color,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    hasIconSvg: !!row.iconSvg,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive slug from name: trim → lowercase → strip non-alphanumeric */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ─── GET /api/dance-types  (public) ──────────────────────────────────────────

router.get("/dance-types", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(danceTypesTable)
      .where(eq(danceTypesTable.isActive, true))
      .orderBy(asc(danceTypesTable.sortOrder), asc(danceTypesTable.name));
    res.json(rows.map(shapeDanceType));
  } catch (err) {
    console.error("[dance-types] GET /api/dance-types error:", err);
    res.status(500).json({ error: "Failed to fetch dance types" });
  }
});

// ─── GET /api/admin/settings/dance-types  (admin) ────────────────────────────

router.get(
  "/admin/settings/dance-types",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(danceTypesTable)
        .orderBy(asc(danceTypesTable.sortOrder), asc(danceTypesTable.name));
      res.json(rows.map(shapeDanceType));
    } catch (err) {
      console.error("[dance-types] GET /api/admin/settings/dance-types error:", err);
      res.status(500).json({ error: "Failed to fetch dance types" });
    }
  },
);

// ─── POST /api/admin/settings/dance-types  (admin) ───────────────────────────

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "color must be a hex value");

const CreateBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().max(2000).nullish(),
  iconUrl: z.string().max(2000).nullish(),
  coverImageUrl: z.string().max(2000).nullish(),
  color: hexColor.nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.post(
  "/admin/settings/dance-types",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors });
      return;
    }
    const { name, slug, description, iconUrl, coverImageUrl, color, isActive, sortOrder } = parsed.data;
    const finalSlug = slug ?? slugify(name);
    try {
      const [created] = await db
        .insert(danceTypesTable)
        .values({
          name,
          slug: finalSlug,
          description: description ?? null,
          iconUrl: iconUrl ?? null,
          coverImageUrl: coverImageUrl ?? null,
          color: color ?? null,
          isActive: isActive ?? true,
          sortOrder: sortOrder ?? 0,
        })
        .returning();
      await logActivity(req, {
        action: "create",
        module: "settings",
        entityType: "dance_type",
        entityId: created.id,
        entityLabel: created.name,
        after: danceTypeActivitySnapshot(created),
        summary: `Created dance type ${created.name}`,
      });
      res.status(201).json(shapeDanceType(created));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("dance_types_slug_unique") || msg.includes("unique")) {
        res.status(409).json({ error: `Slug "${finalSlug}" is already in use` });
        return;
      }
      console.error("[dance-types] POST error:", err);
      res.status(500).json({ error: "Failed to create dance type" });
    }
  },
);

// ─── PATCH /api/admin/settings/dance-types/:id  (admin) ──────────────────────

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().max(2000).nullish(),
  iconUrl: z.string().max(2000).nullish(),
  coverImageUrl: z.string().max(2000).nullish(),
  color: hexColor.nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.patch(
  "/admin/settings/dance-types/:id",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors });
      return;
    }
    const updates = parsed.data;
    // Auto-derive slug when name changes but slug is not explicitly provided
    if (updates.name && !updates.slug) {
      updates.slug = slugify(updates.name);
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    try {
      const [existing] = await db.select().from(danceTypesTable).where(eq(danceTypesTable.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      const [updated] = await db
        .update(danceTypesTable)
        .set(updates)
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      const { before, after } = diffFields(
        danceTypeActivitySnapshot(existing),
        danceTypeActivitySnapshot(updated),
        DANCE_TYPE_ACTIVITY_FIELDS,
      );
      const changedKeys = Object.keys(after);
      if (changedKeys.length > 0) {
        const action = existing.isActive !== updated.isActive ? updated.isActive ? "activate" : "deactivate" : "update";
        await logActivity(req, {
          action,
          module: "settings",
          entityType: "dance_type",
          entityId: updated.id,
          entityLabel: updated.name,
          before,
          after,
          summary: action === "activate"
            ? `Activated dance type ${updated.name}`
            : action === "deactivate"
              ? `Deactivated dance type ${updated.name}`
              : `Updated dance type ${updated.name}: ${changedKeys.join(", ")}`,
        });
      }
      res.json(shapeDanceType(updated));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("dance_types_slug_unique") || msg.includes("unique")) {
        res.status(409).json({ error: `Slug "${updates.slug}" is already in use` });
        return;
      }
      console.error("[dance-types] PATCH error:", err);
      res.status(500).json({ error: "Failed to update dance type" });
    }
  },
);

// ─── DELETE /api/admin/settings/dance-types/:id  (admin, soft) ───────────────

router.delete(
  "/admin/settings/dance-types/:id",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [existing] = await db.select().from(danceTypesTable).where(eq(danceTypesTable.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      const [updated] = await db
        .update(danceTypesTable)
        .set({ isActive: false })
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      if (existing.isActive !== updated.isActive) {
        await logActivity(req, {
          action: "deactivate",
          module: "settings",
          entityType: "dance_type",
          entityId: updated.id,
          entityLabel: updated.name,
          before: { isActive: existing.isActive },
          after: { isActive: updated.isActive },
          summary: `Deactivated dance type ${updated.name}`,
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[dance-types] DELETE error:", err);
      res.status(500).json({ error: "Failed to deactivate dance type" });
    }
  },
);

// ─── POST /api/admin/settings/dance-types/:id/icon  (admin) — upload SVG ─────
// Admin reads the chosen .svg file as text and POSTs { svg }. We sanitize and
// store the markup in the DB (no external storage). 512KB per-route body limit.
router.post(
  "/admin/settings/dance-types/:id/icon",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  express.json({ limit: "512kb" }),
  async (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const svgRaw = typeof (req.body as { svg?: unknown })?.svg === "string" ? (req.body as { svg: string }).svg : null;
    if (!svgRaw) {
      res.status(400).json({ error: "Body must include { svg: string }" });
      return;
    }
    const result = sanitizeSvg(svgRaw);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    try {
      const [existing] = await db.select().from(danceTypesTable).where(eq(danceTypesTable.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      const [updated] = await db
        .update(danceTypesTable)
        .set({ iconSvg: result.svg, iconMime: "image/svg+xml" })
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      if (updated.iconSvg) {
        await logActivity(req, {
          action: "update",
          module: "settings",
          entityType: "dance_type",
          entityId: updated.id,
          entityLabel: updated.name,
          before: { hasIconSvg: !!existing.iconSvg },
          after: { hasIconSvg: true, iconUpdated: true },
          summary: `Updated icon for dance type ${updated.name}`,
        });
      }
      res.json(shapeDanceType(updated));
    } catch (err) {
      console.error("[dance-types] icon upload error:", err);
      res.status(500).json({ error: "Failed to save icon" });
    }
  },
);

// ─── DELETE /api/admin/settings/dance-types/:id/icon  (admin) — clear SVG ─────
router.delete(
  "/admin/settings/dance-types/:id/icon",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [existing] = await db.select().from(danceTypesTable).where(eq(danceTypesTable.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      const [updated] = await db
        .update(danceTypesTable)
        .set({ iconSvg: null, iconMime: null })
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      if (existing.iconSvg !== updated.iconSvg) {
        await logActivity(req, {
          action: "update",
          module: "settings",
          entityType: "dance_type",
          entityId: updated.id,
          entityLabel: updated.name,
          before: { hasIconSvg: !!existing.iconSvg },
          after: { hasIconSvg: !!updated.iconSvg },
          summary: `Cleared icon for dance type ${updated.name}`,
        });
      }
      res.json(shapeDanceType(updated));
    } catch (err) {
      console.error("[dance-types] icon clear error:", err);
      res.status(500).json({ error: "Failed to remove icon" });
    }
  },
);

// ─── GET /api/dance-types/:id/icon.svg  (public) — serve stored SVG ──────────
router.get("/dance-types/:id/icon.svg", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).end();
    return;
  }
  try {
    const [row] = await db
      .select({ iconSvg: danceTypesTable.iconSvg })
      .from(danceTypesTable)
      .where(eq(danceTypesTable.id, id))
      .limit(1);
    if (!row?.iconSvg) {
      res.status(404).end();
      return;
    }
    const safeIcon = sanitizeSvg(row.iconSvg);
    if ("error" in safeIcon) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", 'inline; filename="dance-type-icon.svg"');
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'none'; style-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox",
    );
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(safeIcon.svg);
  } catch (err) {
    console.error("[dance-types] serve icon error:", err);
    res.status(500).end();
  }
});

export default router;
