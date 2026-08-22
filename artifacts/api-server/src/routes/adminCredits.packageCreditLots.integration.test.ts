import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CREDIT_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_credit";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Refusing non-local database");
  if (!/disposable|local|test/i.test(url.pathname)) throw new Error("Refusing database without disposable/local/test name");
  if (/rlwy\.net|railway/i.test(databaseUrl)) throw new Error("Refusing Railway database");
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `credit-writer-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function adjust(id: number, body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/admin/package-orders/${id}/credits`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key", "x-admin-token": adminToken() },
    body: JSON.stringify(body),
  });
}

async function makeOrder(label: string, remainingCredits = 5): Promise<number> {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `credit-writer-${run}-${label}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`Credit Writer ${label}`, email],
  );
  const result = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, 'Writer Test Package', 10, $4, 'active') RETURNING id`,
    [`Credit Writer ${label}`, email, student.rows[0].id, remainingCredits],
  );
  return result.rows[0].id as number;
}

async function lots(id: number): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT l.*, t.type AS issuing_transaction_type
     FROM package_credit_lots l
     JOIN credit_transactions t ON t.id = l.issuing_credit_transaction_id
     WHERE l.package_order_id = $1 ORDER BY l.id`,
    [id],
  );
  return result.rows as Array<Record<string, unknown>>;
}

before(async () => {
  const express = (await import("express")).default;
  jwtSign = (await import("jsonwebtoken")).default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const adminCreditsRouter = (await import("./adminCredits")).default;
  pool = (await import("@workspace/db")).pool;
  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminCreditsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;

  const existing = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existing.rows.length) superAdminId = existing.rows[0].id as number;
  else {
    const created = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Credit Writer Super', true) RETURNING id`,
      [`credit-writer-${Date.now()}`, `credit-writer-${Date.now()}@example.com`],
    );
    superAdminId = created.rows[0].id as number;
  }
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("bonus and complimentary issuances create zero-valued classified lots", async () => {
  for (const [sourceType, type] of [["bonus", "package_bonus"], ["manual_complimentary", "manual_adjustment"]] as const) {
    const id = await makeOrder(sourceType);
    const response = await adjust(id, { type, delta: 3, sourceType, idempotencyKey: crypto.randomUUID() });
    assert.equal(response.status, 201);
    const [lot] = await lots(id);
    assert.equal(lot.source_type, sourceType);
    assert.equal(lot.credits_issued, 3);
    assert.equal(lot.credits_remaining, 3);
    assert.equal(lot.total_value_minor, 0);
    assert.equal(lot.value_basis, "unknown");
    assert.equal(lot.issuing_transaction_type, type);
  }
});

