import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Hero is an image-only carousel (Task 1.1). Each slide is just an image plus an
// optional tap route; legacy content columns (title/tagline/button_text) were
// dropped in migration 0026_hero_image_only.
export const heroItemsTable = pgTable("hero_items", {
  id: serial("id").primaryKey(),
  imageUrl: text("image_url").notNull(),
  buttonRoute: text("button_route").notNull().default("/(tabs)/classes"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
