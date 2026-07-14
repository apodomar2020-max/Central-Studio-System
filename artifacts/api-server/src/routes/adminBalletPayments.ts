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
 *
 * POST create-time validation (Phase A / P0-7 — deliberately narrow scope,
 * two related checks are explicitly withheld pending separate business
 * decisions: no unique-paid-payment constraint, no amount-vs-package-price
 * validation):
 *   (a) levelAssignmentId, if given, must belong to this same application.
 *   (b) packageId, if given, must exist and be active.
 *   (c) packageOrderId, if given, must exist; its studentId is checked
 *       against the application's parentStudentId ONLY when the application
 *       has a linked parent account (package_orders has no child/application
 *       column, only an account-level studentId) — a manual/walk-in
 *       application (parentStudentId null) skips this specific check, with
 *       an explicit log line so the skip is visible rather than silent.
 */

import { Router, type IRouter, type Response } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletPaymentsTable,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletLevelAssignmentsTable,
  balletPackagesTable,
  packageOrdersTable,
  BALLET_PAYMENT_STATUSES,
  BALLET_PAYMENT_METHODS,
} from "@workspace/db";
import type { BalletPaymentStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  addCalendarDays,
  defaultSubscriptionExpiresAt,
  findPaymentForApplication,
  getCurrentSubscriptionForApplication,
  isDateOnly,
  normalizeExtensionHistory,
  todayDateOnly,
  validateSubscriptionDates,
} from "../lib/balletSubscriptions";

const router: IRouter = Router();
const BALLET_PAYMENT_ACTIVITY_FIELDS = ["applicationId", "levelAssignmentId", "packageId", "packageOrderId", "amountEgp", "status", "paymentMethod", "billingMonth", "subscriptionStartDate", "subscriptionExpiresAt", "originalExpiresAt", "isRenewal", "renewedFromId", "extensionHistory", "paidAt", "refundedAt", "notes"] as const;

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
  paymentMethod:     z.enum(BALLET_PAYMENT_METHODS).optional(),
  status:            z.enum(BALLET_PAYMENT_STATUSES).optional(),
  // C2: calendar month this payment covers, "YYYY-MM". Optional at the API
  // level (historical/non-monthly payments omit it), but it is the required
  // input for a payment meant to represent a monthly entitlement — the C4
  // hours calculation scopes strictly to status='paid' AND billingMonth=M.
  billingMonth:      z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "billingMonth must be in YYYY-MM format").optional(),
  startDate:         z.string().optional(),
  expiresAt:         z.string().optional(),
  notes:             z.string().optional(),
});

