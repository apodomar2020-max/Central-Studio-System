import { integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletPackagesTable } from "./balletPackages";
import { balletLevelsTable } from "./balletLevels";

/**
 * ballet_package_levels — join table: which levels a pricing package applies to.
 *
 * Many-to-many, replacing the old ballet_packages.level_ids integer array so
 * referential integrity is enforced by the database.
 *
 * level_id uses ON DELETE RESTRICT: a level referenced by a package cannot be
 * deleted, matching the ballet_class_levels / ballet_groups convention.
 */
export const balletPackageLevelsTable = pgTable(
  "ballet_package_levels",
  {
    id:        serial("id").primaryKey(),
    packageId: integer("package_id").notNull().references(() => balletPackagesTable.id, { onDelete: "cascade" }),
    levelId:   integer("level_id").notNull().references(() => balletLevelsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePackageLevel: uniqueIndex("ballet_package_levels_package_level_unique").on(table.packageId, table.levelId),
  }),
);

export const insertBalletPackageLevelSchema = createInsertSchema(balletPackageLevelsTable).omit({
  id: true, createdAt: true,
});

export type BalletPackageLevel = typeof balletPackageLevelsTable.$inferSelect;
export type InsertBalletPackageLevel = z.infer<typeof insertBalletPackageLevelSchema>;
