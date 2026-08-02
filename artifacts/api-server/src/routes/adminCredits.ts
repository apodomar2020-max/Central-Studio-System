/**
 * Admin Credit Ledger routes
 *
 * All routes require requireAdminAuth.
 *
 *   GET /api/admin/credits/ledger  — paginated list of credit_transactions
 *     query params: packageOrderId?, studentEmail?, studentId?, page?, limit?
 */

import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import * as zod from "zod";
import { db, creditTransactionsTable, packageCreditLotsTable, packageOrdersTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { ListCreditTransactionsQueryParams } from "@workspace/api-zod";
import { createStudentNotification } from "../lib/notifications";
import { ExposableHttpError } from "../lib/httpError";
import { logActivity } from "../lib/activityLog";

const router: IRouter = Router();

router.get(
  "/admin/credits/ledger",
  requireAdminAuth,
  requireAdminPermission("credits", "history"),
  async (req: AdminRequest, res): Promise<void> => {
    const query = ListCreditTransactionsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const { packageOrderId, studentEmail, page = 1, limit = 50 } = query.data;
    // Membership Engine (Phase 3): read directly off req.query rather than
    // extending the generated ListCreditTransactionsQueryParams schema.
    const rawStudentId = req.query.studentId;
    const studentId = typeof rawStudentId === "string" && /^\d+$/.test(rawStudentId) ? Number(rawStudentId) : undefined;

    // -----------------------------------------------------------------------
    // Resolve filter conditions
    // -----------------------------------------------------------------------
    const conditions = [];

    if (packageOrderId != null) {
      conditions.push(eq(creditTransactionsTable.packageOrderId, packageOrderId));
    }

    // Resolve student id/email → matching package order IDs. Matching on
    // package_orders.student_id (Phase 3, migration 0034) as well as email
    // means this keeps working for rows created before that column existed
    // (student_id null → falls through to the email match) and for rows
    // backfilled since.
    if (studentId != null || studentEmail) {
      const orderConditions = [];
      if (studentId != null) orderConditions.push(eq(packageOrdersTable.studentId, studentId));
      if (studentEmail) orderConditions.push(sql`lower(trim(${packageOrdersTable.studentEmail})) = ${studentEmail.trim().toLowerCase()}`);

      const matchingOrders = await db
        .select({ id: packageOrdersTable.id })
        .from(packageOrdersTable)
        .where(or(...orderConditions));

      const orderIds = matchingOrders.map((o) => o.id);
      const ledgerConditions = [];
      if (orderIds.length > 0) ledgerConditions.push(inArray(creditTransactionsTable.packageOrderId, orderIds));
      // Some ledger rows (e.g. attendance deductions) already carry their
      // own studentId directly — catch those too even if, for some reason,
      // their package order didn't match above.
      if (studentId != null) ledgerConditions.push(eq(creditTransactionsTable.studentId, studentId));

      if (ledgerConditions.length === 0) {
        res.json({ data: [], total: 0, page, limit });
        return;
      }
      conditions.push(or(...ledgerConditions));
    }

    const offset = (page - 1) * limit;
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // -----------------------------------------------------------------------
    // Execute data + count queries in parallel
    // -----------------------------------------------------------------------
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(creditTransactionsTable)
        .where(whereClause)
        .orderBy(desc(creditTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ total: count() })
        .from(creditTransactionsTable)
        .where(whereClause),
    ]);

    res.json({ data: rows, total, page, limit });
  },
);

// ---------------------------------------------------------------------------
// POST /admin/package-orders/:id/credits
//
// Apply a credit adjustment to an active package order.  Used by admins to:
//   • Add bonus credits (type="package_bonus", delta must be positive)
//   • Manually adjust credits up or down (type="manual_adjustment", delta can
//     be any non-zero integer — negative removes credits)
//
// The operation is fully atomic:
//   1. Lock the package order row (SELECT FOR UPDATE)
//   2. Validate the new balance would be >= 0
//   3. Update remainingCredits on packageOrders
//   4. If the package was fullyUsed and credits are being added, reactivate it
//   5. Insert an immutable ledger row in credit_transactions
// ---------------------------------------------------------------------------

