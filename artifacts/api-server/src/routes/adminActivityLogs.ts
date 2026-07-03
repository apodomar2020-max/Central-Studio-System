/**
 * Admin Activity Logs API (Phase 7B).
 *
 * GET /api/admin/logs — paginated, filterable feed of admin_activity_logs.
 * Guarded by auditLogs.view. Admin-only endpoint: intentionally NOT part of
 * the OpenAPI contract / generated clients (same pattern as /api/admin/roles
 * and /api/promotions) — the Logs page uses a raw header-aware fetch.
 *
 * Response body (Ballet Applications pagination pattern):
 *   { data, total, page, limit, totalPages }
 */
import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db, adminActivityLogsTable } from "@workspace/db";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";

const router: IRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

router.get(
  "/admin/logs",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("auditLogs", "view"),
  async (req, res): Promise<void> => {
    const page = Math.max(1, parseInt(firstString(req.query["page"]) ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(firstString(req.query["limit"]) ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const search = firstString(req.query["search"]);
    const action = firstString(req.query["action"]);
    const moduleKey = firstString(req.query["module"]);
    const entityType = firstString(req.query["entityType"]);
    const actorIdRaw = firstString(req.query["actorId"]);
    const from = firstString(req.query["from"]);
    const to = firstString(req.query["to"]);

    const conditions: SQL[] = [];
    if (action) conditions.push(eq(adminActivityLogsTable.action, action));
    if (moduleKey) conditions.push(eq(adminActivityLogsTable.module, moduleKey));
    if (entityType) conditions.push(eq(adminActivityLogsTable.entityType, entityType));
    if (actorIdRaw) {
      const actorId = parseInt(actorIdRaw, 10);
      if (!isNaN(actorId)) conditions.push(eq(adminActivityLogsTable.actorId, actorId));
    }
    if (from && DATE_RE.test(from)) {
      conditions.push(gte(adminActivityLogsTable.createdAt, `${from}T00:00:00.000Z`));
    }
    if (to && DATE_RE.test(to)) {
      conditions.push(lte(adminActivityLogsTable.createdAt, `${to}T23:59:59.999Z`));
    }
    if (search) {
      const pattern = `%${search}%`;
      const searchCondition = or(
        ilike(adminActivityLogsTable.summary, pattern),
        ilike(adminActivityLogsTable.entityLabel, pattern),
        ilike(adminActivityLogsTable.actorName, pattern),
        ilike(adminActivityLogsTable.actorEmail, pattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [[totals], data] = await Promise.all([
      db.select({ total: count() }).from(adminActivityLogsTable).where(whereClause),
      db
        .select()
        .from(adminActivityLogsTable)
        .where(whereClause)
        .orderBy(desc(adminActivityLogsTable.createdAt), desc(adminActivityLogsTable.id))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const total = Number(totals?.total ?? 0);
    res.json({
      data,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    });
  },
);

export default router;
