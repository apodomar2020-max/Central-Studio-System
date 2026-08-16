/**
 * Notifications Wave 5 — Notification Delivery Logs API.
 *
 * GET /api/admin/logs/notification-delivery — paginated, filterable,
 * server-joined operational feed (see lib/notificationDeliveryLogs.ts for
 * the row-granularity/privacy design). Deliberately a NEW, dedicated
 * read-only route — never folded into the generic GET /notifications
 * (student-facing) or GET /notification-campaigns (Marketing campaign
 * management) endpoints, which serve entirely different audiences/shapes.
 *
 * GET /api/admin/logs/notification-delivery/filter-options — small,
 * LIMIT-bounded distinct-value lookups to populate the Type / Related
 * Entity filter dropdowns (same pattern as GET /api/admin/users powering
 * the Actor filter on the Admin Activity Logs page).
 *
 * GET /api/admin/logs/notification-delivery/:id — single-record detail.
 *
 * ─── RBAC (investigated, documented — not a new permission) ──────────────
 * Requires BOTH `auditLogs.view` AND `notifications.view` — chained as two
 * sequential requireAdminPermission() middlewares, so both must pass to
 * reach the handler (an AND, not an OR). Neither permission alone is
 * sufficient:
 *   - `notifications.view` alone already grants Marketing → Manual Push
 *     Notifications, and a Marketing-only role plausibly holds it without
 *     ever being meant to see cross-account, system-wide operational Push
 *     delivery history for every student in the studio — that would be a
 *     privilege-scope surprise, not an intended read.
 *   - `auditLogs.view` alone (System Users / ops-only roles) says nothing
 *     about whether that role is meant to see Notifications content at all.
 * Requiring both matches the task's own recommended posture and needs no
 * new permission: PERMISSION_CATALOG already has `auditLogs.view` (backs
 * the existing Admin Activity Logs page) and `notifications.view` (backs
 * Marketing → Manual Push Notifications) — this endpoint is simply gated
 * on the intersection of two capabilities that already exist for
 * unrelated reasons, exactly the kind of role a "notification delivery
 * operator" would be expected to hold (audit/ops visibility AND
 * notifications visibility).
 */
import { Router, type IRouter } from "express";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  getNotificationDeliveryFilterOptions,
  getNotificationDeliveryLogDetail,
  listNotificationDeliveryLogs,
} from "../lib/notificationDeliveryLogs";

const router: IRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

// Both permissions are required — see the file doc comment above for why
// neither alone is treated as sufficient.
const requireNotificationDeliveryAccess = [
  requireAdminAuth,
  requireAdminPermission("auditLogs", "view"),
  requireAdminPermission("notifications", "view"),
] as const;

router.get(
  "/admin/logs/notification-delivery/filter-options",
  blockStudentJwt,
  ...requireNotificationDeliveryAccess,
  async (_req, res): Promise<void> => {
    const options = await getNotificationDeliveryFilterOptions();
    res.json(options);
  },
);

router.get(
  "/admin/logs/notification-delivery/:id",
  blockStudentJwt,
  ...requireNotificationDeliveryAccess,
  async (req, res): Promise<void> => {
    const id = firstString(req.params["id"]);
    if (!id) {
      res.status(400).json({ error: "Missing log id" });
      return;
    }
    const detail = await getNotificationDeliveryLogDetail(id);
    if (!detail) {
      res.status(404).json({ error: "Notification delivery log not found" });
      return;
    }
    res.json(detail);
  },
);

router.get(
  "/admin/logs/notification-delivery",
  blockStudentJwt,
  ...requireNotificationDeliveryAccess,
  async (req, res): Promise<void> => {
    const page = Math.max(1, parseInt(firstString(req.query["page"]) ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(firstString(req.query["limit"]) ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const result = await listNotificationDeliveryLogs({
      page,
      limit,
      search: firstString(req.query["search"]),
      source: firstString(req.query["source"]),
      status: firstString(req.query["status"]),
      type: firstString(req.query["type"]),
      platform: firstString(req.query["platform"]),
      relatedEntityType: firstString(req.query["relatedEntityType"]),
      errorCode: firstString(req.query["errorCode"]),
      from: firstString(req.query["from"]),
      to: firstString(req.query["to"]),
    });

    res.json(result);
  },
);

export default router;
