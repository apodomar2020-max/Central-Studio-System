import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, packageOrdersTable, creditTransactionsTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import {
  ListPackageOrdersQueryParams,
  ListPackageOrdersResponse,
  GetPackageOrderParams,
  GetPackageOrderResponse,
  CreatePackageOrderBody,
  UpdatePackageOrderParams,
  UpdatePackageOrderBody,
  UpdatePackageOrderResponse,
  DeletePackageOrderParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/package-orders", async (req, res): Promise<void> => {
  const query = ListPackageOrdersQueryParams.safeParse(req.query);
  let rows = await db.select().from(packageOrdersTable).orderBy(desc(packageOrdersTable.createdAt));
  if (query.success && query.data.status) {
    rows = rows.filter((r) => r.status === query.data.status);
  }
  res.json(ListPackageOrdersResponse.parse(rows));
});

router.post("/package-orders", async (req, res): Promise<void> => {
  const parsed = CreatePackageOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(packageOrdersTable).values(parsed.data).returning();
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
    return inserted;
  });
  res.status(201).json(GetPackageOrderResponse.parse(row));
});

router.get("/package-orders/:id", async (req, res): Promise<void> => {
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
  res.json(GetPackageOrderResponse.parse(row));
});

router.patch("/package-orders/:id", async (req, res): Promise<void> => {
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
});

router.delete("/package-orders/:id", async (req, res): Promise<void> => {
  const params = DeletePackageOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(packageOrdersTable).where(eq(packageOrdersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Package order not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
