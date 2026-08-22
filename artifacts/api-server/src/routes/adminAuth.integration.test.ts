/**
 * Admin auth / RBAC substrate — real-route integration coverage for the
 * middleware and guards every other admin route depends on
 * (routes/adminAuth.ts): requireAdminAuth, requireAdminPermission,
 * System Users CRUD, Roles CRUD, and the Super Admin safety invariants
 * (self-lockout, last-active-Super-Admin, privilege-escalation).
 *
 * Phase 1 closure — see SYSTEM_USERS_ROLES_PERMISSIONS_INVESTIGATION_REPORT.md
 * §N ("Testing Gaps"): this substrate previously had zero dedicated tests.
 *
 * Same boot/auth/safety-gate conventions as
 * financeRolesPermissions.integration.test.ts, but against its own dedicated
 * disposable database (not the shared "hotfix" one) so the Super Admin count
 * invariants tested here — including the concurrent-deactivation race the
 * pg_advisory_xact_lock exists to close — are exact and not polluted by
 * fixtures from unrelated test files.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATABASE_URL = process.env.ADMIN_RBAC_DISPOSABLE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_admin_rbac";

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
delete process.env.REDIS_URL;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

// Boots the real built server (dist/index.mjs) as a subprocess — same reason
// as financeRolesPermissions.integration.test.ts (exceljs/esm interop under
// node:test's raw loader).
let child: ChildProcess;
let pool: typeof import("@workspace/db").pool;
let bcryptHash: (data: string, salt: number) => Promise<string>;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let port: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// POST /admin/users validates username against /^[a-z0-9_]+$/ with a 30-char
// max — `run` (used as a uniqueness suffix everywhere else) contains hyphens
// and is too long for that. API-facing usernames use this short, sanitized
// variant instead. Direct SQL fixture inserts bypass zod validation entirely
// and can keep using the full `run` value.
const runSlug = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Craft an admin JWT directly (bypassing login) — mirrors production: the
 * server re-derives identity/permissions from the DB on every request via
 * loadAdminIdentity(sub), so only `sub` is security-relevant here. */
function tokenFor(adminId: number, claims: Partial<{ isSuperAdmin: boolean; roleId: number | null }> = {}): string {
  return jwtSign(
    { sub: adminId, username: `admin-rbac-${adminId}`, isSuperAdmin: claims.isSuperAdmin ?? false, roleId: claims.roleId ?? null },
    ADMIN_JWT_SECRET,
  );
}

async function asAdmin(path: string, adminId: number, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(adminId),
      ...(init.headers ?? {}),
    },
  });
}

async function asToken(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": token,
      ...(init.headers ?? {}),
    },
  });
}

function waitForHealthy(baseUrl: string, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/healthz`);
        if (res.ok) { resolve(); return; }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) { reject(new Error("Server did not become healthy in time")); return; }
      setTimeout(attempt, 200);
    };
    void attempt();
  });
}

async function makeRole(label: string, permissions: Record<string, unknown>): Promise<number> {
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Admin RBAC ${label} ${run}`, JSON.stringify(permissions)],
  );
  return role.rows[0].id as number;
}

async function makeAdmin(label: string, opts: {
  roleId?: number | null;
  isSuperAdmin?: boolean;
  isActive?: boolean;
  passwordHash?: string;
} = {}): Promise<number> {
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      `admin-rbac-${label}-${run}`,
      `admin-rbac-${label}-${run}@example.com`,
      opts.passwordHash ?? "x",
      `Admin RBAC ${label}`,
      opts.isSuperAdmin ?? false,
      opts.isActive ?? true,
      opts.roleId ?? null,
    ],
  );
  return user.rows[0].id as number;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

let seededSuperAdminId: number; // migration 0007's seeded 'superadmin'

let noPermAdminId: number;
let viewOnlyAdminId: number;
let fullAdminUsersAdminId: number;
let fullRolesAdminId: number;
let inactiveAdminId: number;

let loginUserId: number;
const loginPassword = "Correct-Horse-Battery-Staple-1";
let loginUserHash: string;

let limitedRoleEditorId: number; // roles.create/edit/assignPermissions but no finance.view
let limitedRoleEditorRoleId: number;

