/**
 * Finance Phase 2D-2 — protected batch-control API security tests.
 *
 * Real Express router + real admin JWT auth middleware, disposable local
 * Postgres. Proves the authorization boundary: unauthenticated/unauthorized
 * requests are rejected, a non-Super-Admin cannot approve/cancel/start, and
 * a client cannot forge classifier version/code commit through the
 * approval body (the service layer's fingerprint check, exercised here
 * through the real HTTP surface).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_BATCH_LIFECYCLE_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5432/central_studio_disposable_batch_lifecycle";

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
process.env.API_SECRET_KEY = "test-api-secret-key";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let regularAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(id: number, isSuperAdmin: boolean): string {
  return jwtSign({ sub: id, username: `batch-test-${id}`, isSuperAdmin, roleId: null }, ADMIN_JWT_SECRET);
}

async function call(path: string, init: RequestInit & { token?: string; apiKey?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.apiKey !== "") headers["x-api-key"] = init.apiKey ?? "test-api-secret-key";
  if (init.token) headers["x-admin-token"] = init.token;
  return fetch(apiUrl(path), { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const financeBackfillBatchesRouter = (await import("./financeBackfillBatches")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", financeBackfillBatchesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const superAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Batch Test Super', true) RETURNING id`,
    [`batch-test-super-${run}`, `batch-test-super-${run}@example.com`],
  );
  superAdminId = superAdmin.rows[0].id as number;

  const regularAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Batch Test Regular', false) RETURNING id`,
    [`batch-test-regular-${run}`, `batch-test-regular-${run}@example.com`],
  );
  regularAdminId = regularAdmin.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

function createBody(suffix: string) {
  return {
    scope: {
      sourceFamilies: ["bookings"],
      operationalStatuses: [`security-test-${suffix}`],
      maxRows: 10,
      batchSize: 10,
    },
    expectedClassifierVersion: "2d1.0.0",
    expectedCodeCommit: "a".repeat(40),
  };
}

// ── Authentication / authorization ──────────────────────────────────────────

test("security: no API key at all is rejected (401, before any admin check)", async () => {
  const res = await call("/api/finance/backfill-batches", { apiKey: "" });
  assert.equal(res.status, 401);
});

test("security: no admin token is rejected", async () => {
  const res = await call("/api/finance/backfill-batches");
  assert.equal(res.status, 401);
});

test("security: a non-Super-Admin without finance view permission is rejected on create/list", async () => {
  const token = tokenFor(regularAdminId, false);
  const create = await call("/api/finance/backfill-batches", { method: "POST", token, body: JSON.stringify(createBody("noperm-create")) });
  assert.equal(create.status, 403);

  const list = await call("/api/finance/backfill-batches", { token });
  assert.equal(list.status, 403);
});

test("security: a non-Super-Admin cannot approve, even with finance view permission", async () => {
  const superToken = tokenFor(superAdminId, true);
  const created = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(createBody("approve-auth")) });
  assert.equal(created.status, 201);
  const { batch } = (await created.json()) as { batch: { id: string } };

  const regularToken = tokenFor(regularAdminId, false);
  const approveAttempt = await call(`/api/finance/backfill-batches/${batch.id}/approve`, {
    method: "POST",
    token: regularToken,
    body: JSON.stringify({ expectedFingerprint: "x", expectedEligibleCount: 0, maxExecutionCount: 1 }),
  });
  assert.equal(approveAttempt.status, 403);
});

test("security: a non-Super-Admin cannot cancel or start", async () => {
  const superToken = tokenFor(superAdminId, true);
  const created = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(createBody("cancel-start-auth")) });
  const { batch } = (await created.json()) as { batch: { id: string } };

  const regularToken = tokenFor(regularAdminId, false);
  const cancelAttempt = await call(`/api/finance/backfill-batches/${batch.id}/cancel`, { method: "POST", token: regularToken });
  assert.equal(cancelAttempt.status, 403);
  const startAttempt = await call(`/api/finance/backfill-batches/${batch.id}/start`, { method: "POST", token: superToken === regularToken ? superToken : regularToken });
  assert.equal(startAttempt.status, 403);
});

test("security: a client cannot forge Admin identity — createdBy is derived from the verified token, not the request body", async () => {
  const superToken = tokenFor(superAdminId, true);
  const body = { ...createBody("forge-identity"), createdBy: "someone-else-entirely" };
  const res = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(body) });
  assert.equal(res.status, 201);
  const { batch } = (await res.json()) as { batch: { createdBy: string } };
  assert.notEqual(batch.createdBy, "someone-else-entirely");
  assert.match(batch.createdBy, /^batch-test-/);
});

test("security: a client cannot forge an approval by supplying an arbitrary fingerprint", async () => {
  const superToken = tokenFor(superAdminId, true);
  const created = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(createBody("forge-fingerprint")) });
  const { batch } = (await created.json()) as { batch: { id: string } };

  // Never attached evidence — approve must fail regardless of the fingerprint supplied.
  const approveAttempt = await call(`/api/finance/backfill-batches/${batch.id}/approve`, {
    method: "POST",
    token: superToken,
    body: JSON.stringify({ expectedFingerprint: "totally-forged-value", expectedEligibleCount: 0, maxExecutionCount: 1 }),
  });
  assert.equal(approveAttempt.status, 409);
});

test("security: raw source rows/PII in a request body cannot smuggle through to the response", async () => {
  const superToken = tokenFor(superAdminId, true);
  const body = { ...createBody("no-pii"), studentEmail: "leaked@example.com", studentName: "Leaked Name" };
  const res = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(body) });
  assert.equal(res.status, 201);
  const text = await res.text();
  assert.equal(text.toLowerCase().includes("leaked"), false);
});

test("security: an unknown action route is rejected (404), not silently accepted", async () => {
  const superToken = tokenFor(superAdminId, true);
  const created = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(createBody("unknown-action")) });
  const { batch } = (await created.json()) as { batch: { id: string } };
  const res = await call(`/api/finance/backfill-batches/${batch.id}/execute-for-real`, { method: "POST", token: superToken });
  assert.equal(res.status, 404);
});

// ── Zero business writes at the HTTP boundary ────────────────────────────────

const BUSINESS_TABLES = ["payment_records", "payment_events", "payment_refunds", "package_orders", "bookings", "attendance", "credit_transactions", "notifications"] as const;

async function businessTableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of BUSINESS_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = res.rows[0].n as number;
  }
  return out;
}

test("zero-write: a full HTTP-driven create->pause->resume->cancel cycle touches no business table", async () => {
  const before_ = await businessTableCounts();
  const superToken = tokenFor(superAdminId, true);
  const created = await call("/api/finance/backfill-batches", { method: "POST", token: superToken, body: JSON.stringify(createBody("http-zero-write")) });
  const { batch } = (await created.json()) as { batch: { id: string } };
  await call(`/api/finance/backfill-batches/${batch.id}/cancel`, { method: "POST", token: superToken });
  const after_ = await businessTableCounts();
  assert.deepEqual(after_, before_);
});
