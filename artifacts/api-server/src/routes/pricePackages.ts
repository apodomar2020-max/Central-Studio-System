import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pricePackagesTable } from "@workspace/db";
import {
  CreatePricePackageBody,
  GetPricePackageParams,
  GetPricePackageResponse,
  UpdatePricePackageParams,
  UpdatePricePackageBody,
  UpdatePricePackageResponse,
  DeletePricePackageParams,
  ListPricePackagesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/price-packages", async (req, res): Promise<void> => {
  const rows = await db.select().from(pricePackagesTable).orderBy(pricePackagesTable.createdAt);
  res.json(ListPricePackagesResponse.parse(rows));
});

router.post("/price-packages", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "create"), async (req, res): Promise<void> => {
  const parsed = CreatePricePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(pricePackagesTable).values(parsed.data).returning();
  res.status(201).json(GetPricePackageResponse.parse(row));
});

router.get("/price-packages/:id", async (req, res): Promise<void> => {
  const params = GetPricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  res.json(GetPricePackageResponse.parse(row));
});

router.patch("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "edit"), async (req, res): Promise<void> => {
  const params = UpdatePricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePricePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(pricePackagesTable).set(parsed.data).where(eq(pricePackagesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  res.json(UpdatePricePackageResponse.parse(row));
});

router.delete("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "delete"), async (req, res): Promise<void> => {
  const params = DeletePricePackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
