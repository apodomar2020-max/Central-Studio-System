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
 *   PATCH /api/admin/ballet/payments/:id/status    — confirm a pending payment as paid.
 *
 * Refund workflow:
 *   New refund operations must use ballet_refunds. Directly changing a
 *   payment to "refunded" is rejected so refunds never withdraw enrollments
 *   implicitly. Historical rows with status="refunded" remain readable.
 *
 * POST create-time validation:
 *   (a) levelAssignmentId, if given, must belong to this same application.
 *   (b) packageId must exist and be active; amountEgp is derived from that
 *       package server-side so clients cannot override the package price.
 *   (c) packageOrderId, if given, must exist; its studentId is checked
 *       against the application's parentStudentId ONLY when the application
 *       has a linked parent account (package_orders has no child/application
 *       column, only an account-level studentId) — a manual/walk-in
 *       application (parentStudentId null) skips this specific check, with
 *       an explicit log line so the skip is visible rather than silent.
 *   (d) initial payments are serialized by locking the application row and
 *       rejecting any existing non-renewal pending/paid/refunded payment.
 */

import { Router, type IRouter, type Response } from "express";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletPaymentsTable,
  balletApplicationsTable,
  balletLevelAssignmentsTable,
  balletPackagesTable,
  packageOrdersTable,
  BALLET_PAYMENT_STATUSES,
  BALLET_PAYMENT_METHODS,
} from "@workspace/db";
import type { BalletPaymentStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { adminActivityActor, diffFields, logActivity, logActivityWithActor } from "../lib/activityLog";
import {
  addCalendarDays,
  defaultSubscriptionExpiresAt,
  findPaymentForApplication,
  normalizeExtensionHistory,
  serializePaymentCycle,
  todayDateOnly,
  validateSubscriptionDates,
} from "../lib/balletSubscriptions";
import { isSupportedManualBalletPaymentMethod } from "../lib/financialAggregates";

const router: IRouter = Router();
const BALLET_PAYMENT_ACTIVITY_FIELDS = ["applicationId", "levelAssignmentId", "packageId", "packageOrderId", "amountEgp", "status", "paymentMethod", "billingMonth", "subscriptionStartDate", "subscriptionExpiresAt", "originalExpiresAt", "isRenewal", "renewedFromId", "extensionHistory", "paidAt", "refundedAt", "notes"] as const;
const INITIAL_PAYMENT_APPLICATION_STATUSES = ["accepted", "assignedToLevel"] as const;
const BLOCKING_INITIAL_PAYMENT_STATUSES = ["pending", "paid", "refunded"] as const;

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
      .select({
        id: balletPaymentsTable.id,
        applicationId: balletPaymentsTable.applicationId,
        levelAssignmentId: balletPaymentsTable.levelAssignmentId,
        packageId: balletPaymentsTable.packageId,
        packageName: balletPackagesTable.name,
        packageOrderId: balletPaymentsTable.packageOrderId,
        amountEgp: balletPaymentsTable.amountEgp,
        status: balletPaymentsTable.status,
        paymentMethod: balletPaymentsTable.paymentMethod,
        billingMonth: balletPaymentsTable.billingMonth,
        subscriptionStartDate: balletPaymentsTable.subscriptionStartDate,
        subscriptionExpiresAt: balletPaymentsTable.subscriptionExpiresAt,
        originalExpiresAt: balletPaymentsTable.originalExpiresAt,
        isRenewal: balletPaymentsTable.isRenewal,
        renewedFromId: balletPaymentsTable.renewedFromId,
        extensionHistory: balletPaymentsTable.extensionHistory,
        paidAt: balletPaymentsTable.paidAt,
        refundedAt: balletPaymentsTable.refundedAt,
        notes: balletPaymentsTable.notes,
        createdAt: balletPaymentsTable.createdAt,
        updatedAt: balletPaymentsTable.updatedAt,
        childName: balletApplicationsTable.childName,
        parentName: balletApplicationsTable.parentName,
      })
      .from(balletPaymentsTable)
      .leftJoin(balletPackagesTable, eq(balletPackagesTable.id, balletPaymentsTable.packageId))
      .leftJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletPaymentsTable.applicationId))
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
    data: rows.map((row) => serializePaymentCycle(row)),
    total: Number(total),
    page,
    limit,
    totalPages: Math.ceil(Number(total) / limit),
  });
});

