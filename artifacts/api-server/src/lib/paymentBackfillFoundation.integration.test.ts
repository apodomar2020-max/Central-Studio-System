/**
 * Finance Phase 2A DB Foundation — Step 2.
 *
 * Proves the row-level CHECK/UNIQUE/FK constraints on
 * payment_backfill_batches and payment_backfill_progress (migration
 * 0077_payment_backfill_foundation.sql) hold exactly as specified.
 *
 * No batch-finalization helper exists in this repository (see
 * paymentBackfillProgress.ts's module doc) — this file therefore covers
 * only row-level constraint behavior, not any cross-row finalization rule.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_BACKFILL_FOUNDATION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_backfill_foundation";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

async function insertBatch(overrides: Record<string, unknown> = {}): Promise<string> {
  const fields = {
    status: "running",
    finished_at: null,
    rolled_back_at: null,
    created_by: "test-seed",
    source_main_commit: "0000000000000000000000000000000000000000",
    // Phase 2D-2 (migration 0082) requires evidence/approval binding for
    // any status other than 'created'/'dry_run_completed'/'cancelled' —
    // this file's default status is 'running', so these must be present.
    // Present for every status regardless (harmless for 'created' rows
    // too), so callers don't need to know which statuses require them.
    classifier_version: "test-fixture",
    report_schema_version: "test-fixture",
    filters: JSON.stringify({ sourceFamilies: ["package_orders"], maxRows: 100, batchSize: 50 }),
    max_rows: 100,
    batch_size: 50,
    evidence_fingerprint: "test-fixture-fingerprint",
    approved_by: "test-seed",
    approved_at: new Date().toISOString(),
    expected_eligible_count: 0,
    max_execution_count: 0,
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `INSERT INTO payment_backfill_batches (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0].id as string;
}

async function insertProgress(overrides: Record<string, unknown>): Promise<number> {
  const fields = {
    source_family: "package_orders",
    last_source_id: 0,
    status: "running",
    processed_count: 0,
    inserted_count: 0,
    skipped_count: 0,
    failed_count: 0,
    finished_at: null,
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `INSERT INTO payment_backfill_progress (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0].id as number;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
});

after(async () => {
  await pool.end();
});

// ─── payment_backfill_batches ────────────────────────────────────────────

test("batch: running with null terminal timestamps succeeds", async () => {
  await assert.doesNotReject(insertBatch({ status: "running" }));
});

test("batch: running with finished_at set fails", async () => {
  await assert.rejects(
    insertBatch({ status: "running", finished_at: new Date().toISOString() }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("batch: completed without finished_at fails", async () => {
  await assert.rejects(
    insertBatch({ status: "completed" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("batch: completed with rolled_back_at set fails", async () => {
  const now = new Date().toISOString();
  await assert.rejects(
    insertBatch({ status: "completed", finished_at: now, rolled_back_at: now }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("batch: failed without finished_at fails", async () => {
  await assert.rejects(
    insertBatch({ status: "failed" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("batch: rolled_back without both timestamps fails", async () => {
  await assert.rejects(
    insertBatch({ status: "rolled_back" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
  await assert.rejects(
    insertBatch({ status: "rolled_back", finished_at: new Date().toISOString() }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("batch: rollback time before finish time fails", async () => {
  const finishedAt = new Date("2026-01-02T00:00:00Z").toISOString();
  const rolledBackAt = new Date("2026-01-01T00:00:00Z").toISOString();
  await assert.rejects(
    insertBatch({ status: "rolled_back", finished_at: finishedAt, rolled_back_at: rolledBackAt }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// A fixed future instant, well after any DB-side `now()` this test run could
// possibly observe — avoids a JS-clock-vs-DB-clock race against the DEFAULT
// now() on started_at (a real bug caught while writing this file: using
// `new Date().toISOString()` here occasionally landed a hair before the
// row's own started_at default, tripping the finished-after-started CHECK).
const FAR_FUTURE = "2099-01-01T00:00:00Z";
const FAR_FUTURE_LATER = "2099-01-02T00:00:00Z";

test("batch: a valid completed row (finished_at set, no rolled_back_at) succeeds", async () => {
  await assert.doesNotReject(insertBatch({ status: "completed", finished_at: FAR_FUTURE }));
});

test("batch: a valid rolled_back row (both timestamps, correct order) succeeds", async () => {
  await assert.doesNotReject(insertBatch({ status: "rolled_back", finished_at: FAR_FUTURE, rolled_back_at: FAR_FUTURE_LATER }));
});

test("batch: an unsupported status is rejected", async () => {
  await assert.rejects(
    insertBatch({ status: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── payment_backfill_progress ───────────────────────────────────────────

test("progress: a valid package_orders row succeeds", async () => {
  const batchId = await insertBatch();
  await assert.doesNotReject(insertProgress({ batch_id: batchId, source_family: "package_orders" }));
});

test("progress: a valid bookings row succeeds", async () => {
  const batchId = await insertBatch();
  await assert.doesNotReject(insertProgress({ batch_id: batchId, source_family: "bookings" }));
});

test("progress: duplicate (batch_id, source_family) fails with 23505", async () => {
  const batchId = await insertBatch();
  await insertProgress({ batch_id: batchId, source_family: "package_orders" });
  await assert.rejects(
    insertProgress({ batch_id: batchId, source_family: "package_orders" }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("progress: unsupported source family fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, source_family: "credit_transactions" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: negative cursor fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, last_source_id: -1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: negative counters fail", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, processed_count: -1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
  await assert.rejects(
    insertProgress({ batch_id: batchId, source_family: "bookings", inserted_count: -1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: counter reconciliation mismatch fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, processed_count: 5, inserted_count: 1, skipped_count: 1, failed_count: 1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: completed with failures fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({
      batch_id: batchId,
      status: "completed",
      finished_at: new Date().toISOString(),
      processed_count: 1,
      failed_count: 1,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: failed with zero failures fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, status: "failed", finished_at: new Date().toISOString(), failed_count: 0 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: running with finished_at fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, status: "running", finished_at: new Date().toISOString() }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: terminal state without finished_at fails", async () => {
  const batchId = await insertBatch();
  await assert.rejects(
    insertProgress({ batch_id: batchId, status: "completed", finished_at: null }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
  await assert.rejects(
    insertProgress({
      batch_id: batchId, source_family: "bookings", status: "failed",
      finished_at: null, processed_count: 1, failed_count: 1,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("progress: a valid completed row (finished_at set, zero failures) succeeds", async () => {
  const batchId = await insertBatch();
  await assert.doesNotReject(insertProgress({
    batch_id: batchId,
    status: "completed",
    finished_at: FAR_FUTURE,
    processed_count: 3, inserted_count: 2, skipped_count: 1, failed_count: 0,
  }));
});

test("progress: a valid failed row (finished_at set, at least one failure) succeeds", async () => {
  const batchId = await insertBatch();
  await assert.doesNotReject(insertProgress({
    batch_id: batchId,
    status: "failed",
    finished_at: FAR_FUTURE,
    processed_count: 1, inserted_count: 0, skipped_count: 0, failed_count: 1,
  }));
});

test("progress: deleting a referenced batch is blocked by RESTRICT", async () => {
  const batchId = await insertBatch();
  await insertProgress({ batch_id: batchId, source_family: "package_orders" });
  await assert.rejects(
    pool.query(`DELETE FROM payment_backfill_batches WHERE id = $1`, [batchId]),
    // PostgreSQL reports an ON DELETE RESTRICT violation as 23001
    // (restrict_violation), distinct from the plain 23503
    // (foreign_key_violation) an unconstrained/CASCADE-less insert-time FK
    // check would raise — confirmed directly against this disposable DB.
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});
