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

import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, danceTypesTable } from "@workspace/db";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

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
    res.json(rows);
  } catch (err) {
    console.error("[dance-types] GET /api/dance-types error:", err);
    res.status(500).json({ error: "Failed to fetch dance types" });
  }
});

// ─── GET /api/admin/settings/dance-types  (admin) ────────────────────────────

router.get(
  "/admin/settings/dance-types",
  requireAdminAuth,
  async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(danceTypesTable)
        .orderBy(asc(danceTypesTable.sortOrder), asc(danceTypesTable.name));
      res.json(rows);
    } catch (err) {
      console.error("[dance-types] GET /api/admin/settings/dance-types error:", err);
      res.status(500).json({ error: "Failed to fetch dance types" });
    }
  },
);

// ─── POST /api/admin/settings/dance-types  (admin) ───────────────────────────

const CreateBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.post(
  "/admin/settings/dance-types",
  requireAdminAuth,
  async (req: AdminRequest, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors });
      return;
    }
    const { name, slug, isActive, sortOrder } = parsed.data;
    const finalSlug = slug ?? slugify(name);
    try {
      const [created] = await db
        .insert(danceTypesTable)
        .values({
          name,
          slug: finalSlug,
          isActive: isActive ?? true,
          sortOrder: sortOrder ?? 0,
        })
        .returning();
      res.status(201).json(created);
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
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.patch(
  "/admin/settings/dance-types/:id",
  requireAdminAuth,
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
      const [updated] = await db
        .update(danceTypesTable)
        .set(updates)
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      res.json(updated);
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
  async (req: AdminRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [updated] = await db
        .update(danceTypesTable)
        .set({ isActive: false })
        .where(eq(danceTypesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Dance type not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[dance-types] DELETE error:", err);
      res.status(500).json({ error: "Failed to deactivate dance type" });
    }
  },
);

export default router;
