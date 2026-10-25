import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Logical IDs deliberately have no cascading FKs. Operations outlive accounts
// and promotions; deleting either must never make an old save executable again.
export const promotionAdminOperationsTable = pgTable(
  "promotion_admin_operations",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorAdminId: integer("actor_admin_id").notNull(),
    method: text("method").notNull(),
    targetPromotionId: integer("target_promotion_id"),
    canonicalVersion: integer("canonical_version").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    expectedRevision: text("expected_revision"),
    state: text("state").notNull().default("reserved"),
    terminalOutcome: text("terminal_outcome"),
    resultPromotionId: integer("result_promotion_id"),
    responseStatus: integer("response_status"),
    // Exact, pre-serialized allowlisted response. Never store raw requests/errors.
    responseBody: text("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (t) => [
    index("promotion_operations_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.state} <> 'expired'`),
    check(
      "promotion_operations_binding_check",
      sql`(${t.actorAdminId} > 0 and ${t.canonicalVersion} = 1 and ${t.requestFingerprint} ~ '^[a-f0-9]{64}$' and ((${t.method} = 'POST' and ${t.targetPromotionId} is null) or (${t.method} in ('PATCH','DELETE') and ${t.targetPromotionId} > 0))) IS TRUE`,
    ),
    check(
      "promotion_operations_state_check",
      sql`((
    (${t.state} = 'reserved' and ${t.terminalOutcome} is null and ${t.completedAt} is null and ${t.responseStatus} is null and ${t.responseBody} is null and ${t.resultPromotionId} is null) or
    (${t.state} = 'succeeded' and ${t.terminalOutcome} = 'succeeded' and ${t.completedAt} is not null and ${t.responseStatus} in (200,201,204) and ${t.resultPromotionId} > 0 and ((${t.responseStatus} = 204 and ${t.responseBody} is null) or (${t.responseStatus} <> 204 and ${t.responseBody} is not null))) or
    (${t.state} = 'rejected' and ${t.terminalOutcome} = 'rejected' and ${t.completedAt} is not null and ${t.responseStatus} between 400 and 499 and ${t.responseBody} is not null and ${t.resultPromotionId} is null) or
    (${t.state} = 'expired' and ${t.terminalOutcome} in ('succeeded','rejected','not_executed') and ${t.completedAt} is not null and ${t.responseBody} is null)
  ) IS TRUE)`,
    ),
    check(
      "promotion_operations_response_size_check",
      sql`${t.responseBody} is null or octet_length(${t.responseBody}) <= 2097152`,
    ),
  ],
);