// ─── POST /api/admin/ballet/payments ──────────────────────────────────────────

const CreatePaymentBody = z.object({
  applicationId:     z.number({ required_error: "applicationId is required" }).int().positive(),
  amountEgp:         z.number().int().positive().optional(),
  packageId:         z.number({ required_error: "packageId is required" }).int().positive(),
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

  const { applicationId, packageId, packageOrderId, levelAssignmentId, paymentMethod, status, billingMonth, notes } = parsed.data;
  const requestedStatus = status ?? "pending";
  if (requestedStatus !== "pending") {
    res.status(422).json({
      error: "New Ballet payment cycles must be created as pending. Confirm payment after the customer pays.",
      code: "BALLET_PAYMENT_MUST_START_PENDING",
    });
    return;
  }

  try {
    const { app, payment } = await db.transaction(async (tx) => {
      const [lockedApp] = await tx
        .select({
          id: balletApplicationsTable.id,
          status: balletApplicationsTable.status,
          childName: balletApplicationsTable.childName,
          parentStudentId: balletApplicationsTable.parentStudentId,
          preferredPaymentMethod: balletApplicationsTable.preferredPaymentMethod,
        })
        .from(balletApplicationsTable)
        .where(eq(balletApplicationsTable.id, applicationId))
        .limit(1)
        .for("update");

      if (!lockedApp) throw Object.assign(new Error("Application not found"), { status: 404 });
      if (!INITIAL_PAYMENT_APPLICATION_STATUSES.includes(lockedApp.status as typeof INITIAL_PAYMENT_APPLICATION_STATUSES[number])) {
        throw Object.assign(new Error("Initial Ballet payment can only be created for accepted or assigned applications."), {
          status: 422,
          code: "BALLET_INITIAL_PAYMENT_APPLICATION_STATUS_INVALID",
        });
      }

      const effectivePaymentMethod = paymentMethod ?? lockedApp.preferredPaymentMethod ?? null;
      if (!isSupportedManualBalletPaymentMethod(effectivePaymentMethod)) {
        throw Object.assign(
          new Error("Manual Ballet payment creation currently supports Pay at Studio only. Online payment must be created by the future verified Kashier gateway flow; Bank Transfer is legacy display-only."),
          { status: 422, code: "BALLET_PAYMENT_METHOD_NOT_SUPPORTED" },
        );
      }

      const [existingInitial] = await tx
        .select({ id: balletPaymentsTable.id, status: balletPaymentsTable.status })
        .from(balletPaymentsTable)
        .where(and(
          eq(balletPaymentsTable.applicationId, applicationId),
          eq(balletPaymentsTable.isRenewal, false),
          inArray(balletPaymentsTable.status, [...BLOCKING_INITIAL_PAYMENT_STATUSES]),
        ))
        .orderBy(desc(balletPaymentsTable.id))
        .limit(1)
        .for("update");
      if (existingInitial) {
        throw Object.assign(new Error(`Initial Ballet payment already exists for this application in status "${existingInitial.status}".`), {
          status: 409,
          code: "BALLET_INITIAL_PAYMENT_EXISTS",
        });
      }

      if (levelAssignmentId != null) {
        const [assignment] = await tx
          .select({ id: balletLevelAssignmentsTable.id, applicationId: balletLevelAssignmentsTable.applicationId })
          .from(balletLevelAssignmentsTable)
          .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
          .limit(1);
        if (!assignment) throw Object.assign(new Error("Level assignment not found"), { status: 404 });
        if (assignment.applicationId !== applicationId) {
          throw Object.assign(new Error("levelAssignmentId does not belong to this application."), { status: 422 });
        }
      }

      const [pkg] = await tx
        .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive, priceEgp: balletPackagesTable.priceEgp })
        .from(balletPackagesTable)
        .where(eq(balletPackagesTable.id, packageId))
        .limit(1);
      if (!pkg) throw Object.assign(new Error("Package not found"), { status: 404 });
      if (!pkg.isActive) throw Object.assign(new Error("Package is inactive and cannot be used for a payment."), { status: 422 });

      if (packageOrderId != null) {
        const [packageOrder] = await tx
          .select({ id: packageOrdersTable.id, studentId: packageOrdersTable.studentId })
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, packageOrderId))
          .limit(1);
        if (!packageOrder) throw Object.assign(new Error("Package order not found"), { status: 404 });

        if (lockedApp.parentStudentId != null) {
          if (packageOrder.studentId !== lockedApp.parentStudentId) {
            throw Object.assign(new Error("This package order does not belong to the same account as this application's parent."), { status: 422 });
          }
        } else {
          logger.info(
            { applicationId, packageOrderId },
            "Skipped packageOrderId ownership check — application has no linked parent account (manual/walk-in submission), and package_orders has no child-level identity to check against",
          );
        }
      }

      const [created] = await tx
        .insert(balletPaymentsTable)
        .values({
          applicationId,
          amountEgp: pkg.priceEgp,
          packageId: pkg.id,
          packageOrderId: packageOrderId ?? null,
          levelAssignmentId: levelAssignmentId ?? null,
          status: "pending",
          paymentMethod: effectivePaymentMethod,
          billingMonth: billingMonth ?? null,
          subscriptionStartDate: null,
          subscriptionExpiresAt: null,
          originalExpiresAt: null,
          isRenewal: false,
          renewedFromId: null,
          paidAt: null,
          refundedAt: null,
          notes: notes ?? null,
        })
        .returning();

      return { app: lockedApp, payment: created };
    });

    await logActivity(req, {
      action: "create",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: payment.id,
      entityLabel: app.childName,
      after: Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment[key]])),
      summary: `Created pending initial ballet payment of ${payment.amountEgp} EGP for ${app.childName}`,
    });

    res.status(201).json({ payment });
  } catch (err) {
    const typed = err as { status?: number; code?: string; message?: string };
    if (typed.status === 404) { res.status(404).json({ error: typed.message ?? "Not found" }); return; }
    if (typed.status === 409) { res.status(409).json({ error: typed.message, code: typed.code }); return; }
    if (typed.status === 422) { res.status(422).json({ error: typed.message, code: typed.code }); return; }
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

  const { status, startDate, expiresAt } = parsed.data;
  if (!isValidPaymentStatus(status)) {
    res.status(400).json({ error: `Invalid status: ${status}. Must be one of: ${BALLET_PAYMENT_STATUSES.join(", ")}` });
    return;
  }
  if (status === "refunded") {
    res.status(422).json({
      error: "Use the Ballet refund workflow. Payment status is historical receipt state and no longer drives enrollment withdrawal.",
      code: "USE_BALLET_REFUND_WORKFLOW",
    });
    return;
  }
  if (status !== "paid") {
    res.status(422).json({
      error: "The only supported Ballet payment status action is confirming a pending payment as paid.",
      code: "BALLET_PAYMENT_STATUS_ACTION_NOT_SUPPORTED",
    });
    return;
  }

  const adminId = req.adminUser?.sub ?? null;
  const now = new Date().toISOString();
  let payment: typeof balletPaymentsTable.$inferSelect | undefined;
  let updatedPayment: typeof balletPaymentsTable.$inferSelect | undefined;
  let app: { id: number; status: string; childName: string } | undefined;

  try {
    await db.transaction(async (tx) => {
      const [lockedPayment] = await tx
        .select()
        .from(balletPaymentsTable)
        .where(eq(balletPaymentsTable.id, id))
        .limit(1)
        .for("update");

      if (!lockedPayment) throw Object.assign(new Error("Payment not found"), { status: 404 });
      if (expectedApplicationId != null && lockedPayment.applicationId !== expectedApplicationId) {
        throw Object.assign(new Error("Payment does not belong to this ballet application."), { status: 422, code: "BALLET_PAYMENT_APPLICATION_MISMATCH" });
      }
      if (lockedPayment.status !== "pending") {
        throw Object.assign(new Error("Only pending Ballet payments can be confirmed as paid."), { status: 422, code: "BALLET_PAYMENT_NOT_PENDING" });
      }

      const [application] = await tx
        .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, childName: balletApplicationsTable.childName })
        .from(balletApplicationsTable)
        .where(eq(balletApplicationsTable.id, lockedPayment.applicationId))
        .limit(1);

      payment = lockedPayment;
      app = application;

      const subscriptionStartDate = startDate ?? lockedPayment.subscriptionStartDate ?? todayDateOnly();
      const subscriptionExpiresAt = expiresAt ?? lockedPayment.subscriptionExpiresAt ?? defaultSubscriptionExpiresAt(subscriptionStartDate);
      const dateError = validateSubscriptionDates(subscriptionStartDate, subscriptionExpiresAt);
      if (dateError) throw Object.assign(new Error(dateError), { status: 400 });

      const [row] = await tx
        .update(balletPaymentsTable)
        .set({
          status: "paid",
          updatedAt: now,
          paidAt: now,
          subscriptionStartDate,
          subscriptionExpiresAt,
          originalExpiresAt: lockedPayment.originalExpiresAt ?? subscriptionExpiresAt,
        })
        .where(eq(balletPaymentsTable.id, id))
        .returning();
      updatedPayment = row;
    });
  } catch (err: unknown) {
    const typed = err as { status?: number; code?: string; message?: string };
    if (typed.status === 404) { res.status(404).json({ error: typed.message ?? "Payment not found" }); return; }
    if (typed.status === 400) { res.status(400).json({ error: typed.message ?? "Invalid payment dates" }); return; }
    if (typed.status === 422) { res.status(422).json({ error: typed.message, code: typed.code }); return; }
    throw err;
  }

  logger.info({ paymentId: id, fromStatus: payment?.status, toStatus: status, adminId }, "Ballet payment status updated");

  if (payment && updatedPayment && payment.status !== status) {
    const { before, after } = diffFields(
      Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment[key]])),
      Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, updatedPayment![key]])),
      BALLET_PAYMENT_ACTIVITY_FIELDS,
    );
    await logActivity(req, {
      action: status === "paid" ? "markPaid" : "statusChange",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: id,
      entityLabel: app?.childName ?? `Application #${payment.applicationId}`,
      before,
      after,
      summary: `Changed ballet payment ${id} status from ${payment.status} to ${status}`,
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

// ─── PATCH /api/admin/ballet/applications/:applicationId/subscription/expiry ──

const EXPIRY_ADJUSTMENT_REASONS = ["studioHoliday", "classSuspension", "medicalAccommodation", "administrativeCorrection", "other"] as const;

const AdjustSubscriptionExpiryBody = z.object({
  adjustmentMethod: z.enum(["addDays", "setDate"]),
  additionalDays: z.number().int().positive().optional(),
  newExpiresAt: z.string().optional(),
  reason: z.enum(EXPIRY_ADJUSTMENT_REASONS),
  otherReason: z.string().trim().min(3).max(300).optional(),
  note: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.adjustmentMethod === "addDays" && value.additionalDays == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["additionalDays"], message: "additionalDays is required." });
  }
  if (value.adjustmentMethod === "setDate" && !value.newExpiresAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newExpiresAt"], message: "newExpiresAt is required." });
  }
  if (value.reason === "other" && !value.otherReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherReason"], message: "A written reason is required when reason is Other." });
  }
});