router.post("/admin/ballet/payments", requireAdminAuth, requireAdminPermission("ballet.payments", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const { applicationId, amountEgp, packageId, packageOrderId, levelAssignmentId, paymentMethod, status, billingMonth, startDate, expiresAt, notes } = parsed.data;

  const [app] = await db
    .select({
      id: balletApplicationsTable.id,
      childName: balletApplicationsTable.childName,
      parentStudentId: balletApplicationsTable.parentStudentId,
      preferredPaymentMethod: balletApplicationsTable.preferredPaymentMethod,
    })
    .from(balletApplicationsTable)
    .where(eq(balletApplicationsTable.id, applicationId))
    .limit(1);

  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  // (a) A given levelAssignmentId must belong to THIS application — never
  // let a payment be recorded against another application's assignment row.
  if (levelAssignmentId != null) {
    const [assignment] = await db
      .select({ id: balletLevelAssignmentsTable.id, applicationId: balletLevelAssignmentsTable.applicationId })
      .from(balletLevelAssignmentsTable)
      .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
      .limit(1);
    if (!assignment) { res.status(404).json({ error: "Level assignment not found" }); return; }
    if (assignment.applicationId !== applicationId) {
      res.status(422).json({ error: "levelAssignmentId does not belong to this application." });
      return;
    }
  }

  // (b) A given packageId must exist and be active.
  if (packageId != null) {
    const [pkg] = await db
      .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive })
      .from(balletPackagesTable)
      .where(eq(balletPackagesTable.id, packageId))
      .limit(1);
    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
    if (!pkg.isActive) { res.status(422).json({ error: "Package is inactive and cannot be used for a payment." }); return; }
  }

  // (c) A given packageOrderId must exist. Ownership (package_orders.studentId
  // === this application's parentStudentId) is only checked when the
  // application actually has a linked parent account — package_orders has no
  // childId/applicationId column at all (only an account-level studentId), so
  // for a manual/walk-in application (parentStudentId null) there is no
  // reliable identity to check ownership against. That case is intentionally
  // skipped rather than silently passing — logged so it's visible, not silent.
  if (packageOrderId != null) {
    const [packageOrder] = await db
      .select({ id: packageOrdersTable.id, studentId: packageOrdersTable.studentId })
      .from(packageOrdersTable)
      .where(eq(packageOrdersTable.id, packageOrderId))
      .limit(1);
    if (!packageOrder) { res.status(404).json({ error: "Package order not found" }); return; }

    if (app.parentStudentId != null) {
      if (packageOrder.studentId !== app.parentStudentId) {
        res.status(422).json({ error: "This package order does not belong to the same account as this application's parent." });
        return;
      }
    } else {
      logger.info(
        { applicationId, packageOrderId },
        "Skipped packageOrderId ownership check — application has no linked parent account (manual/walk-in submission), and package_orders has no child-level identity to check against",
      );
    }
  }

  try {
    const createdStatus = status ?? "pending";
    const now = new Date().toISOString();
    const subscriptionStartDate = createdStatus === "paid" ? (startDate ?? todayDateOnly()) : null;
    const subscriptionExpiresAt = createdStatus === "paid"
      ? (expiresAt ?? defaultSubscriptionExpiresAt(subscriptionStartDate!))
      : null;
    if (subscriptionStartDate && subscriptionExpiresAt) {
      const dateError = validateSubscriptionDates(subscriptionStartDate, subscriptionExpiresAt);
      if (dateError) { res.status(400).json({ error: dateError }); return; }
    }
    const [payment] = await db
      .insert(balletPaymentsTable)
      .values({
        applicationId,
        amountEgp,
        packageId: packageId ?? null,
        packageOrderId: packageOrderId ?? null,
        levelAssignmentId: levelAssignmentId ?? null,
        status: createdStatus,
        // C1: prefill the method from the application's intake preference when
        // the admin didn't explicitly choose one. Explicit body value always wins.
        paymentMethod: paymentMethod ?? app.preferredPaymentMethod ?? null,
        billingMonth: billingMonth ?? null,
        subscriptionStartDate,
        subscriptionExpiresAt,
        originalExpiresAt: subscriptionExpiresAt,
        paidAt: createdStatus === "paid" ? now : null,
        refundedAt: createdStatus === "refunded" ? now : null,
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
  status:    z.string().min(1),
  startDate: z.string().optional(),
  expiresAt: z.string().optional(),
  note:      z.string().optional(),
});

async function updatePaymentStatus(
  req: AdminRequest,
  res: Response,
  id: number,
  expectedApplicationId?: number,
): Promise<void> {
  const parsed = UpdatePaymentStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const { status, startDate, expiresAt, note } = parsed.data;
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
  if (expectedApplicationId != null && payment.applicationId !== expectedApplicationId) {
    res.status(422).json({ error: "Payment does not belong to this ballet application." });
    return;
  }

  const [app] = await db
    .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, childName: balletApplicationsTable.childName })
    .from(balletApplicationsTable)
    .where(eq(balletApplicationsTable.id, payment.applicationId))
    .limit(1);

  const fromStatus = payment.status;
  const adminId = req.adminUser?.sub ?? null;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { status, updatedAt: now };
  if (status === "paid") {
    updates["paidAt"] = now;
    const subscriptionStartDate = startDate ?? payment.subscriptionStartDate ?? todayDateOnly();
    const subscriptionExpiresAt = expiresAt ?? payment.subscriptionExpiresAt ?? defaultSubscriptionExpiresAt(subscriptionStartDate);
    const dateError = validateSubscriptionDates(subscriptionStartDate, subscriptionExpiresAt);
    if (dateError) { res.status(400).json({ error: dateError }); return; }
    updates["subscriptionStartDate"] = subscriptionStartDate;
    updates["subscriptionExpiresAt"] = subscriptionExpiresAt;
    updates["originalExpiresAt"] = payment.originalExpiresAt ?? subscriptionExpiresAt;
  }
  if (status === "refunded") updates["refundedAt"] = now;

  let updatedPayment: typeof payment | undefined;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(balletPaymentsTable)
      .set(updates)
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
}

