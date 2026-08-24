/**
 * Phase B3B2E — FINAL CLOSURE PASS, Part 1, Section 5.
 *
 * IDENTITY_PROVENANCE_PEPPER dependency proof for the B3B2E code paths
 * (deletion-impact / attribution planner / manual resolution).
 *
 *   (A) With a valid pepper configured, all three paths work.
 *   (B) With the pepper UNSET, all three paths FAIL CLOSED — they must not
 *       silently bypass provenance, must not record a decision row, must not
 *       mutate ownership, and must never expose the secret (or the fact of
 *       its configuration) in the response body.
 *
 * The pepper is read LAZILY (studentEmailProvenance.provenanceSecretForKeyId
 * reads process.env at call time), so this suite can boot the real app with
 * the pepper set and then remove it for the fail-closed assertions.
 *
 * HARNESS CAVEAT (honest scoping): src/app.ts cannot be imported under tsx
 * (pre-existing exceljs CJS/ESM interop failure via routes/reports.ts), so
 * this suite mounts the real students router on a bare Express app like
 * every other students.*.integration.test.ts here. Consequently the runtime
 * assertions below prove the STATUS/side-effect half of fail-closed
 * (no 200/201, no decision row, no ownership backfill, no pepper VALUE in
 * the body) but run under Express's DEFAULT error handler, whose dev-mode
 * body includes the thrown Error's message text. The production envelope —
 * a fixed `{"error":"Internal server error"}` for any non-Exposable 5xx —
 * is proven separately by the `5-static-envelope` test below, which reads
 * src/app.ts's Security-G handler directly.
 *
 * NOTE: this file never prints, asserts on, or logs the pepper VALUE. Every
 * check is a presence/absence check or a "body must not contain" check.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATABASE_URL = process.env.DISPOSABLE_PEPPER_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_universe";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
const VALID_PEPPER = "test-pepper-fail-closed-identity-provenance-pepper".padEnd(64, "0");
process.env.IDENTITY_PROVENANCE_PEPPER = VALID_PEPPER;

let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; body: string; json: any };
async function post(path: string, body: unknown, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.API_SECRET_KEY}`,
  };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
async function get(path: string, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${process.env.API_SECRET_KEY}` };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { headers });
  const text = await res.text();
  return { status: res.status, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  // NOTE: src/app.ts cannot be imported under tsx (its transitive
  // `import { Workbook } from "exceljs"` in routes/reports.ts is a CJS/ESM
  // interop failure that only the bundled build resolves) — a pre-existing
  // repo-wide tooling limitation, unrelated to B3B2E. So this suite mounts
  // the real students router on a bare Express app, exactly like every other
  // students.*.integration.test.ts in this repo, and covers the production
  // error-envelope shape with the static proof at the bottom of this file.
  const expressModule = await import("express");
  const express = expressModule.default;
  const studentsRouter = (await import("./students")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", studentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
});

after(async () => {
  process.env.IDENTITY_PROVENANCE_PEPPER = VALID_PEPPER;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `pepper-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string) {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', 'deactivated', true) RETURNING id`,
    [`Pepper Test ${tag}`, email],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdmin(): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const uniq = `pep-${Date.now()}-${adminSeq}`;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`${uniq}-role`, JSON.stringify({ users: { delete: true, edit: true, view: true } })],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, 'x', $3, false, true, $4) RETURNING id`,
    [`${uniq}-admin`, `${uniq}-admin@example.com`, `Pepper Admin ${adminSeq}`, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `${uniq}-admin`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

let poSeq = 0;
async function makeLevelBFixture(tag: string) {
  const { studentId, email } = await makeStudent(tag);
  poSeq += 1;
  const po = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, NULL, 'Test Package', 8, 8, 'active') RETURNING id`,
    [`Pepper PO ${poSeq}`, email],
  );
  const orderId = po.rows[0].id as number;
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'package_activated', 8, 0, 8, 'system')`,
    [orderId, studentId],
  );
  await pool.query(
    `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
     VALUES ($1, $2, $3, $4, true)`,
    [`Pepper Test ${tag}`, email, orderId, studentId],
  );
  return { studentId, email, orderId };
}

function impactUrl(id: number) { return `/api/students/${id}/deletion-impact`; }
function planUrl(id: number) { return `/api/students/${id}/deletion-attribution-plan`; }
function resolveUrl(id: number) { return `/api/students/${id}/deletion-attribution-resolutions`; }

async function withPepperUnset<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.IDENTITY_PROVENANCE_PEPPER;
  delete process.env.IDENTITY_PROVENANCE_PEPPER;
  assert.equal("IDENTITY_PROVENANCE_PEPPER" in process.env, false, "pepper must actually be unset for this check");
  try {
    return await fn();
  } finally {
    process.env.IDENTITY_PROVENANCE_PEPPER = saved;
  }
}

/** Body must never carry the secret, nor a fingerprint derived from it. */
function assertNoSecretLeak(body: string) {
  assert.equal(body.includes(VALID_PEPPER), false, "response body must not contain the pepper value");
  assert.equal(/v1:k1:[0-9a-f]{64}/.test(body), false, "response body must not contain a raw fingerprint");
}

