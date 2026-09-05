import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  appContactLinksTable,
  appContentPagesTable,
  appFaqCategoriesTable,
  appFaqItemsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const CONTENT_PAGE_ACTIVITY_FIELDS = ["title", "subtitle", "content", "isActive"] as const;
const FAQ_ACTIVITY_FIELDS = ["question", "answer", "sortOrder", "isActive", "categoryId"] as const;
const CONTACT_LINK_ACTIVITY_FIELDS = ["type", "label", "value", "icon", "sortOrder", "isActive"] as const;
const FAQ_CATEGORY_ACTIVITY_FIELDS = ["name", "sortOrder", "isActive"] as const;

/**
 * Shape a joined FAQ-item row (item columns + aliased `category*` columns
 * from a LEFT JOIN against app_faq_categories) into the response shape,
 * nesting the category into a `category` object — or `null` when there is
 * no matching category row (or, on the public endpoint, no *active*
 * category row; see the join condition at each call site).
 */
function shapeFaqItemCategory<T extends {
  categoryId: number | null;
  categoryName: string | null;
  categorySortOrder: number | null;
  categoryIsActive: boolean | null;
}>({ categoryId, categoryName, categorySortOrder, categoryIsActive, ...rest }: T) {
  return {
    ...rest,
    category: categoryId != null
      ? { id: categoryId, name: categoryName, sortOrder: categorySortOrder, isActive: categoryIsActive }
      : null,
  };
}

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
  // Nullable/optional — existing FAQs preserve category-less state by
  // default; not required to reference an *active* category (admins may
  // assign a FAQ to a category ahead of the category's own activation).
  categoryId: z.coerce.number().int().positive().nullish(),
});

