import { boolean, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studentsTable = pgTable("students", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  notes: text("notes"),
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").notNull().default(false),
  totalBookings: integer("total_bookings").notNull().default(0),
  // Opaque token embedded in the student's QR code.
  // Never put PII in the QR — this UUID is the only identifier.
  // Auto-generated on creation and never changes.
  qrToken: uuid("qr_token").notNull().defaultRandom().unique(),
  joinedAt: timestamp("joined_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

// qrToken is excluded from the insert schema — it is always auto-generated
// and must never be set or overridden via the API.
export const insertStudentSchema = createInsertSchema(studentsTable).omit({ id: true, qrToken: true, createdAt: true, updatedAt: true });
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
