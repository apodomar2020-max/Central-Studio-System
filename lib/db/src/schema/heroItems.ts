import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const heroItemsTable = pgTable("hero_items", {
  id: serial("id").primaryKey(),
  imageUrl: text("image_url").notNull(),
  tagline: text("tagline"),
  title: text("title").notNull(),
  buttonText: text("button_text").notNull().default("Get Started"),
  buttonRoute: text("button_route").notNull().default("/(tabs)/classes"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
