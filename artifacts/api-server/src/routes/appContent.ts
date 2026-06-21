import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  appContactLinksTable,
  appContentPagesTable,
  appFaqItemsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

const SlugParams = z.object({
  slug: z.string().min(1),
});

const IdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const ContactLinkType = z.enum([
  "whatsapp",
  "phone",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "website",
  "email",
]);

const UpdateContentPageBody = z.object({
  title: z.string().trim().min(1, "Title is required"),
  subtitle: z.string().trim().nullable().optional(),
  content: z.string().trim().min(1, "Content is required"),
  isActive: z.boolean(),
});

const UpsertFaqBody = z.object({
  question: z.string().trim().min(1, "Question is required"),
  answer: z.string().trim().min(1, "Answer is required"),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

const UpsertContactLinkBody = z.object({
  type: ContactLinkType,
  label: z.string().trim().min(1, "Label is required"),
  value: z.string().trim().min(1, "Value is required"),
  icon: z.string().trim().nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.get("/content/help-support", async (_req, res): Promise<void> => {
  const [[page], faqs, contacts] = await Promise.all([
    db
      .select()
      .from(appContentPagesTable)
      .where(eq(appContentPagesTable.slug, "help-support"))
      .limit(1),
    db
      .select()
      .from(appFaqItemsTable)
      .where(eq(appFaqItemsTable.isActive, true))
      .orderBy(asc(appFaqItemsTable.sortOrder), asc(appFaqItemsTable.id)),
    db
      .select()
      .from(appContactLinksTable)
      .where(eq(appContactLinksTable.isActive, true))
      .orderBy(asc(appContactLinksTable.sortOrder), asc(appContactLinksTable.id)),
  ]);

  if (!page || !page.isActive) {
    res.status(404).json({ error: "Content page not found" });
    return;
  }

  res.json({ page, faqs, contacts });
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
  requireAdminPermission("appContent", "view"),
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
  requireAdminPermission("appContent", "view"),
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
  requireAdminPermission("appContent", "edit"),
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

router.get(
  "/admin/content/faqs",
  requireAdminAuth,
  requireAdminPermission("appContent", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(appFaqItemsTable)
      .orderBy(asc(appFaqItemsTable.sortOrder), asc(appFaqItemsTable.id));
    res.json(rows);
  },
);

router.post(
  "/admin/content/faqs",
  requireAdminAuth,
  requireAdminPermission("appContent", "create"),
  async (req, res): Promise<void> => {
    const parsed = UpsertFaqBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid FAQ item" });
      return;
    }

    const [created] = await db
      .insert(appFaqItemsTable)
      .values(parsed.data)
      .returning();

    res.status(201).json(created);
  },
);

router.patch(
  "/admin/content/faqs/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "edit"),
  async (req, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpsertFaqBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid FAQ item" });
      return;
    }

    const [updated] = await db
      .update(appFaqItemsTable)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(appFaqItemsTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "FAQ item not found" });
      return;
    }

    res.json(updated);
  },
);

router.delete(
  "/admin/content/faqs/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "delete"),
  async (req, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [updated] = await db
      .update(appFaqItemsTable)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(appFaqItemsTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "FAQ item not found" });
      return;
    }

    res.json({ success: true });
  },
);

router.get(
  "/admin/content/contact-links",
  requireAdminAuth,
  requireAdminPermission("appContent", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(appContactLinksTable)
      .orderBy(asc(appContactLinksTable.sortOrder), asc(appContactLinksTable.id));
    res.json(rows);
  },
);

router.post(
  "/admin/content/contact-links",
  requireAdminAuth,
  requireAdminPermission("appContent", "create"),
  async (req, res): Promise<void> => {
    const parsed = UpsertContactLinkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid contact link" });
      return;
    }

    const [created] = await db
      .insert(appContactLinksTable)
      .values({
        ...parsed.data,
        icon: parsed.data.icon?.trim() || null,
      })
      .returning();

    res.status(201).json(created);
  },
);

router.patch(
  "/admin/content/contact-links/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "edit"),
  async (req, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpsertContactLinkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid contact link" });
      return;
    }

    const [updated] = await db
      .update(appContactLinksTable)
      .set({
        ...parsed.data,
        icon: parsed.data.icon?.trim() || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(appContactLinksTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Contact link not found" });
      return;
    }

    res.json(updated);
  },
);

router.delete(
  "/admin/content/contact-links/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "delete"),
  async (req, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [updated] = await db
      .update(appContactLinksTable)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(appContactLinksTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Contact link not found" });
      return;
    }

    res.json({ success: true });
  },
);

export default router;