before(async () => {
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const bcryptModule = await import("bcryptjs");
  bcryptHash = bcryptModule.default.hash;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, "..", "..", "dist", "index.mjs");
  port = 25000 + Math.floor(Math.random() * 5000);
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(port),
      NODE_ENV: "test",
    },
    stdio: "pipe",
  });
  await waitForHealthy(`http://127.0.0.1:${port}`, Date.now() + 15000);

  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true AND is_active = true LIMIT 1`);
  if (existingSuper.rows.length === 0) {
    throw new Error("Expected the migration-0007 seeded Super Admin to exist in the disposable DB");
  }
  seededSuperAdminId = existingSuper.rows[0].id as number;

  noPermAdminId = await makeAdmin("no-perm", { roleId: await makeRole("empty", {}) });
  viewOnlyAdminId = await makeAdmin("view-only", { roleId: await makeRole("view-only", { adminUsers: { view: true }, roles: { view: true } }) });
  fullAdminUsersAdminId = await makeAdmin("full-admin-users", {
    roleId: await makeRole("full-admin-users", {
      adminUsers: { view: true, create: true, edit: true, disable: true, assignRole: true },
      roles: { view: true },
    }),
  });
  fullRolesAdminId = await makeAdmin("full-roles", {
    roleId: await makeRole("full-roles", {
      roles: { view: true, create: true, edit: true, assignPermissions: true },
    }),
  });
  inactiveAdminId = await makeAdmin("inactive", { isActive: false });

  loginUserHash = await bcryptHash(loginPassword, 10);
  loginUserId = await makeAdmin("login", {
    passwordHash: loginUserHash,
    roleId: await makeRole("login", { adminUsers: { view: true } }),
  });

  limitedRoleEditorRoleId = await makeRole("limited-role-editor", {
    roles: { view: true, create: true, edit: true, assignPermissions: true },
    // deliberately NO finance.view — used to prove authority-scoping below
  });
  limitedRoleEditorId = await makeAdmin("limited-role-editor", { roleId: limitedRoleEditorRoleId });
});

after(async () => {
  child.kill();
  await pool.end();
});

// ─── Login ────────────────────────────────────────────────────────────────────

test("login succeeds with correct credentials and returns a usable token, no passwordHash", async () => {
  const res = await fetch(apiUrl("/api/admin/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
    body: JSON.stringify({ username: `admin-rbac-login-${run}`, password: loginPassword }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(typeof body.token, "string");
  const bodyText = JSON.stringify(body);
  assert.equal(bodyText.includes("passwordHash"), false);
  assert.equal(bodyText.toLowerCase().includes(loginUserHash.toLowerCase()), false);

  // The returned token must actually work against a protected route.
  const me = await fetch(apiUrl("/api/admin/auth/me"), {
    headers: { "x-api-key": "test-api-secret-key", "x-admin-token": body.token as string },
  });
  assert.equal(me.status, 200);
});

test("login fails with wrong password (401), no user enumeration via status code", async () => {
  const res = await fetch(apiUrl("/api/admin/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
    body: JSON.stringify({ username: `admin-rbac-login-${run}`, password: "wrong-password" }),
  });
  assert.equal(res.status, 401);
});

test("login fails for unknown username (401)", async () => {
  const res = await fetch(apiUrl("/api/admin/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
    body: JSON.stringify({ username: `admin-rbac-does-not-exist-${run}`, password: "whatever" }),
  });
  assert.equal(res.status, 401);
});

test("login fails for a deactivated account, even with the correct password", async () => {
  const hash = await bcryptHash("some-password-1", 10);
  await pool.query(`UPDATE system_users SET password_hash = $1 WHERE id = $2`, [hash, inactiveAdminId]);
  const res = await fetch(apiUrl("/api/admin/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
    body: JSON.stringify({ username: `admin-rbac-inactive-${run}`, password: "some-password-1" }),
  });
  assert.equal(res.status, 401);
});

// ─── requireAdminAuth ───────────────────────────────────────────────────────

test("requireAdminAuth rejects a request with no admin token (401)", async () => {
  const res = await fetch(apiUrl("/api/admin/users"), { headers: { "x-api-key": "test-api-secret-key" } });
  assert.equal(res.status, 401);
});

test("requireAdminAuth rejects a malformed/invalid admin token (401)", async () => {
  const res = await fetch(apiUrl("/api/admin/users"), {
    headers: { "x-api-key": "test-api-secret-key", "x-admin-token": "not-a-real-jwt" },
  });
  assert.equal(res.status, 401);
});

test("requireAdminAuth rejects a token for a deactivated account (401), DB-authoritative not JWT-cached", async () => {
  // A valid, unexpired token — but the account is inactive at request time.
  const res = await asAdmin("/api/admin/users", inactiveAdminId);
  assert.equal(res.status, 401);
});

test("requireAdminAuth rejects a token for a user id that no longer exists (401)", async () => {
  const res = await asAdmin("/api/admin/users", 987654321);
  assert.equal(res.status, 401);
});

test("JWT claims are cosmetic — a forged isSuperAdmin:true claim for a non-Super-Admin DB user is ignored (403, not 200)", async () => {
  const forgedToken = tokenFor(noPermAdminId, { isSuperAdmin: true });
  const res = await asToken("/api/admin/users", forgedToken);
  assert.equal(res.status, 403, "the server must re-derive isSuperAdmin from the DB, not trust the JWT payload");
});

// ─── requireAdminPermission ─────────────────────────────────────────────────

test("requireAdminPermission allows Super Admin regardless of role/permissions", async () => {
  const res = await asAdmin("/api/admin/users", seededSuperAdminId);
  assert.equal(res.status, 200);
  const rolesRes = await asAdmin("/api/admin/roles", seededSuperAdminId);
  assert.equal(rolesRes.status, 200);
});

test("requireAdminPermission allows a non-Super-Admin who holds the exact permission", async () => {
  const res = await asAdmin("/api/admin/users", viewOnlyAdminId);
  assert.equal(res.status, 200);
});

test("requireAdminPermission rejects a non-Super-Admin who lacks the permission (403), with the required permission named", async () => {
  const res = await asAdmin("/api/admin/users", noPermAdminId);
  assert.equal(res.status, 403);
  const body = await res.json() as { requiredPermission?: { module: string; action: string } };
  assert.deepEqual(body.requiredPermission, { module: "adminUsers", action: "view" });
});

// ─── System Users API — permission gating ──────────────────────────────────

test("GET /admin/users: 403 without adminUsers.view, 200 with it", async () => {
  assert.equal((await asAdmin("/api/admin/users", noPermAdminId)).status, 403);
  assert.equal((await asAdmin("/api/admin/users", viewOnlyAdminId)).status, 200);
});

test("GET /admin/users response never includes passwordHash for any row", async () => {
  const res = await asAdmin("/api/admin/users", viewOnlyAdminId);
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  assert.equal(bodyText.includes("passwordHash"), false);
  assert.equal(bodyText.includes("password_hash"), false);
});

test("POST /admin/users: 403 without adminUsers.create, 201 with it", async () => {
  const denied = await asAdmin("/api/admin/users", viewOnlyAdminId, {
    method: "POST",
    body: JSON.stringify({ username: `should_fail_${runSlug}`, email: `should-fail-${run}@example.com`, fullName: "Should Fail", password: "password123" }),
  });
  assert.equal(denied.status, 403);

  const allowed = await asAdmin("/api/admin/users", fullAdminUsersAdminId, {
    method: "POST",
    body: JSON.stringify({ username: `created_by_test_${runSlug}`, email: `created-by-test-${run}@example.com`, fullName: "Created By Test", password: "password123" }),
  });
  assert.equal(allowed.status, 201);
  const createdBody = await allowed.json() as Record<string, unknown>;
  assert.equal("passwordHash" in createdBody, false);
});

test("PATCH /admin/users/:id: edit/assignRole/disable are independently permission-gated", async () => {
  const target = await makeAdmin("patch-target", { roleId: await makeRole("patch-target", {}) });
  // Empty permissions — assigning "no extra permissions" is always within any
  // actor's authority (permissionsAreWithinAuthority only rejects a *granted*
  // permission the actor doesn't hold; fullAdminUsersAdminId's role has no
  // dashboard.view, so a non-empty target role would 403 here for a different,
  // unrelated reason than the one this test is isolating).
  const otherRoleId = await makeRole("reassign-target", {});

  // viewOnlyAdmin holds neither edit, assignRole, nor disable.
  const editDenied = await asAdmin(`/api/admin/users/${target}`, viewOnlyAdminId, {
    method: "PATCH", body: JSON.stringify({ fullName: "Changed Name" }),
  });
  assert.equal(editDenied.status, 403);

  const roleDenied = await asAdmin(`/api/admin/users/${target}`, viewOnlyAdminId, {
    method: "PATCH", body: JSON.stringify({ roleId: otherRoleId }),
  });
  assert.equal(roleDenied.status, 403);

  const disableDenied = await asAdmin(`/api/admin/users/${target}`, viewOnlyAdminId, {
    method: "PATCH", body: JSON.stringify({ isActive: false }),
  });
  assert.equal(disableDenied.status, 403);

  // fullAdminUsersAdmin holds all three.
  const editAllowed = await asAdmin(`/api/admin/users/${target}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ fullName: "Changed Name" }),
  });
  assert.equal(editAllowed.status, 200);

  const roleAllowed = await asAdmin(`/api/admin/users/${target}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ roleId: otherRoleId }),
  });
  assert.equal(roleAllowed.status, 200);

  const disableAllowed = await asAdmin(`/api/admin/users/${target}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ isActive: false }),
  });
  assert.equal(disableAllowed.status, 200);
});