// ═══════════════════════════════════════════════════════════════════════
// (A) valid pepper set — the three B3B2E paths work
// ═══════════════════════════════════════════════════════════════════════

test("5A: with a valid pepper set, deletion-impact / planner / manual-resolution all work", async () => {
  const admin = await makeAdmin();
  const f = await makeLevelBFixture("valid");

  const impact = await get(impactUrl(f.studentId), admin.token);
  assert.equal(impact.status, 200);
  assert.ok(impact.json.manualResolution, "impact must carry the manualResolution block");
  assertNoSecretLeak(impact.body);

  const start = await post(`/api/students/${f.studentId}/deletion-preparation/start`, {}, admin.token);
  assert.equal(start.status, 201);
  const workflowId = start.json.id as number;

  const plan = await get(planUrl(f.studentId), admin.token);
  assert.equal(plan.status, 200);
  assertNoSecretLeak(plan.body);

  const resolved = await post(resolveUrl(f.studentId), {
    workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(resolved.status, 201);
  assertNoSecretLeak(resolved.body);
});

// ═══════════════════════════════════════════════════════════════════════
// (B) pepper unset — every path fails CLOSED
// ═══════════════════════════════════════════════════════════════════════

test("5B-1: with the pepper unset, POST manual resolution fails closed — no 201, no decision row, no ownership backfill, no secret leak", async () => {
  const admin = await makeAdmin();
  const f = await makeLevelBFixture("unset-resolve");
  const start = await post(`/api/students/${f.studentId}/deletion-preparation/start`, {}, admin.token);
  assert.equal(start.status, 201);
  const workflowId = start.json.id as number;

  const res = await withPepperUnset(() => post(resolveUrl(f.studentId), {
    workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, admin.token));

  assert.notEqual(res.status, 201, "a missing pepper must never yield a successful resolution");
  assert.ok(res.status >= 500, `expected a fail-closed 5xx, got ${res.status}`);
  assertNoSecretLeak(res.body);

  const rows = await pool.query(
    `SELECT count(*) FROM student_legacy_identity_resolutions WHERE student_id = $1`, [f.studentId],
  );
  assert.equal(Number(rows.rows[0].count), 0, "no decision row may be written on the fail-closed path");
  const order = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [f.orderId]);
  assert.equal(order.rows[0].student_id, null, "no ownership backfill on the fail-closed path");
});

test("5B-2: with the pepper unset, GET attribution-plan fails closed (never a silent bypass returning an empty/attributable plan)", async () => {
  const admin = await makeAdmin();
  const f = await makeLevelBFixture("unset-plan");
  const start = await post(`/api/students/${f.studentId}/deletion-preparation/start`, {}, admin.token);
  assert.equal(start.status, 201);

  const res = await withPepperUnset(() => get(planUrl(f.studentId), admin.token));
  assert.notEqual(res.status, 200, "a missing pepper must never yield a 200 plan");
  assert.ok(res.status >= 500, `expected a fail-closed 5xx, got ${res.status}`);
  assertNoSecretLeak(res.body);
});

test("5B-3: with the pepper unset, GET deletion-impact fails closed (manualResolution block cannot be computed without provenance)", async () => {
  const admin = await makeAdmin();
  const f = await makeLevelBFixture("unset-impact");

  const res = await withPepperUnset(() => get(impactUrl(f.studentId), admin.token));
  assert.notEqual(res.status, 200, "a missing pepper must never yield a 200 impact report");
  assert.ok(res.status >= 500, `expected a fail-closed 5xx, got ${res.status}`);
  assertNoSecretLeak(res.body);
});

test("5B-4: the pepper is restored and the paths recover — the failure was configuration-driven, not state corruption", async () => {
  const admin = await makeAdmin();
  const f = await makeLevelBFixture("recover");
  const start = await post(`/api/students/${f.studentId}/deletion-preparation/start`, {}, admin.token);
  const workflowId = start.json.id as number;
  await withPepperUnset(() => post(resolveUrl(f.studentId), {
    workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, admin.token));
  // Pepper back in place — same request now succeeds.
  const ok = await post(resolveUrl(f.studentId), {
    workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(ok.status, 201);
});

// ═══════════════════════════════════════════════════════════════════════
// Static scope proofs — server-only secret
// ═══════════════════════════════════════════════════════════════════════

/**
 * Production error envelope: the missing-pepper Error is a plain Error, NOT
 * an ExposableHttpError, and carries no `status`, so app.ts's Security-G
 * handler classifies it 500 + non-exposable and replaces its message with a
 * fixed string. The client therefore never learns which secret is
 * misconfigured. Proven statically because app.ts is not tsx-importable.
 */
test("5-static-envelope: app.ts genericises the missing-pepper 5xx, so the secret's name never reaches a client", async () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const appSrc = readFileSync(`${here}../app.ts`, "utf8");
  assert.ok(appSrc.includes('const exposable = err instanceof ExposableHttpError || status < 500;'),
    "app.ts must classify non-Exposable 5xx as non-exposable");
  assert.ok(/const message = exposable[\s\S]{0,120}"Internal server error"/.test(appSrc),
    "app.ts must replace non-exposable 5xx messages with a fixed string");

  // And the thrown error really is a plain, non-exposable Error.
  const { fingerprintStudentEmail } = await import("../lib/studentEmailProvenance");
  const { ExposableHttpError } = await import("../lib/httpError");
  const thrown = await withPepperUnset(async () => {
    try { fingerprintStudentEmail("someone@example.com"); return null; } catch (e) { return e as Error; }
  });
  assert.ok(thrown instanceof Error, "a missing pepper must throw, not return a value");
  assert.equal(thrown instanceof ExposableHttpError, false,
    "the missing-pepper error must NOT be exposable — its message must never reach a client");
  assert.equal((thrown as any).status, undefined, "no status => classified 500 by app.ts");
  // The message names the env var but NEVER its value.
  assert.equal(thrown!.message.includes(VALID_PEPPER), false,
    "the thrown error message must never embed the secret value");
});

test("5-static: the B3B2E modules never log the pepper and never place it in a response shape", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = [
    `${here}../lib/studentDeletionCandidateUniverse.ts`,
    `${here}../lib/studentDeletionManualResolution.ts`,
    `${here}../lib/studentDeletionAttributionPlanner.ts`,
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes("IDENTITY_PROVENANCE_PEPPER"), false,
      `${file} must not reference the pepper env var directly (it goes through fingerprintStudentEmail)`);
    assert.equal(/console\.(log|info|warn|error|debug)\s*\(|logger\.(info|warn|error|debug|trace)\s*\(/.test(src), false,
      `${file} must contain no logging calls at all`);
  }
});
