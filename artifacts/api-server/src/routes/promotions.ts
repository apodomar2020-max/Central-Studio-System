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
  resolveClassPromotionContext,
  resolvePackagePromotionContext,
  validateClassPromotion,
  validatePackagePromotion,
  writePromotionAuditLog,
} from "../lib/promotionService";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();

const PromotionBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  type: z.enum(["automatic", "manual"]).default("automatic"),
  discountType: z.enum(["percentage", "fixed_amount"]).default("percentage"),
  discountValue: z.coerce.number().nonnegative().default(0),
  priority: z.coerce.number().int().default(0),
  isExclusive: z.boolean().default(false),
  isStackable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  rulesConfig: z.object({
    verifiedStudentOnly: z.boolean().optional(),
    firstPackagePurchaseOnly: z.boolean().optional(),
    minimumBasketAmount: z.number().nonnegative().optional(),
    packageIds: z.array(z.number().int().positive()).optional(),
    branches: z.array(z.string().trim().min(1)).optional(),
    maxGlobalUses: z.number().int().positive().optional(),
    maxUsesPerUser: z.number().int().positive().optional(),
  }).strict().default({}),
  code: z.string().trim().optional(),
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  usesPerUser: z.coerce.number().int().positive().nullable().optional(),
});

function validatePromotionData(value: z.infer<typeof PromotionBodySchema>): string | null {
  const type = value.type ?? "automatic";
  const discountType = value.discountType ?? "percentage";
  const discountValue = value.discountValue ?? 0;

  if (!["automatic", "manual"].includes(type)) {
    return "Promotion type must be automatic or manual.";
  }
  if (!["percentage", "fixed_amount"].includes(discountType)) {
    return "Discount type must be percentage or fixed_amount.";
  }
  if (discountType === "percentage" && discountValue > 100) {
    return "Percentage discounts cannot exceed 100.";
  }
  if (type === "manual" && (!value.code || !value.code.trim())) {
    return "Manual promotions require a promo code.";
  }
  if (type === "manual" && value.code && value.code.trim().length < 3) {
    return "Promo code must be at least 3 characters.";
  }
  return null;
}

const PromotionParams = z.object({ id: z.coerce.number().int().positive() });
const ValidatePromotionBody = z.object({
  packageId: z.coerce.number().int().positive().optional(),
  scheduleId: z.coerce.number().int().positive().optional(),
  promoCode: z.string().trim().min(1).optional().nullable(),
}).superRefine((value, ctx) => {
  const contextCount = Number(value.packageId != null) + Number(value.scheduleId != null);
  if (contextCount !== 1) {
    ctx.addIssue({
      code: "custom",
      message: "Choose exactly one package or class schedule.",
      path: ["context"],
    });
  }
});
type StudentRequest = Request & { studentId?: number };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PROMOTION_ACTIVITY_FIELDS = [
  "name",
  "description",
  "type",
  "discountType",
  "discountValue",
  "priority",
  "isExclusive",
  "isStackable",
  "isActive",
  "startDate",
  "endDate",
  "rulesConfig",
] as const;

const PROMOTION_CODE_ACTIVITY_FIELDS = ["promotionId", "maxUses", "usesPerUser"] as const;

function promotionActivitySnapshot(row: typeof promotionsTable.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    type: row.type,
    discountType: row.discountType,
    discountValue: row.discountValue,
    priority: row.priority,
    isExclusive: row.isExclusive,
    isStackable: row.isStackable,
    isActive: row.isActive,
    startDate: row.startDate,
    endDate: row.endDate,
    rulesConfig: row.rulesConfig,
  };
}

function promotionCodeActivitySnapshot(row: Pick<typeof promotionCodesTable.$inferSelect, "promotionId" | "maxUses" | "usesPerUser">): Record<string, unknown> {
  return {
    promotionId: row.promotionId,
    maxUses: row.maxUses,
    usesPerUser: row.usesPerUser,
  };
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

// Phase 6B: Promotions endpoints use the dedicated `promotions` permission
// module. Roles holding only legacy offers.* grants keep access via the
// module's `offers` legacy alias (see @workspace/api-zod permissions catalog)
// and migration 0043 which materializes promotions.* grants.
router.get("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "view"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt));
  const withCodes = await Promise.all(rows.map((row) => promotionResponse(row)));
  res.json(withCodes);
});

router.post("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = PromotionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const validationError = validatePromotionData(parsed.data);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const { code, maxUses, usesPerUser, ...promotionData } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [promotion] = await tx.insert(promotionsTable).values(promotionData).returning();
    let promotionCode: typeof promotionCodesTable.$inferSelect | null = null;
    if (promotion.type === "manual" && code) {
      const codeStr = code;
      const [insertedCode] = await tx.insert(promotionCodesTable).values({
        promotionId: promotion.id,
        code: normalizeCode(codeStr),
        maxUses: maxUses ?? null,
        usesPerUser: usesPerUser ?? null,
      }).returning();
      promotionCode = insertedCode ?? null;
    }
    return { promotion, promotionCode };
  });
  const row = result.promotion;
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.created",
    metadata: { name: row.name, type: row.type },
  });
  await logActivity(req, {
    action: "create",
    module: "promotions",
    entityType: "promotion",
    entityId: row.id,
    entityLabel: row.name,
    after: promotionActivitySnapshot(row),
    summary: `Created promotion ${row.name}`,
  });
  if (result.promotionCode) {
    await logActivity(req, {
      action: "create",
      module: "promotions",
      entityType: "promotion_code",
      entityId: result.promotionCode.id,
      entityLabel: row.name,
      after: promotionCodeActivitySnapshot(result.promotionCode),
      summary: `Created promo code for promotion ${row.name}`,
    });
  }
  res.status(201).json(await promotionResponse(row));
});

