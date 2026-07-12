/**
 * Admin Ballet Payments routes — /api/admin/ballet/payments/*
 *
 * All routes require:
 *   1. requireAuth          (shared API key, applied globally)
 *   2. requireAdminAuth     (X-Admin-Token JWT)
 *
 * Routes:
 *   GET   /api/admin/ballet/payments              — paginated list + filter by status/applicationId
 *   POST  /api/admin/ballet/payments               — create a payment record for an application
 *   PATCH /api/admin/ballet/payments/:id/status    — change status; "refunded" withdraws the enrollment
 *
 * Refund side-effect:
 *   Transitioning a payment to "refunded" sets refundedAt and, if the payment
 *   is tied to a level assignment (levelAssignmentId), marks that
 *   ballet_level_assignments row status = "withdrawn" (never deletes the
 *   application or its event history). A ballet_application_events row is
 *   appended so the application timeline reflects the withdrawal.
 */

import { Router, type IRouter } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletPaymentsTable,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletLevelAssignmentsTable,
  packageOrdersTable,
  BALLET_PAYMENT_STATUSES,
} from "@workspace/db";
import type { BalletPaymentStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_PAYMENT_ACTIVITY_FIELDS = ["applicationId", "levelAssignmentId", "packageId", "packageOrderId", "amountEgp", "status", "paidAt", "refundedAt", "notes"] as const;

const VALID_PAYMENT_STATUSES = new Set(BALLET_PAYMENT_STATUSES);

function isValidPaymentStatus(s: string): s is BalletPaymentStatus {
  return VALID_PAYMENT_STATUSES.has(s as BalletPaymentStatus);
}

// ─── GET /api/admin/ballet/payments ───────────────────────────────────────────

const ListQuerySchema = z.object({
  page:          z.coerce.number().int().min(1).default(1),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
  status:        z.string().optional(),
  applicationId: z.coerce.number().int().positive().optional(),
});

router.get("/admin/ballet/payments", requireAdminAuth, requireAdminPermission("ballet.payments", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit, status, applicationId } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) {
    if (!isValidPaymentStatus(status)) {
      res.status(400).json({ error: `Invalid status: ${status}` });
      return;
    }
    conditions.push(eq(balletPaymentsTable.status, status));
  }
  if (applicationId != null) {
    conditions.push(eq(balletPaymentsTable.applicationId, applicationId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(balletPaymentsTable)
      .where(where)
      .orderBy(desc(balletPaymentsTable.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ total: count(balletPaymentsTable.id) })
      .from(balletPaymentsTable)
      .where(where),
  ]);

  res.json({
    data: rows,
    total: Number(total),
    page,
    limit,
    totalPages: Math.ceil(Number(total) / limit),
  });
});

// ─── POST /api/admin/ballet/payments ──────────────────────────────────────────

const CreatePaymentBody = z.object({
  applicationId:     z.number({ required_error: "applicationId is required" }).int().positive(),
  amountEgp:         z.number({ required_error: "amountEgp is required" }).int().positive(),
  packageId:         z.number().int().positive().optional(),
  packageOrderId:    z.number().int().positive().optional(),
  levelAssignmentId: z.number().int().positive().optional(),
  notes:             z.string().optional(),
});