// ─── Roles API — permission gating ──────────────────────────────────────────

test("GET /admin/roles: 403 without roles.view, 200 with it", async () => {
  assert.equal((await asAdmin("/api/admin/roles", noPermAdminId)).status, 403);
  assert.equal((await asAdmin("/api/admin/roles", viewOnlyAdminId)).status, 200);
});

test("POST /admin/roles: 403 without roles.create, 201 with it", async () => {
  const denied = await asAdmin("/api/admin/roles", viewOnlyAdminId, {
    method: "POST", body: JSON.stringify({ name: `Should Fail ${run}` }),
  });
  assert.equal(denied.status, 403);

  const allowed = await asAdmin("/api/admin/roles", fullRolesAdminId, {
    method: "POST", body: JSON.stringify({ name: `Created By Test ${run}` }),
  });
  assert.equal(allowed.status, 201);
});

test("PATCH /admin/roles/:id: 403 without roles.edit, 200 with it", async () => {
  const roleId = await makeRole("edit-target", {});
  const denied = await asAdmin(`/api/admin/roles/${roleId}`, viewOnlyAdminId, {
    method: "PATCH", body: JSON.stringify({ description: "nope" }),
  });
  assert.equal(denied.status, 403);

  const allowed = await asAdmin(`/api/admin/roles/${roleId}`, fullRolesAdminId, {
    method: "PATCH", body: JSON.stringify({ description: "updated" }),
  });
  assert.equal(allowed.status, 200);
});

