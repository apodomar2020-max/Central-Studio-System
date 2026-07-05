import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, heroItemsTable } from "@workspace/db";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  CreateHeroItemBody,
  GetHeroItemParams,
  GetHeroItemResponse,
  UpdateHeroItemParams,
  UpdateHeroItemBody,
  UpdateHeroItemResponse,
  DeleteHeroItemParams,
  ListHeroItemsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const HERO_ACTIVITY_FIELDS = ["imageUrl", "buttonRoute", "sortOrder", "isActive"] as const;

router.get("/hero-items", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(heroItemsTable)
    .orderBy(asc(heroItemsTable.sortOrder), asc(heroItemsTable.createdAt));
  res.json(ListHeroItemsResponse.parse(rows));
});

router.post("/hero-items", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateHeroItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [row] = await db.insert(heroItemsTable).values(parsed.data).returning();
    await logActivity(req, {
      action: "create",
      module: "heroSlides",
      entityType: "hero_slide",
      entityId: row.id,
      entityLabel: `Hero slide ${row.id}`,
      after: Object.fromEntries(HERO_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      summary: `Created hero slide ${row.id}`,
    });
    res.status(201).json(GetHeroItemResponse.parse(row));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    res.status(500).json({ error: cause ? `${msg} | ${cause}` : msg });
  }
});

router.get("/hero-items/:id", async (req, res): Promise<void> => {
  const params = GetHeroItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(heroItemsTable)
    .where(eq(heroItemsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Hero item not found" });
    return;
  }
  res.json(GetHeroItemResponse.parse(row));
});

router.patch("/hero-items/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateHeroItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateHeroItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(heroItemsTable).where(eq(heroItemsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Hero item not found" });
    return;
  }
  const [row] = await db
    .update(heroItemsTable)
    .set(parsed.data)
    .where(eq(heroItemsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hero item not found" });
    return;
  }
  const { before, after } = diffFields(
    Object.fromEntries(HERO_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
    Object.fromEntries(HERO_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    HERO_ACTIVITY_FIELDS,
  );
  const changedKeys = Object.keys(after);
  if (changedKeys.length > 0) {
    const action = existing.isActive !== row.isActive ? row.isActive ? "activate" : "deactivate" : "update";
    await logActivity(req, {
      action,
      module: "heroSlides",
      entityType: "hero_slide",
      entityId: row.id,
      entityLabel: `Hero slide ${row.id}`,
      before,
      after,
      summary: action === "activate"
        ? `Activated hero slide ${row.id}`
        : action === "deactivate"
          ? `Deactivated hero slide ${row.id}`
          : `Updated hero slide ${row.id}: ${changedKeys.join(", ")}`,
    });
  }
  res.json(UpdateHeroItemResponse.parse(row));
});

router.delete("/hero-items/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = DeleteHeroItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(heroItemsTable)
    .where(eq(heroItemsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hero item not found" });
    return;
  }
  await logActivity(req, {
    action: "delete",
    module: "heroSlides",
    entityType: "hero_slide",
    entityId: row.id,
    entityLabel: `Hero slide ${row.id}`,
    before: Object.fromEntries(HERO_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted hero slide ${row.id}`,
  });
  res.sendStatus(204);
});

export default router;
