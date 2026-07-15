/**
 * Admin Ballet Performance Opportunities routes — /api/admin/ballet/performances/*
 *
 * Admin-managed events (recitals, galas, competitions) ballet students can be
 * invited to perform at.
 *
 * Routes:
 *   GET   /api/admin/ballet/performances       — paginated list
 *   POST  /api/admin/ballet/performances       — create opportunity
 *   PATCH /api/admin/ballet/performances/:id   — update opportunity
 */

import { Router, type IRouter } from "express";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, balletPerformanceOpportunitiesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_PERFORMANCE_STATUSES = ["active", "inactive"] as const;
const GOOGLE_DRIVE_IMAGE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const BALLET_PERFORMANCE_ACTIVITY_FIELDS = [
  "eventTitle",
  "description",
  "imageUrl",
  "eventType",
  "locationName",
  "eventDate",
  "startTime",
  "endTime",
  "requirements",
  "externalCtaUrl",
  "status",
] as const;

function extractGoogleDriveFileId(input: URL): string | null {
  const pathMatch = input.pathname.match(/\/file\/d\/([^/]+)/i);
  const raw = pathMatch?.[1] ?? input.searchParams.get("id");
  if (!raw) return null;
  const decoded = decodeURIComponent(raw).trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(decoded) ? decoded : null;
}

function normalizePerformanceImageUrl(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Image URL must be a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Image URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("Image URL must not include credentials.");
  }

  if (!GOOGLE_DRIVE_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    return url.toString();
  }

  const driveId = extractGoogleDriveFileId(url);
  if (!driveId) {
    throw new Error("Google Drive image URL must include a public file ID.");
  }

  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveId)}`;
}

function normalizeExternalCtaUrl(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("External CTA URL must be a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("External CTA URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("External CTA URL must not include credentials.");
  }

  return url.toString();
}

function isPerformanceUrlValidationError(err: unknown): err is Error {
  return err instanceof Error && (
    err.message.includes("Image URL")
    || err.message.includes("Google Drive image URL")
    || err.message.includes("External CTA URL")
  );
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/performances", requireAdminAuth, requireAdminPermission("ballet.performances", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletPerformanceOpportunitiesTable).orderBy(asc(balletPerformanceOpportunitiesTable.eventDate)).limit(limit).offset(offset),
    db.select({ total: count(balletPerformanceOpportunitiesTable.id) }).from(balletPerformanceOpportunitiesTable),
  ]);

  res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreatePerformanceBody = z.object({
  eventTitle:   z.string().min(1, "eventTitle is required"),
  description:  z.string().nullable().optional(),
  imageUrl:     z.string().nullable().optional(),
  eventType:    z.string().min(1, "eventType is required"),
  locationName: z.string().nullable().optional(),
  eventDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "eventDate must be YYYY-MM-DD"),
  startTime:    z.string().min(1, "startTime is required"),
  endTime:      z.string().min(1, "endTime is required"),
  requirements: z.array(z.string()).optional(),
  externalCtaUrl: z.string().nullable().optional(),
  status:       z.enum(BALLET_PERFORMANCE_STATUSES).default("active"),
});

router.post("/admin/ballet/performances", requireAdminAuth, requireAdminPermission("ballet.performances", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePerformanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  try {
    const performanceValues = {
      ...parsed.data,
      description: parsed.data.description?.trim() || null,
      imageUrl: normalizePerformanceImageUrl(parsed.data.imageUrl),
      locationName: parsed.data.locationName?.trim() || null,
      externalCtaUrl: normalizeExternalCtaUrl(parsed.data.externalCtaUrl),
    };

    const [performance] = await db.insert(balletPerformanceOpportunitiesTable).values(performanceValues).returning();
    await logActivity(req, {
      action: "create",
      module: "ballet.performances",
      entityType: "ballet_performance_opportunity",
      entityId: performance.id,
      entityLabel: performance.eventTitle,
      after: Object.fromEntries(BALLET_PERFORMANCE_ACTIVITY_FIELDS.map((key) => [key, performance[key]])),
      summary: `Created ballet performance opportunity ${performance.eventTitle}`,
    });
    res.status(201).json({ performance });
  } catch (err) {
    if (isPerformanceUrlValidationError(err)) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "POST /admin/ballet/performances failed");
    res.status(500).json({ error: "Failed to create performance opportunity" });
  }
});

const UpdatePerformanceBody = z.object({
  eventTitle:   z.string().min(1).optional(),
  description:  z.string().nullable().optional(),
  imageUrl:     z.string().nullable().optional(),
  eventType:    z.string().min(1).optional(),
  locationName: z.string().nullable().optional(),
  eventDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime:    z.string().min(1).optional(),
  endTime:      z.string().min(1).optional(),
  requirements: z.array(z.string()).optional(),
  externalCtaUrl: z.string().nullable().optional(),
  status:       z.enum(BALLET_PERFORMANCE_STATUSES).optional(),
});

router.patch("/admin/ballet/performances/:id", requireAdminAuth, requireAdminPermission("ballet.performances", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid performance opportunity ID" }); return; }

  const parsed = UpdatePerformanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  let updates: Record<string, unknown>;
  try {
    updates = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) updates[k] = v;
    }
    if (parsed.data.description !== undefined) {
      updates["description"] = parsed.data.description?.trim() || null;
    }
    if (parsed.data.imageUrl !== undefined) {
      updates["imageUrl"] = normalizePerformanceImageUrl(parsed.data.imageUrl);
    }
    if (parsed.data.locationName !== undefined) {
      updates["locationName"] = parsed.data.locationName?.trim() || null;
    }
    if (parsed.data.externalCtaUrl !== undefined) {
      updates["externalCtaUrl"] = normalizeExternalCtaUrl(parsed.data.externalCtaUrl);
    }
  } catch (err) {
    if (isPerformanceUrlValidationError(err)) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "PATCH /admin/ballet/performances/:id normalization failed");
    res.status(500).json({ error: "Failed to update performance opportunity" });
    return;
  }
  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [existing] = await db.select().from(balletPerformanceOpportunitiesTable).where(eq(balletPerformanceOpportunitiesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Performance opportunity not found" }); return; }
    const [performance] = await db
      .update(balletPerformanceOpportunitiesTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletPerformanceOpportunitiesTable.id, id))
      .returning();
    if (!performance) { res.status(404).json({ error: "Performance opportunity not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_PERFORMANCE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_PERFORMANCE_ACTIVITY_FIELDS.map((key) => [key, performance[key]])),
      BALLET_PERFORMANCE_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.performances",
        entityType: "ballet_performance_opportunity",
        entityId: performance.id,
        entityLabel: performance.eventTitle,
        before,
        after,
        summary: `Updated ballet performance opportunity ${performance.eventTitle}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ performance });
  } catch (err) {
    if (isPerformanceUrlValidationError(err)) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "PATCH /admin/ballet/performances/:id failed");
    res.status(500).json({ error: "Failed to update performance opportunity" });
  }
});

export default router;