router.patch(
  "/admin/ballet/payments/:id/status",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid payment ID" }); return; }
    await updatePaymentStatus(req, res, id);
  },
);

router.patch(
  "/admin/ballet/applications/:applicationId/payments/:id/status",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const applicationId = parseInt(String(req.params["applicationId"] ?? ""), 10);
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(applicationId)) { res.status(400).json({ error: "Invalid application ID" }); return; }
    if (isNaN(id)) { res.status(400).json({ error: "Invalid payment ID" }); return; }
    await updatePaymentStatus(req, res, id, applicationId);
  },
);

// ─── POST /api/admin/ballet/applications/:applicationId/subscriptions/renew ──

const RenewSubscriptionBody = z.object({
  renewedFromId:  z.number({ required_error: "renewedFromId is required" }).int().positive(),
  packageId:      z.number({ required_error: "packageId is required" }).int().positive(),
  amountEgp:      z.number({ required_error: "amountEgp is required" }).int().positive(),
  paymentMethod:  z.enum(BALLET_PAYMENT_METHODS),
  status:         z.enum(BALLET_PAYMENT_STATUSES).default("pending"),
  startDate:      z.string(),
  expiresAt:      z.string(),
  billingMonth:   z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "billingMonth must be in YYYY-MM format").optional(),
  note:           z.string().optional(),
});

router.post(
  "/admin/ballet/applications/:applicationId/subscriptions/renew",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const applicationId = parseInt(String(req.params["applicationId"] ?? ""), 10);
    if (isNaN(applicationId)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parsed = RenewSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { renewedFromId, packageId, amountEgp, paymentMethod, status, startDate, expiresAt, billingMonth, note } = parsed.data;
    const dateError = validateSubscriptionDates(startDate, expiresAt);
    if (dateError) { res.status(400).json({ error: dateError }); return; }

    const [app] = await db
      .select({ id: balletApplicationsTable.id, childName: balletApplicationsTable.childName })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, applicationId))
      .limit(1);
    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    const previous = await findPaymentForApplication(renewedFromId, applicationId);
    if (!previous) { res.status(404).json({ error: "Previous subscription/payment cycle not found for this application." }); return; }

    const [pkg] = await db
      .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive })
      .from(balletPackagesTable)
      .where(eq(balletPackagesTable.id, packageId))
      .limit(1);
    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
    if (!pkg.isActive) { res.status(422).json({ error: "Package is inactive and cannot be used for a renewal." }); return; }

    const [existingRenewal] = await db
      .select()
      .from(balletPaymentsTable)
      .where(and(
        eq(balletPaymentsTable.applicationId, applicationId),
        eq(balletPaymentsTable.renewedFromId, renewedFromId),
      ))
      .orderBy(desc(balletPaymentsTable.createdAt))
      .limit(1);
    if (existingRenewal) {
      res.status(200).json({ payment: existingRenewal, duplicatePrevented: true });
      return;
    }

    const now = new Date().toISOString();
    const [payment] = await db
      .insert(balletPaymentsTable)
      .values({
        applicationId,
        amountEgp,
        packageId,
        packageOrderId: null,
        levelAssignmentId: previous.levelAssignmentId ?? null,
        paymentMethod,
        status,
        billingMonth: billingMonth ?? null,
        subscriptionStartDate: status === "paid" ? startDate : null,
        subscriptionExpiresAt: status === "paid" ? expiresAt : null,
        originalExpiresAt: status === "paid" ? expiresAt : null,
        isRenewal: true,
        renewedFromId,
        paidAt: status === "paid" ? now : null,
        refundedAt: status === "refunded" ? now : null,
        notes: note ?? null,
      })
      .returning();

    await logActivity(req, {
      action: "renew",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: payment.id,
      entityLabel: app.childName,
      after: Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment[key]])),
      summary: `Renewed ballet subscription for ${app.childName} from payment #${renewedFromId}`,
    });

    res.status(201).json({ payment });
  },
);