const UpsertFaqCategoryBody = z.object({
  name: z.string().trim().min(1, "Name is required"),
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

router.get("/content/contact-links", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(appContactLinksTable)
    .where(eq(appContactLinksTable.isActive, true))
    .orderBy(asc(appContactLinksTable.sortOrder), asc(appContactLinksTable.id));

  res.json(rows);
});

router.get("/content/help-support", async (_req, res): Promise<void> => {
  const [[page], faqRows, contacts, faqCategories] = await Promise.all([
    db
      .select()
      .from(appContentPagesTable)
      .where(eq(appContentPagesTable.slug, "help-support"))
      .limit(1),
    // faqs stays flat, sorted exactly as today (sortOrder, id) — no reshape
    // into grouped/nested data. Category is a per-item join, additive only.
    // Only an *active* category is attached here (see the join condition
    // below) — a FAQ pointing at a deactivated category serializes
    // identically to a genuinely uncategorized one on this public endpoint.
    db
      .select({
        id: appFaqItemsTable.id,
        question: appFaqItemsTable.question,
        answer: appFaqItemsTable.answer,
        sortOrder: appFaqItemsTable.sortOrder,
        isActive: appFaqItemsTable.isActive,
        categoryId: appFaqCategoriesTable.id,
        categoryName: appFaqCategoriesTable.name,
        categorySortOrder: appFaqCategoriesTable.sortOrder,
        categoryIsActive: appFaqCategoriesTable.isActive,
      })
      .from(appFaqItemsTable)
      .leftJoin(
        appFaqCategoriesTable,
        and(eq(appFaqCategoriesTable.id, appFaqItemsTable.categoryId), eq(appFaqCategoriesTable.isActive, true)),
      )
      .where(eq(appFaqItemsTable.isActive, true))
      .orderBy(asc(appFaqItemsTable.sortOrder), asc(appFaqItemsTable.id)),
    db
      .select()
      .from(appContactLinksTable)
      .where(eq(appContactLinksTable.isActive, true))
      .orderBy(asc(appContactLinksTable.sortOrder), asc(appContactLinksTable.id)),
    db
      .select()
      .from(appFaqCategoriesTable)
      .where(eq(appFaqCategoriesTable.isActive, true))
      .orderBy(asc(appFaqCategoriesTable.sortOrder), asc(appFaqCategoriesTable.id)),
  ]);

  if (!page || !page.isActive) {
    res.status(404).json({ error: "Content page not found" });
    return;
  }

  res.json({ page, faqs: faqRows.map(shapeFaqItemCategory), contacts, faqCategories });
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

    const [existing] = await db.select().from(appContentPagesTable).where(eq(appContentPagesTable.slug, params.data.slug)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Content page not found" });
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

    const { before, after } = diffFields(
      Object.fromEntries(CONTENT_PAGE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(CONTENT_PAGE_ACTIVITY_FIELDS.map((key) => [key, updated[key]])),
      CONTENT_PAGE_ACTIVITY_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "update",
        module: "appContent",
        entityType: "content_page",
        entityId: updated.slug,
        entityLabel: updated.title,
        before,
        after,
        summary: `Updated content page ${updated.title}`,
      });
    }

    res.json(updated);
  },
);

/**
 * Confirm a submitted categoryId actually references an existing
 * app_faq_categories row before insert/update. Not required to be active —
 * admins may assign a FAQ to a category ahead of the category's own
 * activation (see UpsertFaqBody comment).
 */
async function findFaqCategoryOr404(res: import("express").Response, categoryId: number | null | undefined): Promise<boolean> {
  if (categoryId == null) return true;
  const [category] = await db.select().from(appFaqCategoriesTable).where(eq(appFaqCategoriesTable.id, categoryId)).limit(1);
  if (!category) {
    res.status(404).json({ error: "FAQ category not found" });
    return false;
  }
  return true;
}

/** Re-select a FAQ item joined to its true category assignment (regardless of the category's active state) for admin responses. */
async function selectAdminFaqItem(id: number) {
  const [row] = await db
    .select({
      id: appFaqItemsTable.id,
      question: appFaqItemsTable.question,
      answer: appFaqItemsTable.answer,
      sortOrder: appFaqItemsTable.sortOrder,
      isActive: appFaqItemsTable.isActive,
      createdAt: appFaqItemsTable.createdAt,
      updatedAt: appFaqItemsTable.updatedAt,
      categoryId: appFaqCategoriesTable.id,
      categoryName: appFaqCategoriesTable.name,
      categorySortOrder: appFaqCategoriesTable.sortOrder,
      categoryIsActive: appFaqCategoriesTable.isActive,
    })
    .from(appFaqItemsTable)
    .leftJoin(appFaqCategoriesTable, eq(appFaqCategoriesTable.id, appFaqItemsTable.categoryId))
    .where(eq(appFaqItemsTable.id, id))
    .limit(1);
  return row ? shapeFaqItemCategory(row) : null;
}

router.get(
  "/admin/content/faqs",
  requireAdminAuth,
  requireAdminPermission("appContent", "view"),
  async (_req, res): Promise<void> => {
    // Admin sees the true category assignment regardless of the category's
    // active state (unlike the public endpoint's join), so admins can see
    // and fix (or knowingly leave) a FAQ pointing at an inactive category.
    const rows = await db
      .select({
        id: appFaqItemsTable.id,
        question: appFaqItemsTable.question,
        answer: appFaqItemsTable.answer,
        sortOrder: appFaqItemsTable.sortOrder,
        isActive: appFaqItemsTable.isActive,
        createdAt: appFaqItemsTable.createdAt,
        updatedAt: appFaqItemsTable.updatedAt,
        categoryId: appFaqCategoriesTable.id,
        categoryName: appFaqCategoriesTable.name,
        categorySortOrder: appFaqCategoriesTable.sortOrder,
        categoryIsActive: appFaqCategoriesTable.isActive,
      })
      .from(appFaqItemsTable)
      .leftJoin(appFaqCategoriesTable, eq(appFaqCategoriesTable.id, appFaqItemsTable.categoryId))
      .orderBy(asc(appFaqItemsTable.sortOrder), asc(appFaqItemsTable.id));
    res.json(rows.map(shapeFaqItemCategory));
  },
);

router.post(
  "/admin/content/faqs",
  requireAdminAuth,
  requireAdminPermission("appContent", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpsertFaqBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid FAQ item" });
      return;
    }

    if (!(await findFaqCategoryOr404(res, parsed.data.categoryId))) return;

    const [created] = await db
      .insert(appFaqItemsTable)
      .values({ ...parsed.data, categoryId: parsed.data.categoryId ?? null })
      .returning();

    await logActivity(req, {
      action: "create",
      module: "appContent",
      entityType: "faq_item",
      entityId: created.id,
      entityLabel: created.question,
      after: Object.fromEntries(FAQ_ACTIVITY_FIELDS.map((key) => [key, created[key]])),
      summary: `Created FAQ item ${created.question}`,
    });
    res.status(201).json(await selectAdminFaqItem(created.id));
  },
);

