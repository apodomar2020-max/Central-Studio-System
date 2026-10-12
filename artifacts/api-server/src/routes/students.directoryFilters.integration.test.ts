import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { Server } from "node:http";

const databaseUrl = process.env.DISPOSABLE_USERS_DIRECTORY_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DISPOSABLE_USERS_DIRECTORY_DATABASE_URL to a disposable localhost database.",
  );
const parsedUrl = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1"].includes(parsedUrl.hostname) ||
  !/disposable/.test(parsedUrl.pathname) ||
  /railway|rlwy/i.test(databaseUrl)
) {
  throw new Error("Refusing a non-local/non-disposable database");
}
process.env.DATABASE_URL = databaseUrl;
process.env.ADMIN_JWT_SECRET = "directory-test-secret-only";
let pool: typeof import("@workspace/db").pool;
let server: Server;
let base: string;
const prefix = `Directory QA ${Date.now()}`;
const tokens: Record<string, string> = {};
const fixtureIds: number[] = [];
const adminIds: number[] = [];
const roleIds: number[] = [];
const bcrypt = await import("bcryptjs");

before(async () => {
  const express = (await import("express")).default;
  const admin = (await import("./adminAuth")).default;
  const students = (await import("./students")).default;
  pool = (await import("@workspace/db")).pool;
  const app = express();
  app.use(express.json());
  app.use("/api", admin, students);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api`;
  for (const [name, permissions] of Object.entries({
    students: { students: { view: true } },
    parents: { parents: { view: true } },
    combined: { students: { view: true }, parents: { view: true } },
    users: { users: { view: true } },
    none: {},
  })) {
    const role = await pool.query(
      "INSERT INTO roles(name,permissions) VALUES($1,$2) RETURNING id",
      [prefix + name, JSON.stringify(permissions)],
    );
    roleIds.push(role.rows[0].id);
    const row = await pool.query(
      "INSERT INTO system_users(username,email,password_hash,full_name,role_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        (prefix + name).toLowerCase(),
        `${name}-${Date.now()}@example.invalid`,
        await bcrypt.default.hash("Directory-test-2026!", 4),
        name,
        role.rows[0].id,
      ],
    );
    adminIds.push(row.rows[0].id);
    const login = await fetch(base + "/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: prefix + name,
        password: "Directory-test-2026!",
      }),
    });
    assert.equal(login.status, 200);
    tokens[name] = ((await login.json()) as { token: string }).token;
  }
  let sequence = 0;
  for (const type of ["student", "parent", null]) {
    for (const status of ["active", "deactivated", "deleted"]) {
      for (const provider of ["local", "google", "apple", "facebook", null]) {
        sequence++;
        const row = await pool.query(
          `INSERT INTO students(name,email,phone,account_type,account_status,auth_provider,joined_at)
          VALUES($1,$2,NULL,$3,$4,$5,$6) RETURNING id`,
          [
            `${prefix} ${status} ${type ?? "legacy"} ${sequence}`,
            `directory-${Date.now()}-${sequence}@example.invalid`,
            type,
            status,
            status === "deleted" ? null : provider,
            "2026-09-15T12:00:00Z",
          ],
        );
        fixtureIds.push(row.rows[0].id);
      }
    }
  }
});

after(async () => {
  if (pool) {
    await pool.query("DELETE FROM students WHERE id = ANY($1::int[])", [
      fixtureIds,
    ]);
    await pool.query("DELETE FROM system_users WHERE id = ANY($1::int[])", [
      adminIds,
    ]);
    await pool.query("DELETE FROM roles WHERE id = ANY($1::int[])", [roleIds]);
  }
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (pool) await pool.end();
});

async function list(role: string, params: Record<string, string> = {}) {
  return fetch(
    base + "/students?" + new URLSearchParams({ search: prefix, ...params }),
    { headers: { "x-admin-token": tokens[role] ?? "" } },
  );
}

function readList(
  response: Response,
): Promise<{
  students: Array<{
    id: number;
    accountStatus: string;
    accountType: string | null;
  }>;
  total: number;
  totalPages: number;
}> {
  return response.json() as ReturnType<typeof readList>;
}

test("omitted lifecycle parameters retain the authorized all-status population", async () => {
  for (const [role, expected] of [
    ["students", 30],
    ["parents", 15],
    ["combined", 45],
    ["users", 45],
  ] as const) {
    const response = await list(role);
    assert.equal(response.status, 200);
    const body = await readList(response);
    assert.equal(body.total, expected);
    assert.deepEqual(
      new Set(body.students.map((row: any) => row.accountStatus)),
      new Set(["active", "deactivated", "deleted"]),
    );
    for (const row of body.students)
      for (const key of [
        "passwordHash",
        "qrToken",
        "googleId",
        "appleId",
        "facebookId",
      ])
        assert.equal(key in row, false);
  }
});

test("active directories and inactive totals include legacy student types without duplicate rows", async () => {
  for (const [params, expected] of [
    [{ accountType: "student", accountStatus: "active" }, 10],
    [{ accountType: "parent", accountStatus: "active" }, 5],
    [{ accountStatus: "inactive" }, 30],
    [{ accountStatus: "deactivated" }, 15],
    [{ accountStatus: "deleted" }, 15],
  ] as const) {
    const body = await readList(await list("users", params));
    assert.equal(body.total, expected);
    assert.equal(
      new Set(body.students.map((row: any) => row.id)).size,
      expected,
    );
  }
});

test("filters cannot widen account-type permissions or totals", async () => {
  for (const [role, forbidden, permittedTotal] of [
    ["students", "parent", 20],
    ["parents", "student", 10],
  ] as const) {
    assert.equal(
      (await list(role, { accountType: forbidden, accountStatus: "inactive" }))
        .status,
      403,
    );
    const body = await readList(
      await list(role, { accountStatus: "inactive" }),
    );
    assert.equal(body.total, permittedTotal);
    assert.ok(
      body.students.every((row: any) =>
        role === "parents"
          ? row.accountType === "parent"
          : row.accountType !== "parent",
      ),
    );
  }
  assert.equal((await list("none", { accountStatus: "inactive" })).status, 403);
  assert.equal((await list("anonymous")).status, 401);
});

test("provider and inclusive UTC dates filter before pagination, including cleared providers", async () => {
  const params = {
    accountStatus: "inactive",
    authProvider: "google",
    joinedFrom: "2026-09-15",
    joinedTo: "2026-09-15",
    pageSize: "1",
  };
  const first = await readList(await list("users", params));
  assert.equal(first.total, 3);
  assert.equal(first.students.length, 1);
  assert.equal(first.totalPages, 3);
  const ids: number[] = [];
  for (const page of ["1", "2", "3"])
    ids.push(
      (await readList(await list("users", { ...params, page }))).students[0].id,
    );
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => b - a),
  );
  assert.equal(
    (
      await readList(
        await list("users", {
          accountStatus: "inactive",
          authProvider: "notRecorded",
        }),
      )
    ).total,
    18,
  );
  assert.equal(
    (await readList(await list("users", { joinedFrom: "2026-09-16" }))).total,
    0,
  );
  assert.equal(
    (await readList(await list("users", { joinedTo: "2026-09-14" }))).total,
    0,
  );
});

test("invalid filters and impossible/reversed dates are rejected", async () => {
  for (const params of [
    { accountStatus: "suspended" },
    { accountType: "child" },
    { authProvider: "manual" },
    { joinedFrom: "2026-02-30" },
    { joinedFrom: "0000-01-01" },
    { joinedFrom: "not-a-date" },
    { joinedFrom: "2026-09-16", joinedTo: "2026-09-15" },
    { pageSize: "201" },
  ] as Record<string, string>[]) {
    assert.equal(
      (await list("users", params)).status,
      400,
      JSON.stringify(params),
    );
  }
});

test("search and lifecycle updates recalculate counts without changing history", async () => {
  const id = fixtureIds[0];
  const original = (
    await pool.query("SELECT name FROM students WHERE id=$1", [id])
  ).rows[0].name;
  const params = { search: original, accountStatus: "active" };
  assert.equal((await readList(await list("users", params))).total, 1);
  await pool.query(
    "UPDATE students SET account_status='deactivated' WHERE id=$1",
    [id],
  );
  assert.equal((await readList(await list("users", params))).total, 0);
  assert.equal(
    (
      await readList(
        await list("users", { ...params, accountStatus: "inactive" }),
      )
    ).total,
    1,
  );
});

test("permitted inactive detail reads retain type authorization and anonymized tombstones", async () => {
  const student = fixtureIds[5];
  const parent = fixtureIds[20];
  const detail = (id: number, role: string) =>
    fetch(base + "/students/" + id, {
      headers: { "x-admin-token": tokens[role] },
    });
  assert.equal((await detail(student, "students")).status, 200);
  assert.equal((await detail(student, "parents")).status, 403);
  assert.equal((await detail(parent, "parents")).status, 200);
  assert.equal((await detail(parent, "students")).status, 403);
  const tombstone = fixtureIds[10];
  await pool.query(
    "UPDATE students SET name=$1,email=$2,phone=NULL,auth_provider=NULL WHERE id=$3",
    [
      `Deleted Student #${tombstone}`,
      `deleted-student-${tombstone}@tombstone.invalid`,
      tombstone,
    ],
  );
  const response = await detail(tombstone, "students");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    name: string;
    email: string;
    accountStatus: string;
    phone: string | null;
  };
  assert.equal(body.accountStatus, "deleted");
  assert.equal(body.name, `Deleted Student #${tombstone}`);
  assert.equal(body.email, `deleted-student-${tombstone}@tombstone.invalid`);
  assert.equal(body.phone, null);
});
