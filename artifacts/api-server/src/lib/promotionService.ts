import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  classesTable,
  packageOrdersTable,
  pricePackagesTable,
  promotionAuditLogsTable,
  promotionCodesTable,
  promotionRedemptionsTable,
  promotionRulesConfigSchema,
  promotionsTable,
  schedulesTable,
  studentsTable,
  type Promotion,
  type PromotionCode,
  type PromotionRulesConfig,
} from "@workspace/db";

import { DbClient } from "./dbTypes";
import { resolveSingleClassPriceEgp } from "./singleClassPricing";

type StudentForPromotion = Pick<typeof studentsTable.$inferSelect, "id" | "emailVerified">;
type PackageForPromotion = Pick<typeof pricePackagesTable.$inferSelect, "id" | "name" | "priceEgp" | "isActive">;

export type CheckoutContext = {
  student: StudentForPromotion;
  basket?: {
    items?: Array<{ type: "package" | "booking"; id: number; amount: number }>;
  };
  subtotal: number;
  branch?: string | null;
  package?: PackageForPromotion;
  booking?: { id?: number | null; classId?: number | null; scheduleId?: number | null };
  paymentMethod?: string | null;
  verified?: boolean;
};

type Candidate = {
  promotion: Promotion;
  code?: PromotionCode | null;
  discountAmount: number;
  finalSubtotal: number;
};

export type PromotionValidationResult = {
  eligible: boolean;
  reason: string | null;
  originalSubtotal: number;
  discountAmount: number;
  finalSubtotal: number;
  promotion: { id: number; name: string } | null;
  promotionCode: string | null;
  appliedPromotionIds: number[];
};

type InternalValidationResult = PromotionValidationResult & {
  candidates: Candidate[];
};

type ValidationOptions = {
  lockRedemptionScope?: boolean;
};

