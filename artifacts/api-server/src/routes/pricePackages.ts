import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pricePackagesTable } from "@workspace/db";
import { diffFields, logActivity } from "../lib/activityLog";
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
const PRICE_PACKAGE_ACTIVITY_FIELDS = ["name", "type", "priceEgp", "sessions", "description", "isActive", "isFeatured", "validityMonths", "singleClassPriceEgp", "allowedDanceTypes", "features"] as const;

router.get("/price-packages", async (req, res): Promise<void> => {
  const rows = await db.select().from(pricePackagesTable).orderBy(pricePackagesTable.createdAt);
  res.json(ListPricePackagesResponse.parse(rows));
});

router.post("/price-packages", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePricePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(pricePackagesTable).values(parsed.data).returning();
  await logActivity(req, {
    action: "create",
    module: "packages",
    entityType: "price_package",
    entityId: row.id,
    entityLabel: row.name,
    after: Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Created package ${row.name}`,
  });
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

router.patch("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "edit"), async (req: AdminRequest, res): Promise<void> => {
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
  const [existing] = await db.select().from(pricePackagesTable).where(eq(pricePackagesTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  const [row] = await db.update(pricePackagesTable).set(parsed.data).where(eq(pricePackagesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Price package not found" });
    return;
  }
  const { before, after } = diffFields(
    Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
    Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    PRICE_PACKAGE_ACTIVITY_FIELDS,
  );
  const changedKeys = Object.keys(after);
  if (changedKeys.length > 0) {
    const action = existing.isActive !== row.isActive ? row.isActive ? "activate" : "deactivate" : "update";
    await logActivity(req, {
      action,
      module: "packages",
      entityType: "price_package",
      entityId: row.id,
      entityLabel: row.name,
      before,
      after,
      summary: action === "activate"
        ? `Activated package ${row.name}`
        : action === "deactivate"
          ? `Deactivated package ${row.name}`
          : `Updated package ${row.name}: ${changedKeys.join(", ")}`,
    });
  }
  res.json(UpdatePricePackageResponse.parse(row));
});

router.delete("/price-packages/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("packages", "delete"), async (req: AdminRequest, res): Promise<void> => {
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
  await logActivity(req, {
    action: "delete",
    module: "packages",
    entityType: "price_package",
    entityId: row.id,
    entityLabel: row.name,
    before: Object.fromEntries(PRICE_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted package ${row.name}`,
  });
  res.sendStatus(204);
});

export default router;