router.post("/admin/ballet/payments", requireAdminAuth, requireAdminPermission("ballet.payments", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const { applicationId, amountEgp, packageId, packageOrderId, levelAssignmentId, notes } = parsed.data;

  const [app] = await db
    .select({ id: balletApplicationsTable.id, childName: balletApplicationsTable.childName })
    .from(balletApplicationsTable)
    .where(eq(balletApplicationsTable.id, applicationId))
    .limit(1);

  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  if (packageOrderId != null) {
    const [packageOrder] = await db
      .select({ id: packageOrdersTable.id })
      .from(packageOrdersTable)
      .where(eq(packageOrdersTable.id, packageOrderId))
      .limit(1);
    if (!packageOrder) { res.status(404).json({ error: "Package order not found" }); return; }
  }

  try {
    const [payment] = await db
      .insert(balletPaymentsTable)
      .values({
        applicationId,
        amountEgp,
        packageId: packageId ?? null,
        packageOrderId: packageOrderId ?? null,
        levelAssignmentId: levelAssignmentId ?? null,
        notes: notes ?? null,
      })
      .returning();

    await logActivity(req, {
      action: "create",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: payment.id,
      entityLabel: app.childName,
      after: Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment[key]])),
      summary: `Created ballet payment of ${amountEgp} EGP for ${app.childName}`,
    });

    res.status(201).json({ payment });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/payments failed");
    res.status(500).json({ error: "Failed to create payment" });
  }
});

// ─── PATCH /api/admin/ballet/payments/:id/status ──────────────────────────────

const UpdatePaymentStatusBody = z.object({
  status: z.string().min(1),
  note:   z.string().optional(),
});

router.patch(
  "/admin/ballet/payments/:id/status",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid payment ID" }); return; }

    const parsed = UpdatePaymentStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { status, note } = parsed.data;
    if (!isValidPaymentStatus(status)) {
      res.status(400).json({ error: `Invalid status: ${status}. Must be one of: ${BALLET_PAYMENT_STATUSES.join(", ")}` });
      return;
    }

    const [payment] = await db
      .select()
      .from(balletPaymentsTable)
      .where(eq(balletPaymentsTable.id, id))
      .limit(1);

    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

    const [app] = await db
      .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, childName: balletApplicationsTable.childName })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, payment.applicationId))
      .limit(1);

    const fromStatus = payment.status;
    const adminId = req.adminUser?.sub ?? null;
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { status, updatedAt: now };
    if (status === "paid") updates["paidAt"] = now;
    if (status === "refunded") updates["refundedAt"] = now;

    let updatedPayment: typeof payment | undefined;

    await db.transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await tx
        .update(balletPaymentsTable)
        .set(updates as any)
        .where(eq(balletPaymentsTable.id, id))
        .returning();
      updatedPayment = row;

      if (status === "refunded" && payment.levelAssignmentId != null) {
        await tx
          .update(balletLevelAssignmentsTable)
          .set({
            status: "withdrawn",
            notes: `Withdrawn — payment refunded on ${now.slice(0, 10)}`,
            updatedAt: now,
          })
          .where(eq(balletLevelAssignmentsTable.id, payment.levelAssignmentId));

        await tx.insert(balletApplicationEventsTable).values({
          applicationId: payment.applicationId,
          fromStatus:    app?.status ?? null,
          toStatus:      app?.status ?? null,
          changedById:   adminId,
          note:          note ? `Payment refunded — enrollment withdrawn. ${note}` : "Payment refunded — enrollment withdrawn",
        });
      }
    });

    logger.info({ paymentId: id, fromStatus, toStatus: status, adminId }, "Ballet payment status updated");

    if (updatedPayment && fromStatus !== status) {
      const { before, after } = diffFields(
        Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment[key]])),
        Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, updatedPayment![key]])),
        BALLET_PAYMENT_ACTIVITY_FIELDS,
      );
      await logActivity(req, {
        action: status === "refunded" ? "refund" : status === "paid" ? "markPaid" : "statusChange",
        module: "ballet.payments",
        entityType: "ballet_payment",
        entityId: id,
        entityLabel: app?.childName ?? `Application #${payment.applicationId}`,
        before,
        after,
        summary: status === "refunded"
          ? `Refunded ballet payment ${id} for ${app?.childName ?? `application #${payment.applicationId}`} — enrollment withdrawn`
          : `Changed ballet payment ${id} status from ${fromStatus} to ${status}`,
      });
    }

    res.json({ payment: updatedPayment });
  },
);

export default router;