// ─── Privilege-escalation guards ────────────────────────────────────────────

test("isSuperAdmin in the POST /admin/users body is rejected outright (400), even for a Super Admin caller", async () => {
  const res = await asAdmin("/api/admin/users", seededSuperAdminId, {
    method: "POST",
    body: JSON.stringify({
      username: `injected_${runSlug}`, email: `injected-${run}@example.com`, fullName: "Injected",
      password: "password123", isSuperAdmin: true,
    }),
  });
  assert.equal(res.status, 400);
  const created = await pool.query(`SELECT is_super_admin FROM system_users WHERE username = $1`, [`injected_${runSlug}`]);
  assert.equal(created.rows.length, 0, "the user must not have been created at all");
});

test("isSuperAdmin in the PATCH /admin/users/:id body is rejected outright (400)", async () => {
  const target = await makeAdmin("patch-injection-target");
  const res = await asAdmin(`/api/admin/users/${target}`, seededSuperAdminId, {
    method: "PATCH", body: JSON.stringify({ isSuperAdmin: true }),
  });
  assert.equal(res.status, 400);
  const row = await pool.query(`SELECT is_super_admin FROM system_users WHERE id = $1`, [target]);
  assert.equal(row.rows[0].is_super_admin, false);
});

test("a non-Super-Admin cannot assign a role permission they do not themselves hold (403), even with roles.assignPermissions", async () => {
  const res = await asAdmin("/api/admin/roles", limitedRoleEditorId, {
    method: "POST",
    body: JSON.stringify({ name: `Escalation Attempt ${run}`, permissions: { finance: { view: true } } }),
  });
  assert.equal(res.status, 403);
  const created = await pool.query(`SELECT id FROM roles WHERE name = $1`, [`Escalation Attempt ${run}`]);
  assert.equal(created.rows.length, 0);
});

test("a non-Super-Admin CAN assign a permission they themselves hold (positive control for the authority check above)", async () => {
  const res = await asAdmin("/api/admin/roles", limitedRoleEditorId, {
    method: "POST",
    body: JSON.stringify({ name: `Within Authority ${run}`, permissions: { roles: { view: true } } }),
  });
  assert.equal(res.status, 201);
});

test("a non-Super-Admin cannot modify their own assigned role's permissions (403)", async () => {
  const res = await asAdmin(`/api/admin/roles/${limitedRoleEditorRoleId}`, limitedRoleEditorId, {
    method: "PATCH", body: JSON.stringify({ permissions: { roles: { view: true, create: true } } }),
  });
  assert.equal(res.status, 403);
});

// ─── Self-lockout prevention ─────────────────────────────────────────────────

