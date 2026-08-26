import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { studentsTable } from "./students";

/**
 * Security-01B2 — short-lived server-authoritative "may this provider
 * identity attach to this existing account" challenges.
 *
 * A row here is created ONLY when routes/socialAuth.ts's resolveSocialLogin
 * reaches Branch 4 (provider email matches an existing account, but the
 * provider does not attest ownership). It binds exclusively server-derived
 * facts — provider, provider subject id, and the target student — captured
 * at verification time. The client never supplies or amends any of these;
 * completion (POST /api/auth/social-link/verify) references the challenge
 * only by its opaque token, never by re-submitting the fields it binds.
 *
 * No student/account email is stored here — the OTP goes to the account's
 * CURRENT email at send/verify time (read fresh off `students`), so a row
 * here cannot go stale relative to an email change and there is nothing
 * email-shaped to leak from this table.
 *
 * `token_hash` follows the exact pattern already used for installation
 * unregister secrets (lib/installationUnregister.ts): a random opaque value
 * is generated server-side and returned to the client once; only its
 * SHA-256 digest is ever persisted. Knowledge of the raw token is therefore
 * required to complete linking — the serial `id` is never exposed.
 */
export const socialLinkChallengesTable = pgTable("social_link_challenges", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  check("social_link_challenges_provider_check", sql`${table.provider} in ('google','facebook','apple')`),
  check("social_link_challenges_status_check", sql`${table.status} in ('pending','consumed','expired')`),
]);

export type SocialLinkChallenge = typeof socialLinkChallengesTable.$inferSelect;
