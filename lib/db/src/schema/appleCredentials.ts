import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";

// Refresh credentials only, encrypted with the existing versioned AES-GCM keyring.
// Unlinked credentials expire; linked credentials survive tombstoning only for bounded revocation retries.
export const appleCredentialsTable = pgTable("apple_credentials", {
  subject: text("subject").primaryKey(),
  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "restrict" }),
  ciphertext: text("ciphertext").notNull(), iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(), keyVersion: text("key_version").notNull(),
  state: text("state").notNull().default("active"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, t => [index("apple_credentials_retry_idx").on(t.state, t.retryAt), check("apple_credentials_state_check", sql`${t.state} IN ('active','revoke_pending')`)]);

export const appleAuthChallengesTable = pgTable("apple_auth_challenges", {
  tokenHash: text("token_hash").primaryKey(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});
