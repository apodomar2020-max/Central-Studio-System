import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, heroItemsTable } from "@workspace/db";
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

router.get("/hero-items", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(heroItemsTable)
    .orderBy(asc(heroItemsTable.sortOrder), asc(heroItemsTable.createdAt));
  res.json(ListHeroItemsResponse.parse(rows));
});

router.post("/hero-items", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "create"), async (req, res): Promise<void> => {
  const parsed = CreateHeroItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [row] = await db.insert(heroItemsTable).values(parsed.data).returning();
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

router.patch("/hero-items/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "edit"), async (req, res): Promise<void> => {
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
  const [row] = await db
    .update(heroItemsTable)
    .set(parsed.data)
    .where(eq(heroItemsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hero item not found" });
    return;
  }
  res.json(UpdateHeroItemResponse.parse(row));
});

router.delete("/hero-items/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("heroSlides", "delete"), async (req, res): Promise<void> => {
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
  res.sendStatus(204);
});

export default router;