const AdjustCreditsParams = zod.object({
  id: zod.coerce.number().int().positive(),
});

const AdjustCreditsBody = zod.object({
  type: zod.enum(["manual_adjustment", "package_bonus"]),
  /** Signed credit change. Positive = add credits, negative = remove credits. */
  delta: zod.number().int().refine((n) => n !== 0, { message: "delta must be non-zero" }),
  sourceType: zod.enum(["bonus", "manual_complimentary", "manual_paid"]).optional(),
  totalValueMinor: zod.number().int().positive().optional(),
  idempotencyKey: zod.string().uuid(),
  notes: zod.string().optional(),
}).superRefine((value, ctx) => {
  if (value.delta < 0) {
    if (value.type !== "manual_adjustment") {
      ctx.addIssue({ code: "custom", path: ["type"], message: "Negative adjustments must use manual_adjustment" });
    }
    if (value.sourceType != null) {
      ctx.addIssue({ code: "custom", path: ["sourceType"], message: "Negative adjustments do not issue credit lots" });
    }
    if (value.totalValueMinor != null) {
      ctx.addIssue({ code: "custom", path: ["totalValueMinor"], message: "Negative adjustments cannot include monetary value" });
    }
    return;
  }

  if (value.sourceType == null) {
    ctx.addIssue({ code: "custom", path: ["sourceType"], message: "Positive credit issuance requires sourceType" });
    return;
  }
  if (value.type === "package_bonus" && value.sourceType !== "bonus") {
    ctx.addIssue({ code: "custom", path: ["sourceType"], message: "package_bonus requires sourceType bonus" });
  }
  if (value.type === "manual_adjustment" && value.sourceType === "bonus") {
  delta: zod.number().int().refine((val) => val !== 0, { message: "delta cannot be 0" }),
  sourceType: zod.enum(["manual_paid", "manual_complimentary", "bonus"]).optional(),
  totalValueMinor: zod.number().int().min(0).optional(),
  idempotencyKey: zod.string().min(1).max(255),
  notes: zod.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.delta > 0) {
    if (!data.sourceType) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        message: "sourceType is required when adding credits (delta > 0)",
        path: ["sourceType"],
      });
    }
    if (data.sourceType === "manual_paid" && data.totalValueMinor == null) {
      ctx.addIssue({
        code: zod.ZodIssueCode.custom,
        message: "totalValueMinor is required for manual_paid additions",
        path: ["totalValueMinor"],
      });
    }
  }
});

