import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  packageOrdersTable,
  creditTransactionsTable,
  packageCreditLotsTable,
  pricePackagesTable,
  studentsTable,
  paymentRecordsTable,
  paymentEventsTable,
  pricePackageDanceTypesTable,
  type PaymentRecordRequestedChannel,
  PAYMENT_RECORD_CONFIRMED_METHODS,
  type PaymentRecordConfirmedMethod,
} from "@workspace/db";
import { egpToMinor, minorToEgp } from "../lib/money";
import { canViewFinanceAmounts } from "../lib/financialVisibility";
import { logger } from "../lib/logger";
import { createStudentNotification } from "../lib/notifications";
import { sendPushNotification } from "../lib/pushNotifications";
import { createPromotionRedemptions, validatePackagePromotion } from "../lib/promotionService";
import { confirmCanonicalPaymentRecord, appendActivationCreditsIssuedEventOnce } from "../lib/financeConfirmation";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import { resolvePackageParticipant } from "../lib/participants/resolvePackageParticipant";
import { evaluatePackagePurchaseEligibility } from "../lib/eligibility/packagePurchaseEligibility";
import {
  ListPackageOrdersQueryParams,
  ListPackageOrdersResponse,
  GetPackageOrderParams,
  GetPackageOrderResponse,
  UpdatePackageOrderParams,
  UpdatePackageOrderBody,
  UpdatePackageOrderResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function serializePackageOrderRows(
  rows: Array<typeof packageOrdersTable.$inferSelect>,
  req: AdminRequest,
) {
  const canViewAmounts = canViewFinanceAmounts(req.adminUser);
  if (!canViewAmounts || rows.length === 0) {
    return rows.map((row) => ({
      ...row,
      priceEgp: null,
      participantName: row.participantNameSnapshot,
      ownershipState: row.participantType == null ? "legacy_unassigned" as const : "assigned" as const,
    }));
  }
  const records = await db
    .select({
      packageOrderId: paymentRecordsTable.packageOrderId,
      finalPayableAmountMinor: paymentRecordsTable.finalPayableAmountMinor,
    })
    .from(paymentRecordsTable)
    .where(inArray(paymentRecordsTable.packageOrderId, rows.map((row) => row.id)));
  const amountByOrderId = new Map(
    records.map((record) => [
      record.packageOrderId,
      record.finalPayableAmountMinor == null ? null : minorToEgp(record.finalPayableAmountMinor),
    ]),
  );
  return rows.map((row) => ({
    ...row,
    priceEgp: amountByOrderId.get(row.id) ?? null,
    participantName: row.participantNameSnapshot,
    ownershipState: row.participantType == null ? "legacy_unassigned" as const : "assigned" as const,
  }));
}

function requirePackageOrderAction(req: Request, res: Response, next: NextFunction): void {
  const status = req.body?.status;
  const hasGeneralEdits = Object.keys(req.body ?? {}).some((key) => key !== "status");
  if (req.body?.remainingCredits !== undefined) {
    res.status(400).json({
      error: "Credit balances must be changed through the credit adjustment endpoint.",
    });
    return;
  }
  if (status !== undefined && status !== "active" && status !== "cancelled") {
    res.status(400).json({ error: "Unsupported package order status." });
    return;
  }
  if (status === "active") {
    requireAdminPermission("packageOrders", "approve")(req, res, next);
    return;
  }
  if (status === "cancelled") {
    requireAdminPermission("packageOrders", "cancel")(req, res, () => {
      if (!hasGeneralEdits) {
        next();
        return;
      }
      requireAdminPermission("packageOrders", "approve")(req, res, next);
    });
    return;
  }
  requireAdminPermission("packageOrders", "approve")(req, res, next);
}

// Finance Roles & Permissions integration: status:"active" is the approved
// authoritative payment-confirmation moment for a package order (see the
// Finance Phase 2C comment on the PATCH handler below) — it requires
// finance.paymentsConfirm in addition to the existing packageOrders.approve
// permission already enforced by requirePackageOrderAction.
function requirePackageOrderPaymentConfirmPermission(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.status !== "active") {
    next();
    return;
  }
  requireAdminPermission("finance", "paymentsConfirm")(req, res, next);
}

