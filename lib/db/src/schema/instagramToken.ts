import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

export const instagramToken = pgTable("instagram_token", {
  id:          integer("id").primaryKey().default(1),
  accessToken: text("access_token").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
});
