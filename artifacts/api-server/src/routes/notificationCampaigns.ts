/**
 * Notifications Wave 2 — Manual Push Campaign lifecycle API.
 *
 * Deliberately a NEW route file, not an extension of routes/notifications.ts
 * — the legacy manual-notification endpoints there (POST/GET/PATCH/DELETE
 * /notifications) are left completely untouched for backward compatibility
 * (the existing Admin page keeps working unchanged until a later wave's UI
 * redesign). This file is purely additive.
 *
 * Reuses the existing "notifications" RBAC permission module (view/create/
 * send/delete) rather than introducing a new one — a campaign is still
 * fundamentally the same notifications:* capability the legacy composer
 * already requires, just a different persistence shape.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { count, desc, eq } from "drizzle-orm";
import { blockStudentJwt } from "../middlewares/auth";
import {
  db,
  notificationCampaignsTable,
} from "@workspace/db";
import {
  NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES,
  NOTIFICATION_CAMPAIGN_DELETABLE_STATUSES,
  NOTIFICATION_CAMPAIGN_EDITABLE_STATUSES,
} from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  computeCampaignAggregate,
  NotificationCampaignError,
  previewCampaignAudience,
  sendCampaign,
} from "../lib/notificationCampaigns";

const router: IRouter = Router();

const CAMPAIGN_ACTIVITY_FIELDS = ["title", "body", "audienceType", "audienceConfig", "status"] as const;

const AudienceTypeSchema = z.enum(NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES);

const CreateCampaignBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audienceType: AudienceTypeSchema.default("all"),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

const UpdateCampaignBody = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  audienceType: AudienceTypeSchema.optional(),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

const ListCampaignsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function isEditable(status: string): boolean {
  return (NOTIFICATION_CAMPAIGN_EDITABLE_STATUSES as readonly string[]).includes(status);
}

function isDeletable(status: string): boolean {
  return (NOTIFICATION_CAMPAIGN_DELETABLE_STATUSES as readonly string[]).includes(status);
}

function handleCampaignError(res: import("express").Response, error: unknown): void {
  if (error instanceof NotificationCampaignError) {
    const statusCode = error.code === "NOT_FOUND" ? 404 : error.code === "NOT_SENDABLE" ? 409 : 400;
    res.status(statusCode).json({ error: error.message, code: error.code });
    return;
  }
  throw error;
}

// ─── POST /notification-campaigns — create draft ────────────────────────────

router.post(
  "/notification-campaigns",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [row] = await db
      .insert(notificationCampaignsTable)
      .values({
        title: parsed.data.title,
        body: parsed.data.body,
        audienceType: parsed.data.audienceType,
        audienceConfig: parsed.data.audienceConfig ?? null,
        status: "draft",
        createdByAdminId: req.adminUser?.sub ?? null,
      })
      .returning();
    await logActivity(req, {
      action: "create",
      module: "notificationCampaigns",
      entityType: "notification_campaign",
      entityId: row.id,
      entityLabel: row.title,
      after: Object.fromEntries(CAMPAIGN_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      summary: `Created Manual Push Campaign draft "${row.title}"`,
    });
    res.status(201).json(row);
  },
);

// ─── GET /notification-campaigns — list ──────────────────────────────────────

router.get(
  "/notification-campaigns",
  requireAdminAuth,
  requireAdminPermission("notifications", "view"),
  async (req, res): Promise<void> => {
    const parsed = ListCampaignsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(notificationCampaignsTable)
        .orderBy(desc(notificationCampaignsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(notificationCampaignsTable),
    ]);

    // List view intentionally uses the write-once cached counters (fast,
    // no per-row aggregate query) — see the schema file's doc comment for
    // why that's safe for these specific fields. Reads are the one
    // exception (never cached) and would require a per-row query here;
    // Wave 2 leaves per-row read counts to the detail endpoint only, to
    // keep the list endpoint's cost independent of campaign count.
    res.json({ data: rows, total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) });
  },
);

// ─── GET /notification-campaigns/:id — detail, live-derived aggregates ──────

router.get(
  "/notification-campaigns/:id",
  requireAdminAuth,
  requireAdminPermission("notifications", "view"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    const [campaign] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id)).limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const aggregate = await computeCampaignAggregate(id);
    res.json({ ...campaign, aggregate });
  },
);

// ─── POST /notification-campaigns/:id/preview — resolve without freezing ────

router.post(
  "/notification-campaigns/:id/preview",
  requireAdminAuth,
  requireAdminPermission("notifications", "view"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    const [campaign] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id)).limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    try {
      const preview = await previewCampaignAudience(campaign);
      await db.update(notificationCampaignsTable).set({ previewedAt: new Date().toISOString() }).where(eq(notificationCampaignsTable.id, id));
      res.json(preview);
    } catch (error) {
      handleCampaignError(res, error);
    }
  },
);

// ─── PATCH /notification-campaigns/:id — edit draft content/audience ────────

router.patch(
  "/notification-campaigns/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    const parsed = UpdateCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [before] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id)).limit(1);
    if (!before) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    // Server-enforced immutability — not merely a UI affordance. Sent /
    // completed / failed / archived content can never be edited through
    // this endpoint, regardless of what the client sends.
    if (!isEditable(before.status)) {
      res.status(409).json({ error: `Campaign content is immutable once its status is "${before.status}" — only "draft" campaigns can be edited.` });
      return;
    }
    const [row] = await db
      .update(notificationCampaignsTable)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
        ...(parsed.data.audienceType !== undefined ? { audienceType: parsed.data.audienceType } : {}),
        ...(parsed.data.audienceConfig !== undefined ? { audienceConfig: parsed.data.audienceConfig } : {}),
      })
      .where(eq(notificationCampaignsTable.id, id))
      .returning();
    const { before: beforeDiff, after } = diffFields(
      Object.fromEntries(CAMPAIGN_ACTIVITY_FIELDS.map((key) => [key, before[key]])),
      Object.fromEntries(CAMPAIGN_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      CAMPAIGN_ACTIVITY_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "update",
        module: "notificationCampaigns",
        entityType: "notification_campaign",
        entityId: row.id,
        entityLabel: row.title,
        before: beforeDiff,
        after,
        summary: `Updated Manual Push Campaign draft "${row.title}"`,
      });
    }
    res.json(row);
  },
);

// ─── POST /notification-campaigns/:id/send ───────────────────────────────────

router.post(
  "/notification-campaigns/:id/send",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "send"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    try {
      const result = await sendCampaign(id);
      await logActivity(req, {
        action: "send",
        module: "notificationCampaigns",
        entityType: "notification_campaign",
        entityId: id,
        after: { ...result },
        summary: `Sent Manual Push Campaign ${id}: ${result.status}`,
      });
      res.json(result);
    } catch (error) {
      handleCampaignError(res, error);
    }
  },
);

// ─── POST /notification-campaigns/:id/archive — non-destructive ─────────────

router.post(
  "/notification-campaigns/:id/archive",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    const [before] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id)).limit(1);
    if (!before) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (before.status === "archived") {
      res.json(before);
      return;
    }
    // Archive never touches title/body/audience, the linked notification
    // row, the recipient snapshot, or delivery/read history — only status +
    // archivedAt change.
    const [row] = await db
      .update(notificationCampaignsTable)
      .set({ status: "archived", archivedAt: new Date().toISOString() })
      .where(eq(notificationCampaignsTable.id, id))
      .returning();
    await logActivity(req, {
      action: "archive",
      module: "notificationCampaigns",
      entityType: "notification_campaign",
      entityId: id,
      entityLabel: row.title,
      before: { status: before.status },
      after: { status: row.status },
      summary: `Archived Manual Push Campaign "${row.title}"`,
    });
    res.json(row);
  },
);

// ─── DELETE /notification-campaigns/:id — draft-only hard delete ────────────

router.delete(
  "/notification-campaigns/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    const [existing] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    // Server-enforced — a campaign that has ever been sent (or is
    // currently sending) can never be hard-deleted through this API,
    // regardless of what the client requests. Archive is the only removal
    // path once a send has been attempted.
    if (!isDeletable(existing.status)) {
      res.status(409).json({ error: `Campaign cannot be hard-deleted once its status is "${existing.status}" — use archive instead.` });
      return;
    }
    await db.delete(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, id));
    await logActivity(req, {
      action: "delete",
      module: "notificationCampaigns",
      entityType: "notification_campaign",
      entityId: id,
      entityLabel: existing.title,
      before: Object.fromEntries(CAMPAIGN_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      summary: `Deleted Manual Push Campaign draft "${existing.title}"`,
    });
    res.sendStatus(204);
  },
);

export default router;