function requirePackageOrderReadAccess(req: Request, res: Response, next: NextFunction): void {
  if (req.studentJwtVerified) {
    requireVerifiedStudent(req, res, next);
    return;
  }
  requireAdminAuth(req, res, () => {
    requireAdminPermission("packageOrders", "view")(req, res, next);
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const PACKAGE_ORDER_ACTIVITY_FIELDS = ["status", "notes", "activatedAt", "expiresAt", "remainingCredits"] as const;

function packageOrderActivitySnapshot(row: typeof packageOrdersTable.$inferSelect): Record<string, unknown> {
  return {
    status: row.status,
    notes: row.notes,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
    remainingCredits: row.remainingCredits,
  };
}

function packageOrderLabel(row: typeof packageOrdersTable.$inferSelect): string {
  return `${row.studentName} - ${row.packageName}`;
}

// Finance Phase 2C: UpdatePackageOrderBody is a generated (orval) zod
// schema that does not know about this field and, by default zod.object
// behavior, silently strips unknown keys — so confirmedPaymentMethod is
// parsed separately against this small local schema rather than by
// extending the generated contract. Required only for the activation
// (status:"active") transition, validated against the exact DB-enum
// values from the schema (never invented), and never trusted for any
// other field (amount/discount/actor/timestamp all remain server-derived).
const PackageOrderConfirmedPaymentMethod = z.object({
  confirmedPaymentMethod: z.enum(PAYMENT_RECORD_CONFIRMED_METHODS).optional(),
});

const PurchasePackageBody = z.object({
  packageId: z.coerce.number().int().positive(),
  paymentMode: z.enum(["pay_at_studio", "online_payment"]).optional(),
  promoCode: z.string().trim().optional().nullable(),
  participantType: z.enum(["self", "child"]).optional(),
  participantChildId: z.coerce.number().int().positive().optional(),
}).passthrough().superRefine((value, ctx) => {
  if (value.participantType === "self" && value.participantChildId != null) {
    ctx.addIssue({ code: "custom", path: ["participantChildId"], message: "Self purchases cannot include a child ID." });
  }
  if (value.participantType === "child" && value.participantChildId == null) {
    ctx.addIssue({ code: "custom", path: ["participantChildId"], message: "Child purchases require a child ID." });
  }
});

// Membership Engine (Phase 3): studentId/studentEmail are read directly off
// req.query (not through ListPackageOrdersQueryParams) so this stays a
// read-side-only addition without touching the generated api-zod schema.
router.get(
  "/package-orders",
  requireAdminAuth,
  requireAdminPermission("packageOrders", "view"),
  async (req, res): Promise<void> => {
  const query = ListPackageOrdersQueryParams.safeParse(req.query);
  const rawStudentId = req.query.studentId;
  const studentId = typeof rawStudentId === "string" && /^\d+$/.test(rawStudentId) ? Number(rawStudentId) : undefined;
  const studentEmail = typeof req.query.studentEmail === "string" ? req.query.studentEmail : undefined;

  const conditions = [];
  if (query.success && query.data.status) {
    conditions.push(eq(packageOrdersTable.status, query.data.status));
  }
  if (studentId != null && studentEmail) {
    // Both given — match either, so a stale/legacy email still resolves.
    conditions.push(sql`(${packageOrdersTable.studentId} = ${studentId} OR lower(trim(${packageOrdersTable.studentEmail})) = ${normalizeEmail(studentEmail)})`);
  } else if (studentId != null) {
    // studentId alone — same identity strategy as every other membership
    // lookup: resolve the account's normalized email first, then match
    // studentId = ? OR normalized(studentEmail) = ?, so pre-backfill legacy
    // rows (student_id still null) keep showing up via the email side.
    const [resolvedStudent] = await db
      .select({ email: studentsTable.email })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId))
      .limit(1);
    conditions.push(
      resolvedStudent
        ? sql`(${packageOrdersTable.studentId} = ${studentId} OR lower(trim(${packageOrdersTable.studentEmail})) = ${normalizeEmail(resolvedStudent.email)})`
        : eq(packageOrdersTable.studentId, studentId),
    );
  } else if (studentEmail) {
    conditions.push(sql`lower(trim(${packageOrdersTable.studentEmail})) = ${normalizeEmail(studentEmail)}`);
  }

  // ── Pagination (Phase 4B) ──────────────────────────────────────────────
  // page/pageSize are read directly off req.query (same pattern as
  // studentId/studentEmail above) so the generated api-zod schema and every
  // existing consumer stay untouched. Without pagination params the endpoint
  // behaves exactly as before: the FULL list is returned as an array (the
  // admin Attendance check-in flow depends on this). With params, the body
  // is STILL a plain array — only sliced — and pagination metadata travels
  // in response headers (same convention as GET /attendance).
  const rawPage = req.query.page;
  const rawPageSize = req.query.pageSize;
  const page = typeof rawPage === "string" && /^\d+$/.test(rawPage) ? Math.max(1, Number(rawPage)) : undefined;
  const pageSize = typeof rawPageSize === "string" && /^\d+$/.test(rawPageSize)
    ? Math.min(200, Math.max(1, Number(rawPageSize)))
    : undefined;
  const paginated = page != null || pageSize != null;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  if (!paginated) {
    const rows = whereClause
      ? await db.select().from(packageOrdersTable).where(whereClause).orderBy(desc(packageOrdersTable.createdAt))
      : await db.select().from(packageOrdersTable).orderBy(desc(packageOrdersTable.createdAt));
    res.setHeader("X-Total-Count", String(rows.length));
    res.json(ListPackageOrdersResponse.parse(await serializePackageOrderRows(rows, req as AdminRequest)));
    return;
  }

  const effectivePage = page ?? 1;
  const effectivePageSize = pageSize ?? 25;
  const offset = (effectivePage - 1) * effectivePageSize;

  const [countRow] = whereClause
    ? await db.select({ total: sql<number>`count(*)::int` }).from(packageOrdersTable).where(whereClause)
    : await db.select({ total: sql<number>`count(*)::int` }).from(packageOrdersTable);
  const total = Number(countRow?.total ?? 0);

  const rows = whereClause
    ? await db.select().from(packageOrdersTable).where(whereClause).orderBy(desc(packageOrdersTable.createdAt)).limit(effectivePageSize).offset(offset)
    : await db.select().from(packageOrdersTable).orderBy(desc(packageOrdersTable.createdAt)).limit(effectivePageSize).offset(offset);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(effectivePage));
  res.setHeader("X-Page-Size", String(effectivePageSize));
  res.setHeader("X-Total-Pages", String(total === 0 ? 0 : Math.ceil(total / effectivePageSize)));
  res.json(ListPackageOrdersResponse.parse(await serializePackageOrderRows(rows, req as AdminRequest)));
  },
);