router.patch(
  "/admin/content/faqs/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
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

    const [existing] = await db.select().from(appFaqItemsTable).where(eq(appFaqItemsTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "FAQ item not found" });
      return;
    }

    if (!(await findFaqCategoryOr404(res, parsed.data.categoryId))) return;

    const [updated] = await db
      .update(appFaqItemsTable)
      .set({ ...parsed.data, categoryId: parsed.data.categoryId ?? null, updatedAt: new Date().toISOString() })
      .where(eq(appFaqItemsTable.id, params.data.id))
      .returning();

    const { before, after } = diffFields(
      Object.fromEntries(FAQ_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(FAQ_ACTIVITY_FIELDS.map((key) => [key, updated[key]])),
      FAQ_ACTIVITY_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: existing.isActive !== updated.isActive ? updated.isActive ? "activate" : "deactivate" : "update",
        module: "appContent",
        entityType: "faq_item",
        entityId: updated.id,
        entityLabel: updated.question,
        before,
        after,
        summary: `Updated FAQ item ${updated.question}`,
      });
    }

    res.json(await selectAdminFaqItem(updated.id));
  },
);

router.delete(
  "/admin/content/faqs/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db.select().from(appFaqItemsTable).where(eq(appFaqItemsTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "FAQ item not found" });
      return;
    }
    const [updated] = await db
      .update(appFaqItemsTable)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(appFaqItemsTable.id, params.data.id))
      .returning();

    if (existing.isActive !== updated.isActive) {
      await logActivity(req, {
        action: "deactivate",
        module: "appContent",
        entityType: "faq_item",
        entityId: updated.id,
        entityLabel: updated.question,
        before: { isActive: existing.isActive },
        after: { isActive: updated.isActive },
        summary: `Deactivated FAQ item ${updated.question}`,
      });
    }

    res.json({ success: true });
  },
);

// ─── FAQ Categories — independently managed CMS entity referenced by ────────
// app_faq_items.category_id. Same appContent permission module/actions and
// same soft-delete (isActive=false) convention as every sibling entity in
// this file; never hard-deleted (see appFaqItems.ts categoryId comment).

/**
 * drizzle-orm's node-postgres driver wraps the underlying pg error in a
 * DrizzleQueryError whose own `.message` is just the failed SQL text (no
 * constraint name) — the real pg error (with `.message`/`.code`/
 * `.constraint`) lives on `.cause`. Check both so a duplicate-name 409 is
 * actually detected regardless of wrapping.
 */
function pgErrorText(err: unknown): string {
  const top = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return `${top} ${cause}`;
}

router.get(
  "/admin/content/faq-categories",
  requireAdminAuth,
  requireAdminPermission("appContent", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(appFaqCategoriesTable)
      .orderBy(asc(appFaqCategoriesTable.sortOrder), asc(appFaqCategoriesTable.id));
    res.json(rows);
  },
);

