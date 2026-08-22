/**
 * Real-route integration coverage for Finance Phase 2B-1: Package Purchase
 * Creation-Time Monetary Capture.
 *
 * Boots the actual Express router and real student auth middleware over
 * HTTP, exactly like packageOrders.activation.integration.test.ts. Proves
 * that POST /api/package-orders now performs a three-row atomic dual write
 * (package_orders + payment_records + payment_events), never a client-
 * provided amount, and that the transaction is genuinely all-or-nothing.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CAPTURE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_capture";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let packageId: number;
let promotionCode: string;
let packagePriceEgp: number;
let pushDeliveryBaseline = 0;
// createStudentNotification (a pre-existing, unrelated side effect fired on
// every package-order creation) dispatches push delivery via a detached
// setTimeout(0) that the request path never awaits. This suite creates many
// more orders than the single-order activation suite this pattern was
// copied from, so `after` polls for those writes to land (see
// waitForPushDeliveryDrain) instead of guessing a fixed delay.
let ordersCreated = 0;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function makeStudent(run: string, label: string): Promise<{ id: number; email: string }> {
  const email = `pkg-capture-${run}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ($1, $2, '0100000000', 'student', '2000-01-01', true) RETURNING id`,
    [`Package Capture Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

async function makeParent(run: string, label: string): Promise<{ id: number; email: string }> {
  const email = `pkg-capture-${run}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified)
     VALUES ($1, $2, '0100000000', 'parent', '1985-01-01', true) RETURNING id`,
    [`Package Parent ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string, emailVerified = true): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified }, process.env.STUDENT_JWT_SECRET!);
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  // extractToken() in auth.ts checks x-api-key BEFORE Authorization: a
  // present x-api-key would shadow the student JWT entirely, so student
  // requests must omit it and rely on the Bearer token alone.
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 201) ordersCreated += 1;
  return res;
}

async function pushDeliverySkippedCount(): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM notification_delivery_logs WHERE status = 'skipped' AND error_code = 'push_disabled'`);
  return result.rows[0].n as number;
}

async function waitForPushDeliveryDrain(baseline: number, expectedNew: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await pushDeliverySkippedCount();
    if (current - baseline >= expectedNew) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function paymentRecordFor(packageOrderId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT * FROM payment_records WHERE flow_type = 'package_purchase' AND package_order_id = $1`,
    [packageOrderId],
  );
  return result.rows[0];
}

async function paymentEventsFor(paymentRecordId: number): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT * FROM payment_events WHERE payment_record_id = $1 ORDER BY id`,
    [paymentRecordId],
  );
  return result.rows;
}

async function packageOrderCount(): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM package_orders`);
  return result.rows[0].n as number;
}

async function paymentRecordCount(): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM payment_records`);
  return result.rows[0].n as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const packageOrdersRouter = (await import("./packageOrders")).default;
  const myRoutesRouter = (await import("./myRoutes")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", packageOrdersRouter);
  app.use("/api", myRoutesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  packagePriceEgp = 750.5;
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', $2, 8, 6, true) RETURNING id`,
    [`Creation Capture Test Package ${run}`, packagePriceEgp],
  );
  packageId = pkg.rows[0].id as number;

  const promo = await pool.query(
    `INSERT INTO promotions (name, type, discount_type, discount_value, is_active, rules_config)
     VALUES ($1, 'code', 'percentage', 10, true, '{}') RETURNING id`,
    [`Creation Capture Promo ${run}`],
  );
  promotionCode = `CAPTURE-${run}`.toUpperCase().slice(0, 40);
  await pool.query(
    `INSERT INTO promotion_codes (promotion_id, code) VALUES ($1, $2)`,
    [promo.rows[0].id as number, promotionCode],
  );

  pushDeliveryBaseline = await pushDeliverySkippedCount();
});

after(async () => {
  await waitForPushDeliveryDrain(pushDeliveryBaseline, ordersCreated);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Category A: happy-path dual write (no promo) ───────────────────────────

test("creating a package order writes a matching payment_records row in the correct initial status", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "happy");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);

  const record = await paymentRecordFor(order.id as number);
  assert.ok(record, "a payment_records row must exist for the new package order");
  assert.equal(record!.flow_type, "package_purchase");
  assert.equal(record!.capture_origin, "live_capture");
  assert.equal(record!.evidence_class, "confirmed");
  assert.equal(record!.amount_availability, "exact");
  assert.equal(record!.amount_source, "creation_snapshot");
  assert.equal(record!.gross_amount_minor, 75050);
  assert.equal(record!.discount_amount_minor, 0);
  assert.equal(record!.final_payable_amount_minor, 75050);
  assert.equal(record!.paid_amount_minor, 0);
  assert.equal(record!.refunded_amount_minor, 0);
  assert.equal(record!.currency, "EGP");
  // Every new package order starts operational status "pendingPayment" and
  // the only exit is an admin PATCH {status:"active"} — i.e. it is already
  // sitting in an admin confirmation queue the instant it's created.
  assert.equal(record!.status, "pending_confirmation");
  assert.equal(record!.paid_at, null);
  assert.equal(record!.confirming_admin_id, null);
  assert.equal(record!.confirmed_payment_method, null);
  assert.equal(record!.student_id, student.id);
  assert.equal(record!.participant_type, "self");
  assert.equal(record!.child_id, null);
});

test("a Parent child purchase stores only authoritative participant snapshots and payer identity", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const parent = await makeParent(run, "child-owner");
  const cairoToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [currentYear, currentMonth, currentDay] = cairoToday.split("-");
  const childDob = `${Number(currentYear) - 11}-${currentMonth}-${currentDay}`;
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth, birthday, age, gender)
     VALUES ($1, 'Canonical Child Name', $2, 'forged-legacy', 99, 'female')
     RETURNING id`,
    [parent.id, childDob],
  );
  const childId = child.rows[0].id as number;
  const childPackage = await pool.query(
    `INSERT INTO price_packages
       (name, type, price_egp, sessions, validity_months, is_active, allow_all_ages, min_age, max_age)
     VALUES ($1, 'per_class', 500, 4, 2, true, false, 5, 12)
     RETURNING id`,
    [`Child Package ${run}`],
  );

  const res = await asStudent(studentToken(parent.id, parent.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({
      packageId: childPackage.rows[0].id,
      participantType: "child",
      participantChildId: childId,
      participantName: "Forged Name",
      participantDateOfBirth: "1900-01-01",
      participantAge: 126,
    }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.participantType, "child");
  assert.equal(body.participantChildId, childId);
  assert.equal(body.participantName, "Canonical Child Name");
  assert.equal(body.participantAgeAtPurchase, 11);
  assert.equal(body.purchaseEligibilityConfigurationState, "configured");

  const stored = await pool.query(
    `SELECT *, participant_date_of_birth_snapshot::text AS participant_dob_text
     FROM package_orders WHERE id = $1`,
    [body.id],
  );
  assert.equal(stored.rows[0].participant_dob_text, childDob);
  assert.equal(stored.rows[0].student_id, parent.id);
  const payment = await paymentRecordFor(body.id as number);
  assert.equal(payment!.student_id, parent.id, "payer remains the authenticated Parent");
  assert.equal(payment!.child_id, childId, "child ID is descriptive participant metadata");
  assert.equal(payment!.participant_type, "child");

  const myPackagesResponse = await asStudent(
    studentToken(parent.id, parent.email),
    "/api/my/packages",
  );
  assert.equal(myPackagesResponse.status, 200);
  const myPackages = await myPackagesResponse.json() as Array<Record<string, unknown>>;
  const owned = myPackages.find((order) => order.id === body.id);
  assert.equal(owned?.participantType, "child");
  assert.equal(owned?.participantChildId, childId);
  assert.equal(owned?.participantName, "Canonical Child Name");
  assert.equal(owned?.ownershipState, "assigned");
});

test("Student child selection and an unrelated Parent child are rejected without writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "student-child-rejected");
  const owner = await makeParent(run, "actual-child-owner");
  const attacker = await makeParent(run, "other-parent");
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth, gender)
     VALUES ($1, 'Private Child', '2015-01-01', 'female') RETURNING id`,
    [owner.id],
  );
  const childId = child.rows[0].id as number;
  const before = await packageOrderCount();

  const studentResponse = await asStudent(studentToken(student.id, student.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, participantType: "child", participantChildId: childId }),
  });
  assert.equal(studentResponse.status, 400);
  assert.equal((await jsonBody(studentResponse)).code, "STUDENT_SELF_ONLY");

  const parentResponse = await asStudent(studentToken(attacker.id, attacker.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, participantType: "child", participantChildId: childId }),
  });
  assert.equal(parentResponse.status, 404);
  assert.equal((await jsonBody(parentResponse)).code, "PARTICIPANT_NOT_OWNED");
  assert.equal(await packageOrderCount(), before);
});

test("missing DOB and age-ineligible self or child purchases fail before financial writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const missingStudent = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified)
     VALUES ('Missing DOB', $1, 'student', true) RETURNING id, email`,
    [`missing-dob-${run}@example.com`],
  );
  const parent = await makeParent(run, "ineligible-self");
  const missingChild = await pool.query(
    `INSERT INTO children (parent_id, full_name, gender)
     VALUES ($1, 'Missing DOB Child', 'female') RETURNING id`,
    [parent.id],
  );
  const kidsPackage = await pool.query(
    `INSERT INTO price_packages
       (name, type, price_egp, sessions, validity_months, is_active, allow_all_ages, min_age, max_age)
     VALUES ($1, 'per_class', 400, 4, 2, true, false, 5, 12) RETURNING id`,
    [`Kids Rejection Package ${run}`],
  );
  const before = { orders: await packageOrderCount(), payments: await paymentRecordCount() };

  const missingSelf = await asStudent(
    studentToken(missingStudent.rows[0].id, missingStudent.rows[0].email),
    "/api/package-orders",
    { method: "POST", body: JSON.stringify({ packageId: kidsPackage.rows[0].id, participantType: "self" }) },
  );
  assert.equal(missingSelf.status, 409);
  assert.equal((await jsonBody(missingSelf)).code, "PACKAGE_PARTICIPANT_INELIGIBLE");

  const ineligibleParent = await asStudent(studentToken(parent.id, parent.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId: kidsPackage.rows[0].id, participantType: "self" }),
  });
  assert.equal(ineligibleParent.status, 409);
  const ineligibleBody = await jsonBody(ineligibleParent);
  assert.equal((ineligibleBody.eligibility as { reasons: Array<{ code: string }> }).reasons[0]?.code, "AGE_ABOVE_MAXIMUM");

  const missingChildResponse = await asStudent(studentToken(parent.id, parent.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({
      packageId: kidsPackage.rows[0].id,
      participantType: "child",
      participantChildId: missingChild.rows[0].id,
    }),
  });
  assert.equal(missingChildResponse.status, 409);
  const missingChildBody = await jsonBody(missingChildResponse);
  assert.equal(missingChildBody.code, "PARTICIPANT_DOB_REQUIRED");
  assert.equal(
    (missingChildBody.eligibility as { reasons: Array<{ code: string }> }).reasons[0]?.code,
    "DOB_REQUIRED",
  );

  assert.deepEqual(
    { orders: await packageOrderCount(), payments: await paymentRecordCount() },
    before,
  );
});

test("the payment_records row's requested_payment_channel reflects paymentMode", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "channel");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, paymentMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  assert.equal(record!.requested_payment_channel, "pay_at_studio");
  assert.equal(record!.raw_requested_channel, "pay_at_studio");
});

test("an online_payment paymentMode maps to the 'online' canonical channel", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "online");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, paymentMode: "online_payment" }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  assert.equal(record!.requested_payment_channel, "online");
  assert.equal(record!.raw_requested_channel, "online_payment");
});

test("an absent paymentMode maps to the 'unknown' canonical channel with a null raw value", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "no-mode");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  assert.equal(record!.requested_payment_channel, "unknown");
  assert.equal(record!.raw_requested_channel, null);
});

// ─── Category B: matching payment_events "created" row ──────────────────────

test("exactly one payment_events 'created' row is written, matching the record's status", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "events");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  const events = await paymentEventsFor(record!.id as number);

  assert.equal(events.length, 1, "exactly one payment_events row must exist");
  const [event] = events;
  assert.equal(event.event_type, "created");
  assert.equal(event.previous_status, null);
  assert.equal(event.new_status, record!.status);
  assert.equal(event.amount_minor, null);
  assert.equal(event.actor_type, "student");
  assert.equal(event.actor_admin_id, null);
  assert.equal(event.credit_transaction_id, null);
  assert.equal(event.payment_refund_id, null);
});

// ─── Category C: never a client-supplied amount ─────────────────────────────

test("a client-supplied price/priceEgp field is rejected outright, never used as the captured amount", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "no-client-price");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, priceEgp: 1 }),
  });
  assert.equal(res.status, 400);
});

test("the captured gross amount always matches the server-side catalog price, never a forged body field", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "forged-amount");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    // amountMinor/grossAmountMinor are not real fields on the request
    // schema at all — passthrough() would let them ride along silently if
    // the route ever read from req.body instead of the catalog row.
    body: JSON.stringify({ packageId, amountMinor: 1, grossAmountMinor: 1 }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  assert.equal(record!.gross_amount_minor, 75050, "gross amount must come from the catalog price, not the request body");
});

// ─── Category D: atomicity ───────────────────────────────────────────────────

test("an ineligible promo code rejects the whole request with zero rows written anywhere", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "atomic-promo");
  const token = studentToken(student.id, student.email);

  const before = { orders: await packageOrderCount(), records: await paymentRecordCount() };

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, promoCode: "DOES-NOT-EXIST-ANYWHERE" }),
  });
  assert.equal(res.status, 409);

  const after = { orders: await packageOrderCount(), records: await paymentRecordCount() };
  assert.equal(after.orders, before.orders, "no package_orders row may be left behind by a rejected promo");
  assert.equal(after.records, before.records, "no payment_records row may be left behind by a rejected promo");
});

test("every payment_records row created here has a matching payment_events row (no orphans)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "orphan-check");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);

  const orphanCheck = await pool.query(
    `SELECT count(*)::int AS n FROM payment_records pr
     WHERE pr.id = $1 AND NOT EXISTS (SELECT 1 FROM payment_events pe WHERE pe.payment_record_id = pr.id)`,
    [record!.id],
  );
  assert.equal(orphanCheck.rows[0].n, 0);
});

// ─── Category E: unauthenticated / unverified rejection before any write ────

test("an unauthenticated request is rejected and writes nothing", async () => {
  const before = { orders: await packageOrderCount(), records: await paymentRecordCount() };

  const res = await fetch(apiUrl("/api/package-orders"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 401);

  const after = { orders: await packageOrderCount(), records: await paymentRecordCount() };
  assert.equal(after.orders, before.orders);
  assert.equal(after.records, before.records);
});

test("an unverified student's request is rejected and writes nothing", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "unverified");
  const token = studentToken(student.id, student.email, false);

  const before = { orders: await packageOrderCount(), records: await paymentRecordCount() };

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 403);

  const after = { orders: await packageOrderCount(), records: await paymentRecordCount() };
  assert.equal(after.orders, before.orders);
  assert.equal(after.records, before.records);
});

// ─── Category F: invalid input, ownership, response contract ────────────────

test("a nonexistent package id returns 404 and writes nothing", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "invalid-package");
  const token = studentToken(student.id, student.email);
  const before = { orders: await packageOrderCount(), records: await paymentRecordCount() };

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId: 999_999_999 }),
  });
  assert.equal(res.status, 404);

  const after = { orders: await packageOrderCount(), records: await paymentRecordCount() };
  assert.equal(after.orders, before.orders);
  assert.equal(after.records, before.records);
});

test("the payment record's studentId is the authenticated requester, never client-suppliable", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "ownership");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    // studentId is not a real field on PurchasePackageBody at all, but the
    // schema is .passthrough() — if the route ever read it directly instead
    // of req.studentId (from the verified JWT), this would silently forge
    // ownership onto a different account.
    body: JSON.stringify({ packageId, studentId: student.id + 999 }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);
  const record = await paymentRecordFor(order.id as number);
  assert.equal(record!.student_id, student.id, "the payment record must belong to the authenticated student, not a forged studentId in the body");
});

test("the creation response contract is unchanged: only package-order fields, no payment internals leaked", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "response-contract");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);

  const expectedKeys = [
    "id", "studentName", "studentEmail", "studentPhone", "packageId",
    "packageName", "totalCredits", "remainingCredits", "status", "notes",
    "activatedAt", "expiresAt", "createdAt", "updatedAt", "participantType",
    "participantChildId", "participantName", "participantAgeAtPurchase",
    "purchaseEligibilityConfigurationState", "ownershipState",
  ].sort();
  assert.deepEqual(Object.keys(order).sort(), expectedKeys, "the response must contain exactly the pre-existing package-order fields — no payment_records/payment_events data leaked into it");
  assert.equal(order.status, "pendingPayment", "the operational package-order status is untouched by this change");
});

// ─── Category G: successful non-zero promotion capture ──────────────────────

test("an eligible non-zero promotion discount is captured correctly across payment_records, payment_events, and promotion_redemptions", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "promo-capture");
  const token = studentToken(student.id, student.email);

  const res = await asStudent(token, "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, promoCode: promotionCode }),
  });
  assert.equal(res.status, 201);
  const order = await jsonBody(res);

  const expectedGrossMinor = Math.round(packagePriceEgp * 100);
  const expectedDiscountMinor = Math.round(expectedGrossMinor * 0.10);
  const expectedFinalMinor = expectedGrossMinor - expectedDiscountMinor;
  assert.ok(expectedDiscountMinor > 0, "test fixture sanity: discount must be non-zero");

  const record = await paymentRecordFor(order.id as number);
  assert.ok(record, "a payment_records row must exist");
  assert.equal(record!.gross_amount_minor, expectedGrossMinor);
  assert.equal(record!.discount_amount_minor, expectedDiscountMinor);
  assert.equal(record!.final_payable_amount_minor, expectedFinalMinor);
  assert.equal(record!.flow_type, "package_purchase");
  assert.equal(record!.capture_origin, "live_capture");
  assert.equal(record!.evidence_class, "confirmed");
  assert.equal(record!.amount_availability, "exact");
  assert.equal(record!.amount_source, "creation_snapshot");
  assert.equal(record!.status, "pending_confirmation");
  assert.equal(record!.paid_amount_minor, 0);
  assert.equal(record!.refunded_amount_minor, 0);

  const events = await paymentEventsFor(record!.id as number);
  assert.equal(events.length, 1, "exactly one payment_events row");
  assert.equal(events[0].event_type, "created");
  assert.equal(events[0].new_status, "pending_confirmation");

  const redemptions = await pool.query(
    `SELECT * FROM promotion_redemptions WHERE package_order_id = $1`,
    [order.id],
  );
  assert.equal(redemptions.rowCount, 1, "exactly one promotion redemption");
  const redemption = redemptions.rows[0];
  assert.equal(redemption.student_id, student.id, "redemption must belong to the requesting student");
  assert.equal(redemption.package_order_id, order.id, "redemption must belong to the created package order");
  const redeemedDiscountMinor = Math.round(Number(redemption.discount_amount) * 100);
  assert.equal(redeemedDiscountMinor, expectedDiscountMinor, "the recorded payment_records discount and the redeemed promotion discount must not disagree");

  const creditRows = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`, [order.id]);
  assert.equal(creditRows.rows[0].n, 0, "no credit transaction may exist yet");
  const refundRows = await pool.query(`SELECT count(*)::int AS n FROM payment_refunds WHERE payment_record_id = $1`, [record!.id]);
  assert.equal(refundRows.rows[0].n, 0, "no payment_refund row may exist");

  const expectedKeys = [
    "id", "studentName", "studentEmail", "studentPhone", "packageId",
    "packageName", "totalCredits", "remainingCredits", "status", "notes",
    "activatedAt", "expiresAt", "createdAt", "updatedAt", "participantType",
    "participantChildId", "participantName", "participantAgeAtPurchase",
    "purchaseEligibilityConfigurationState", "ownershipState",
  ].sort();
  assert.deepEqual(Object.keys(order).sort(), expectedKeys, "response contract must remain unchanged even with a promotion applied");
});