router.post(
  "/package-orders",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
  const parsed = PurchasePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "status")) {
    res.status(400).json({ error: "Package order status is assigned by the server." });
    return;
  }
  if (
    Object.prototype.hasOwnProperty.call(req.body ?? {}, "price") ||
    Object.prototype.hasOwnProperty.call(req.body ?? {}, "priceEgp")
  ) {
    res.status(400).json({ error: "Package price is assigned by the server." });
    return;
  }

  const [[student], [packageDefinition]] = await Promise.all([
    db
      .select({
        id: studentsTable.id,
        name: studentsTable.name,
        email: studentsTable.email,
        phone: studentsTable.phone,
        emailVerified: studentsTable.emailVerified,
        accountType: studentsTable.accountType,
      })
      .from(studentsTable)
      .where(eq(studentsTable.id, req.studentId!))
      .limit(1),
    db
      .select()
      .from(pricePackagesTable)
      .where(eq(pricePackagesTable.id, parsed.data.packageId))
      .limit(1),
  ]);

  if (!student) {
    res.status(404).json({ error: "Student account not found." });
    return;
  }
  if (!packageDefinition || !packageDefinition.isActive) {
    res.status(404).json({ error: "Active package not found." });
    return;
  }

  const totalCredits = packageDefinition.sessions ?? 1;
  const legacyPackageName = req.body?.packageName;
  const legacyTotalCredits = req.body?.totalCredits;
  const legacyRemainingCredits = req.body?.remainingCredits;
  if (legacyPackageName !== undefined && legacyPackageName !== packageDefinition.name) {
    res.status(400).json({ error: "Package name does not match the selected package." });
    return;
  }
  if (legacyTotalCredits !== undefined && legacyTotalCredits !== totalCredits) {
    res.status(400).json({ error: "Package credit total does not match the selected package." });
    return;
  }
  if (legacyRemainingCredits !== undefined && legacyRemainingCredits !== totalCredits) {
    res.status(400).json({ error: "Remaining credits are assigned by the server." });
    return;
  }

  // Finance Phase 2B-1 correction: createStudentNotification's push dispatch
  // (pushNotifications.ts's sendPushNotification) runs on the shared `db`
  // pool — a separate connection from this route's `tx` — and is normally
  // scheduled via a detached setTimeout(0) the instant the notification row
  // is inserted. That connection can see the new package_order/payment rows
  // only once this transaction commits; scheduling the push before COMMIT
  // races the commit regardless of where in the transaction body the call
  // sits. dispatchPush: false keeps the notification row itself atomic with
  // the rest of this transaction (Pattern B) while `pendingPush` captures
  // exactly what createStudentNotification would have scheduled, so it can
  // be dispatched for real only after `db.transaction` below has resolved
  // successfully — a deterministic post-commit boundary, not a timing race.
  // A mutable container, not a bare `let`: TypeScript narrows a `let`
  // reassigned inside a closure back to its type at closure-creation time
  // for any read after `await`ing that closure (a known control-flow-
  // analysis limitation — reading the plain variable below would type as
  // `never`), so the pending-push state is held in an object field instead.
  const pushState: { pending: { studentId: number; title: string; body: string; data: Record<string, unknown>; notificationId: number } | null } = { pending: null };

  const result = await db.transaction(async (tx) => {
    const effectiveParticipantType = parsed.data.participantType
      ?? (student.accountType === "student" ? "self" : undefined);
    if (!effectiveParticipantType) {
      return {
        kind: "participant_error" as const,
        ok: false as const,
        status: 400 as const,
        reason: {
          code: "PARTICIPANT_REQUIRED" as const,
          message: "A package participant must be selected.",
        },
      };
    }
    const resolution = await resolvePackageParticipant(tx, req.studentId!, {
      participantType: effectiveParticipantType,
      participantChildId: parsed.data.participantChildId,
    });
    if (!resolution.ok) {
      return { kind: "participant_error" as const, ...resolution };
    }

    const purchaseEligibility = evaluatePackagePurchaseEligibility(
      resolution.participant.dateOfBirth,
      {
        allowAllAges: packageDefinition.allowAllAges,
        minAge: packageDefinition.minAge,
        maxAge: packageDefinition.maxAge,
      },
    );
    if (!purchaseEligibility.eligible) {
      return {
        kind: "participant_ineligible" as const,
        participantType: resolution.participant.participantType,
        reasons: purchaseEligibility.reasons,
      };
    }
    if (purchaseEligibility.value.purchaseEligibilityConfigurationState === "legacy_unconfigured") {
      logger.warn({
        event: "package_purchase_legacy_unconfigured_age_range",
        packageId: packageDefinition.id,
        studentId: resolution.account.id,
      }, "Allowing package purchase with legacy-unconfigured age eligibility.");
    }

    const promotionResult = await validatePackagePromotion({
      student: { id: resolution.account.id, emailVerified: resolution.account.emailVerified },
      package: {
        id: packageDefinition.id,
        name: packageDefinition.name,
        priceEgp: packageDefinition.priceEgp,
        isActive: packageDefinition.isActive,
      },
      basket: { items: [{ type: "package", id: packageDefinition.id, amount: packageDefinition.priceEgp }] },
      subtotal: packageDefinition.priceEgp,
      verified: resolution.account.emailVerified,
    }, parsed.data.promoCode, tx, { lockRedemptionScope: true });
    if (parsed.data.promoCode && !promotionResult.eligible) {
      return {
        kind: "promotion_not_eligible" as const,
        reason: promotionResult.reason ?? "Promo code is not eligible.",
      };
    }

    const allowedDanceTypeRows = await tx
      .select({ danceTypeId: pricePackageDanceTypesTable.danceTypeId })
      .from(pricePackageDanceTypesTable)
      .where(eq(pricePackageDanceTypesTable.packageId, packageDefinition.id));

    const [inserted] = await tx
      .insert(packageOrdersTable)
      .values({
        studentName: resolution.account.name,
        studentEmail: normalizeEmail(resolution.account.email),
        studentPhone: resolution.account.phone,
        // Membership Engine (Phase 3): populate the owner FK at creation
        // time so new orders never need backfilling.
        studentId: resolution.account.id,
        participantType: resolution.participant.participantType,
        participantChildId: resolution.participant.participantChildId,
        participantNameSnapshot: resolution.participant.displayName,
        participantDateOfBirthSnapshot: purchaseEligibility.value.participantDateOfBirthSnapshot,
        participantAgeAtPurchase: purchaseEligibility.value.participantAgeAtPurchase,
        eligibilityEvaluatedOn: purchaseEligibility.value.eligibilityEvaluatedOn,
        packageAllowAllAgesSnapshot: purchaseEligibility.value.packageAllowAllAgesSnapshot,
        packageMinAgeSnapshot: purchaseEligibility.value.packageMinAgeSnapshot,
        packageMaxAgeSnapshot: purchaseEligibility.value.packageMaxAgeSnapshot,
        purchaseEligibilityConfigurationState:
          purchaseEligibility.value.purchaseEligibilityConfigurationState,
        allowedDanceTypeIdsSnapshot: allowedDanceTypeRows.map((row) => row.danceTypeId),
        packageId: packageDefinition.id,
        packageName: packageDefinition.name,
        totalCredits,
        remainingCredits: totalCredits,
        status: "pendingPayment",
        notes: null,
        activatedAt: null,
        expiresAt: null,
      })
      .returning();

    // Finance Phase 2B-1: capture the creation-time monetary snapshot as a
    // live payment_records row, plus its opening payment_events "created"
    // row, in the same transaction as the package_orders write above. The
    // amount is always the server-computed catalog price minus any locked
    // promotion discount — never a client-provided figure.
    const grossAmountMinor = egpToMinor(packageDefinition.priceEgp);
    const discountAmountMinor = promotionResult.eligible ? egpToMinor(promotionResult.discountAmount) : 0;
    const finalPayableAmountMinor = grossAmountMinor - discountAmountMinor;

    const requestedPaymentChannel: PaymentRecordRequestedChannel =
      parsed.data.paymentMode === "pay_at_studio"
        ? "pay_at_studio"
        : parsed.data.paymentMode === "online_payment"
          ? "online"
          : "unknown";

    // Every newly created package order starts operational status
    // "pendingPayment" (see the insert above) and the ONLY path out of it
    // is an admin PATCH {status:"active"} gated by the packageOrders:approve
    // permission (see requirePackageOrderAction / the activation transaction
    // below) — there is no self-service confirmation, no payment gateway
    // callback, and no other transition into "active". A pendingPayment
    // order is therefore already sitting in an admin confirmation queue the
    // instant it is created, not merely "unpaid with no queue" — so the
    // Finance status must be pending_confirmation, matching the order's
    // real lifecycle, not unpaid.
    const initialStatus = "pending_confirmation" as const;

    const [paymentRecord] = await tx
      .insert(paymentRecordsTable)
      .values({
        flowType: "package_purchase",
        packageOrderId: inserted.id,
        bookingId: null,
        captureOrigin: "live_capture",
        occurredAt: inserted.createdAt,
        evidenceClass: "confirmed",
        amountAvailability: "exact",
        amountSource: "creation_snapshot",
        grossAmountMinor,
        discountAmountMinor,
        finalPayableAmountMinor,
        paidAmountMinor: 0,
        refundedAmountMinor: 0,
        currency: "EGP",
        requestedPaymentChannel,
        rawRequestedChannel: parsed.data.paymentMode ?? null,
        status: initialStatus,
        studentId: resolution.account.id,
        participantType: resolution.participant.participantType,
        childId: resolution.participant.participantChildId,
        creationIdempotencyKey: null,
      })
      .returning();

    await tx.insert(paymentEventsTable).values({
      paymentRecordId: paymentRecord.id,
      paymentRefundId: null,
      eventType: "created",
      amountMinor: null,
      previousStatus: null,
      newStatus: initialStatus,
      creditTransactionId: null,
      actorAdminId: null,
      actorType: "student",
      reason: null,
      providerReference: null,
      ipAddress: null,
      userAgent: null,
      idempotencyKey: null,
    });

    // The notification ROW is inserted here, on the transaction client, so
    // it stays atomic with the package order/payment rows above (rolls back
    // together on any later failure in this transaction). dispatchPush:
    // false suppresses createStudentNotification's own setTimeout(0) push
    // scheduling — the actual push is dispatched post-commit below instead.
    const notificationTitle = "Package request submitted";
    const notificationBody = `Your package request for ${inserted.packageName} (${inserted.participantNameSnapshot}) has been submitted.`;
    const notificationMetadata = {
      packageName: inserted.packageName,
      remainingCredits: inserted.remainingCredits,
      participantType: inserted.participantType,
      participantName: inserted.participantNameSnapshot,
    };
    const notificationRow = await createStudentNotification(tx, {
      studentEmail: inserted.studentEmail,
      title: notificationTitle,
      body: notificationBody,
      type: "package_created",
      relatedEntityType: "package_order",
      relatedEntityId: inserted.id,
      metadata: notificationMetadata,
      dispatchPush: false,
    });
    if (notificationRow) {
      pushState.pending = {
        studentId: resolution.account.id,
        title: notificationTitle,
        body: notificationBody,
        data: { type: "package_created", ...notificationMetadata },
        notificationId: notificationRow.id,
      };
    }

    // Promotion redemption mutates usage state (redemption counts) that
    // must correspond atomically to the captured discount above — it stays
    // inside this transaction, not deferred like the push dispatch, so a
    // failure here still rolls back the package order and both payment rows.
    await createPromotionRedemptions(tx, promotionResult, {
      studentId: resolution.account.id,
      packageOrderId: inserted.id,
      metadata: {
        packageId: packageDefinition.id,
        packageName: packageDefinition.name,
        promoCode: promotionResult.promotionCode,
        source: "package_checkout",
      },
    });

    return inserted;
  });
  // Deterministic post-commit boundary: the push is dispatched only after
  // `db.transaction` above has resolved, i.e. only after package_orders,
  // payment_records, payment_events, the notification row, and any
  // promotion redemption have all actually committed. Not awaited — matches
  // the pre-existing fire-and-forget contract; a push failure here has
  // never rolled back a package purchase and still does not.
  if (pushState.pending) {
    const push = pushState.pending;
    void sendPushNotification(push).catch((error) => {
      logger.error({ err: error, notificationId: push.notificationId }, "Failed to dispatch package-order creation push");
    });
  }
  if ("kind" in result && result.kind === "promotion_not_eligible") {
    res.status(409).json({
      error: result.reason,
      code: "promotion_not_eligible",
    });
    return;
  }
  if ("kind" in result && result.kind === "participant_error") {
    res.status(result.status).json({
      code: result.reason.code,
      message: result.reason.message,
      eligibility: { eligible: false, reasons: [result.reason] },
    });
    return;
  }
  if ("kind" in result && result.kind === "participant_ineligible") {
    const missingChildDob = result.participantType === "child"
      && result.reasons.some((reason) => reason.code === "DOB_REQUIRED");
    res.status(409).json({
      code: missingChildDob ? "PARTICIPANT_DOB_REQUIRED" : "PACKAGE_PARTICIPANT_INELIGIBLE",
      message: missingChildDob
        ? "Date of birth is required for the selected participant."
        : result.reasons[0]?.message ?? "The selected participant is not eligible for this package.",
      eligibility: { eligible: false, reasons: result.reasons },
    });
    return;
  }
  res.status(201).json(GetPackageOrderResponse.parse({
    ...result,
    participantName: result.participantNameSnapshot,
    ownershipState: result.participantType == null ? "legacy_unassigned" : "assigned",
  }));
  },
);