function normalizePromoCode(code?: string | null): string | null {
  const trimmed = code?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function nowMs(): number {
  return Date.now();
}

function parseDateMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateDiscount(promotion: Promotion, subtotal: number): number {
  const raw = promotion.discountType === "percentage"
    ? subtotal * (promotion.discountValue / 100)
    : promotion.discountValue;
  return roundMoney(Math.max(0, Math.min(subtotal, raw)));
}

async function countRedemptions(
  client: DbClient,
  promotionId: number,
  studentId?: number,
  promotionCodeId?: number | null,
): Promise<number> {
  const conditions = [eq(promotionRedemptionsTable.promotionId, promotionId)];
  if (studentId != null) conditions.push(eq(promotionRedemptionsTable.studentId, studentId));
  if (promotionCodeId != null) conditions.push(eq(promotionRedemptionsTable.promotionCodeId, promotionCodeId));
  const [row] = await client
    .select({ total: count() })
    .from(promotionRedemptionsTable)
    .where(and(...conditions));
  return row?.total ?? 0;
}

async function evaluateCandidate(
  client: DbClient,
  context: CheckoutContext,
  promotion: Promotion,
  code?: PromotionCode | null,
): Promise<{ eligible: true; candidate: Candidate } | { eligible: false; reason: string }> {
  const parsedRules = promotionRulesConfigSchema.safeParse(promotion.rulesConfig ?? {});
  if (!parsedRules.success) return { eligible: false, reason: "Promotion rules are invalid." };
  const rules: PromotionRulesConfig = parsedRules.data;
  const current = nowMs();
  const starts = parseDateMs(promotion.startDate);
  const ends = parseDateMs(promotion.endDate);

  if (!promotion.isActive) return { eligible: false, reason: "Promotion is inactive." };
  if (starts != null && current < starts) return { eligible: false, reason: "Promotion has not started yet." };
  if (ends != null && current > ends) return { eligible: false, reason: "Promotion has expired." };
  if (promotion.discountValue <= 0) return { eligible: false, reason: "Promotion has no discount configured." };

  if (rules.verifiedStudentOnly && !(context.verified ?? context.student.emailVerified)) {
    return { eligible: false, reason: "Only verified accounts can use this promotion." };
  }
  if (rules.minimumBasketAmount != null && context.subtotal < rules.minimumBasketAmount) {
    return { eligible: false, reason: `Minimum basket amount is EGP ${rules.minimumBasketAmount}.` };
  }
  if (Array.isArray(rules.packageIds) && rules.packageIds.length > 0 && !context.package?.id) {
    return { eligible: false, reason: "Promotion is only available for selected packages." };
  }
  if (Array.isArray(rules.packageIds) && rules.packageIds.length > 0 && context.package && !rules.packageIds.includes(context.package.id)) {
    return { eligible: false, reason: "Promotion is not available for this package." };
  }
  if (Array.isArray(rules.branches) && rules.branches.length > 0) {
    const branch = context.branch?.trim().toLowerCase();
    const allowed = rules.branches.map((item) => item.trim().toLowerCase());
    if (!branch || !allowed.includes(branch)) {
      return { eligible: false, reason: "Promotion is not available for this branch." };
    }
  }
  if (rules.firstPackagePurchaseOnly && !context.package) {
    return { eligible: false, reason: "Promotion is only available for package purchases." };
  }
  if (rules.firstPackagePurchaseOnly) {
    const [existing] = await client
      .select({ total: count() })
      .from(packageOrdersTable)
      .where(and(
        eq(packageOrdersTable.studentId, context.student.id),
        sql`${packageOrdersTable.status} <> 'cancelled'`,
      ));
    if ((existing?.total ?? 0) > 0) {
      return { eligible: false, reason: "Promotion is only available for your first package purchase." };
    }
  }
  if (rules.maxGlobalUses != null) {
    const total = await countRedemptions(client, promotion.id);
    if (total >= rules.maxGlobalUses) return { eligible: false, reason: "Promotion usage limit has been reached." };
  }
  if (rules.maxUsesPerUser != null) {
    const total = await countRedemptions(client, promotion.id, context.student.id);
    if (total >= rules.maxUsesPerUser) return { eligible: false, reason: "You have already used this promotion." };
  }
  if (code) {
    if (code.maxUses != null) {
      const totalCodeUses = await countRedemptions(client, promotion.id, undefined, code.id);
      if (totalCodeUses >= code.maxUses) {
        return { eligible: false, reason: "Promo code usage limit has been reached." };
      }
    }
    if (code.usesPerUser != null) {
      const usedByStudent = await countRedemptions(client, promotion.id, context.student.id, code.id);
      if (usedByStudent >= code.usesPerUser) {
        return { eligible: false, reason: "You have already used this promo code." };
      }
    }
  }

  const discountAmount = calculateDiscount(promotion, context.subtotal);
  return {
    eligible: true,
    candidate: {
      promotion,
      code,
      discountAmount,
      finalSubtotal: roundMoney(context.subtotal - discountAmount),
    },
  };
}

async function lockPromotionRedemptionScope(
  client: DbClient,
  context: CheckoutContext,
  promotions: Promotion[],
  code?: PromotionCode | null,
): Promise<void> {
  const promotionIds = [...new Set(promotions.map((promotion) => promotion.id))].sort((a, b) => a - b);
  const codeIds = code ? [code.id] : [];

  for (const promotionId of promotionIds) {
    await client.execute(sql`select pg_advisory_xact_lock(918201, ${promotionId})`);
  }
  for (const codeId of codeIds) {
    await client.execute(sql`select pg_advisory_xact_lock(918202, ${codeId})`);
  }
  await client.execute(sql`select pg_advisory_xact_lock(918203, ${context.student.id})`);
}

function combineCandidates(context: CheckoutContext, candidates: Candidate[]): InternalValidationResult {
  if (candidates.length === 0) {
    return {
      eligible: false,
      reason: "No eligible promotion found.",
      originalSubtotal: context.subtotal,
      discountAmount: 0,
      finalSubtotal: context.subtotal,
      promotion: null,
      promotionCode: null,
      appliedPromotionIds: [],
      candidates: [],
    };
  }

  const allStackable = candidates.every((candidate) => candidate.promotion.isStackable);
  const selected = allStackable
    ? candidates
    : [candidates.sort((a, b) => b.discountAmount - a.discountAmount || b.promotion.priority - a.promotion.priority)[0]];
  const discountAmount = roundMoney(Math.min(context.subtotal, selected.reduce((sum, item) => sum + item.discountAmount, 0)));
  const primary = selected[0];

  return {
    eligible: true,
    reason: null,
    originalSubtotal: context.subtotal,
    discountAmount,
    finalSubtotal: roundMoney(context.subtotal - discountAmount),
    promotion: primary ? { id: primary.promotion.id, name: selected.length > 1 ? `${primary.promotion.name} + ${selected.length - 1} more` : primary.promotion.name } : null,
    promotionCode: selected.find((item) => item.code)?.code?.code ?? null,
    appliedPromotionIds: selected.map((item) => item.promotion.id),
    candidates: selected,
  };
}

export async function resolvePackagePromotionContext(studentId: number, packageId: number): Promise<CheckoutContext | null> {
  const [[student], [packageDefinition]] = await Promise.all([
    db
      .select({ id: studentsTable.id, emailVerified: studentsTable.emailVerified })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId))
      .limit(1),
    db
      .select({ id: pricePackagesTable.id, name: pricePackagesTable.name, priceEgp: pricePackagesTable.priceEgp, isActive: pricePackagesTable.isActive })
      .from(pricePackagesTable)
      .where(eq(pricePackagesTable.id, packageId))
      .limit(1),
  ]);
  if (!student || !packageDefinition || !packageDefinition.isActive) return null;
  return {
    student,
    package: packageDefinition,
    basket: { items: [{ type: "package", id: packageDefinition.id, amount: roundMoney(packageDefinition.priceEgp) }] },
    subtotal: roundMoney(packageDefinition.priceEgp),
    verified: student.emailVerified,
  };
}

