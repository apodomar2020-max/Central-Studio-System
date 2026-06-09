import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One-time verification codes for email confirmation.
 *
 * Flow:
 *  1. POST /api/auth/send-email-otp  → insert row here, send code to student's email
 *  2. POST /api/auth/verify-email-otp → look up unexpired row, mark used, mark student verified
 *
 * Old / expired rows can be safely cleaned up by a maintenance job; they are
 * ignored during lookup but never automatically deleted here.
 */
export const emailOtpsTable = pgTable("email_otps", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),                         // 6-digit string
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type EmailOtp = typeof emailOtpsTable.$inferSelect;
