import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";

export const studentsTable = pgTable("students", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  accountType: text("account_type"),
  profileCompleted: boolean("profile_completed").notNull().default(false),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true, mode: "string" }),
  // Profile Completion Engine (Phase 4). All nullable — every account
  // (including pre-existing ones) starts without these until filled in.
  gender: text("gender"),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  city: text("city"),
  nationality: text("nationality"),
  howDidYouHearAboutUs: text("how_did_you_hear_about_us"),
  policiesAcceptedAt: timestamp("policies_accepted_at", { withTimezone: true, mode: "string" }),
  // Resume-support only — NOT the source of truth for completion state.
  // completion percent/isComplete/nextStep/missing/completed are always
  // derived fresh from the actual saved fields (see lib/profileCompletion.ts);
  // this column just remembers which step the user last finished so a
  // fresh app open on another device can jump back to the right place
  // without waiting on a full re-derivation round trip.
  lastCompletionStep: text("last_completion_step"),
  notes: text("notes"),
  passwordHash: text("password_hash"),
  // Session revocation (Security-02B, CS-SEC-H-03). Every student JWT embeds
  // the token_version that was current at issuance. requireAuth's student
  // fast-path rejects a token whose embedded version no longer matches this
  // column, so bumping it atomically invalidates every outstanding token for
  // the account. A legacy JWT with no tokenVersion claim is treated as
  // version 1 — deployment alone (every row starts at 1) never logs anyone
  // out; only an explicit reset/change/logout bump does.
  tokenVersion: integer("token_version").notNull().default(1),
  // Account lifecycle (Phase B1B). Only "active"/"deactivated" are
  // reachable via any route this phase — "deleted" exists solely so the
  // CHECK constraint and downstream fail-closed logic already account for
  // it ahead of the future tombstone phase. deactivated_at/by_admin_id are
  // set together on deactivation and cleared together on reactivation;
  // there is deliberately no persisted deactivation-reason column — a
  // reason (if supplied) lives only in the audit log payload.
  accountStatus: text("account_status").notNull().default("active"),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "string" }),
  deactivatedByAdminId: integer("deactivated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "string" }),
  // Which mechanism last authenticated this account: "local" | "google" | "apple" | "facebook".
  // Nullable for legacy rows created before social auth existed.
  authProvider: text("auth_provider"),
  // Stable per-provider subject IDs. Each is uniquely indexed (partial — NULLs allowed)
  // so one account links at most one identity per provider and no two accounts share one.
  googleId: text("google_id"),
  appleId: text("apple_id"),
  facebookId: text("facebook_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
  // Avatar handling. `avatarUrl` is the effective image to display.
  // `avatarSource` records who owns it: "manual" (user upload — never overwritten
  // by a provider) or "google" (synced from the provider). `providerAvatarUrl`
  // always tracks the latest provider picture even when a manual avatar wins.
  avatarUrl: text("avatar_url"),
  avatarSource: text("avatar_source"),
  providerAvatarUrl: text("provider_avatar_url"),
  providerDisplayName: text("provider_display_name"),
  totalBookings: integer("total_bookings").notNull().default(0),
  // Opaque token embedded in the student's QR code.
  // Never put PII in the QR — this UUID is the only identifier.
  // Auto-generated on creation and never changes.
  qrToken: uuid("qr_token").notNull().defaultRandom().unique(),
  joinedAt: timestamp("joined_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("students_account_status_check", sql`${table.accountStatus} IN ('active', 'deactivated', 'deleted')`),
]);

// qrToken is excluded from the insert schema — it is always auto-generated
// and must never be set or overridden via the API.
export const insertStudentSchema = createInsertSchema(studentsTable).omit({ id: true, qrToken: true, createdAt: true, updatedAt: true });
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
