import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { packageOrdersTable } from "./packageOrders";
import { studentsTable } from "./students";

export const promotionRulesConfigSchema = z.object({
  verifiedStudentOnly: z.boolean().optional(),
  firstPackagePurchaseOnly: z.boolean().optional(),
  minimumBasketAmount: z.number().nonnegative().optional(),
  packageIds: z.array(z.number().int().positive()).optional(),
  branches: z.array(z.string().trim().min(1)).optional(),
  maxGlobalUses: z.number().int().positive().optional(),
  maxUsesPerUser: z.number().int().positive().optional(),
}).strict();

export type PromotionRulesConfig = z.infer<typeof promotionRulesConfigSchema>;

export const promotionsTable = pgTable("promotions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("automatic"),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: real("discount_value").notNull().default(0),
  priority: integer("priority").notNull().default(0),
  isExclusive: boolean("is_exclusive").notNull().default(false),
  isStackable: boolean("is_stackable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  startDate: timestamp("start_date", { withTimezone: true, mode: "string" }),
  endDate: timestamp("end_date", { withTimezone: true, mode: "string" }),
  rulesConfig: jsonb("rules_config").$type<PromotionRulesConfig>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const promotionCodesTable = pgTable(
  "promotion_codes",
  {
    id: serial("id").primaryKey(),
    promotionId: integer("promotion_id").notNull().references(() => promotionsTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    maxUses: integer("max_uses"),
    usesPerUser: integer("uses_per_user"),
    currentUses: integer("current_uses").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueCode: uniqueIndex("promotion_codes_code_unique").on(table.code),
  }),
);

export const promotionRedemptionsTable = pgTable("promotion_redemptions", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => promotionsTable.id, { onDelete: "restrict" }),
  promotionCodeId: integer("promotion_code_id").references(() => promotionCodesTable.id, { onDelete: "set null" }),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  packageOrderId: integer("package_order_id").references(() => packageOrdersTable.id, { onDelete: "set null" }),
  discountAmount: real("discount_amount").notNull().default(0),
  originalSubtotal: real("original_subtotal").notNull().default(0),
  finalSubtotal: real("final_subtotal").notNull().default(0),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
});

export const promotionAuditLogsTable = pgTable("promotion_audit_logs", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").references(() => promotionsTable.id, { onDelete: "set null" }),
  actorAdminId: integer("actor_admin_id"),
  action: text("action").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const insertPromotionSchema = createInsertSchema(promotionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPromotionCodeSchema = createInsertSchema(promotionCodesTable).omit({ id: true, createdAt: true, updatedAt: true, currentUses: true });

export type Promotion = typeof promotionsTable.$inferSelect;
export type PromotionCode = typeof promotionCodesTable.$inferSelect;
export type PromotionRedemption = typeof promotionRedemptionsTable.$inferSelect;
export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