test("an admin cannot disable their own account, even with adminUsers.disable (400)", async () => {
  const res = await asAdmin(`/api/admin/users/${fullAdminUsersAdminId}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ isActive: false }),
  });
  assert.equal(res.status, 400);
  const row = await pool.query(`SELECT is_active FROM system_users WHERE id = $1`, [fullAdminUsersAdminId]);
  assert.equal(row.rows[0].is_active, true);
});

test("an admin cannot change their own role, even with adminUsers.assignRole (400)", async () => {
  const otherRoleId = await makeRole("self-reassign-target", {});
  const res = await asAdmin(`/api/admin/users/${fullAdminUsersAdminId}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ roleId: otherRoleId }),
  });
  assert.equal(res.status, 400);
});

test("only another Super Admin can modify a Super Admin account — a permission-holding ordinary admin cannot", async () => {
  const res = await asAdmin(`/api/admin/users/${seededSuperAdminId}`, fullAdminUsersAdminId, {
    method: "PATCH", body: JSON.stringify({ fullName: "Hijacked Name" }),
  });
  assert.equal(res.status, 403);
});

// ─── Last active Super Admin — including the concurrency race ──────────────

test("the sole active Super Admin cannot deactivate themselves (400) — self-disable guard covers this case too", async () => {
  const res = await asAdmin(`/api/admin/users/${seededSuperAdminId}`, seededSuperAdminId, {
    method: "PATCH", body: JSON.stringify({ isActive: false }),
  });
  assert.equal(res.status, 400);
});

test("deactivating one of two active Super Admins succeeds (count stays >= 1, no block)", async () => {
  const superB = await makeAdmin("super-b", { isSuperAdmin: true });
  const res = await asAdmin(`/api/admin/users/${superB}`, seededSuperAdminId, {
    method: "PATCH", body: JSON.stringify({ isActive: false }),
  });
  assert.equal(res.status, 200);
  const row = await pool.query(`SELECT is_active FROM system_users WHERE id = $1`, [superB]);
  assert.equal(row.rows[0].is_active, false);
});

test("concurrent mutual deactivation between the last two active Super Admins: exactly one wins, the last one is never removed", async () => {
  const superC = await makeAdmin("super-c", { isSuperAdmin: true });
  const superD = await makeAdmin("super-d", { isSuperAdmin: true });

  // Force the precondition directly rather than assuming prior tests' state
  // (e.g. `seededSuperAdminId`, still active from the self-disable test
  // above): every OTHER Super Admin is deactivated via SQL so exactly C and D
  // are the two active Super Admins racing below. This is the one place the
  // test touches Super Admin rows outside the API on purpose — it is setting
  // up an isolated precondition, not exercising the guard under test.
  await pool.query(
    `UPDATE system_users SET is_active = false WHERE is_super_admin = true AND id NOT IN ($1, $2)`,
    [superC, superD],
  );

  const activeBefore = await pool.query(`SELECT count(*) FROM system_users WHERE is_super_admin = true AND is_active = true`);
  assert.equal(Number(activeBefore.rows[0].count), 2, "test precondition: exactly 2 active Super Admins");

  const [resC, resD] = await Promise.all([
    asAdmin(`/api/admin/users/${superD}`, superC, { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
    asAdmin(`/api/admin/users/${superC}`, superD, { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
  ]);

  const statuses = [resC.status, resD.status].sort((a, b) => a - b);
  // Exactly one request must succeed (200) — never both (which would zero
  // out Super Admins). The loser is blocked either with 400 ("Cannot remove
  // the final active Super Admin", from the advisory-lock-guarded count
  // check) or 401 (its own account was the one just deactivated by the
  // winning request, so its concurrent requireAdminAuth re-check — DB-
  // authoritative on every request — now correctly rejects it too). Both are
  // safe outcomes; what must never happen is two 200s.
  assert.equal(statuses.filter((s) => s === 200).length, 1, `expected exactly one 200, got ${JSON.stringify(statuses)}`);
  assert.ok(
    statuses.includes(400) || statuses.includes(401),
    `expected the loser to be blocked with 400 or 401, got ${JSON.stringify(statuses)}`,
  );

  const activeAfter = await pool.query(`SELECT count(*) FROM system_users WHERE is_super_admin = true AND is_active = true`);
  assert.equal(Number(activeAfter.rows[0].count), 1, "exactly one Super Admin must remain active after the race");
});

test("Super Admin count invariant holds globally: at least one active Super Admin remains after the whole suite's mutations", async () => {
  const activeSuperAdmins = await pool.query(`SELECT count(*) FROM system_users WHERE is_super_admin = true AND is_active = true`);
  assert.ok(Number(activeSuperAdmins.rows[0].count) >= 1);
});