test("manual paid requires explicit value and records purchase value basis", async () => {
  const id = await makeOrder("paid");
  const missing = await adjust(id, {
    type: "manual_adjustment", delta: 2, sourceType: "manual_paid", idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(missing.status, 400);
  assert.equal((await lots(id)).length, 0);

  const response = await adjust(id, {
    type: "manual_adjustment", delta: 2, sourceType: "manual_paid", totalValueMinor: 45_000, idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(response.status, 201);
  const [lot] = await lots(id);
  assert.equal(lot.source_type, "manual_paid");
  assert.equal(lot.total_value_minor, 45_000);
  assert.equal(lot.value_basis, "recorded_purchase_price");
});

test("negative adjustment reduces credit lots FIFO, creates single credit_transaction and manual_adjustment allocations", async () => {
  const id = await makeOrder("negative-fifo", 0);
  // Add Lot A (3 credits, paid 30,000 minor)
  const addA = await adjust(id, {
    type: "manual_adjustment", delta: 3, sourceType: "manual_paid", totalValueMinor: 30_000, idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(addA.status, 201);

  // Add Lot B (4 credits, complimentary)
  const addB = await adjust(id, {
    type: "manual_adjustment", delta: 4, sourceType: "manual_complimentary", idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(addB.status, 201);

  // Package order now has remaining_credits = 7, Lot A = 3, Lot B = 4
  const body = { type: "manual_adjustment", delta: -5, idempotencyKey: crypto.randomUUID() };
  const res1 = await adjust(id, body);
  assert.equal(res1.status, 201);

  // Idempotent retry returns 201
  const res2 = await adjust(id, body);
  assert.equal(res2.status, 201);

  // Verify package_orders.remaining_credits = 2
  const orderRes = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [id]);
  assert.equal(orderRes.rows[0].remaining_credits, 2);
  assert.equal(orderRes.rows[0].status, "active");

  // Verify lot balances: Lot A remaining = 0, Lot B remaining = 2, total sum = 2
  const currentLots = await lots(id);
  assert.equal(currentLots.length, 2);
  assert.equal(currentLots[0].credits_remaining, 0); // Lot A completely deducted
  assert.equal(currentLots[1].credits_remaining, 2); // Lot B partially deducted (4 - 2 = 2)

  const lotSumRes = await pool.query(`SELECT SUM(credits_remaining)::int AS total FROM package_credit_lots WHERE package_order_id = $1`, [id]);
  assert.equal(lotSumRes.rows[0].total, 2);
  assert.equal(orderRes.rows[0].remaining_credits, lotSumRes.rows[0].total);

  // Verify credit_transactions: 1 transaction for Lot A (+3), 1 for Lot B (+4), 1 for the negative adjustment (-5)
  const txRes = await pool.query(`SELECT id, delta, type FROM credit_transactions WHERE package_order_id = $1 ORDER BY id`, [id]);
  assert.equal(txRes.rows.length, 3);
  const negTx = txRes.rows[2];
  assert.equal(negTx.delta, -5);
  assert.equal(negTx.type, "manual_adjustment");

  // Verify package_credit_allocations: 2 allocation rows, both referencing negTx.id
  const allocRes = await pool.query(
    `SELECT lot_id, event_type, credits, total_value_minor, unit_value_minor, value_basis
     FROM package_credit_allocations
     WHERE credit_transaction_id = $1 ORDER BY id`,
    [negTx.id],
  );
  assert.equal(allocRes.rows.length, 2);
  assert.equal(allocRes.rows[0].lot_id, currentLots[0].id);
  assert.equal(allocRes.rows[0].event_type, "manual_adjustment");
  assert.equal(allocRes.rows[0].credits, 3);
  assert.equal(allocRes.rows[0].total_value_minor, 30_000); // 100% of Lot A value
  assert.equal(allocRes.rows[0].value_basis, "recorded_purchase_price");

  assert.equal(allocRes.rows[1].lot_id, currentLots[1].id);
  assert.equal(allocRes.rows[1].event_type, "manual_adjustment");
  assert.equal(allocRes.rows[1].credits, 2);
  assert.equal(allocRes.rows[1].total_value_minor, 0); // Complimentary Lot B
});

test("insufficient lot balance fails safely without mutating balances", async () => {
  const id = await makeOrder("insufficient", 0);
  await adjust(id, { type: "manual_adjustment", delta: 2, sourceType: "manual_complimentary", idempotencyKey: crypto.randomUUID() });

  const failRes = await adjust(id, { type: "manual_adjustment", delta: -5, idempotencyKey: crypto.randomUUID() });
  assert.equal(failRes.status, 400);

  const orderRes = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [id]);
  assert.equal(orderRes.rows[0].remaining_credits, 2);
  const lotSumRes = await pool.query(`SELECT SUM(credits_remaining)::int AS total FROM package_credit_lots WHERE package_order_id = $1`, [id]);
  assert.equal(lotSumRes.rows[0].total, 2);
});

test("positive issuance rejects missing source and concurrent exact retries do not duplicate the lot", async () => {
  const id = await makeOrder("retry");
  assert.equal((await adjust(id, { type: "manual_adjustment", delta: 2, idempotencyKey: crypto.randomUUID() })).status, 400);

  const body = {
    type: "manual_adjustment", delta: 2, sourceType: "manual_complimentary", idempotencyKey: crypto.randomUUID(),
  };
  const [first, retry] = await Promise.all([adjust(id, body), adjust(id, body)]);
  assert.deepEqual([first.status, retry.status], [201, 201]);
  assert.equal((await lots(id)).length, 1);
  const order = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [id]);
  assert.equal(order.rows[0].remaining_credits, 7);
});

test("reusing an idempotency key with a different payload is rejected", async () => {
  const id = await makeOrder("key-conflict");
  const idempotencyKey = crypto.randomUUID();
  assert.equal((await adjust(id, {
    type: "manual_adjustment", delta: 2, sourceType: "manual_complimentary", idempotencyKey,
  })).status, 201);
  assert.equal((await adjust(id, {
    type: "manual_adjustment", delta: 3, sourceType: "manual_complimentary", idempotencyKey,
  })).status, 409);
  assert.equal((await lots(id)).length, 1);
});
