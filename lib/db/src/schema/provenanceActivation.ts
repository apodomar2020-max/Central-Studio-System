import { boolean, pgTable, serial, timestamp } from "drizzle-orm/pg-core";

/**
 * Phase B3B0-1A: single-row T0 boundary for email-identity provenance.
 *
 * Written once, idempotently (INSERT ... ON CONFLICT DO NOTHING keyed on the
 * fixed id=1 row) the first time it's needed. `activatedAt` is the moment
 * this system started being able to prove forward-looking email ownership.
 * Existing students' CURRENT email is only ever "current as of T0" — never
 * backdated to students.createdAt. Queryable at runtime so a future B3B1
 * planner can determine whether a given historical row predates provenance
 * capability entirely.
 */
export const provenanceActivationTable = pgTable("provenance_activation", {
  id: serial("id").primaryKey(),
  // Fixed-true unique column: ON CONFLICT (singleton) DO NOTHING guarantees
  // exactly one row can ever exist, enforced by the DB, not application code.
  singleton: boolean("singleton").notNull().default(true).unique(),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type ProvenanceActivation = typeof provenanceActivationTable.$inferSelect;
