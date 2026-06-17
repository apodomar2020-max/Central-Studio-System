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
import { db, creditTransactionsTable, packageOrdersTable } from "@workspace/db";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";
import { ListCreditTransactionsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get(
  "/admin/credits/ledger",
  requireAdminAuth,
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

export default router;