router.get("/package-orders/:id", requirePackageOrderReadAccess, async (req, res): Promise<void> => {
  const params = GetPackageOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(packageOrdersTable).where(eq(packageOrdersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Package order not found" });
    return;
  }
  if (
    req.studentJwtVerified &&
    normalizeEmail(row.studentEmail) !== normalizeEmail(req.studentEmail ?? "")
  ) {
    res.status(404).json({ error: "Package order not found" });
    return;
  }
  res.json(GetPackageOrderResponse.parse({
    ...row,
    participantName: row.participantNameSnapshot,
    ownershipState: row.participantType == null ? "legacy_unassigned" : "assigned",
  }));
});

router.get(
  "/package-orders/:id/payment-confirmation-amount",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("packageOrders", "view"),
  requireAdminPermission("finance", "paymentsConfirm"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = GetPackageOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [record] = await db
      .select({
        finalPayableAmountMinor: paymentRecordsTable.finalPayableAmountMinor,
        status: paymentRecordsTable.status,
        orderStatus: packageOrdersTable.status,
      })
      .from(paymentRecordsTable)
      .innerJoin(packageOrdersTable, eq(packageOrdersTable.id, paymentRecordsTable.packageOrderId))
      .where(and(
        eq(paymentRecordsTable.packageOrderId, params.data.id),
        eq(paymentRecordsTable.flowType, "package_purchase"),
      ))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }
    if (record.status !== "pending_confirmation" || record.orderStatus !== "pendingPayment") {
      res.status(409).json({ error: "Package payment is not eligible for confirmation" });
      return;
    }
    res.json({
      packageOrderId: params.data.id,
      amountEgp: record.finalPayableAmountMinor == null ? null : minorToEgp(record.finalPayableAmountMinor),
      paymentStatus: record.status,
    });
  },
);