/**
 * Resolves the same server-owned class price and branch used by booking
 * creation. Promo validation never accepts a subtotal or branch from the app.
 */
export async function resolveClassPromotionContext(studentId: number, scheduleId: number): Promise<CheckoutContext | null> {
  const [[student], [schedule]] = await Promise.all([
    db
      .select({ id: studentsTable.id, emailVerified: studentsTable.emailVerified })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId))
      .limit(1),
    db
      .select({
        id: schedulesTable.id,
        classId: schedulesTable.classId,
        status: schedulesTable.status,
        location: schedulesTable.location,
        classActive: classesTable.isActive,
      })
      .from(schedulesTable)
      .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
      .where(eq(schedulesTable.id, scheduleId))
      .limit(1),
  ]);
  if (!student || !schedule || schedule.status !== "active" || !schedule.classActive) return null;

  const subtotal = roundMoney(await resolveSingleClassPriceEgp(db, {
    scheduleId: schedule.id,
    classId: schedule.classId,
  }));
  return {
    student,
    booking: { classId: schedule.classId, scheduleId: schedule.id },
    basket: { items: [{ type: "booking", id: schedule.classId, amount: subtotal }] },
    subtotal,
    branch: schedule.location,
    verified: student.emailVerified,
  };
}

export async function validateCheckoutPromotion(
  context: CheckoutContext,
  promoCode?: string | null,
  client: DbClient = db,
  options: ValidationOptions = {},
): Promise<InternalValidationResult> {
  const normalizedCode = normalizePromoCode(promoCode);
  const automaticRows = await client
    .select()
    .from(promotionsTable)
    .where(eq(promotionsTable.type, "automatic"))
    .orderBy(desc(promotionsTable.priority), desc(promotionsTable.createdAt));

  let manualPair: { promotion: Promotion; code: PromotionCode } | null = null;
  if (normalizedCode) {
    const [row] = await client
      .select({ promotion: promotionsTable, code: promotionCodesTable })
      .from(promotionCodesTable)
      .innerJoin(promotionsTable, eq(promotionCodesTable.promotionId, promotionsTable.id))
      .where(eq(promotionCodesTable.code, normalizedCode))
      .limit(1);
    if (!row) {
      return {
        eligible: false,
        reason: "Promo code was not found.",
        originalSubtotal: context.subtotal,
        discountAmount: 0,
        finalSubtotal: context.subtotal,
        promotion: null,
        promotionCode: normalizedCode,
        appliedPromotionIds: [],
        candidates: [],
      };
    }
    manualPair = row;
  }

  if (options.lockRedemptionScope) {
    await lockPromotionRedemptionScope(
      client,
      context,
      manualPair ? [...automaticRows, manualPair.promotion] : automaticRows,
      manualPair?.code ?? null,
    );
  }

  const candidates: Candidate[] = [];
  let lastReason = normalizedCode ? "Promo code is not eligible." : "No eligible promotion found.";

  for (const promotion of automaticRows) {
    const result = await evaluateCandidate(client, context, promotion, null);
    if (result.eligible) candidates.push(result.candidate);
    else lastReason = result.reason;
  }
  if (manualPair) {
    const result = await evaluateCandidate(client, context, manualPair.promotion, manualPair.code);
    if (!result.eligible) {
      return {
        eligible: false,
        reason: result.reason,
        originalSubtotal: context.subtotal,
        discountAmount: 0,
        finalSubtotal: context.subtotal,
        promotion: null,
        promotionCode: normalizedCode,
        appliedPromotionIds: [],
        candidates: [],
      };
    }
    candidates.push(result.candidate);
  }

  const combined = combineCandidates(context, candidates);
  return combined.eligible ? combined : { ...combined, reason: lastReason };
}

