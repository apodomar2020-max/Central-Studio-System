import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, packageOrdersTable } from "@workspace/db";
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
  const [row] = await db.insert(packageOrdersTable).values(parsed.data).returning();
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
  const [row] = await db.update(packageOrdersTable).set(update).where(eq(packageOrdersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Package order not found" });
    return;
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
