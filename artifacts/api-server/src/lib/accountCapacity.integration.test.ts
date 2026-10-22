/** Real HTTP routes + independent PostgreSQL transactions. Run only through the
 * disposable-cluster harness; never accepts a production or default DB URL. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { Server } from "node:http";

const url = process.env.LIMITS_DISPOSABLE_DATABASE_URL;
if (!url) throw new Error("Use the disposable account-capacity harness");
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.startsWith("/central_limits_disposable")) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";
process.env.STUDENT_JWT_SECRET = "limits-student-fixture-only";
process.env.ADMIN_JWT_SECRET = "limits-admin-fixture-only";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let server: Server;
let base: string;
let pool: typeof import("@workspace/db").pool;
let sign: typeof import("jsonwebtoken").sign;
let scheduleId: number;
let levelId: number;
let adminId: number;
const occurrence = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
let serial = 0;

before(async () => {
  const express = (await import("express")).default;
  sign = (await import("jsonwebtoken")).default.sign;
  pool = (await import("@workspace/db")).pool;
  const app = express();
  app.use(express.json());
  app.use((await import("../middlewares/auth")).requireAuth);
  app.use((await import("../routes/children")).default);
  app.use((await import("../routes/ballet")).default);
  app.use((await import("../routes/adminBallet")).default);
  app.use((await import("../routes/balletCancellationRefunds")).default);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.status ? err.message : "Internal server error" }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  levelId = (await pool.query("insert into ballet_levels(name,age_min,age_max) values ('Fixture level',0,99) returning id")).rows[0].id;
  const cls = (await pool.query("insert into ballet_classes(title,level_id) values ('Fixture assessment',$1) returning id", [levelId])).rows[0].id;
  scheduleId = (await pool.query("insert into ballet_schedules(class_id,day_of_week,start_time,end_time) values ($1,$2,'12:00','13:00') returning id", [cls, new Date(`${occurrence}T12:00:00Z`).getUTCDay()])).rows[0].id;
  adminId = (await pool.query("insert into system_users(username,email,password_hash,full_name,is_super_admin) values ('limits-admin','admin@fixture.invalid','fixture','Fixture Admin',true) returning id")).rows[0].id;
});
after(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); await pool?.end(); });
async function parent(type = "parent") {
  const email = `parent-${++serial}@fixture.invalid`;
  const id = (await pool.query("insert into students(name,email,password_hash,account_type,email_verified) values ('Fixture Parent',$1,'fixture',$2,true) returning id", [email, type])).rows[0].id;
  return { id, token: sign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!) };
}
type Parent = Awaited<ReturnType<typeof parent>>;
async function request(p: Parent, path: string, body?: unknown, method = "POST") {
  return fetch(base + path, { method, headers: { authorization: `Bearer ${p.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function child(p: Parent, name = `Fixture Child ${++serial}`) {
  return (await pool.query("insert into children(parent_id,full_name,birthday) values($1,$2,'2018-01-01') returning id", [p.id, name])).rows[0].id as number;
}
async function application(p: Parent, id: number | null, status = "pending", name = `Fixture Child ${++serial}`) {
  return (await pool.query("insert into ballet_applications(parent_student_id,child_id,parent_name,parent_phone,parent_email,child_name,child_birthday,status) values($1,$2,'Fixture','000','fixture@example.invalid',$3,'2018-01-01',$4) returning id", [p.id, id, name, status])).rows[0].id as number;
}
function body(id?: number, name = `New Fixture ${++serial}`) {
  return { parentName: "Fixture", parentPhone: "000", parentEmail: "fixture@example.invalid", childName: name, childBirthday: "2018-01-01", previousExperience: false, assessmentScheduleId: scheduleId, assessmentDate: occurrence, preferredPaymentMethod: "inPerson", ...(id ? { childId: id } : {}) };
}
async function responseBody(r: Response): Promise<{ code?: string; limit?: number; currentCount?: number; existingApplicationId?: number; child: { parentId: number } }> {
  return await r.json() as { code?: string; limit?: number; currentCount?: number; existingApplicationId?: number; child: { parentId: number } };
}
const createBody = { fullName: "Created Fixture", birthday: "2018-01-01", gender: "female" };
async function count(table: "children" | "ballet_applications", id: number) {
  return (await pool.query(`select count(*)::int n from ${table} where ${table === "children" ? "parent_id" : "parent_student_id"}=$1`, [id])).rows[0].n;
}

for (const n of [0, 1, 3, 4, 5, 8]) test(`profile admission at ${n} children, existing management preserved`, async () => {
  const p = await parent(); const ids = [];
  for (let i = 0; i < n; i++) ids.push(await child(p));
  const r = await request(p, "/children", { ...createBody, parentId: 99999 });
  assert.equal(r.status, n < 4 ? 201 : 422);
  const data = await responseBody(r);
  if (n >= 4) assert.deepEqual({ code: data.code, limit: data.limit, currentCount: data.currentCount }, { code: "CHILD_PROFILE_LIMIT_REACHED", limit: 4, currentCount: n });
  else assert.equal(data.child.parentId, p.id);
  assert.equal(await count("children", p.id), n + (n < 4 ? 1 : 0));
  if (ids.length) assert.equal((await request(p, `/children/${ids[0]}`, { fullName: "Edited Fixture" }, "PATCH")).status, 200);
  assert.equal((await request(p, "/children", undefined, "GET")).status, 200);
});

test("profile creation preserves existing student-type role behavior and isolation", async () => {
  const p = await parent("student"); const other = await parent(); const id = await child(other);
  assert.equal((await request(p, "/children", createBody)).status, 201);
  assert.equal((await request(p, `/children/${id}`, { fullName: "Wrong owner" }, "PATCH")).status, 404);
  assert.equal((await request(p, "/ballet/applications", body(id))).status, 403);
  assert.equal((await fetch(base + "/children", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody) })).status, 401);
});

for (const status of ["pending", "needsFollowUp", "accepted", "assignedToLevel", "active", "rejected", "cancelled", "withdrawn"]) test(`Ballet status ${status} counts according to canonical policy`, async () => {
  const p = await parent(); const a = await child(p); const b = await child(p); const c = await child(p);
  await application(p, a, "active"); await application(p, b, status);
  const r = await request(p, "/ballet/applications", body(c));
  const open = ["pending", "needsFollowUp", "accepted", "assignedToLevel", "active"].includes(status);
  assert.equal(r.status, open ? 422 : 201, JSON.stringify(await r.clone().json()));
  if (open) assert.equal((await responseBody(r)).code, "BALLET_CHILD_LIMIT_REACHED");
});

test("zero/one journeys admit; four profiles permit an existing child; over-limit journeys retained", async () => {
  for (const n of [0, 1, 2, 3]) {
    const p = await parent(); const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await child(p));
    for (let i = 0; i < n; i++) await application(p, ids[i]);
    assert.equal((await request(p, "/ballet/applications", body(ids[3]))).status, n < 2 ? 201 : 422);
    assert.equal(await count("ballet_applications", p.id), n + (n < 2 ? 1 : 0));
  }
});

test("same-child 409 takes precedence over full Ballet capacity; foreign ownership remains 403", async () => {
  const p = await parent(); const other = await parent(); const a = await child(p); const b = await child(p);
  const appId = await application(p, a); await application(p, b);
  const r = await request(p, "/ballet/applications", body(a));
  assert.equal(r.status, 409); const data = await responseBody(r);
  assert.equal(data.code, "DUPLICATE_APPLICATION"); assert.equal(data.existingApplicationId, appId);
  assert.equal((await request(p, "/ballet/applications", body(await child(other)))).status, 403);
});

test("manual autosave reuses profile at four, rejects new profile and rolls back failed admission", async () => {
  const p = await parent(); for (let i = 0; i < 4; i++) await child(p, `Manual Fixture ${i}`);
  assert.equal((await request(p, "/ballet/applications", body(undefined, "Manual Fixture 0"))).status, 201);
  assert.equal(await count("children", p.id), 4);
  const r = await request(p, "/ballet/applications", body()); assert.equal(r.status, 422);
  assert.equal((await responseBody(r)).code, "CHILD_PROFILE_LIMIT_REACHED");
  const q = await parent(); await application(q, await child(q)); await application(q, await child(q));
  const before = await count("children", q.id);
  assert.equal((await request(q, "/ballet/applications", body())).status, 422);
  assert.equal(await count("children", q.id), before);
  assert.equal(await count("ballet_applications", q.id), 2);
});

test("legacy identity counting preserves linked IDs, unlinked records and unattributed history", async () => {
  const p = await parent(); const a = await child(p); const b = await child(p);
  await application(p, a, "pending", "Different snapshot");
  const unlinked = await application(p, null, "accepted", "Legacy Fixture");
  await pool.query("insert into ballet_applications(parent_name,parent_phone,parent_email,child_name,status) values('Fixture','000','fixture@example.invalid','Unattributed Fixture','active')");
  assert.equal((await request(p, "/ballet/applications", body(b))).status, 422);
  await pool.query("update ballet_applications set status='withdrawn' where id=$1", [unlinked]);
  assert.equal((await request(p, "/ballet/applications", body(b))).status, 201);
});

test("concurrent profile requests stop at four, independent accounts each progress", async () => {
  const p = await parent(); const q = await parent();
  for (let i = 0; i < 3; i++) { await child(p); await child(q); }
  const results = await Promise.all([request(p, "/children", createBody), request(p, "/children", createBody), request(q, "/children", createBody)]);
  assert.deepEqual(results.slice(0, 2).map(r => r.status).sort(), [201, 422]);
  assert.equal(results[2].status, 201); assert.equal(await count("children", p.id), 4); assert.equal(await count("children", q.id), 4);
});

test("concurrent distinct Ballet children stop at two; same-child race returns duplicate", async () => {
  const p = await parent(); const ids = [await child(p), await child(p), await child(p)]; await application(p, ids[0]);
  assert.deepEqual((await Promise.all([request(p, "/ballet/applications", body(ids[1])), request(p, "/ballet/applications", body(ids[2]))])).map(r => r.status).sort(), [201, 422]);
  assert.equal(await count("ballet_applications", p.id), 2);
  const q = await parent(); const id = await child(q);
  assert.deepEqual((await Promise.all([request(q, "/ballet/applications", body(id)), request(q, "/ballet/applications", body(id))])).map(r => r.status).sort(), [201, 409]);
});

test("manual autosave and standalone creation share the same account lock", async () => {
  const p = await parent(); for (let i = 0; i < 3; i++) await child(p);
  const results = await Promise.all([request(p, "/ballet/applications", body()), request(p, "/children", createBody)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 422]);
  assert.equal(await count("children", p.id), 4);
});

test("concurrent identical manual requests save a single child/application/event", async () => {
  const p = await parent(); const name = `Manual race ${++serial}`;
  const results = await Promise.all([request(p, "/ballet/applications", body(undefined, name)), request(p, "/ballet/applications", body(undefined, name))]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await count("children", p.id), 1); assert.equal(await count("ballet_applications", p.id), 1);
});

test("cancel races with Admin status change without reopening a terminal journey", async () => {
  const p = await parent(); const id = await application(p, await child(p));
  const admin = sign({ sub: adminId, username: "limits-admin", isSuperAdmin: true, roleId: null }, process.env.ADMIN_JWT_SECRET!);
  const results = await Promise.all([
    request(p, `/ballet/applications/${id}/cancel`, { reason: "Fixture cancellation" }),
    fetch(base + `/admin/ballet/applications/${id}/status`, { method: "PATCH", headers: { "content-type": "application/json", "x-admin-token": admin }, body: JSON.stringify({ status: "needsFollowUp" }) }),
  ]);
  assert.equal(results[0].status, 200);
  assert.ok([200, 422].includes(results[1].status));
  assert.equal((await pool.query("select status from ballet_applications where id=$1", [id])).rows[0].status, "cancelled");
});

test("failed event write rolls back manual child and application", async () => {
  const p = await parent();
  await pool.query("create function limits_fixture_fail_event() returns trigger language plpgsql as $$ begin raise exception 'fixture event failure'; end $$");
  await pool.query("create trigger limits_fixture_fail_event before insert on ballet_application_events for each row execute function limits_fixture_fail_event()");
  try {
    assert.equal((await request(p, "/ballet/applications", body())).status, 500);
    assert.equal(await count("children", p.id), 0); assert.equal(await count("ballet_applications", p.id), 0);
  } finally {
    await pool.query("drop trigger limits_fixture_fail_event on ballet_application_events");
    await pool.query("drop function limits_fixture_fail_event()");
  }
});

for (const status of ["rejected", "cancelled", "withdrawn"]) test(`same linked child may reapply after ${status}`, async () => {
  const p = await parent(); const id = await child(p); await application(p, id, status);
  assert.equal((await request(p, "/ballet/applications", body(id))).status, 201);
});

test("manual linked duplicates preserve 409 and separate saved profiles keep separate identities", async () => {
  const p = await parent(); const first = await child(p, "Identical Fixture"); const second = await child(p, "Identical Fixture");
  await application(p, first, "pending", "Identical Fixture");
  assert.equal((await request(p, "/ballet/applications", body(undefined, "Identical Fixture"))).status, 409);
  assert.equal((await request(p, "/ballet/applications", body(second, "Identical Fixture"))).status, 201);
  const third = await child(p);
  assert.equal((await request(p, "/ballet/applications", body(third))).status, 422);
});

test("legacy same-identity linked/unlinked gap is preserved rather than silently merged", async () => {
  const p = await parent(); const id = await child(p, "Legacy Same Fixture");
  const legacy = await application(p, null, "pending", "Legacy Same Fixture");
  assert.equal((await request(p, "/ballet/applications", body(id, "Legacy Same Fixture"))).status, 201);
  assert.equal((await pool.query("select child_id from ballet_applications where id=$1", [legacy])).rows[0].child_id, null);
  assert.equal((await request(p, "/ballet/applications", body(await child(p)))).status, 422);
});

for (const operation of ["status", "assign-level"]) test(`stale Admin ${operation} cannot resurrect a cancelled application`, async () => {
  const p = await parent(); const id = await application(p, await child(p), operation === "status" ? "pending" : "accepted");
  const blocker = await pool.connect();
  const admin = sign({ sub: adminId, username: "limits-admin", isSuperAdmin: true, roleId: null }, process.env.ADMIN_JWT_SECRET!);
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query("begin");
    const pid = (await blocker.query("select pg_backend_pid() pid")).rows[0].pid;
    await blocker.query("select id from ballet_applications where id=$1 for update", [id]);
    pending = fetch(base + `/admin/ballet/applications/${id}/${operation}`, { method: operation === "status" ? "PATCH" : "POST", headers: { "content-type": "application/json", "x-admin-token": admin }, body: JSON.stringify(operation === "status" ? { status: "needsFollowUp" } : { levelId }) });
    const deadline = Date.now() + 5000; let blocked = false;
    while (Date.now() < deadline) {
      blocked = (await pool.query("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) blocked", [pid])).rows[0].blocked;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blocked, "Admin request reached its transactional row lock after the preliminary read");
    await blocker.query("update ballet_applications set status='cancelled' where id=$1", [id]);
    await blocker.query("commit");
    assert.equal((await pending).status, 422);
    assert.equal((await pool.query("select status from ballet_applications where id=$1", [id])).rows[0].status, "cancelled");
  } finally { await blocker.query("rollback"); blocker.release(); if (pending) await pending; }
});

test("cancellation and admission keep the account within capacity and allow retry after release", async () => {
  const p = await parent(); const a = await application(p, await child(p)); await application(p, await child(p)); const next = await child(p);
  const [cancel, submit] = await Promise.all([request(p, `/ballet/applications/${a}/cancel`, { reason: "Fixture release" }), request(p, "/ballet/applications", body(next))]);
  assert.equal(cancel.status, 200); assert.ok([201, 422].includes(submit.status));
  if (submit.status === 422) assert.equal((await request(p, "/ballet/applications", body(next))).status, 201);
  const current = (await pool.query("select count(distinct child_id)::int n from ballet_applications where parent_student_id=$1 and status in ('pending','needsFollowUp','accepted','assignedToLevel','active')", [p.id])).rows[0].n;
  assert.equal(current, 2);
});

test("Worker withdrawal releases capacity only when the application becomes terminal", async () => {
  const p = await parent(); const first = await child(p); const second = await child(p); const next = await child(p);
  const appId = await application(p, first, "active"); await application(p, second, "active");
  const assignment = (await pool.query("insert into ballet_level_assignments(application_id,child_id,level_id,status) values($1,$2,$3,'active') returning id", [appId, first, levelId])).rows[0].id;
  const cancellation = (await pool.query("insert into ballet_enrollment_cancellation_requests(application_id,level_assignment_id,child_id,parent_student_id,reason,requested_timing,status) values($1,$2,$3,$4,'Fixture withdrawal','immediate','approved') returning id", [appId, assignment, first, p.id])).rows[0].id;
  assert.equal((await request(p, "/ballet/applications", body(next))).status, 422);
  const { processBalletCancellationFinalizationJob } = await import("./balletCancellationFinalization");
  await processBalletCancellationFinalizationJob({ type: "finalize_cancellation_request", requestId: cancellation, source: "scheduler" });
  assert.equal((await pool.query("select status from ballet_applications where id=$1", [appId])).rows[0].status, "withdrawn");
  assert.equal((await request(p, "/ballet/applications", body(next))).status, 201);
  assert.equal(await count("ballet_applications", p.id), 3);
});


test("Ballet admission completes under connection-pool pressure", { timeout: 15000 }, async () => {
  const p = await parent(); const ids: number[] = [];
  for (let i = 0; i < 15; i++) ids.push(await child(p));
  const results = await Promise.all(ids.map(id => request(p, "/ballet/applications", body(id))));
  assert.equal(results.filter(r => r.status === 201).length, 2);
  assert.equal(results.filter(r => r.status === 422).length, 13);
  assert.equal(await count("ballet_applications", p.id), 2);
});


test("over-limit current journeys remain viewable and may progress without allocating a place", async () => {
  const p = await parent(); const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await application(p, await child(p)));
  const list = await request(p, "/ballet/applications/my", undefined, "GET");
  assert.equal(list.status, 200);
  const listed = await list.json() as { applications: { id: number }[] };
  assert.equal(listed.applications.length, 3);
  const admin = sign({ sub: adminId, username: "limits-admin", isSuperAdmin: true, roleId: null }, process.env.ADMIN_JWT_SECRET!);
  const r = await fetch(base + `/admin/ballet/applications/${ids[0]}/status`, { method: "PATCH", headers: { "content-type": "application/json", "x-admin-token": admin }, body: JSON.stringify({ status: "needsFollowUp" }) });
  assert.equal(r.status, 200);
  assert.equal(await count("ballet_applications", p.id), 3);
});
