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
  resumeCampaign,
  sendCampaign,
} from "../lib/notificationCampaigns";
import { validateAndNormalizeAudienceConfig } from "../lib/notificationCampaignAudience";

const router: IRouter = Router();

const CAMPAIGN_ACTIVITY_FIELDS = ["title", "body", "audienceType", "audienceConfig", "status"] as const;

// Wave 3: new/edited campaigns may use any of the eight resolvable values
// (the legacy "all" plus the seven-segment contract) — "all" is kept fully
// creatable, not just resolvable, purely for backward compatibility with
// any existing integration/tooling that already sends it; it behaves
// identically to "all_members" in every respect (same resolver branch, same
// config shape). "all_members" is the new DEFAULT and the name the Wave 3
// contract asks new campaigns to use going forward, but nothing rejects the
// old value outright.
const AudienceTypeSchema = z.enum(NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES);

const CreateCampaignBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audienceType: AudienceTypeSchema.default("all_members"),
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

const CAMPAIGN_ERROR_STATUS_CODES: Record<string, number> = {
  NOT_FOUND: 404,
  NOT_SENDABLE: 409,
  // Wave 2.1 — resume-specific outcomes. All conflict-shaped: the request
  // itself is well-formed, but the campaign's current state doesn't permit
  // it right now.
  NOT_RESUMABLE: 409,
  NOT_STALE: 409,
  MAX_ATTEMPTS_EXCEEDED: 409,
  MISSING_NOTIFICATION: 409,
  // Concurrency-review fix — a sender (initial send or an earlier resume)
  // discovered mid-run that a concurrent resume reclaimed the campaign's
  // send lease. Conflict-shaped for the same reason as the codes above: not
  // a client error, just "someone else already owns this now".
  LEASE_LOST: 409,
  // Wave 3 — audienceConfig failed shape validation or an async DB check
  // (nonexistent id, schedule/class mismatch, cancelled schedule, invalid
  // occurrence, nonexistent package). Genuinely a client error (400),
  // listed explicitly for readability even though it matches the default.
  UNSUPPORTED_AUDIENCE_TYPE: 400,
  INVALID_AUDIENCE_CONFIG: 400,
};

function handleCampaignError(res: import("express").Response, error: unknown): void {
  if (error instanceof NotificationCampaignError) {
    const statusCode = CAMPAIGN_ERROR_STATUS_CODES[error.code] ?? 400;
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
    // Wave 3: canonical server-side audienceConfig validation — shape
    // (Zod, per audienceType) plus async DB checks (ids exist, schedule
    // belongs to class, package exists, …). The client's raw config is
    // NEVER trusted or stored directly; only the validated/normalized
    // result (e.g. deduplicated specific_members.studentIds) is persisted.
    let normalizedAudienceConfig: Record<string, unknown>;
    try {
      normalizedAudienceConfig = await validateAndNormalizeAudienceConfig(parsed.data.audienceType, parsed.data.audienceConfig ?? {}) as Record<string, unknown>;
    } catch (error) {
      handleCampaignError(res, error);
      return;
    }
    const [row] = await db
      .insert(notificationCampaignsTable)
      .values({
        title: parsed.data.title,
        body: parsed.data.body,
        audienceType: parsed.data.audienceType,
        audienceConfig: normalizedAudienceConfig,
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

    // Wave 3: re-validate whenever EITHER audience field changes — an
    // audienceType change with no fresh audienceConfig defaults to {} (an
    // empty object) rather than silently reusing the OLD type's config
    // shape, which would almost always be structurally wrong for the new
    // type; a config-requiring type (specific_members/class_participants/
    // package_holders) then correctly 400s asking for real configuration
    // instead of persisting a stale/mismatched one.
    let normalizedAudienceConfig: Record<string, unknown> | undefined;
    if (parsed.data.audienceType !== undefined || parsed.data.audienceConfig !== undefined) {
      const effectiveAudienceType = parsed.data.audienceType ?? before.audienceType;
      const effectiveRawConfig = parsed.data.audienceConfig !== undefined
        ? parsed.data.audienceConfig
        : (parsed.data.audienceType !== undefined ? {} : before.audienceConfig);
      try {
        normalizedAudienceConfig = await validateAndNormalizeAudienceConfig(effectiveAudienceType as never, effectiveRawConfig ?? {}) as Record<string, unknown>;
      } catch (error) {
        handleCampaignError(res, error);
        return;
      }
    }

    const [row] = await db
      .update(notificationCampaignsTable)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
        ...(parsed.data.audienceType !== undefined ? { audienceType: parsed.data.audienceType } : {}),
        ...(normalizedAudienceConfig !== undefined ? { audienceConfig: normalizedAudienceConfig } : {}),
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

// ─── POST /notification-campaigns/:id/resume — recover a stale "sending" campaign ──
//
// Wave 2.1. Gated on notifications:send (the same permission sending
// itself requires — resuming is conceptually "continue sending", not a
// separate lesser capability). Only ever acts on a STALE "sending"
// campaign: an actively-running send is rejected (NOT_STALE), a campaign
// in any other status is rejected (NOT_RESUMABLE). Never accepts a body —
// there is nothing to configure; content/audience cannot be changed by
// this or any other post-draft endpoint.

router.post(
  "/notification-campaigns/:id/resume",
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
      const result = await resumeCampaign(id);
      await logActivity(req, {
        action: "resume",
        module: "notificationCampaigns",
        entityType: "notification_campaign",
        entityId: id,
        after: { ...result },
        summary: `Resumed stale Manual Push Campaign ${id} (attempt ${result.sendAttempt}): ${result.status}`,
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
