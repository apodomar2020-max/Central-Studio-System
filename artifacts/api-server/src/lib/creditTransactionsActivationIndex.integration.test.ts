/**
 * Finance Phase 2A DB Hardening — Step 1.
 *
 * Proves the database-level invariant added by migration
 * 0076_enforce_one_package_activation_credit.sql:
 * `credit_transactions_one_package_activation_idx`, a partial unique index
 * on `credit_transactions(package_order_id) WHERE type = 'package_activated'`.
 *
 * This is a DB-invariant test, not a route test — every insert here goes
 * directly through `pool.query`, deliberately bypassing the application-level
 * FOR UPDATE guard in packageOrders.ts (already covered end-to-end by
 * packageOrders.activation.integration.test.ts). The point of this file is
 * to prove the constraint holds even if that application guard is bypassed
 * or regresses — the database itself is the last line of defense.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ACTIVATION_INDEX_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_activation_guard";

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
let packageId: number;

async function makePendingOrder(label: string): Promise<{ id: number; studentId: number }> {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`Activation Index Test ${label}`, `activation-index-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`],
  );
  const studentId = student.rows[0].id as number;
  const order = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Activation Index Test Package', 8, 8, 'pendingPayment')
     RETURNING id`,
    [`Activation Index Test ${label}`, `unused-${label}@example.com`, studentId, packageId],
  );
  return { id: order.rows[0].id as number, studentId };
}

async function insertActivationRow(packageOrderId: number): Promise<void> {
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'package_activated', 8, 0, 8, 'test-seed')`,
    [packageOrderId],
  );
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months) VALUES ($1, 'per_class', 1000, 8, 6) RETURNING id`,
    [`Activation Index Test Package ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  await pool.end();
});

// ─── 1–2: single-row success, duplicate rejection ───────────────────────────

test("a first package_activated credit row for a package order succeeds", async () => {
  const { id } = await makePendingOrder("first-success");
  await assert.doesNotReject(insertActivationRow(id));

  const count = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'package_activated'`,
    [id],
  );
  assert.equal(count.rows[0].n, 1);
});

test("a second package_activated row for the same package order is rejected by the database with 23505", async () => {
  const { id } = await makePendingOrder("duplicate-rejected");
  await insertActivationRow(id);

  await assert.rejects(insertActivationRow(id), (err: unknown) => pgErrorCode(err) === "23505");

  const count = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'package_activated'`,
    [id],
  );
  assert.equal(count.rows[0].n, 1, "the rejected insert must not have landed");
});

// ─── 3: independence across distinct orders ─────────────────────────────────

test("different package orders may each independently have one package_activated row", async () => {
  const orderA = await makePendingOrder("distinct-a");
  const orderB = await makePendingOrder("distinct-b");

  await insertActivationRow(orderA.id);
  await insertActivationRow(orderB.id);

  const count = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = ANY($1) AND type = 'package_activated'`,
    [[orderA.id, orderB.id]],
  );
  assert.equal(count.rows[0].n, 2, "each distinct order gets its own row, unconstrained by the other");
});

// ─── 4: partial predicate does not constrain other transaction types ────────

test("the same package order may still record other credit_transaction types alongside its one package_activated row", async () => {
  const { id } = await makePendingOrder("other-types-allowed");
  await insertActivationRow(id);

  // The partial index's WHERE clause is `type = 'package_activated'` only —
  // it must not interfere with attendance_deduction, package_bonus, etc. on
  // the very same package_order_id, including more than one of each.
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'attendance_deduction', -1, 8, 7, 'test-seed')`,
    [id],
  );
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'attendance_deduction', -1, 7, 6, 'test-seed')`,
    [id],
  );
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'package_bonus', 2, 6, 8, 'test-seed')`,
    [id],
  );

  const total = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`,
    [id],
  );
  assert.equal(total.rows[0].n, 4, "1 package_activated + 2 attendance_deduction + 1 package_bonus, none blocked");
});

// ─── 5: package_order_id IS NULL — confirmed inapplicable by current schema ──

test("credit_transactions.package_order_id is NOT NULL, so a null-package_order_id collision scenario does not exist under the current schema", async () => {
  // lib/db/src/schema/creditTransactions.ts declares packageOrderId as
  // `.notNull()`, and this has been true since the table's introduction —
  // there is no historical or current code path that can produce a null
  // package_order_id row. This test asserts that fact directly (a NOT NULL
  // violation, 23502) rather than silently skipping the scenario, so a
  // future schema change relaxing this column to nullable is forced to
  // revisit this test rather than leaving the "null collision" case
  // unverified by accident.
  await assert.rejects(
    pool.query(
      `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
       VALUES (NULL, 'package_activated', 8, 0, 8, 'test-seed')`,
    ),
    (err: unknown) => pgErrorCode(err) === "23502",
  );
});

// ─── 6: the invariant holds even when bypassed via direct SQL ──────────────

test("the database rejects a duplicate package_activated row even via direct SQL, independent of any application-level route guard", async () => {
  // Every insert in this file already goes through pool.query directly,
  // never through the packageOrders.ts route handler — this test exists to
  // state that fact as an explicit, named assertion rather than leaving it
  // implicit in the file's overall structure.
  const { id } = await makePendingOrder("direct-sql-bypass");
  await insertActivationRow(id);

  await assert.rejects(insertActivationRow(id), (err: unknown) => pgErrorCode(err) === "23505");
});