router.patch(
  "/package-orders/:id",
  blockStudentJwt,
  requireAdminAuth,
  requirePackageOrderAction,
  requirePackageOrderPaymentConfirmPermission,
  async (req: AdminRequest, res): Promise<void> => {
  const params = UpdatePackageOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if ([
    "participantType",
    "participantChildId",
    "participantNameSnapshot",
    "participantDateOfBirthSnapshot",
    "participantAgeAtPurchase",
  ].some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
    res.status(400).json({
      error: "Package participant ownership is immutable after purchase.",
      code: "PACKAGE_PARTICIPANT_IMMUTABLE",
    });
    return;
  }
  const parsed = UpdatePackageOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "active" && !parsed.data.activatedAt) {
    update.activatedAt = new Date().toISOString();
  }

  // If activating a package, wrap in a transaction and write a ledger row.
  // All other updates (notes, expiry, etc.) take the simple non-transactional path.
  const isActivating = parsed.data.status === "active";

  // Finance Phase 2C: activation is the approved authoritative moment for
  // payment confirmation (policy decision #1) — confirmedPaymentMethod is
  // therefore required for this transition and only this transition, never
  // for unrelated edits/rejection. Admin must explicitly choose it; `unknown`
  // is accepted only as an explicit choice, never an invisible default.
  let confirmedPaymentMethod: PaymentRecordConfirmedMethod | undefined;
  if (isActivating) {
    const methodParsed = PackageOrderConfirmedPaymentMethod.safeParse(req.body);
    if (!methodParsed.success || !methodParsed.data.confirmedPaymentMethod) {
      res.status(400).json({
        error: "confirmedPaymentMethod is required to confirm payment and activate a package order.",
        code: "CONFIRMED_PAYMENT_METHOD_REQUIRED",
      });
      return;
    }
    confirmedPaymentMethod = methodParsed.data.confirmedPaymentMethod;
  }
  const confirmingAdminId = req.adminUser?.id;
  if (isActivating && confirmingAdminId == null) {
    res.status(401).json({ error: "Authenticated Admin identity is required to confirm payment." });
    return;
  }

  let row: typeof packageOrdersTable.$inferSelect | undefined;
  let beforeOrder: typeof packageOrdersTable.$inferSelect | undefined;
  let financeCompatibility: "legacy_payment_record_missing" | null = null;
  // Finance Phase 2C: same deferred-push pattern as POST /package-orders —
  // the notification row is inserted inside `tx` (atomic with the Finance
  // confirmation/activation writes above), but its push must be dispatched
  // only after this transaction actually commits.
  const activationPushState: { pending: { studentId: number; studentEmail: string; title: string; body: string; data: Record<string, unknown>; notificationId: number } | null } = { pending: null };

  if (isActivating) {
    const result = await db.transaction(async (tx) => {
      // Pre-Phase-2 Payment Integrity Hotfix: lock the row before making any
      // activation decision. Without FOR UPDATE, two concurrent activation
      // requests (a double-click, or a client retry after a timed-out
      // response whose write actually succeeded) can both read the
      // pre-activation row, both pass the status check below, and both
      // insert a package_activated credit row — silently double-crediting
      // the student. The lock serializes concurrent activation attempts on
      // this exact order so only the first one observes a pre-activation
      // status.
      const [current] = await tx
        .select()
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.id, params.data.id))
        .for("update");
      if (!current) return { kind: "not_found" as const };
      beforeOrder = current;

      // Only pendingPayment orders may be activated. Every other status is
      // reachable exclusively through other flows that are not this
      // endpoint's job to redo: fullyUsed/expired orders are reactivated via
      // POST /admin/package-orders/:id/credits (adminCredits.ts), which
      // issues a manual_adjustment/package_bonus credit row, never
      // package_activated; cancelled and already-active orders have no
      // legitimate reason to run this transition again. Restricting the
      // source state (not merely rejecting "already active") also closes the
      // window where a retried/duplicated request lands after the credit
      // insert below has already run once for this order.
      if (current.status !== "pendingPayment") {
        return { kind: "not_activatable" as const, current };
      }

      // Defense in depth beneath the status guard above: even if a future
      // code path ever resets status back to pendingPayment after activation
      // (there is none today), a package_activated row already existing for
      // this order is independent, durable proof that credits were already
      // issued once, and must never be issued a second time.
      const [existingActivation] = await tx
        .select({ id: creditTransactionsTable.id })
        .from(creditTransactionsTable)
        .where(and(
          eq(creditTransactionsTable.packageOrderId, current.id),
          eq(creditTransactionsTable.type, "package_activated"),
        ))
        .limit(1);
      if (existingActivation) {
        return { kind: "not_activatable" as const, current };
      }

      const validParticipantShape =
        (current.participantType == null && current.participantChildId == null)
        || (current.participantType === "self" && current.participantChildId == null)
        || (current.participantType === "child" && current.participantChildId != null);
      if (!validParticipantShape) {
        return { kind: "invalid_participant" as const, current };
      }

      // Finance Phase 2C: this activation is the approved authoritative
      // payment-confirmation moment (policy decision #1). Confirm the
      // existing canonical payment_records row BEFORE mutating
      // package_orders/credit_transactions, so a Finance integrity problem
      // (multiple/mismatched records) aborts the whole transaction — no
      // partial activation with an inconsistent Finance ledger.
      const confirmation = await confirmCanonicalPaymentRecord(tx, {
        flowType: "package_purchase",
        packageOrderId: current.id,
        confirmedPaymentMethod: confirmedPaymentMethod!,
        confirmingAdminId: confirmingAdminId!,
      });
      if (confirmation.kind === "integrity_error" || confirmation.kind === "terminal") {
        return { kind: "finance_integrity_error" as const, current, confirmation };
      }
      let confirmedPaymentRecordId: number | null = null;
      if (confirmation.kind === "legacy_missing") {
        // Phase 2C approved policy #4: a pre-Phase-2B order has no
        // canonical payment_records row. Do not fabricate one — preserve
        // existing operational activation behavior unchanged, surface a
        // controlled, non-sensitive compatibility signal, and log a
        // structured high-severity warning for Phase 2D remediation.
        logger.warn({
          event: "finance_legacy_payment_record_missing",
          flowType: "package_purchase",
          packageOrderId: current.id,
        }, "Activating a package order with no canonical payment_records row — legacy/pre-Phase-2B source, Phase 2D backfill scope.");
      } else {
        confirmedPaymentRecordId = confirmation.record.id;
      }

      // Bind the Expiration Date: when activating, default expiresAt to
      // activatedAt + the package's validity window (from price_packages), unless
      // the admin set an explicit expiry. Orders with no linked package or no
      // validity simply have no expiry.
      if (!parsed.data.expiresAt && current.packageId != null) {
        const [pp] = await tx
          .select({ validityMonths: pricePackagesTable.validityMonths })
          .from(pricePackagesTable)
          .where(eq(pricePackagesTable.id, current.packageId))
          .limit(1);
        if (pp?.validityMonths && pp.validityMonths > 0) {
          const base = new Date((update.activatedAt as string) ?? new Date().toISOString());
          base.setMonth(base.getMonth() + pp.validityMonths);
          update.expiresAt = base.toISOString();
        }
      }

      const [updated] = await tx
        .update(packageOrdersTable)
        .set(update)
        .where(eq(packageOrdersTable.id, params.data.id))
        .returning();

      // Insert package_activated ledger row
      const [creditTransaction] = await tx.insert(creditTransactionsTable).values({
        packageOrderId: current.id,
        studentId: current.studentId,
        participantType: current.participantType,
        participantChildId: current.participantChildId,
        type: "package_activated",
        delta: current.totalCredits,
        balanceBefore: 0,
        balanceAfter: current.totalCredits,
        referenceId: null,
        referenceType: null,
        notes: `Package "${current.packageName}" activated`,
        createdBy: "admin",
      }).returning();

      // Package Credit Allocation Phase B: issue the purchased origin lot in
      // the same transaction as its operational ledger row. The purchase-time
      // snapshot is the only permitted monetary source; catalog pricing must
      // never be consulted here.
      const [existingLot] = await tx
        .select({ id: packageCreditLotsTable.id })
        .from(packageCreditLotsTable)
        .where(eq(packageCreditLotsTable.issuingCreditTransactionId, creditTransaction.id))
        .limit(1);
      if (!existingLot) {
        const hasPurchaseValue = current.purchaseUnitPriceMinor != null;
        await tx.insert(packageCreditLotsTable).values({
          packageOrderId: current.id,
          sourceType: "purchased",
          creditsIssued: current.totalCredits,
          creditsRemaining: current.totalCredits,
          totalValueMinor: hasPurchaseValue
            ? current.purchaseUnitPriceMinor! * current.totalCredits
            : null,
          valueBasis: hasPurchaseValue ? "recorded_purchase_price" : "unknown",
          expiresAt: updated.expiresAt,
          issuingCreditTransactionId: creditTransaction.id,
          createdBy: "admin",
        });
      }

      // Finance Phase 2C: the credit issuance above is the fulfillment side
      // effect of payment confirmation — append the dedicated
      // activation_credits_issued event (idempotent: a no-op if this exact
      // payment record already has one, covering "Finance paid but
      // fulfillment incomplete" resume per approved policy #7). Only
      // possible when a canonical payment record actually exists.
      if (confirmedPaymentRecordId != null) {
        await appendActivationCreditsIssuedEventOnce(tx, {
          paymentRecordId: confirmedPaymentRecordId,
          creditTransactionId: creditTransaction.id,
          actorAdminId: confirmingAdminId!,
        });
      }

      // current.status is guaranteed "pendingPayment" here (guarded above),
      // so this transition always represents a genuine first activation —
      // the notification is unconditional, not re-gated on current.status.
      // Finance Phase 2C: dispatchPush:false + a post-commit dispatch below
      // (approved policy #8) — the notification row itself stays atomic
      // with the Finance/activation writes above.
      const activationTitle = "Package active";
      const activationBody = `Your ${updated.packageName} package is now active.`;
      const activationMetadata = {
        packageName: updated.packageName,
        remainingCredits: updated.remainingCredits,
        participantType: updated.participantType,
        participantName: updated.participantNameSnapshot,
      };
      const activationNotificationRow = await createStudentNotification(tx, {
        studentId: updated.studentId,
        studentEmail: updated.studentEmail,
        title: activationTitle,
        body: activationBody,
        type: "package_activated",
        relatedEntityType: "package_order",
        relatedEntityId: updated.id,
        metadata: activationMetadata,
        dispatchPush: false,
      });
      if (activationNotificationRow && updated.studentId != null) {
        activationPushState.pending = {
          studentId: updated.studentId,
          studentEmail: updated.studentEmail,
          title: activationTitle,
          body: activationBody,
          data: { type: "package_activated", ...activationMetadata },
          notificationId: activationNotificationRow.id,
        };
      }

      return {
        kind: "ok" as const,
        before: current,
        updated,
        financeCompatibility: confirmedPaymentRecordId == null ? "legacy_payment_record_missing" as const : null,
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Package order not found" });
      return;
    }
    if (result.kind === "not_activatable") {
      res.status(409).json({
        error: `Package order ${result.current.id} cannot be activated from status "${result.current.status}". Only pendingPayment orders can be activated, and each order can only be activated once.`,
        code: "PACKAGE_ORDER_NOT_ACTIVATABLE",
      });
      return;
    }
    if (result.kind === "finance_integrity_error") {
      logger.error({
        event: "finance_confirmation_integrity_error",
        flowType: "package_purchase",
        packageOrderId: result.current.id,
        confirmation: result.confirmation,
      }, "Blocked package activation due to a Finance payment_records integrity problem.");
      res.status(409).json({
        error: "This package order's payment record is in an inconsistent state and cannot be confirmed automatically. Please contact engineering support.",
        code: "FINANCE_CONFIRMATION_INTEGRITY_ERROR",
      });
      return;
    }
    if (result.kind === "invalid_participant") {
      res.status(409).json({
        error: "Package order participant ownership is invalid and cannot be activated.",
        code: "PACKAGE_PARTICIPANT_MISMATCH",
      });
      return;
    }
    beforeOrder = result.before;
    row = result.updated;
    financeCompatibility = result.financeCompatibility;
    // Deterministic post-commit boundary — dispatched only once the
    // activation transaction above has actually resolved successfully.
    if (activationPushState.pending) {
      const push = activationPushState.pending;
      void sendPushNotification(push).catch((error) => {
        logger.error({ err: error, notificationId: push.notificationId }, "Failed to dispatch package-activation push");
      });
    }
  } else {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.id, params.data.id));

      if (!current) return undefined;
      beforeOrder = current;

      const [updated] = await tx
        .update(packageOrdersTable)
        .set(update)
        .where(eq(packageOrdersTable.id, params.data.id))
        .returning();

      if (updated.status === "cancelled" && current.status !== "cancelled") {
        await createStudentNotification(tx, {
          studentId: updated.studentId,
          studentEmail: updated.studentEmail,
          title: "Package cancelled",
          body: `Your ${updated.packageName} package was cancelled.`,
          type: "package_cancelled",
          relatedEntityType: "package_order",
          relatedEntityId: updated.id,
          metadata: {
            packageName: updated.packageName,
            remainingCredits: updated.remainingCredits,
          },
        });
      }

      return { before: current, updated };
    });

    if (!result) {
      res.status(404).json({ error: "Package order not found" });
      return;
    }
    beforeOrder = result.before;
    row = result.updated;
  }

  if (row && beforeOrder) {
    const { before, after } = diffFields(
      packageOrderActivitySnapshot(beforeOrder),
      packageOrderActivitySnapshot(row),
      PACKAGE_ORDER_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const statusChanged = beforeOrder.status !== row.status;
      const action = statusChanged
        ? row.status === "active"
          ? "activate"
          : row.status === "cancelled"
            ? "cancel"
            : "statusChange"
        : "update";
      await logActivity(req, {
        action,
        module: "packageOrders",
        entityType: "package_order",
        entityId: row.id,
        entityLabel: packageOrderLabel(row),
        before,
        after,
        summary: statusChanged
          ? `${row.status === "active" ? "Activated" : row.status === "cancelled" ? "Cancelled" : "Changed status for"} package order ${row.id} (${packageOrderLabel(row)})`
          : `Updated package order ${row.id} (${packageOrderLabel(row)}): ${changedKeys.join(", ")}`,
      });
    }
  }

  // Non-sensitive, additive compatibility signal for Phase 2C policy #4 —
  // a response header rather than a new response-body field, since
  // UpdatePackageOrderResponse is a generated (orval) contract this route
  // must not diverge from.
  if (financeCompatibility) {
    res.setHeader("X-Finance-Compatibility", financeCompatibility);
  }
  res.json(UpdatePackageOrderResponse.parse(row));
  },
);

router.delete("/package-orders/:id", (_req, res): void => {
  res.status(405).json({
    error: "Package orders cannot be hard-deleted. Cancel the order instead.",
  });
});

export default router;