function formatExpiryAdjustmentReason(reason: typeof EXPIRY_ADJUSTMENT_REASONS[number], otherReason?: string): string {
  if (reason === "other") return otherReason?.trim() ?? "Other";
  return {
    studioHoliday: "Studio holiday",
    classSuspension: "Class suspension",
    medicalAccommodation: "Medical accommodation",
    administrativeCorrection: "Administrative correction",
  }[reason];
}

router.patch(
  "/admin/ballet/applications/:applicationId/subscription/expiry",
  requireAdminAuth,
  requireAdminPermission("ballet.payments", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const applicationId = parseInt(String(req.params["applicationId"] ?? ""), 10);
    if (isNaN(applicationId)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parsed = AdjustSubscriptionExpiryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { adjustmentMethod, additionalDays, reason, otherReason } = parsed.data;
    const note = parsed.data.note?.trim() || null;
    const now = new Date().toISOString();
    const today = todayDateOnly();
    const adminId = req.adminUser?.sub ?? null;

    let app: { id: number; childName: string; status: string } | undefined;
    let paymentBefore: typeof balletPaymentsTable.$inferSelect | undefined;
    let paymentAfter: typeof balletPaymentsTable.$inferSelect | undefined;
    let historyEntry: Record<string, unknown> | undefined;

    try {
      await db.transaction(async (tx) => {
        const [application] = await tx
          .select({ id: balletApplicationsTable.id, childName: balletApplicationsTable.childName, status: balletApplicationsTable.status })
          .from(balletApplicationsTable)
          .where(eq(balletApplicationsTable.id, applicationId))
          .limit(1);
        if (!application) throw Object.assign(new Error("Application not found"), { status: 404 });
        app = application;

        const [lockedPayment] = await tx
          .select()
          .from(balletPaymentsTable)
          .where(and(
            eq(balletPaymentsTable.applicationId, applicationId),
            eq(balletPaymentsTable.status, "paid"),
            isNotNull(balletPaymentsTable.subscriptionStartDate),
            isNotNull(balletPaymentsTable.subscriptionExpiresAt),
            lte(balletPaymentsTable.subscriptionStartDate, today),
            gte(balletPaymentsTable.subscriptionExpiresAt, today),
          ))
          .orderBy(asc(balletPaymentsTable.subscriptionStartDate), desc(balletPaymentsTable.id))
          .limit(1)
          .for("update");

        if (!lockedPayment) {
          throw Object.assign(
            new Error("No active paid subscription cycle is adjustable. Expired cycles require a new pending renewal instead of expiry adjustment."),
            { status: 422, code: "BALLET_NO_ADJUSTABLE_SUBSCRIPTION" },
          );
        }

        const previousExpiresAt = lockedPayment.subscriptionExpiresAt;
        if (!previousExpiresAt) {
          throw Object.assign(new Error("The current subscription has no expiry date to adjust."), { status: 422, code: "BALLET_SUBSCRIPTION_EXPIRY_MISSING" });
        }

        const newExpiresAt = adjustmentMethod === "addDays"
          ? addCalendarDays(previousExpiresAt, additionalDays!)
          : parsed.data.newExpiresAt!;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiresAt)) {
          throw Object.assign(new Error("newExpiresAt must be a valid YYYY-MM-DD date."), { status: 400 });
        }
        if (newExpiresAt <= previousExpiresAt) {
          throw Object.assign(new Error("New expiry must be later than the current expiry."), { status: 422, code: "BALLET_EXPIRY_NOT_EXTENDED" });
        }

        const daysAdded = Math.round((Date.parse(`${newExpiresAt}T00:00:00.000Z`) - Date.parse(`${previousExpiresAt}T00:00:00.000Z`)) / 86_400_000);
        if (!Number.isFinite(daysAdded) || daysAdded <= 0) {
          throw Object.assign(new Error("New expiry must be later than the current expiry."), { status: 422, code: "BALLET_EXPIRY_NOT_EXTENDED" });
        }

        const history = normalizeExtensionHistory(lockedPayment.extensionHistory);
        historyEntry = {
          previousExpiresAt,
          newExpiresAt,
          daysAdded,
          adjustmentMethod,
          additionalDays: adjustmentMethod === "addDays" ? additionalDays! : null,
          reason: formatExpiryAdjustmentReason(reason, otherReason),
          reasonKey: reason,
          note,
          actorId: adminId,
          extendedAt: now,
        };

        paymentBefore = lockedPayment;
        const [updated] = await tx
          .update(balletPaymentsTable)
          .set({
            subscriptionExpiresAt: newExpiresAt,
            originalExpiresAt: lockedPayment.originalExpiresAt ?? previousExpiresAt,
            extensionHistory: [...history, historyEntry as any],
            updatedAt: now,
          })
          .where(eq(balletPaymentsTable.id, lockedPayment.id))
          .returning();
        paymentAfter = updated;

        const { before, after } = diffFields(
          Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, lockedPayment[key]])),
          Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, updated[key]])),
          BALLET_PAYMENT_ACTIVITY_FIELDS,
        );
        await logActivityWithActor(tx, adminActivityActor(req), {
          action: "adjustExpiry",
          module: "ballet.payments",
          entityType: "ballet_payment",
          entityId: updated.id,
          entityLabel: application.childName,
          before,
          after: { ...after, adjustment: historyEntry },
          summary: `Adjusted ballet subscription expiry for ${application.childName} from ${previousExpiresAt} to ${newExpiresAt}`,
        });
      });
    } catch (err: unknown) {
      const typed = err as { status?: number; code?: string; message?: string };
      if (typed.status === 404) { res.status(404).json({ error: typed.message ?? "Application not found" }); return; }
      if (typed.status === 400) { res.status(400).json({ error: typed.message ?? "Invalid expiry adjustment" }); return; }
      if (typed.status === 422) { res.status(422).json({ error: typed.message, code: typed.code }); return; }
      logger.error({ err, applicationId }, "PATCH /admin/ballet/applications/:applicationId/subscription/expiry failed");
      res.status(500).json({ error: "Failed to adjust subscription expiry" });
      return;
    }

    res.json({
      payment: paymentAfter ? serializePaymentCycle(paymentAfter) : null,
      previousExpiresAt: paymentBefore?.subscriptionExpiresAt ?? null,
      newExpiresAt: paymentAfter?.subscriptionExpiresAt ?? null,
      adjustment: historyEntry,
    });
  },
);