// ─── PATCH /api/admin/ballet/applications/:applicationId/payments/:id/extend ─

const ExtendSubscriptionBody = z.object({
  newExpiresAt:           z.string().optional(),
  additionalDays:         z.number().int().positive().optional(),
  reason:                 z.enum(["studio_holiday", "emergency_closure", "class_suspension", "instructor_unavailability", "other"]),
  note:                   z.string().nullable().optional(),
  confirmExpiredExtension:z.boolean().optional(),
}).refine((value) => Boolean(value.newExpiresAt) !== Boolean(value.additionalDays), {
  message: "Provide either newExpiresAt or additionalDays.",
});

router.patch(
  "/admin/ballet/applications/:applicationId/payments/:id/extend",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const applicationId = parseInt(String(req.params["applicationId"] ?? ""), 10);
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(applicationId)) { res.status(400).json({ error: "Invalid application ID" }); return; }
    if (isNaN(id)) { res.status(400).json({ error: "Invalid payment ID" }); return; }

    const parsed = ExtendSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const payment = await findPaymentForApplication(id, applicationId);
    if (!payment) { res.status(404).json({ error: "Payment not found for this application." }); return; }

    const current = await getCurrentSubscriptionForApplication(applicationId);
    if (!current || current.id !== id) {
      res.status(422).json({ error: "Only the current subscription cycle can be extended." });
      return;
    }
    if (!payment.subscriptionExpiresAt) {
      res.status(422).json({ error: "This payment has no subscription expiration date to extend." });
      return;
    }
    if (payment.subscriptionStatus === "expired" && !parsed.data.confirmExpiredExtension) {
      res.status(409).json({ error: "Extending an expired subscription requires explicit confirmation.", code: "EXPIRED_EXTENSION_CONFIRMATION_REQUIRED" });
      return;
    }

    const previousExpiresAt = payment.subscriptionExpiresAt;
    const newExpiresAt = parsed.data.newExpiresAt ?? addCalendarDays(previousExpiresAt, parsed.data.additionalDays!);
    if (!isDateOnly(newExpiresAt)) { res.status(400).json({ error: "newExpiresAt must be a valid YYYY-MM-DD date." }); return; }
    const daysAdded = diffDaysForExtension(previousExpiresAt, newExpiresAt);
    if (daysAdded <= 0) { res.status(422).json({ error: "New expiration date must be later than the current expiration date." }); return; }

    const history = normalizeExtensionHistory(payment.extensionHistory);
    const extension = {
      previousExpiresAt,
      newExpiresAt,
      daysAdded,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
      actorId: req.adminUser?.sub ?? null,
      extendedAt: new Date().toISOString(),
    };
    const [updated] = await db
      .update(balletPaymentsTable)
      .set({
        subscriptionExpiresAt: newExpiresAt,
        originalExpiresAt: payment.originalExpiresAt ?? previousExpiresAt,
        extensionHistory: [...history, extension],
        updatedAt: extension.extendedAt,
      })
      .where(eq(balletPaymentsTable.id, id))
      .returning();

    await logActivity(req, {
      action: "extend",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: id,
      entityLabel: `Application #${applicationId}`,
      before: { subscriptionExpiresAt: previousExpiresAt },
      after: { subscriptionExpiresAt: newExpiresAt, extension },
      summary: `Extended ballet subscription #${id} from ${previousExpiresAt} to ${newExpiresAt}`,
    });

    res.json({ payment: updated, extension });
  },
);

function diffDaysForExtension(previousExpiresAt: string, newExpiresAt: string): number {
  return Math.round((Date.parse(`${newExpiresAt}T00:00:00.000Z`) - Date.parse(`${previousExpiresAt}T00:00:00.000Z`)) / 86_400_000);
}

export default router;
