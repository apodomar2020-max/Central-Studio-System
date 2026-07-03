import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  packageOrdersTable,
  creditTransactionsTable,
  pricePackagesTable,
  studentsTable,
} from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { createPromotionRedemptions, validatePackagePromotion } from "../lib/promotionService";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
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

const PurchasePackageBody = z.object({
  packageId: z.coerce.number().int().positive(),
  paymentMode: z.enum(["pay_at_studio", "online_payment"]).optional(),
  promoCode: z.string().trim().optional().nullable(),
}).passthrough();

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
    res.json(ListPackageOrdersResponse.parse(rows));
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
  res.json(ListPackageOrdersResponse.parse(rows));
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

  const promotionResult = await validatePackagePromotion({
    student: { id: student.id, emailVerified: student.emailVerified },
    package: {
      id: packageDefinition.id,
      name: packageDefinition.name,
      priceEgp: packageDefinition.priceEgp,
      isActive: packageDefinition.isActive,
    },
    basket: { items: [{ type: "package", id: packageDefinition.id, amount: packageDefinition.priceEgp }] },
    subtotal: packageDefinition.priceEgp,
    verified: student.emailVerified,
  }, parsed.data.promoCode);
  if (parsed.data.promoCode && !promotionResult.eligible) {
    res.status(409).json({
      error: promotionResult.reason ?? "Promo code is not eligible.",
      code: "promotion_not_eligible",
    });
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(packageOrdersTable)
      .values({
        studentName: student.name,
        studentEmail: normalizeEmail(student.email),
        studentPhone: student.phone,
        // Membership Engine (Phase 3): populate the owner FK at creation
        // time so new orders never need backfilling.
        studentId: student.id,
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
    await createStudentNotification(tx, {
      studentEmail: inserted.studentEmail,
      title: "Package request submitted",
      body: `Your package request for ${inserted.packageName} has been submitted.`,
      type: "package_created",
      relatedEntityType: "package_order",
      relatedEntityId: inserted.id,
      metadata: {
        packageName: inserted.packageName,
        remainingCredits: inserted.remainingCredits,
        },
      });
      await createPromotionRedemptions(tx, promotionResult, {
        studentId: student.id,
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
  res.status(201).json(GetPackageOrderResponse.parse(row));
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
  res.json(GetPackageOrderResponse.parse(row));
});

router.patch(
  "/package-orders/:id",
  blockStudentJwt,
  requireAdminAuth,
  requirePackageOrderAction,
  async (req, res): Promise<void> => {
  const params = UpdatePackageOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  let row: typeof packageOrdersTable.$inferSelect | undefined;

  if (isActivating) {
    const result = await db.transaction(async (tx) => {
      // Fetch current state for ledger balance fields
      const [current] = await tx
        .select()
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.id, params.data.id));
      if (!current) return undefined;

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
      await tx.insert(creditTransactionsTable).values({
        packageOrderId: current.id,
        studentId: null,
        type: "package_activated",
        delta: current.totalCredits,
        balanceBefore: 0,
        balanceAfter: current.totalCredits,
        referenceId: null,
        referenceType: null,
        notes: `Package "${current.packageName}" activated`,
        createdBy: "admin",
      });

      if (current.status !== "active") {
        await createStudentNotification(tx, {
          studentEmail: updated.studentEmail,
          title: "Package active",
          body: `Your ${updated.packageName} package is now active.`,
          type: "package_activated",
          relatedEntityType: "package_order",
          relatedEntityId: updated.id,
          metadata: {
            packageName: updated.packageName,
            remainingCredits: updated.remainingCredits,
          },
        });
      }

      return updated;
    });

    if (!result) {
      res.status(404).json({ error: "Package order not found" });
      return;
    }
    row = result;
  } else {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.id, params.data.id));

      if (!current) return undefined;

      const [updated] = await tx
        .update(packageOrdersTable)
        .set(update)
        .where(eq(packageOrdersTable.id, params.data.id))
        .returning();

      if (updated.status === "cancelled" && current.status !== "cancelled") {
        await createStudentNotification(tx, {
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

      return updated;
    });

    const updated = result;
    if (!updated) {
      res.status(404).json({ error: "Package order not found" });
      return;
    }
    row = updated;
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