// ─── POST /api/admin/ballet/applications/:applicationId/subscriptions/renew ──

const RenewSubscriptionBody = z.object({
  renewedFromId:  z.number({ required_error: "renewedFromId is required" }).int().positive(),
  packageId:      z.number({ required_error: "packageId is required" }).int().positive(),
  paymentMethod:  z.enum(BALLET_PAYMENT_METHODS).optional(),
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

    const { renewedFromId, packageId, paymentMethod, billingMonth, note } = parsed.data;

    const [app] = await db
      .select({ id: balletApplicationsTable.id, childName: balletApplicationsTable.childName })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, applicationId))
      .limit(1);
    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    const previous = await findPaymentForApplication(renewedFromId, applicationId);
    if (!previous) { res.status(404).json({ error: "Previous subscription/payment cycle not found for this application." }); return; }

    const effectivePaymentMethod = paymentMethod ?? "inPerson";
    if (!isSupportedManualBalletPaymentMethod(effectivePaymentMethod)) {
      res.status(422).json({
        error: "Manual Ballet subscription renewal currently supports Pay at Studio only. Online payment must be created by the future verified Kashier gateway flow; Bank Transfer is legacy display-only.",
        code: "BALLET_PAYMENT_METHOD_NOT_SUPPORTED",
      });
      return;
    }

    const [pkg] = await db
      .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive, priceEgp: balletPackagesTable.priceEgp })
      .from(balletPackagesTable)
      .where(eq(balletPackagesTable.id, packageId))
      .limit(1);
    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }
    if (!pkg.isActive) { res.status(422).json({ error: "Package is inactive and cannot be used for a renewal." }); return; }

    let payment: typeof balletPaymentsTable.$inferSelect | undefined;
    try {
      await db.transaction(async (tx) => {
        const [existingRenewal] = await tx
          .select({ id: balletPaymentsTable.id })
          .from(balletPaymentsTable)
          .where(and(
            eq(balletPaymentsTable.applicationId, applicationId),
            eq(balletPaymentsTable.renewedFromId, renewedFromId),
            eq(balletPaymentsTable.isRenewal, true),
            eq(balletPaymentsTable.status, "pending"),
          ))
          .limit(1)
          .for("update");
        if (existingRenewal) {
          throw Object.assign(new Error("A pending renewal already exists for this payment cycle."), { status: 409, code: "BALLET_PENDING_RENEWAL_EXISTS" });
        }

        const [inserted] = await tx
          .insert(balletPaymentsTable)
          .values({
            applicationId,
            amountEgp: pkg.priceEgp,
            packageId,
            packageOrderId: null,
            levelAssignmentId: previous.levelAssignmentId ?? null,
            paymentMethod: effectivePaymentMethod,
            status: "pending",
            billingMonth: billingMonth ?? null,
            subscriptionStartDate: null,
            subscriptionExpiresAt: null,
            originalExpiresAt: null,
            isRenewal: true,
            renewedFromId,
            paidAt: null,
            refundedAt: null,
            notes: note ?? null,
          })
          .returning();
        payment = inserted;
      });
    } catch (err: unknown) {
      const typed = err as { status?: number; code?: string; message?: string };
      if (typed.status === 409 || typed.code === "23505") {
        res.status(409).json({
          error: "A pending renewal already exists for this payment cycle.",
          code: "BALLET_PENDING_RENEWAL_EXISTS",
        });
        return;
      }
      logger.error({ err, applicationId, renewedFromId }, "POST /admin/ballet/applications/:applicationId/subscriptions/renew failed");
      res.status(500).json({ error: "Failed to create renewal" });
      return;
    }

    await logActivity(req, {
      action: "renew",
      module: "ballet.payments",
      entityType: "ballet_payment",
      entityId: payment!.id,
      entityLabel: app.childName,
      after: Object.fromEntries(BALLET_PAYMENT_ACTIVITY_FIELDS.map((key) => [key, payment![key]])),
      summary: `Created pending ballet renewal for ${app.childName} from payment #${renewedFromId}`,
    });

    res.status(201).json({ payment });
  },
);

export default router;
