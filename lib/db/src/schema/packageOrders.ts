import { boolean, check, date, index, integer, pgTable, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { childrenTable } from "./children";

export const packageOrdersTable = pgTable("package_orders", {
  id: serial("id").primaryKey(),
  studentName: text("student_name").notNull(),
  studentEmail: text("student_email").notNull(),
  studentPhone: text("student_phone"),
  // Membership Engine (Phase 3): the account-owner FK. Nullable — legacy rows
  // and any row created before this column existed only have studentEmail.
  // Read paths should match on `studentId = X OR normalized(studentEmail) = Y`
  // (see resolveMemberIdentity / membershipIdentity.ts), never studentId alone.
  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  // Phase A participant-owned entitlement foundation. Nullable as a complete
  // legacy shape only; new purchase behavior is intentionally deferred.
  participantType: text("participant_type"),
  participantChildId: integer("participant_child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  participantNameSnapshot: text("participant_name_snapshot"),
  participantDateOfBirthSnapshot: date("participant_date_of_birth_snapshot", { mode: "string" }),
  participantAgeAtPurchase: smallint("participant_age_at_purchase"),
  eligibilityEvaluatedOn: date("eligibility_evaluated_on", { mode: "string" }),
  packageAllowAllAgesSnapshot: boolean("package_allow_all_ages_snapshot"),
  packageMinAgeSnapshot: smallint("package_min_age_snapshot"),
  packageMaxAgeSnapshot: smallint("package_max_age_snapshot"),
  purchaseEligibilityConfigurationState: text("purchase_eligibility_configuration_state"),
  allowedDanceTypeIdsSnapshot: integer("allowed_dance_type_ids_snapshot").array(),
  packageId: integer("package_id"),
  packageName: text("package_name").notNull(),
  totalCredits: integer("total_credits").notNull(),
  remainingCredits: integer("remaining_credits").notNull(),
  purchaseUnitPriceMinor: integer("purchase_unit_price_minor"),
  priceSnapshotBasis: text("price_snapshot_basis"),
  status: text("status").notNull().default("pendingPayment"),
  notes: text("notes"),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  check("package_orders_participant_shape_check", sql`
    (${table.participantType} is null and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'self' and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'child' and ${table.participantChildId} is not null)
  `),
  check("package_orders_participant_age_snapshot_check", sql`
    ${table.participantAgeAtPurchase} is null or ${table.participantAgeAtPurchase} between 0 and 150
  `),
  check("package_orders_age_range_snapshot_check", sql`
    (${table.packageAllowAllAgesSnapshot} is null and ${table.packageMinAgeSnapshot} is null and ${table.packageMaxAgeSnapshot} is null)
    or (${table.packageAllowAllAgesSnapshot} = true and ${table.packageMinAgeSnapshot} is null and ${table.packageMaxAgeSnapshot} is null)
    or (
      ${table.packageAllowAllAgesSnapshot} = false
      and ${table.packageMinAgeSnapshot} is not null
      and ${table.packageMinAgeSnapshot} between 0 and 150
      and (
        ${table.packageMaxAgeSnapshot} is null
        or (${table.packageMaxAgeSnapshot} between 0 and 150 and ${table.packageMinAgeSnapshot} <= ${table.packageMaxAgeSnapshot})
      )
    )
  `),
  check("package_orders_purchase_eligibility_configuration_state_check", sql`
    ${table.purchaseEligibilityConfigurationState} is null
    or ${table.purchaseEligibilityConfigurationState} in ('configured', 'legacy_unconfigured')
  `),
  check("package_orders_price_snapshot_basis_check", sql`
    ${table.priceSnapshotBasis} is null
    or ${table.priceSnapshotBasis} in ('recorded_purchase_price', 'estimated_catalog_price', 'unknown')
  `),
  index("package_orders_owner_participant_status_idx")
    .on(table.studentId, table.participantType, table.participantChildId, table.status),
  index("package_orders_participant_child_status_idx")
    .on(table.participantChildId, table.status),
]));

export const insertPackageOrderSchema = createInsertSchema(packageOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPackageOrder = z.infer<typeof insertPackageOrderSchema>;
export type PackageOrder = typeof packageOrdersTable.$inferSelect;
