import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { Server } from "node:http";

const url = process.env.DISPOSABLE_ROUTES_DATABASE_URL;
if (!url) throw new Error("Provide a disposable local QA database");
const target = new URL(url);
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("disposable"))
  throw new Error("Refusing non-disposable/non-local database");
process.env.DATABASE_URL = url;
process.env.ADMIN_JWT_SECRET = "attendance-filter-qa-only";
delete process.env.REDIS_URL;
let pool: typeof import("@workspace/db").pool;
let server: Server;
let base: string;
const tokens: Record<string, string> = {};
const email = `attendance-filter-${Date.now()}@example.invalid`;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  const express = (await import("express")).default;
  const bcrypt = (await import("bcryptjs")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", (await import("./adminAuth")).default, (await import("./attendance")).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api`;
  for (const [label, permissions] of Object.entries({ viewer: { attendance: { view: true } }, denied: {} })) {
    const role = (await pool.query("INSERT INTO roles(name,permissions) VALUES($1,$2) RETURNING id", [email + label, JSON.stringify(permissions)])).rows[0];
    await pool.query("INSERT INTO system_users(username,email,password_hash,full_name,role_id) VALUES($1,$2,$3,$4,$5)",
      [email + label, email + label, await bcrypt.hash("Synthetic-2026!", 4), "Synthetic filter viewer", role.id]);
    const login = await fetch(base + "/admin/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: email + label, password: "Synthetic-2026!" }) });
    assert.equal(login.status, 200);
    tokens[label] = ((await login.json()) as { token: string }).token;
  }
  for (const [schedule, timestamp] of [[900001, "2026-10-11T20:59:00Z"], [900001, "2026-10-11T21:01:00Z"], [900002, "2026-10-12T12:00:00Z"]] as const)
    await pool.query("INSERT INTO attendance(student_name,student_email,schedule_id,checked_in_at) VALUES($1,$2,$3,$4)", ["Synthetic filter record", email, schedule, timestamp]);
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
});
async function get(params: Record<string, string> = {}, role = "viewer") {
  return fetch(base + "/attendance?" + new URLSearchParams({ studentEmail: email, ...params }),
    { headers: { "x-admin-token": tokens[role] ?? "" } });
}
test("documented filters, counts and pagination use Cairo calendar dates", async () => {
  for (const [params, total] of [[{}, 3], [{ scheduleId: "900001" }, 2], [{ date: "2026-10-12" }, 2],
    [{ scheduleId: "900001", date: "2026-10-12" }, 1], [{ date: "2026-10-11" }, 1]] as const) {
    const response = await get(params);
    assert.equal(response.status, 200);
    const body = await response.json() as Array<{ id: number }>;
    assert.equal(Number(response.headers.get("X-Total-Count")), total);
    assert.equal(body.length, total);
  }
  const firstResponse = await get({ date: "2026-10-12", pageSize: "1", page: "1" });
  const secondResponse = await get({ date: "2026-10-12", pageSize: "1", page: "2" });
  const first = await firstResponse.json() as Array<{ id: number }>;
  const second = await secondResponse.json() as typeof first;
  assert.equal(Number(firstResponse.headers.get("X-Total-Count")), 2);
  assert.equal(Number(secondResponse.headers.get("X-Total-Count")), 2);
  assert.equal(first.length, 1);
  assert.notEqual(first[0].id, second[0].id);
});
test("invalid documented filters fail closed", async () => {
  for (const params of [{ scheduleId: "invalid" }, { scheduleId: "0" }, { scheduleId: "1.5" },
    { date: "2026-02-30" }, { date: "0000-01-01" }, { date: "invalid" }] as Array<Record<string, string>>)
    assert.equal((await get(params)).status, 400);
});
test("filters cannot bypass attendance permissions", async () => {
  assert.equal((await get({ scheduleId: "900001" }, "denied")).status, 403);
  assert.equal((await get({ date: "2026-10-12" }, "anonymous")).status, 401);
});