router.patch("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = PromotionBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, maxUses, usesPerUser, ...promotionData } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [beforePromotion] = await tx
      .select()
      .from(promotionsTable)
      .where(eq(promotionsTable.id, params.data.id))
      .limit(1);
    if (!beforePromotion) return null;

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
    let beforeCode: typeof promotionCodesTable.$inferSelect | null = null;
    let afterCode: typeof promotionCodesTable.$inferSelect | null = null;
    if (code && code.trim()) {
      const codeStr = code;
      const normalizedCode = normalizeCode(codeStr);
      [beforeCode] = await tx
        .select()
        .from(promotionCodesTable)
        .where(eq(promotionCodesTable.code, normalizedCode))
        .limit(1);
      const [upsertedCode] = await tx
        .insert(promotionCodesTable)
        .values({
          promotionId: updated.id,
          code: normalizedCode,
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
        })
        .returning();
      afterCode = upsertedCode ?? null;
    }
    return { beforePromotion, updated, beforeCode, afterCode };
  });
  if (!result) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  const row = result.updated;
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.updated",
    metadata: { fields: Object.keys(req.body ?? {}) },
  });
  const promotionDiff = diffFields(
    promotionActivitySnapshot(result.beforePromotion),
    promotionActivitySnapshot(row),
    PROMOTION_ACTIVITY_FIELDS,
  );
  const promotionChangedKeys = Object.keys(promotionDiff.after);
  if (promotionChangedKeys.length > 0) {
    const deactivated = result.beforePromotion.isActive === true && row.isActive === false;
    const activated = result.beforePromotion.isActive === false && row.isActive === true;
    await logActivity(req, {
      action: deactivated ? "deactivate" : activated ? "activate" : "update",
      module: "promotions",
      entityType: "promotion",
      entityId: row.id,
      entityLabel: row.name,
      before: promotionDiff.before,
      after: promotionDiff.after,
      summary: deactivated
        ? `Deactivated promotion ${row.name}`
        : activated
          ? `Activated promotion ${row.name}`
          : `Updated promotion ${row.name}: ${promotionChangedKeys.join(", ")}`,
    });
  }
  if (result.afterCode) {
    const codeAction = result.beforeCode ? "update" : "create";
    const codeDiff = result.beforeCode
      ? diffFields(
        promotionCodeActivitySnapshot(result.beforeCode),
        promotionCodeActivitySnapshot(result.afterCode),
        PROMOTION_CODE_ACTIVITY_FIELDS,
      )
      : { before: {}, after: promotionCodeActivitySnapshot(result.afterCode) };
    if (Object.keys(codeDiff.after).length > 0) {
      await logActivity(req, {
        action: codeAction,
        module: "promotions",
        entityType: "promotion_code",
        entityId: result.afterCode.id,
        entityLabel: row.name,
        before: Object.keys(codeDiff.before).length > 0 ? codeDiff.before : null,
        after: codeDiff.after,
        summary: `${codeAction === "create" ? "Created" : "Updated"} promo code for promotion ${row.name}`,
      });
    }
  }
  res.json(await promotionResponse(row));
});

router.delete("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(promotionsTable).where(eq(promotionsTable.id, params.data.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  const [row] = await db
    .update(promotionsTable)
    .set({ isActive: false })
    .where(eq(promotionsTable.id, params.data.id))
    .returning();
  await writePromotionAuditLog({
    promotionId: row.id,
    actorAdminId: req.adminUser?.id ?? null,
    action: "promotion.deactivated",
    metadata: { name: row.name },
  });
  if (existing.isActive !== row.isActive) {
    await logActivity(req, {
      action: "deactivate",
      module: "promotions",
      entityType: "promotion",
      entityId: row.id,
      entityLabel: row.name,
      before: { isActive: existing.isActive },
      after: { isActive: row.isActive },
      summary: `Deactivated promotion ${row.name}`,
    });
  }
  res.sendStatus(204);
});

router.post("/promotions/validate", requireStudentAuth, requireVerifiedStudent, async (req: StudentRequest, res): Promise<void> => {
  const parsed = ValidatePromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_promotion_context",
      message: "This promo code cannot be checked for the selected class or package.",
    });
    return;
  }
  const isClassBooking = parsed.data.scheduleId != null;
  const context = isClassBooking
    ? await resolveClassPromotionContext(req.studentId!, parsed.data.scheduleId!)
    : await resolvePackagePromotionContext(req.studentId!, parsed.data.packageId!);
  if (!context) {
    res.status(404).json({
      error: isClassBooking ? "Active class schedule not found." : "Active package not found.",
    });
    return;
  }
  const result = isClassBooking
    ? await validateClassPromotion(context, parsed.data.promoCode)
    : await validatePackagePromotion(context, parsed.data.promoCode);
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

export {
  createPromotionRedemptions,
  resolveClassPromotionContext,
  resolvePackagePromotionContext,
  validateClassPromotion,
  validatePackagePromotion,
};
export default router;
