/**
 * Admin Credit Ledger routes
 *
 * All routes require requireAdminAuth.
 *
 *   GET /api/admin/credits/ledger  — paginated list of credit_transactions
 *     query params: packageOrderId?, studentEmail?, page?, limit?
 */

import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import * as zod from "zod";
import { db, creditTransactionsTable, packageOrdersTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { ListCreditTransactionsQueryParams } from "@workspace/api-zod";
import { createStudentNotification } from "../lib/notifications";

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

    // -----------------------------------------------------------------------
    // Resolve filter conditions
    // -----------------------------------------------------------------------
    const conditions = [];

    if (packageOrderId != null) {
      conditions.push(eq(creditTransactionsTable.packageOrderId, packageOrderId));
    }

    // Resolve student email → matching package order IDs
    if (studentEmail) {
      const matchingOrders = await db
        .select({ id: packageOrdersTable.id })
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.studentEmail, studentEmail));

      const orderIds = matchingOrders.map((o) => o.id);
      if (orderIds.length === 0) {
        res.json({ data: [], total: 0, page, limit });
        return;
      }
      conditions.push(inArray(creditTransactionsTable.packageOrderId, orderIds));
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
  notes: zod.string().optional(),
});

router.post(
  "/admin/package-orders/:id/credits",
  requireAdminAuth,
  requireAdminPermission("credits", "adjust"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = AdjustCreditsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = AdjustCreditsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const { id } = params.data;
    const { type, delta, notes } = body.data;
    const adminEmail = req.adminUser?.username ?? "admin";

    try {
      const result = await db.transaction(async (tx) => {
        // Step 1 — Lock the order row
        const [order] = await tx
          .select()
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, id))
          .for("update");

        if (!order) {
          throw { status: 404, message: "Package order not found" };
        }

        const newRemaining = order.remainingCredits + delta;

        if (newRemaining < 0) {
          throw {
            status: 400,
            message: `Cannot remove ${Math.abs(delta)} credits — only ${order.remainingCredits} remaining`,
          };
        }

        // Step 2 — Determine new status
        let newStatus = order.status;
        if (newRemaining <= 0) {
          newStatus = "fullyUsed";
        } else if (order.status === "fullyUsed" && delta > 0) {
          // Re-activate a fully-used package when credits are added back
          newStatus = "active";
        }

        // Step 3 — Update packageOrders
        const [updated] = await tx
          .update(packageOrdersTable)
          .set({ remainingCredits: newRemaining, status: newStatus })
          .where(eq(packageOrdersTable.id, id))
          .returning();

        // Step 4 — Append immutable ledger row
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
            referenceType: null,
            notes: notes ?? null,
            createdBy: adminEmail,
          })
          .returning();

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

        return { order: updated, transaction };
      });

      res.status(201).json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status && e.message) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
