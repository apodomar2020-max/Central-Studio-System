import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type Request } from "express";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  insertPromotionSchema,
  promotionCodesTable,
  promotionRedemptionsTable,
  promotionRulesConfigSchema,
  promotionsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import {
  createPromotionRedemptions,
  resolvePackagePromotionContext,
  validatePackagePromotion,
  writePromotionAuditLog,
} from "../lib/promotionService";

const router: IRouter = Router();

const PromotionBody = insertPromotionSchema.extend({
  rulesConfig: promotionRulesConfigSchema.default({}),
  code: z.string().trim().min(3).optional().or(z.literal("")),
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  usesPerUser: z.coerce.number().int().positive().nullable().optional(),
}).superRefine((value, ctx) => {
  if (!["automatic", "manual"].includes(value.type)) {
    ctx.addIssue({ code: "custom", path: ["type"], message: "Promotion type must be automatic or manual." });
  }
  if (!["percentage", "fixed_amount"].includes(value.discountType)) {
    ctx.addIssue({ code: "custom", path: ["discountType"], message: "Discount type must be percentage or fixed_amount." });
  }
  if (value.discountType === "percentage" && value.discountValue > 100) {
    ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discounts cannot exceed 100." });
  }
  if (value.type === "manual" && !value.code?.trim()) {
    ctx.addIssue({ code: "custom", path: ["code"], message: "Manual promotions require a promo code." });
  }
});

const PromotionParams = z.object({ id: z.coerce.number().int().positive() });
const ValidatePromotionBody = z.object({
  packageId: z.coerce.number().int().positive(),
  promoCode: z.string().trim().optional().nullable(),
});
type StudentRequest = Request & { studentId?: number };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

async function promotionResponse(row: typeof promotionsTable.$inferSelect) {
  const codes = await db
    .select()
    .from(promotionCodesTable)
    .where(eq(promotionCodesTable.promotionId, row.id));
  const codesWithUsage = await Promise.all(codes.map(async (code) => {
    const [usage] = await db
      .select({ total: count() })
      .from(promotionRedemptionsTable)
      .where(eq(promotionRedemptionsTable.promotionCodeId, code.id));
    return { ...code, currentUses: usage?.total ?? 0 };
  }));
  return { ...row, codes: codesWithUsage };
}

router.get("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "view"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt));
  const withCodes = await Promise.all(rows.map((row) => promotionResponse(row)));
  res.json(withCodes);
});

router.post("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = PromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { code, maxUses, usesPerUser, ...promotionData } = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [promotion] = await tx.insert(promotionsTable).values(promotionData).returning();
    if (promotion.type === "manual" && code) {
      await tx.insert(promotionCodesTable).values({
        promotionId: promotion.id,
        code: normalizeCode(code),
        maxUses: maxUses ?? null,
        usesPerUser: usesPerUser ?? null,
      });
    }
    return promotion;
  });
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.created",
    metadata: { name: row.name, type: row.type },
  });
  res.status(201).json(await promotionResponse(row));
});

router.patch("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = PromotionBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, maxUses, usesPerUser, ...promotionData } = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [updated] = Object.keys(promotionData).length > 0
      ? await tx
        .update(promotionsTable)
        .set(promotionData)
        .where(eq(promotionsTable.id, params.data.id))
        .returning()
      : await tx
        .select()
        .from(promotionsTable)
        .where(eq(promotionsTable.id, params.data.id))
        .limit(1);
    if (!updated) return null;
    if (code?.trim()) {
      await tx
        .insert(promotionCodesTable)
        .values({
          promotionId: updated.id,
          code: normalizeCode(code),
          maxUses: maxUses ?? null,
          usesPerUser: usesPerUser ?? null,
        })
        .onConflictDoUpdate({
          target: promotionCodesTable.code,
          set: {
            promotionId: updated.id,
            maxUses: maxUses ?? null,
            usesPerUser: usesPerUser ?? null,
          },
        });
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.updated",
    metadata: { fields: Object.keys(req.body ?? {}) },
  });
  res.json(await promotionResponse(row));
});

router.delete("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(promotionsTable)
    .set({ isActive: false })
    .where(eq(promotionsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.deactivated",
    metadata: { name: row.name },
  });
  res.sendStatus(204);
});

router.post("/promotions/validate", requireStudentAuth, requireVerifiedStudent, async (req: StudentRequest, res): Promise<void> => {
  const parsed = ValidatePromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const context = await resolvePackagePromotionContext(req.studentId!, parsed.data.packageId);
  if (!context) {
    res.status(404).json({ error: "Active package not found." });
    return;
  }
  const result = await validatePackagePromotion(context, parsed.data.promoCode);
  res.json({
    eligible: result.eligible,
    reason: result.reason,
    originalSubtotal: result.originalSubtotal,
    discountAmount: result.discountAmount,
    finalSubtotal: result.finalSubtotal,
    promotion: result.promotion,
    promotionCode: result.promotionCode,
  });
});

export { createPromotionRedemptions, resolvePackagePromotionContext, validatePackagePromotion };
export default router;