router.post(
  "/admin/package-orders/:id/adjust-credits",
  requireAdminAuth,
  requireAdminPermission("credits", "adjust"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = AdjustCreditsParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = AdjustCreditsBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }

    const { id } = params.data;
    const { type, delta, sourceType, totalValueMinor, idempotencyKey, notes } = body.data;
    const adminEmail = req.adminUser?.username ?? "admin";
    const idempotencyReference = `admin_credit_adjustment:${idempotencyKey}`;

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${id}:${idempotencyKey}`}, 0))`);

        const [order] = await tx
          .select()
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, id))
          .for("update");

        if (!order) {
          throw new ExposableHttpError(404, "Package order not found");
        }

        const [existingTransaction] = await tx
          .select()
          .from(creditTransactionsTable)
          .where(and(
            eq(creditTransactionsTable.packageOrderId, id),
            eq(creditTransactionsTable.referenceType, idempotencyReference),
          ))
          .limit(1);
        if (existingTransaction) {
          const [existingLot] = await tx
            .select()
            .from(packageCreditLotsTable)
            .where(eq(packageCreditLotsTable.issuingCreditTransactionId, existingTransaction.id))
            .limit(1);
          const [existingAllocation] = await tx
            .select()
            .from(packageCreditAllocationsTable)
            .where(eq(packageCreditAllocationsTable.creditTransactionId, existingTransaction.id))
            .limit(1);
          const expectedLotValue = sourceType === "manual_paid" ? totalValueMinor : delta > 0 ? 0 : undefined;
          const requestMatches = existingTransaction.type === type
            && existingTransaction.delta === delta
            && (delta < 0
              ? existingAllocation != null
              : existingLot?.sourceType === sourceType && existingLot.totalValueMinor === expectedLotValue);
          if (!requestMatches) {
            throw new ExposableHttpError(409, "Idempotency key was already used for a different credit adjustment");
          }
          return {
            order,
            transaction: existingTransaction,
            before: { remainingCredits: existingTransaction.balanceBefore, status: order.status },
            replayed: true,
          };
        }

        const newRemaining = order.remainingCredits + delta;

        if (newRemaining < 0) {
          throw new ExposableHttpError(400, `Cannot remove ${Math.abs(delta)} credits — only ${order.remainingCredits} remaining`);
        }

        // Step 2 — Handle delta < 0 credit lot reduction and allocation
        let activeLots: Array<typeof packageCreditLotsTable.$inferSelect> = [];
        if (delta < 0) {
          const neededDeduct = Math.abs(delta);
          activeLots = await tx
            .select()
            .from(packageCreditLotsTable)
            .where(and(
              eq(packageCreditLotsTable.packageOrderId, id),
              gt(packageCreditLotsTable.creditsRemaining, 0),
            ))
            .orderBy(
              sql`${packageCreditLotsTable.expiresAt} asc nulls last`,
              asc(packageCreditLotsTable.createdAt),
              asc(packageCreditLotsTable.id),
            )
            .for("update");

          const totalAvailableLotCredits = activeLots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
          if (neededDeduct > totalAvailableLotCredits) {
            throw new ExposableHttpError(400, `Cannot remove ${neededDeduct} credits — only ${totalAvailableLotCredits} remaining across credit lots`);
          }
        }

        // Step 3 — Determine new status
        let newStatus = order.status;
        if (newRemaining <= 0) {
          newStatus = "fullyUsed";
        } else if (order.status === "fullyUsed" && delta > 0) {
          // Re-activate a fully-used package when credits are added back
          newStatus = "active";
        }

        // Step 4 — Update packageOrders
        const [updated] = await tx
          .update(packageOrdersTable)
          .set({ remainingCredits: newRemaining, status: newStatus })
          .where(eq(packageOrdersTable.id, id))
          .returning();

        // Step 5 — Append single immutable ledger transaction row
        const [transaction] = await tx
          .insert(creditTransactionsTable)
          .values({
            packageOrderId: id,
            studentId: null,
            type,
            delta,
            balanceBefore: order.remainingCredits,
            balanceAfter: newRemaining,
            referenceId: null,
            referenceType: idempotencyReference,
            notes: notes ?? null,
            createdBy: adminEmail,
          })
          .returning();

        if (delta > 0) {
          await tx.insert(packageCreditLotsTable).values({
            packageOrderId: id,
            sourceType: sourceType!,
            creditsIssued: delta,
            creditsRemaining: delta,
            totalValueMinor: sourceType === "manual_paid" ? totalValueMinor! : 0,
            valueBasis: sourceType === "manual_paid" ? "recorded_purchase_price" : "unknown",
            expiresAt: updated.expiresAt,
            issuingCreditTransactionId: transaction.id,
            createdBy: adminEmail,
            notes: notes ?? null,
          });
        } else if (delta < 0) {
          let remainingToDeduct = Math.abs(delta);
          for (const lot of activeLots) {
            if (remainingToDeduct <= 0) break;
            const deductCount = Math.min(lot.creditsRemaining, remainingToDeduct);

            let allocatedTotalValueMinor = 0;
            let unitValueMinor: number | null = null;
            if (lot.totalValueMinor != null && lot.creditsIssued > 0) {
              const consumedBefore = BigInt(lot.creditsIssued - lot.creditsRemaining);
              const consumedAfter = consumedBefore + BigInt(deductCount);
              const value = BigInt(lot.totalValueMinor);
              const issued = BigInt(lot.creditsIssued);
              const valStart = (value * consumedBefore) / issued;
              const valEnd = (value * consumedAfter) / issued;
              allocatedTotalValueMinor = Number(valEnd - valStart);
              unitValueMinor = deductCount === 1 ? allocatedTotalValueMinor : null;
            }

            const [updatedLot] = await tx
              .update(packageCreditLotsTable)
              .set({ creditsRemaining: lot.creditsRemaining - deductCount })
              .where(and(
                eq(packageCreditLotsTable.id, lot.id),
                eq(packageCreditLotsTable.creditsRemaining, lot.creditsRemaining),
              ))
              .returning({ id: packageCreditLotsTable.id });

            if (!updatedLot) {
              throw new ExposableHttpError(409, "Credit lot changed during manual credit adjustment");
            }

            await tx.insert(packageCreditAllocationsTable).values({
              lotId: lot.id,
              eventType: "manual_adjustment",
              creditTransactionId: transaction.id,
              packageOrderId: id,
              credits: deductCount,
              unitValueMinor,
              totalValueMinor: allocatedTotalValueMinor,
              valueBasis: allocatedTotalValueMinor > 0 ? lot.valueBasis : "unknown",
              policyVersion: "manual_adjustment_v1_expiry_fifo",
              createdBy: adminEmail,
              notes: notes ?? null,
            });

            remainingToDeduct -= deductCount;
          }
        }

        await createStudentNotification(tx, {
          studentEmail: updated.studentEmail,
          title: "Package credits updated",
          body: `Your ${updated.packageName} package credits were updated. New balance: ${updated.remainingCredits}.`,
          type: newRemaining <= 0 ? "credits_exhausted" : "package_credits_updated",
          relatedEntityType: "package_order",
          relatedEntityId: updated.id,
          metadata: {
            packageName: updated.packageName,
            remainingCredits: updated.remainingCredits,
          },
        });

        if (newRemaining <= 0 && order.remainingCredits > 0) {
          await createStudentNotification(tx, {
            studentEmail: updated.studentEmail,
            title: "Package credits used",
            body: `Your ${updated.packageName} package credits have been used.`,
            type: "credits_exhausted",
            relatedEntityType: "package_order",
            relatedEntityId: updated.id,
            metadata: {
              packageName: updated.packageName,
              remainingCredits: updated.remainingCredits,
            },
          });
        }

        return {
          order: updated,
          transaction,
          before: {
            remainingCredits: order.remainingCredits,
            status: order.status,
          },
          replayed: false,
        };
      });

      if (!result.replayed) await logActivity(req, {
        action: "creditAdjust",
        module: "packageOrders",
        entityType: "package_order",
        entityId: result.order.id,
        entityLabel: `${result.order.studentName} - ${result.order.packageName}`,
        before: {
          remainingCredits: result.before.remainingCredits,
          status: result.before.status,
        },
        after: {
          remainingCredits: result.transaction.balanceAfter,
          status: result.order.status,
          delta: result.transaction.delta,
          type: result.transaction.type,
          transactionId: result.transaction.id,
        },
        summary: `Adjusted credits for package order ${result.order.id} (${result.order.studentName} - ${result.order.packageName}): ${delta > 0 ? "+" : ""}${delta}`,
      });

      res.status(201).json(result);
    } catch (err: unknown) {
      // Only our own deliberately-thrown errors carry client-safe messages; a
      // duck-typed { status, message } check could forward library internals.
      if (err instanceof ExposableHttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
