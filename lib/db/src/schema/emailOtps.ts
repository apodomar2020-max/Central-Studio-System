import { boolean, check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  // Nullable: social / email-first verification flows may issue an OTP keyed by
  // email before (or independently of) a known student row.
  studentId: integer("student_id"),
  email: text("email").notNull(),
  // Security-06B (CS-SEC-M-01): NOT the raw 6-digit code. Stores an
  // HMAC-SHA-256 digest of (purpose, normalized email, raw code) keyed by
  // the server-only OTP_PEPPER, formatted as `v1:<64 lowercase hex chars>`.
  // See artifacts/api-server/src/lib/otpDigest.ts for the canonical binding
  // and comparison logic. Enforced by email_otps_code_digest_format_check.
  code: text("code").notNull(),
  // What the code is for: "verify" (email verification) | "reset" (password reset).
  purpose: text("purpose").notNull().default("verify"),
  // Wrong-code attempts against this row; used to lock out brute-force guessing.
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("email_otps_code_digest_format_check", sql`${table.code} ~ '^v1:[0-9a-f]{64}$'`),
]);

export type EmailOtp = typeof emailOtpsTable.$inferSelect;