export const validatePackagePromotion = validateCheckoutPromotion;
export const validateClassPromotion = validateCheckoutPromotion;

export async function createPromotionRedemptions(
  client: DbClient,
  evaluation: InternalValidationResult,
  input: { studentId: number; packageOrderId?: number | null; bookingId?: number | null; metadata?: Record<string, unknown> },
): Promise<void> {
  if (!evaluation.eligible || evaluation.discountAmount <= 0) return;
  for (const candidate of evaluation.candidates) {
    const proportional = evaluation.discountAmount === candidate.discountAmount
      ? candidate.discountAmount
      : roundMoney(Math.min(candidate.discountAmount, evaluation.discountAmount));
    if (input.packageOrderId != null || input.bookingId != null) {
      const targetCondition = input.packageOrderId != null
        ? eq(promotionRedemptionsTable.packageOrderId, input.packageOrderId)
        : eq(promotionRedemptionsTable.bookingId, input.bookingId!);
      const [existing] = await client
        .select({ total: count() })
        .from(promotionRedemptionsTable)
        .where(and(
          eq(promotionRedemptionsTable.promotionId, candidate.promotion.id),
          targetCondition,
        ));
      if ((existing?.total ?? 0) > 0) continue;
    }
    await client.insert(promotionRedemptionsTable).values({
      promotionId: candidate.promotion.id,
      promotionCodeId: candidate.code?.id ?? null,
      studentId: input.studentId,
      bookingId: input.bookingId ?? null,
      packageOrderId: input.packageOrderId ?? null,
      discountAmount: proportional,
      originalSubtotal: evaluation.originalSubtotal,
      finalSubtotal: evaluation.finalSubtotal,
      metadata: input.metadata ?? null,
    });
    if (candidate.code) {
      await client
        .update(promotionCodesTable)
        .set({ currentUses: sql`${promotionCodesTable.currentUses} + 1` })
        .where(eq(promotionCodesTable.id, candidate.code.id));
    }
  }
}

export async function writePromotionAuditLog(input: {
  promotionId?: number | null;
  actorAdminId?: number | null;
  action: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(promotionAuditLogsTable).values({
    promotionId: input.promotionId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    action: input.action,
    metadata: input.metadata ?? null,
  });
}