router.post(
  "/admin/content/faq-categories",
  requireAdminAuth,
  requireAdminPermission("appContent", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpsertFaqCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid FAQ category" });
      return;
    }

    try {
      const [created] = await db
        .insert(appFaqCategoriesTable)
        .values(parsed.data)
        .returning();

      await logActivity(req, {
        action: "create",
        module: "appContent",
        entityType: "faq_category",
        entityId: created.id,
        entityLabel: created.name,
        after: Object.fromEntries(FAQ_CATEGORY_ACTIVITY_FIELDS.map((key) => [key, created[key]])),
        summary: `Created FAQ category ${created.name}`,
      });
      res.status(201).json(created);
    } catch (err: unknown) {
      if (pgErrorText(err).includes("app_faq_categories_name_unique_ci")) {
        res.status(409).json({ error: `Category name "${parsed.data.name}" is already in use` });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/admin/content/faq-categories/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpsertFaqCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid FAQ category" });
      return;
    }

    const [existing] = await db.select().from(appFaqCategoriesTable).where(eq(appFaqCategoriesTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "FAQ category not found" });
      return;
    }

    try {
      const [updated] = await db
        .update(appFaqCategoriesTable)
        .set({ ...parsed.data, updatedAt: new Date().toISOString() })
        .where(eq(appFaqCategoriesTable.id, params.data.id))
        .returning();

      const { before, after } = diffFields(
        Object.fromEntries(FAQ_CATEGORY_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
        Object.fromEntries(FAQ_CATEGORY_ACTIVITY_FIELDS.map((key) => [key, updated[key]])),
        FAQ_CATEGORY_ACTIVITY_FIELDS,
      );
      if (Object.keys(after).length > 0) {
        await logActivity(req, {
          action: existing.isActive !== updated.isActive ? updated.isActive ? "activate" : "deactivate" : "update",
          module: "appContent",
          entityType: "faq_category",
          entityId: updated.id,
          entityLabel: updated.name,
          before,
          after,
          summary: `Updated FAQ category ${updated.name}`,
        });
      }

      res.json(updated);
    } catch (err: unknown) {
      if (pgErrorText(err).includes("app_faq_categories_name_unique_ci")) {
        res.status(409).json({ error: `Category name "${parsed.data.name}" is already in use` });
        return;
      }
      throw err;
    }
  },
);

// Soft-delete only — mirrors every sibling entity in this file. Categories
// are never hard-deleted (app_faq_items.category_id is ON DELETE RESTRICT);
// deactivating a category does not touch any app_faq_items row (see
// appFaqItems.ts / the public /content/help-support join for the read-time
// behavior this produces).
router.delete(
  "/admin/content/faq-categories/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db.select().from(appFaqCategoriesTable).where(eq(appFaqCategoriesTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "FAQ category not found" });
      return;
    }
    const [updated] = await db
      .update(appFaqCategoriesTable)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(appFaqCategoriesTable.id, params.data.id))
      .returning();

    if (existing.isActive !== updated.isActive) {
      await logActivity(req, {
        action: "deactivate",
        module: "appContent",
        entityType: "faq_category",
        entityId: updated.id,
        entityLabel: updated.name,
        before: { isActive: existing.isActive },
        after: { isActive: updated.isActive },
        summary: `Deactivated FAQ category ${updated.name}`,
      });
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
  async (req: AdminRequest, res): Promise<void> => {
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

    await logActivity(req, {
      action: "create",
      module: "appContent",
      entityType: "contact_link",
      entityId: created.id,
      entityLabel: created.label,
      after: Object.fromEntries(CONTACT_LINK_ACTIVITY_FIELDS.map((key) => [key, created[key]])),
      summary: `Created contact link ${created.label}`,
    });
    res.status(201).json(created);
  },
);

router.patch(
  "/admin/content/contact-links/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
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

    const [existing] = await db.select().from(appContactLinksTable).where(eq(appContactLinksTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Contact link not found" });
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

    const { before, after } = diffFields(
      Object.fromEntries(CONTACT_LINK_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(CONTACT_LINK_ACTIVITY_FIELDS.map((key) => [key, updated[key]])),
      CONTACT_LINK_ACTIVITY_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: existing.isActive !== updated.isActive ? updated.isActive ? "activate" : "deactivate" : "update",
        module: "appContent",
        entityType: "contact_link",
        entityId: updated.id,
        entityLabel: updated.label,
        before,
        after,
        summary: `Updated contact link ${updated.label}`,
      });
    }

    res.json(updated);
  },
);

router.delete(
  "/admin/content/contact-links/:id",
  requireAdminAuth,
  requireAdminPermission("appContent", "delete"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db.select().from(appContactLinksTable).where(eq(appContactLinksTable.id, params.data.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Contact link not found" });
      return;
    }
    const [updated] = await db
      .update(appContactLinksTable)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(appContactLinksTable.id, params.data.id))
      .returning();

    if (existing.isActive !== updated.isActive) {
      await logActivity(req, {
        action: "deactivate",
        module: "appContent",
        entityType: "contact_link",
        entityId: updated.id,
        entityLabel: updated.label,
        before: { isActive: existing.isActive },
        after: { isActive: updated.isActive },
        summary: `Deactivated contact link ${updated.label}`,
      });
    }

    res.json({ success: true });
  },
);

export default router;
