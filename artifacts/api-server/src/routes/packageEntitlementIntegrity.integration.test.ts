import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const url = process.env.DISPOSABLE_ENTITLEMENT_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
  || !/disposable/.test(new URL(url).pathname)) throw new Error("A disposable localhost database is required.");
process.env.DATABASE_URL = url;
process.env.STUDENT_JWT_SECRET = "entitlement-test-student";
process.env.ADMIN_JWT_SECRET = "entitlement-test-admin";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let dbModule: typeof import("@workspace/db");
let server: import("node:http").Server;
let port: number;
let sign: (payload: object, secret: string) => string;
let adminId: number;
let danceId: number;
let otherDanceId: number;
let suffix: string;
let resolveCredit: typeof import("../lib/bookings/resolveParticipantPackageCredit").resolveParticipantPackageCredit;

before(async () => {
  suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbModule = await import("@workspace/db");
  sign = (await import("jsonwebtoken")).default.sign;
  ({ resolveParticipantPackageCredit: resolveCredit } = await import("../lib/bookings/resolveParticipantPackageCredit"));
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", (await import("../middlewares/auth")).requireAuth);
  for (const router of ["pricePackages", "packageOrders", "bookings", "checkIn", "attendance"]) {
    app.use("/api", (await import(`./${router}.ts`)).default);
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  port = (server.address() as import("node:net").AddressInfo).port;
  const pool = dbModule.pool;
  adminId = (await pool.query(`INSERT INTO system_users (username,email,password_hash,full_name,is_super_admin)
    VALUES ($1,$2,'test','Entitlement Admin',true) RETURNING id`, [`ent-${suffix}`, `ent-${suffix}@example.com`])).rows[0].id;
  const dances = await pool.query(`INSERT INTO dance_types (name,slug) VALUES ('Fixture Dance',$1),('Other Fixture Dance',$2) RETURNING id`, [`ent-${suffix}`, `other-${suffix}`]);
  [danceId, otherDanceId] = dances.rows.map((row) => row.id);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dbModule.pool.end();
});

async function account() {
  const email = `fixture-${suffix}-${Math.random().toString(36).slice(2)}@example.com`;
  const row = (await dbModule.pool.query(`INSERT INTO students (name,email,account_type,date_of_birth,email_verified)
    VALUES ('Fixture', $1,'student','1995-01-01',true) RETURNING id,qr_token`, [email])).rows[0];
  return { id: row.id as number, email, qrToken: row.qr_token as string };
}
async function catalogue(restricted = true, legacy = false) {
  const id = (await dbModule.pool.query(`INSERT INTO price_packages
    (name,price_egp,sessions,allow_all_ages,allowed_dance_types) VALUES ('Fixture Package',400,4,true,$1) RETURNING id`,
    [restricted || legacy ? ["Fixture Dance"] : []])).rows[0].id as number;
  if (restricted) await dbModule.pool.query(`INSERT INTO price_package_dance_types VALUES ($1,$2)`, [id, danceId]);
  return id;
}
async function request(path: string, body?: object, method = "POST", owner?: Awaited<ReturnType<typeof account>>) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) headers.authorization = `Bearer ${sign({ sub: owner.id, email: owner.email, type: "student" }, process.env.STUDENT_JWT_SECRET!)}`;
  else headers["x-admin-token"] = sign({ sub: adminId, username: "fixture", isSuperAdmin: true }, process.env.ADMIN_JWT_SECRET!);
  return fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function orderFixture(options: { ids?: number[] | null; state?: string | null; packageId?: number | null } = {}) {
  const owner = await account();
  const packageId = options.packageId === undefined ? await catalogue() : options.packageId;
  const ids = options.ids === undefined ? [danceId] : options.ids;
  const orderId = (await dbModule.pool.query(`INSERT INTO package_orders
    (student_name,student_email,student_id,participant_type,package_id,package_name,total_credits,remaining_credits,status,
     allowed_dance_type_ids_snapshot,dance_type_restriction_state_snapshot)
    VALUES ('Fixture',$1,$2,'self',$3,'Fixture Package',4,4,'active',$4,$5) RETURNING id`,
    [owner.email, owner.id, packageId, ids, options.state ?? null])).rows[0].id as number;
  const activationId = (await dbModule.pool.query(`INSERT INTO credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after)
    VALUES ($1,$2,'self','package_activated',4,0,4) RETURNING id`, [orderId, owner.id])).rows[0].id;
  await dbModule.pool.query(`INSERT INTO package_credit_lots
    (package_order_id,source_type,credits_issued,credits_remaining,total_value_minor,value_basis,issuing_credit_transaction_id,created_by)
    VALUES ($1,'purchased',4,4,40000,'recorded_purchase_price',$2,'test')`, [orderId, activationId]);
  return { owner, packageId, orderId };
}
async function resolve(fixture: Awaited<ReturnType<typeof orderFixture>>, style = danceId) {
  return dbModule.db.transaction((tx) => resolveCredit(tx, {
    packageOrderId: fixture.orderId, accountOwnerStudentId: fixture.owner.id,
    participantType: "self", participantChildId: null, occurrenceDate: "2026-10-10", danceTypeId: style,
  }));
}
async function schedule(style = danceId) {
  const classId = (await dbModule.pool.query(`INSERT INTO classes (title,category,dance_type_id,allow_all_ages)
    VALUES ('Fixture Class','Fixture',$1,true) RETURNING id`, [style])).rows[0].id as number;
  const date = (await dbModule.pool.query(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d`)).rows[0].d as string;
  const scheduleId = (await dbModule.pool.query(`INSERT INTO schedules (class_id,day_of_week,start_time,end_time,package_eligible)
    VALUES ($1,extract(dow from $2::date)::int,'00:00','23:59',true) RETURNING id`, [classId, date])).rows[0].id as number;
  return { classId, scheduleId, date };
}
async function booking(fixture: Awaited<ReturnType<typeof orderFixture>>, style = danceId) {
  const sched = await schedule(style);
  const bookingId = (await dbModule.pool.query(`INSERT INTO bookings
    (student_name,student_email,account_owner_student_id,participant_type,booking_scope,class_id,schedule_id,occurrence_date,
     package_order_id,payment_mode,status,booking_status)
    VALUES ('Fixture',$1,$2,'self','self',$3,$4,$5,$6,'package_credit','confirmed','confirmed') RETURNING id`,
    [fixture.owner.email, fixture.owner.id, sched.classId, sched.scheduleId, sched.date, fixture.orderId])).rows[0].id as number;
  return { ...sched, bookingId };
}

test("referenced catalogue deletion rejects with 409; deactivation preserves orders and restrictions", async () => {
  const f = await orderFixture();
  const response = await request(`/price-packages/${f.packageId}`, undefined, "DELETE");
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "PACKAGE_HAS_ORDERS");
  assert.equal((await request(`/price-packages/${f.packageId}`, { isActive: false }, "PATCH")).status, 200);
  assert.equal((await resolve(f)).ok, true);
  assert.equal((await request("/package-orders", { packageId: f.packageId, participantType: "self" }, "POST", f.owner)).status, 404);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM price_package_dance_types WHERE package_id=$1`, [f.packageId])).rows[0].n, 1);
});
test("unreferenced package still deletes and records its existing audit action", async () => {
  const id = await catalogue();
  assert.equal((await request(`/price-packages/${id}`, undefined, "DELETE")).status, 204);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM admin_activity_logs WHERE entity_id=$1 AND entity_type='price_package' AND action='delete'`, [id])).rows[0].n, 1);
});
test("purchase captures restricted and explicitly unrestricted provenance; rejects text-only restrictions without creating orders", async () => {
  for (const restricted of [true, false]) {
    const owner = await account();
    const id = await catalogue(restricted);
    const response = await request("/package-orders", { packageId: id, participantType: "self" }, "POST", owner);
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const order = (await dbModule.pool.query(`SELECT allowed_dance_type_ids_snapshot AS ids,dance_type_restriction_state_snapshot AS state FROM package_orders WHERE package_id=$1`, [id])).rows[0];
    assert.deepEqual(order.ids, restricted ? [danceId] : []);
    assert.equal(order.state, restricted ? "restricted" : "unrestricted");
  }
  const owner = await account();
  const id = await catalogue(false, true);
  assert.equal((await request("/package-orders", { packageId: id, participantType: "self" }, "POST", owner)).status, 409);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM package_orders WHERE package_id=$1`, [id])).rows[0].n, 0);
});
test("historical restrictions survive deleted, deactivated and edited catalogue state", async () => {
  for (const mode of ["deleted", "deactivated", "edited"]) {
    const f = await orderFixture();
    if (mode === "deleted") await dbModule.pool.query(`DELETE FROM price_packages WHERE id=$1`, [f.packageId]);
    if (mode === "deactivated") await request(`/price-packages/${f.packageId}`, { isActive: false }, "PATCH");
    if (mode === "edited") await request(`/price-packages/${f.packageId}`, { allowedDanceTypeIds: [otherDanceId] }, "PATCH");
    assert.equal((await resolve(f, danceId)).ok, true);
    const mismatch = await resolve(f, otherDanceId);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "PACKAGE_DANCE_TYPE_MISMATCH");
  }
});
test("missing and empty legacy snapshots fail closed; explicit unrestricted and detached restricted snapshots remain usable", async () => {
  for (const ids of [null, []]) {
    const result = await resolve(await orderFixture({ ids }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PACKAGE_CREDIT_INTEGRITY_MISMATCH");
  }
  assert.equal((await resolve(await orderFixture({ ids: [], state: "unrestricted", packageId: null }), otherDanceId)).ok, true);
  assert.equal((await resolve(await orderFixture({ packageId: null }))).ok, true);
});
test("new booking uses saved restrictions, not changed catalogue permissions", async () => {
  const f = await orderFixture();
  await request(`/price-packages/${f.packageId}`, { allowedDanceTypeIds: [otherDanceId] }, "PATCH");
  for (const style of [otherDanceId, danceId]) {
    const s = await schedule(style);
    const response = await request("/bookings", {
      studentName: "Fixture", studentEmail: f.owner.email,
      scheduleId: s.scheduleId, classId: s.classId, occurrenceDate: s.date,
      participantType: "self", packageOrderId: f.orderId, paymentMode: "package_credit",
    }, "POST", f.owner);
    assert.equal(response.status, style === danceId ? 201 : 409, JSON.stringify(await response.clone().json()));
  }
  assert.equal((await dbModule.pool.query(`SELECT remaining_credits AS n FROM package_orders WHERE id=$1`, [f.orderId])).rows[0].n, 4);
});
for (const entry of ["qr", "manual"]) {
  test(`${entry} attendance rejects disallowed historical credits with zero deductions; permits saved allowed style`, async () => {
    for (const allowed of [false, true]) {
      const f = await orderFixture();
      const b = await booking(f, allowed ? danceId : otherDanceId);
      const path = entry === "qr" ? "/check-in/qr" : "/attendance";
      const body = entry === "qr"
        ? { qrToken: f.owner.qrToken, bookingId: b.bookingId, paymentMode: "package_credit", packageOrderId: f.orderId }
        : { studentName: "Fixture", studentEmail: f.owner.email, studentId: f.owner.id, bookingId: b.bookingId, packageOrderId: f.orderId, paymentMode: "package_credit", creditDeducted: true };
      const response = await request(path, body);
      assert.equal(response.status, allowed ? 201 : 409, JSON.stringify(await response.clone().json()));
      assert.equal((await dbModule.pool.query(`SELECT remaining_credits AS n FROM package_orders WHERE id=$1`, [f.orderId])).rows[0].n, allowed ? 3 : 4);
      assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id=$1 AND type='attendance_deduction'`, [f.orderId])).rows[0].n, allowed ? 1 : 0);
    }
  });
}
test("already-deducted booking cannot bypass restrictions; valid spent credits are not deducted twice", async () => {
  for (const allowed of [false, true]) {
    const f = await orderFixture();
    const b = await booking(f, allowed ? danceId : otherDanceId);
    await dbModule.pool.query(`UPDATE package_orders SET remaining_credits=0,status='fullyUsed' WHERE id=$1`, [f.orderId]);
    await dbModule.pool.query(`INSERT INTO credit_transactions
      (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,booking_id)
      VALUES ($1,$2,'self','booking_deduction',-1,1,0,$3)`, [f.orderId, f.owner.id, b.bookingId]);
    const response = await request("/check-in/qr", { qrToken: f.owner.qrToken, bookingId: b.bookingId, paymentMode: "package_credit", packageOrderId: f.orderId });
    assert.equal(response.status, allowed ? 201 : 409, JSON.stringify(await response.clone().json()));
    assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id=$1 AND type='attendance_deduction'`, [f.orderId])).rows[0].n, 0);
  }
});
test("walk-in settlement rejects wrong dance type without changing balances or attendance", async () => {
  const f = await orderFixture();
  const s = await schedule(otherDanceId);
  const { performStudioPackageWalkIn } = await import("../lib/checkInService");
  await assert.rejects(dbModule.db.transaction((tx) => performStudioPackageWalkIn(tx, {
    accountOwnerStudentId: f.owner.id, participantType: "self", participantChildId: null,
    packageOrderId: f.orderId, classId: s.classId, scheduleId: s.scheduleId, occurrenceDate: s.date, performedBy: "test",
  })), (error: unknown) => (error as { code: string }).code === "PACKAGE_DANCE_TYPE_MISMATCH");
  assert.equal((await dbModule.pool.query(`SELECT remaining_credits AS n FROM package_orders WHERE id=$1`, [f.orderId])).rows[0].n, 4);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM attendance WHERE package_order_id=$1`, [f.orderId])).rows[0].n, 0);
});
test("purchase row lock makes concurrent deletion wait and reject after the order commits", async () => {
  const id = await catalogue();
  const owner = await account();
  const client = await dbModule.pool.connect();
  let response: Promise<Response> | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM price_packages WHERE id=$1 FOR SHARE`, [id]);
    response = request(`/price-packages/${id}`, undefined, "DELETE");
    // Observe an actual lock wait rather than relying on a timing-only race.
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await dbModule.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%price_packages%'`)).rows[0].n > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    await client.query(`INSERT INTO package_orders (student_name,student_email,student_id,package_id,package_name,total_credits,remaining_credits)
      VALUES ('Fixture',$1,$2,$3,'Fixture',4,4)`, [owner.email, owner.id, id]);
    await client.query("COMMIT");
    assert.equal((await response).status, 409);
  } finally { await client.query("ROLLBACK"); client.release(); if (response) await response; }
});
test("purchase waits for catalogue deletion and cannot create a dangling order", async () => {
  const id = await catalogue();
  const owner = await account();
  const client = await dbModule.pool.connect();
  let response: Promise<Response> | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM price_packages WHERE id=$1`, [id]);
    response = request("/package-orders", { packageId: id, participantType: "self" }, "POST", owner);
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await dbModule.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%price_packages%'`)).rows[0].n > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    await client.query("COMMIT");
    assert.equal((await response).status, 404);
    assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM package_orders WHERE package_id=$1`, [id])).rows[0].n, 0);
  } finally { await client.query("ROLLBACK"); client.release(); if (response) await response; }
});
test("snapshot shape constraint rejects contradictory unrestricted evidence", async () => {
  const f = await orderFixture();
  await assert.rejects(dbModule.pool.query(`UPDATE package_orders SET dance_type_restriction_state_snapshot='unrestricted' WHERE id=$1`, [f.orderId]), /package_orders_dance_restriction_snapshot_check/);
});
test("allowed package walk-in consumes exactly one saved restricted credit", async () => {
  const f = await orderFixture();
  const s = await schedule();
  await request(`/price-packages/${f.packageId}`, { allowedDanceTypeIds: [otherDanceId] }, "PATCH");
  const { performStudioPackageWalkIn } = await import("../lib/checkInService");
  const result = await dbModule.db.transaction((tx) => performStudioPackageWalkIn(tx, {
    accountOwnerStudentId: f.owner.id, participantType: "self", participantChildId: null,
    packageOrderId: f.orderId, classId: s.classId, scheduleId: s.scheduleId, occurrenceDate: s.date, performedBy: "test",
  }));
  assert.equal(result.remainingCredits, 3);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE package_order_id=$1 AND event_type='consumption'`, [f.orderId])).rows[0].n, 1);
});
test("consumption allocator itself rejects unverified restrictions without decrementing a lot", async () => {
  const f = await orderFixture({ ids: null });
  const s = await schedule();
  const attendanceId = (await dbModule.pool.query(`INSERT INTO attendance
    (student_name,student_email,student_id,participant_type,schedule_id,class_id,package_order_id,attendance_source,payment_source,credit_deducted,status)
    VALUES ('Fixture',$1,$2,'self',$3,$4,$5,'walk_in','walk_in_package_credit',true,'checked_in') RETURNING id`,
    [f.owner.email, f.owner.id, s.scheduleId, s.classId, f.orderId])).rows[0].id as number;
  const creditTransactionId = (await dbModule.pool.query(`INSERT INTO credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,attendance_id)
    VALUES ($1,$2,'self','attendance_deduction',-1,4,3,$3) RETURNING id`, [f.orderId, f.owner.id, attendanceId])).rows[0].id as number;
  const { allocateAttendanceConsumption } = await import("../lib/packageCredits/selectConsumptionLot");
  await assert.rejects(dbModule.db.transaction((tx) => allocateAttendanceConsumption(tx, {
    creditTransactionId, packageOrderId: f.orderId, attendanceId, bookingId: null, createdBy: "test",
  })), /historical restrictions could not be verified/);
  assert.equal((await dbModule.pool.query(`SELECT credits_remaining AS n FROM package_credit_lots WHERE package_order_id=$1`, [f.orderId])).rows[0].n, 4);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE package_order_id=$1`, [f.orderId])).rows[0].n, 0);
});
test("ambiguous restrictions do not prevent cancellation/restoration and cannot grant new access afterwards", async () => {
  const f = await orderFixture({ ids: null });
  const b = await booking(f);
  await dbModule.pool.query(`UPDATE bookings SET occurrence_date=(now() AT TIME ZONE 'Africa/Cairo')::date+7 WHERE id=$1`, [b.bookingId]);
  await dbModule.pool.query(`UPDATE package_orders SET remaining_credits=3 WHERE id=$1`, [f.orderId]);
  await dbModule.pool.query(`INSERT INTO credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,booking_id)
    VALUES ($1,$2,'self','booking_deduction',-1,4,3,$3)`, [f.orderId, f.owner.id, b.bookingId]);
  const response = await request(`/bookings/${b.bookingId}/cancel`, undefined, "PATCH", f.owner);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await dbModule.pool.query(`SELECT remaining_credits AS n FROM package_orders WHERE id=$1`, [f.orderId])).rows[0].n, 4);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id=$1 AND type='booking_restoration'`, [f.orderId])).rows[0].n, 1);
  assert.equal((await resolve(f)).ok, false);
});
test("student cannot delete catalogue packages or supply unrestricted provenance", async () => {
  const owner = await account();
  const id = await catalogue();
  assert.equal((await request(`/price-packages/${id}`, undefined, "DELETE", owner)).status, 403);
  const response = await request("/package-orders", {
    packageId: id, participantType: "self", allowedDanceTypeIdsSnapshot: [], danceTypeRestrictionStateSnapshot: "unrestricted",
  }, "POST", owner);
  assert.equal(response.status, 201);
  const row = (await dbModule.pool.query(`SELECT dance_type_restriction_state_snapshot AS state,allowed_dance_type_ids_snapshot AS ids FROM package_orders WHERE package_id=$1`, [id])).rows[0];
  assert.equal(row.state, "restricted");
  assert.deepEqual(row.ids, [danceId]);
});
test("concurrent catalogue edit is read under the purchase lock; snapshot and price are coherent", async () => {
  const id = await catalogue();
  const owner = await account();
  const client = await dbModule.pool.connect();
  let response: Promise<Response> | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE price_packages SET price_egp=900 WHERE id=$1`, [id]);
    await client.query(`UPDATE price_package_dance_types SET dance_type_id=$1 WHERE package_id=$2`, [otherDanceId, id]);
    response = request("/package-orders", { packageId: id, participantType: "self" }, "POST", owner);
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await dbModule.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%price_packages%'`)).rows[0].n > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    await client.query("COMMIT");
    assert.equal((await response).status, 201);
    const row = (await dbModule.pool.query(`SELECT po.allowed_dance_type_ids_snapshot AS ids,pr.gross_amount_minor AS price
      FROM package_orders po JOIN payment_records pr ON pr.package_order_id=po.id WHERE po.package_id=$1`, [id])).rows[0];
    assert.deepEqual(row.ids, [otherDanceId]);
    assert.equal(row.price, 90000);
  } finally { await client.query("ROLLBACK"); client.release(); if (response) await response; }
});
test("legacy spent booking uses its actual schedule's dance type, not inconsistent class metadata", async () => {
  const f = await orderFixture();
  const b = await booking(f, otherDanceId);
  const allowed = await schedule(danceId);
  await dbModule.pool.query(`UPDATE bookings SET class_id=$1 WHERE id=$2`, [allowed.classId, b.bookingId]);
  await dbModule.pool.query(`UPDATE package_orders SET remaining_credits=0,status='fullyUsed' WHERE id=$1`, [f.orderId]);
  await dbModule.pool.query(`INSERT INTO credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,booking_id)
    VALUES ($1,$2,'self','booking_deduction',-1,1,0,$3)`, [f.orderId, f.owner.id, b.bookingId]);
  const response = await request("/check-in/qr", { qrToken: f.owner.qrToken, bookingId: b.bookingId, paymentMode: "package_credit", packageOrderId: f.orderId });
  assert.equal(response.status, 409);
  assert.equal((await dbModule.pool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id=$1`, [b.bookingId])).rows[0].n, 0);
});
