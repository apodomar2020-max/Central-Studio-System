import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, appContentPagesTable } from "@workspace/db";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

const SlugParams = z.object({
  slug: z.string().min(1),
});

const UpdateContentPageBody = z.object({
  title: z.string().trim().min(1, "Title is required"),
  subtitle: z.string().trim().nullable().optional(),
  content: z.string().trim().min(1, "Content is required"),
  isActive: z.boolean(),
});

router.get("/content/pages", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(appContentPagesTable)
    .where(eq(appContentPagesTable.isActive, true))
    .orderBy(asc(appContentPagesTable.title));

  res.json(rows);
});

router.get("/content/pages/:slug", async (req, res): Promise<void> => {
  const params = SlugParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select()
    .from(appContentPagesTable)
    .where(eq(appContentPagesTable.slug, params.data.slug))
    .limit(1);

  if (!row || !row.isActive) {
    res.status(404).json({ error: "Content page not found" });
    return;
  }

  res.json(row);
});

router.get(
  "/admin/content/pages",
  requireAdminAuth,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(appContentPagesTable)
      .orderBy(asc(appContentPagesTable.title));

    res.json(rows);
  },
);

router.get(
  "/admin/content/pages/:slug",
  requireAdminAuth,
  async (req, res): Promise<void> => {
    const params = SlugParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [row] = await db
      .select()
      .from(appContentPagesTable)
      .where(eq(appContentPagesTable.slug, params.data.slug))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Content page not found" });
      return;
    }

    res.json(row);
  },
);

router.patch(
  "/admin/content/pages/:slug",
  requireAdminAuth,
  async (req: AdminRequest, res): Promise<void> => {
    const params = SlugParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateContentPageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid content page",
      });
      return;
    }

    const [updated] = await db
      .update(appContentPagesTable)
      .set({
        title: parsed.data.title,
        subtitle: parsed.data.subtitle?.trim() || null,
        content: parsed.data.content,
        isActive: parsed.data.isActive,
        updatedBy: req.adminUser?.sub ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(appContentPagesTable.slug, params.data.slug))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Content page not found" });
      return;
    }

    res.json(updated);
  },
);

export default router;
