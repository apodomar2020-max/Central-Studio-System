import { index, integer, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { danceTypesTable } from "./danceTypes";
import { pricePackagesTable } from "./pricePackages";

/**
 * Canonical Studio package dance-style restrictions.
 * Zero rows for a package means unrestricted.
 */
export const pricePackageDanceTypesTable = pgTable("price_package_dance_types", {
  packageId: integer("package_id")
    .notNull()
    .references(() => pricePackagesTable.id, { onDelete: "cascade" }),
  danceTypeId: integer("dance_type_id")
    .notNull()
    .references(() => danceTypesTable.id, { onDelete: "restrict" }),
}, (table) => [
  primaryKey({
    name: "price_package_dance_types_package_id_dance_type_id_pk",
    columns: [table.packageId, table.danceTypeId],
  }),
  index("price_package_dance_types_dance_type_id_idx").on(table.danceTypeId),
]);

export type PricePackageDanceType = typeof pricePackageDanceTypesTable.$inferSelect;
export type InsertPricePackageDanceType = typeof pricePackageDanceTypesTable.$inferInsert;
