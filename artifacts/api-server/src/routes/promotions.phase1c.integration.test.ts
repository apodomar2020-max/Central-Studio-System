/** Phase 1B: deterministic real HTTP/PostgreSQL concurrency and audit verification.
 * Provision the current schema in a NEW disposable database before running.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

const databaseUrl = process.env.DISPOSABLE_PROMOTIONS_PHASE1C_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DISPOSABLE_PROMOTIONS_PHASE1C_DATABASE_URL to a newly provisioned local disposable database.",
  );
const url = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/disposable|test/i.test(url.pathname) ||
  /railway|rlwy/i.test(databaseUrl)
) {
  throw new Error(
    "Promotions tests refuse non-local or non-disposable databases.",
  );
}
process.env.DATABASE_URL = databaseUrl;
process.env.ADMIN_JWT_SECRET = "promotions-disposable-admin-secret";
process.env.STUDENT_JWT_SECRET = "promotions-disposable-student-secret";
process.env.NODE_ENV = "test";
delete process.env.REDIS_URL;
delete process.env.PROMOTIONS_REQUIRE_REVISION;
delete process.env.BREVO_API_KEY;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let pool: typeof import("@workspace/db").pool;
let server: Server;
let base: string;
let adminToken: string;
let restrictedToken: string;
let studentToken: string;
let studentId: number;
let packageId: number;
const run = `${Date.now()}-${process.pid}`;
let sequence = 0;
const unexpectedErrors: unknown[] = [];
const unique = () => `P1C-${run}-${++sequence}`;

type Code = {
  id: number;
  promotionId: number;
  code: string;
  maxUses: number | null;
  usesPerUser: number | null;
  currentUses: number;
};
type Saved = {
  revision: string;
  id: number;
  name: string;
  type: string;
  codes: Code[];
  rulesConfig: Record<string, unknown>;
  isActive: boolean;
};
async function request<T = Saved & { code: string; error: string }>(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = adminToken,
  bearer?: string,
  revision?: string,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(revision ? { "If-Match": `"${revision}"` } : {}),
      ...(token ? { "x-admin-token": token } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Error and success shapes intentionally differ; assertions inspect the real HTTP contract.
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}
const payload = (extra: Record<string, unknown> = {}) => ({
  name: unique(),
  description: null,
  type: "manual",
  discountType: "percentage",
  discountValue: 10,
  priority: 0,
  isActive: false,
  isExclusive: false,
  isStackable: false,
  startDate: null,
  endDate: null,
  code: unique(),
  maxUses: 12,
  usesPerUser: 2,
  rulesConfig: {},
  ...extra,
});
async function create(extra: Record<string, unknown> = {}): Promise<Saved> {
  const result = await request("POST", "/promotions", payload(extra));
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data as Saved;
}
async function codes(id: number) {
  return (
    await pool.query(
      "select * from promotion_codes where promotion_id=$1 order by id",
      [id],
    )
  ).rows;
}
async function snapshot(id: number) {
  return {
    promotion: (await pool.query("select * from promotions where id=$1", [id]))
      .rows,
    codes: await codes(id),
    redemptions: (
      await pool.query(
        "select * from promotion_redemptions where promotion_id=$1 order by id",
        [id],
      )
    ).rows,
    audits: (
      await pool.query(
        "select * from promotion_audit_logs where promotion_id=$1 order by id",
        [id],
      )
    ).rows,
  };
}
async function addRedemption(p: Saved, kind: "package" | "class") {
  const target =
    kind === "package"
      ? await pool.query(
          "insert into package_orders(student_name,student_email,student_id,package_name,total_credits,remaining_credits) values ('Phase1A',$1,$2,'Test',1,1) returning id",
          [`history-${run}@example.invalid`, studentId],
        )
      : await pool.query(
          "insert into bookings(student_name,student_email) values ('Phase1A',$1) returning id",
          [`history-${run}@example.invalid`],
        );
  await pool.query(
    `insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,package_order_id,booking_id,original_subtotal,discount_amount,final_subtotal,metadata)
    values ($1,$2,$3,$4,$5,100,10,90,$6)`,
    [
      p.id,
      p.codes[0].id,
      studentId,
      kind === "package" ? target.rows[0].id : null,
      kind === "class" ? target.rows[0].id : null,
      { source: `${kind}_checkout`, promoCode: p.codes[0].code },
    ],
  );
  // Deliberately leave the stored counter at zero: history, not the counter, is authoritative.
}

before(async () => {
  ({ pool } = await import("@workspace/db"));
  const { default: jwt } = await import("jsonwebtoken");
  const { default: express } = await import("express");
  const { requireAuth } = await import("../middlewares/auth");
  const { default: promotions } = await import("./promotions");
  const { default: packageOrders } = await import("./packageOrders");
  const { default: bookings } = await import("./bookings");
  const a = await pool.query(
    "insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Test',true) returning id",
    [`promo-admin-${run}`, `admin-${run}@example.invalid`],
  );
  const r = await pool.query(
    "insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Restricted',false) returning id",
    [`promo-restricted-${run}`, `restricted-${run}@example.invalid`],
  );
  const st = await pool.query(
    "insert into students(name,email,email_verified) values ('Promo Test',$1,true) returning id",
    [`student-${run}@example.invalid`],
  );
  studentId = st.rows[0].id;
  packageId = (
    await pool.query(
      "insert into price_packages(name,price_egp) values ($1,100) returning id",
      [`package-${run}`],
    )
  ).rows[0].id;
  adminToken = jwt.sign(
    { sub: a.rows[0].id, tokenVersion: 1 },
    process.env.ADMIN_JWT_SECRET!,
  );
  restrictedToken = jwt.sign(
    { sub: r.rows[0].id, tokenVersion: 1 },
    process.env.ADMIN_JWT_SECRET!,
  );
  studentToken = jwt.sign(
    { sub: studentId, type: "student", emailVerified: true, tokenVersion: 1 },
    process.env.STUDENT_JWT_SECRET!,
  );
  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", promotions);
  app.use("/api", packageOrders);
  app.use("/api", bookings);
  // Same sanitized unexpected-error body as app.ts; no unrelated full-app startup side effects.
  app.use(
    (_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      unexpectedErrors.push(_err);
      const error = _err as {
        expose?: boolean;
        status?: number;
        message?: string;
      };
      res.status(error.expose ? error.status! : 500).json({
        error: error.expose ? error.message : "Internal server error",
      });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (pool) await pool.end();
});

async function checkoutFixture(kind: "package" | "class") {
  const email = `${unique()}@example.invalid`;
  const st = (
    await pool.query(
      "insert into students(name,email,email_verified,account_type,date_of_birth) values ('Phase1A',$1,true,'student','2000-01-01') returning id",
      [email],
    )
  ).rows[0];
  const { default: jwt } = await import("jsonwebtoken");
  const token = jwt.sign(
    {
      sub: st.id,
      email,
      type: "student",
      emailVerified: true,
      tokenVersion: 1,
    },
    process.env.STUDENT_JWT_SECRET!,
  );
  const promotion = await create({ isActive: true });
  if (kind === "package") {
    const pkg = (
      await pool.query(
        "insert into price_packages(name,type,price_egp,sessions,validity_months,is_active,allow_all_ages) values ($1,'per_class',400,8,6,true,true) returning id",
        [unique()],
      )
    ).rows[0];
    return {
      studentId: st.id,
      token,
      promotion,
      path: "/package-orders",
      body: { packageId: pkg.id, promoCode: promotion.codes[0].code },
      gross: 400,
    };
  }
  const instructor = (
    await pool.query(
      "insert into instructors(name,is_active) values ($1,true) returning id",
      [unique()],
    )
  ).rows[0];
  const cls = (
    await pool.query(
      "insert into classes(title,category,instructor_id,is_active,allow_all_ages) values ($1,'general',$2,true,true) returning id",
      [unique(), instructor.id],
    )
  ).rows[0];
  const schedule = (
    await pool.query(
      "insert into schedules(class_id,type,status,day_of_week,start_time,end_time,price_egp) values ($1,'weekly','active',4,'10:00','11:00',300) returning id",
      [cls.id],
    )
  ).rows[0];
  return {
    studentId: st.id,
    token,
    promotion,
    path: "/bookings",
    body: {
      studentName: "Phase1A",
      studentEmail: email,
      scheduleId: schedule.id,
      classId: cls.id,
      paymentMode: "pay_at_studio",
      promoCode: promotion.codes[0].code,
      expectedPriceEgp: 300,
      expectedFinalPriceEgp: 270,
    },
    gross: 300,
  };
}
async function financeHistory(promotionId: number) {
  const redemptions = (
    await pool.query(
      "select * from promotion_redemptions where promotion_id=$1 order by id",
      [promotionId],
    )
  ).rows;
  const payments = (
    await pool.query(
      "select * from payment_records where package_order_id in (select package_order_id from promotion_redemptions where promotion_id=$1) or booking_id in (select booking_id from promotion_redemptions where promotion_id=$1) order by id",
      [promotionId],
    )
  ).rows;
  const events = (
    await pool.query(
      "select * from payment_events where payment_record_id=any($1::int[]) order by id",
      [payments.map((p) => p.id)],
    )
  ).rows;
  const orders = (
    await pool.query(
      "select * from package_orders where id=any($1::int[]) order by id",
      [redemptions.map((r) => r.package_order_id).filter(Boolean)],
    )
  ).rows;
  const bookings = (
    await pool.query(
      "select * from bookings where id=any($1::int[]) order by id",
      [redemptions.map((r) => r.booking_id).filter(Boolean)],
    )
  ).rows;
  return { redemptions, payments, events, orders, bookings };
}

let validate: typeof import("../lib/promotionService").validateCheckoutPromotion;
let database: typeof import("@workspace/db").db;
before(async () => {
  ({ validateCheckoutPromotion: validate } =
    await import("../lib/promotionService"));
  ({ db: database } = await import("@workspace/db"));
});
async function evaluate(
  promotionId: number,
  code?: string,
  extra: Record<string, unknown> = {},
) {
  return validate(
    {
      student: { id: studentId, emailVerified: true },
      booking: { classId: 1, scheduleId: 1 },
      subtotal: 100,
      ...extra,
    },
    code,
  );
}
async function isolate(work: () => Promise<void>) {
  const active = (
    await pool.query("select id from promotions where is_active")
  ).rows.map((r) => r.id);
  await pool.query("update promotions set is_active=false where is_active");
  try {
    await work();
  } finally {
    await pool.query("update promotions set is_active=false where is_active");
    if (active.length)
      await pool.query(
        "update promotions set is_active=true where id=any($1::int[])",
        [active],
      );
  }
}
async function legacy(
  type: string,
  codeTexts: string[],
  extra: Record<string, unknown> = {},
) {
  const p = (
    await pool.query(
      "insert into promotions(name,type,discount_value,is_active,rules_config) values($1,$2,10,true,$3) returning id",
      [unique(), type, extra.rulesConfig ?? {}],
    )
  ).rows[0];
  for (const code of codeTexts)
    await pool.query(
      "insert into promotion_codes(promotion_id,code) values($1,$2)",
      [p.id, code],
    );
  if (extra.isStackable)
    await pool.query("update promotions set is_stackable=true where id=$1", [
      p.id,
    ]);
  return p.id as number;
}

for (const shape of [
  "manual-one",
  "manual-multiple",
  "manual-none",
  "automatic-none",
  "automatic-code",
]) {
  test(`legacy ${shape}: reads preserve all codes, runtime is classified, unsafe edit blocked, DELETE preserves history`, async () =>
    isolate(async () => {
      const type = shape.startsWith("manual") ? "manual" : "automatic",
        texts = shape.endsWith("none")
          ? []
          : shape === "manual-multiple"
            ? [unique(), unique()]
            : [unique()];
      const id = await legacy(type, texts),
        before = await codes(id);
      const list = await request<Saved[]>("GET", "/promotions");
      assert.equal(list.status, 200);
      const row = list.data.find((p) => p.id === id)!;
      assert.equal(row.codes.length, texts.length);
      const evaluation = await evaluate(id, texts[0]);
      assert.equal(evaluation.eligible, shape !== "manual-none");
      if (shape === "manual-multiple") {
        assert.equal((await evaluate(id, texts[1])).eligible, true);
      }
      const safe = shape === "manual-one" || shape === "automatic-none";
      assert.equal(
        (await request("PATCH", `/promotions/${id}`, { description: "review" }))
          .status,
        safe ? 200 : 409,
      );
      assert.equal((await request("DELETE", `/promotions/${id}`)).status, 204);
      assert.equal((await evaluate(id, texts[0])).eligible, false);
      assert.deepEqual(
        (await codes(id)).map((c) => ({
          id: c.id,
          code: c.code,
          owner: c.promotion_id,
        })),
        before.map((c) => ({ id: c.id, code: c.code, owner: c.promotion_id })),
      );
      assert.equal(
        (await request("PATCH", `/promotions/${id}`, { isActive: true }))
          .status,
        safe ? 200 : 409,
      );
    }));
}
test("legacy noncanonical and colliding codes: exact normalized lookup and guarded mutations, no automatic repair", async () =>
  isolate(async () => {
    const canonical = unique(),
      id = await legacy("manual", [canonical.toLowerCase()]),
      other = await legacy("manual", [canonical]);
    const before = await codes(id);
    const evaluation = await evaluate(id, canonical.toLowerCase());
    assert.equal(evaluation.promotion?.id, other);
    assert.equal(
      (await request("PATCH", `/promotions/${id}`, { name: "blocked" })).status,
      409,
    );
    assert.equal(
      (await request("PATCH", `/promotions/${other}`, { name: "blocked" }))
        .status,
      409,
    );
    assert.deepEqual(await codes(id), before);
    assert.equal((await request("DELETE", `/promotions/${id}`)).status, 204);
  }));
test("legacy ownership mismatch is visible, prevents edits, remains a runtime policy risk", async () =>
  isolate(async () => {
    const p = await create({ isActive: true }),
      other = await create(),
      code = p.codes[0];
    await pool.query(
      "insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,original_subtotal,discount_amount,final_subtotal) values($1,$2,$3,100,10,90)",
      [other.id, code.id, studentId],
    );
    const history = (
      await pool.query(
        "select * from promotion_redemptions where promotion_code_id=$1",
        [code.id],
      )
    ).rows;
    assert.equal(
      (await request("PATCH", `/promotions/${p.id}`, { name: "blocked" }))
        .status,
      409,
    );
    assert.equal((await evaluate(p.id, code.code)).eligible, true);
    assert.equal((await request("DELETE", `/promotions/${p.id}`)).status, 204);
    assert.deepEqual(
      (
        await pool.query(
          "select * from promotion_redemptions where promotion_code_id=$1",
          [code.id],
        )
      ).rows,
      history,
    );
  }));
for (const discrepancy of [
  "counter-high-history-zero",
  "counter-zero-history-high",
]) {
  test(`usage ${discrepancy}: eligibility uses redemption rows without resetting counters`, async () =>
    isolate(async () => {
      const p = await create({ isActive: true, maxUses: 1, usesPerUser: null });
      if (discrepancy.startsWith("counter-high"))
        await pool.query(
          "update promotion_codes set current_uses=99 where id=$1",
          [p.codes[0].id],
        );
      else await addRedemption(p, "package");
      const before = await codes(p.id);
      assert.equal(
        (await evaluate(p.id, p.codes[0].code)).eligible,
        discrepancy.startsWith("counter-high"),
      );
      assert.deepEqual(await codes(p.id), before);
      if (discrepancy.startsWith("counter-high"))
        assert.equal(
          (await request("PATCH", `/promotions/${p.id}`, { code: unique() }))
            .status,
          409,
        );
    }));
}
for (const rules of [
  { unknownRule: true },
  { maxGlobalUses: -1 },
  { packageIds: "bad" },
  { branches: [""] },
]) {
  test(`invalid legacy rules ${JSON.stringify(rules)} reject redemption and remain unchanged by edits/deactivation`, async () =>
    isolate(async () => {
      const id = await legacy("manual", [unique()], { rulesConfig: rules }),
        code = (await codes(id))[0];
      assert.equal((await evaluate(id, code.code)).eligible, false);
      assert.equal(
        (
          await request("PATCH", `/promotions/${id}`, {
            description: "blocked",
          })
        ).status,
        400,
      );
      assert.equal((await request("DELETE", `/promotions/${id}`)).status, 204);
      assert.deepEqual(
        (
          await pool.query("select rules_config from promotions where id=$1", [
            id,
          ])
        ).rows[0].rules_config,
        rules,
      );
    }));
}
test("legacy package references: deleted target denies unmatched context; inactive package cannot be previewed", async () =>
  isolate(async () => {
    const id = await legacy("manual", [unique()], {
        rulesConfig: { packageIds: [2147483647] },
      }),
      code = (await codes(id))[0];
    assert.equal((await evaluate(id, code.code)).eligible, false);
    assert.equal(
      (await request("PATCH", `/promotions/${id}`, { description: "blocked" }))
        .status,
      409,
    );
    const inactive = (
      await pool.query(
        "insert into price_packages(name,price_egp,is_active) values($1,100,false) returning id",
        [unique()],
      )
    ).rows[0].id;
    const check = await request(
      "POST",
      "/promotions/validate",
      { packageId: inactive, promoCode: code.code },
      null,
      studentToken,
    );
    assert.equal(check.status, 404);
  }));
for (const [label, fields, expected] of [
  ["future", { startDate: "2099-01-01T00:00:00Z" }, false],
  ["expired", { endDate: "2000-01-01T00:00:00Z" }, false],
  ["active", {}, true],
  ["inactive", { isActive: false }, false],
] as const) {
  test(`date lifecycle ${label} agrees in real validation endpoint and engine`, async () =>
    isolate(async () => {
      const p = await create({ isActive: true, ...fields });
      assert.equal((await evaluate(p.id, p.codes[0].code)).eligible, expected);
      const fixture = await checkoutFixture("class");
      const check = await request<{ eligible: boolean }>(
        "POST",
        "/promotions/validate",
        { scheduleId: fixture.body.scheduleId, promoCode: p.codes[0].code },
        null,
        studentToken,
      );
      assert.equal(check.status, 200);
      assert.equal(check.data.eligible, expected);
    }));
}
for (const [label, rules, context, expected] of [
  ["verified", { verifiedStudentOnly: true }, { verified: false }, false],
  ["minimum basket", { minimumBasketAmount: 101 }, {}, false],
  ["selected package", { packageIds: [2147483647] }, {}, false],
  ["branch missing", { branches: ["Main"] }, {}, false],
  ["branch matching", { branches: ["Main"] }, { branch: " main " }, true],
  ["branch different", { branches: ["Main"] }, { branch: "Other" }, false],
  [
    "first purchase excludes class",
    { firstPackagePurchaseOnly: true },
    { package: undefined },
    false,
  ],
] as const) {
  test(`eligibility ${label}`, async () =>
    isolate(async () => {
      let effectiveRules: Record<string, unknown> = { ...rules };
      if (label === "selected package") {
        const other = (
          await pool.query(
            "insert into price_packages(name,price_egp) values($1,100) returning id",
            [unique()],
          )
        ).rows[0].id;
        effectiveRules = { packageIds: [other] };
      }
      const p = await create({ isActive: true });
      await pool.query("update promotions set rules_config=$2 where id=$1",[p.id,effectiveRules]);
      assert.equal(
        (await evaluate(p.id, p.codes[0].code, { ...context })).eligible,
        expected,
      );
    }));
}
test("historical first-package rules are preserved, reject both purchase contexts, and allow audited deactivation", async()=>isolate(async()=>{
 const id=await legacy("manual",[unique()],{rulesConfig:{firstPackagePurchaseOnly:true}});const code=(await codes(id))[0];
 assert.equal((await evaluate(id,code.code)).eligible,false);
 assert.equal((await evaluate(id,code.code,{package:{id:packageId,name:"Test",priceEgp:100,isActive:true}})).eligible,false);
 assert.equal((await request("PATCH",`/promotions/${id}`,{rulesConfig:{}})).status,409);
 assert.equal((await request("DELETE",`/promotions/${id}`)).status,204);
 assert.deepEqual((await snapshot(id)).promotion[0].rules_config,{firstPackagePurchaseOnly:true});
}));
for (const [discountType, discountValue, expected] of [
  ["percentage", 25, 25],
  ["fixed_amount", 35, 35],
  ["fixed_amount", 1000, 100],
] as const) {
  test(`money ${discountType} ${discountValue} capped at subtotal`, async () =>
    isolate(async () => {
      const p = await create({ isActive: true, discountType, discountValue });
      const result = await evaluate(p.id, p.codes[0].code);
      assert.equal(result.discountAmount, expected);
      assert.equal(result.finalSubtotal, 100 - expected);
    }));
}
test("selection: discount wins before priority; isExclusive is metadata and does not override stacking", async () =>
  isolate(async () => {
    const a = await create({
      type: "automatic",
      code: "",
      maxUses: null,
      usesPerUser: null,
      isActive: true,
      priority: 100,
      discountValue: 10,
      isExclusive: true,
      isStackable: true,
    });
    const b = await create({
      type: "automatic",
      code: "",
      maxUses: null,
      usesPerUser: null,
      isActive: true,
      priority: 0,
      discountValue: 20,
      isStackable: true,
    });
    let result = await evaluate(a.id);
    assert.equal(result.discountAmount, 30);
    assert.equal(result.appliedPromotionIds.length, 2);
    await request("PATCH", `/promotions/${a.id}`, { isStackable: false });
    result = await evaluate(a.id);
    assert.equal(result.discountAmount, 20);
    assert.deepEqual(result.appliedPromotionIds, [b.id]);
    await request("PATCH", `/promotions/${a.id}`, { discountValue: 20 });
    result = await evaluate(a.id);
    assert.deepEqual(result.appliedPromotionIds, [a.id]);
  }));
test("legacy automatic attached code can double a stackable candidate; no new runtime blocking policy is silently enabled", async () =>
  isolate(async () => {
    const code = unique(),
      id = await legacy("automatic", [code], { isStackable: true });
    const result = await evaluate(id, code);
    assert.equal(result.discountAmount, 20);
    assert.deepEqual(result.appliedPromotionIds, [id, id]);
  }));
for (const kind of ["class"] as const) {
  test(`${kind} purchase server price, rejection, immutable Finance and durable Admin replay`, async () =>
    isolate(async () => {
      const f = await checkoutFixture(kind);
      const bought = await request("POST", f.path, f.body, null, f.token);
      assert.equal(bought.status, 201, JSON.stringify(bought.data));
      const h = await financeHistory(f.promotion.id);
      assert.equal(h.payments.length, 1);
      assert.equal(h.payments[0].gross_amount_minor, f.gross * 100);
      assert.equal(h.payments[0].discount_amount_minor, f.gross * 10);
      assert.equal(h.payments[0].currency, "EGP");
      const patch = { description: "After purchase" },
        key = crypto.randomUUID(),
        revision = (await request<Saved[]>("GET", "/promotions")).data.find(
          (p) => p.id === f.promotion.id,
        )!.revision;
      const send = () =>
        fetch(`${base}/promotions/${f.promotion.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-admin-token": adminToken,
            "Idempotency-Key": key,
            "If-Match": `"${revision}"`,
          },
          body: JSON.stringify(patch),
        });
      assert.equal((await send()).status, 200);
      assert.equal(
        (await send()).headers.get("Promotion-Operation-Replayed"),
        "true",
      );
      assert.equal(
        (await request("GET", `/promotions/operations/${key}`)).status,
        200,
      );
      assert.equal(
        (await request("DELETE", `/promotions/${f.promotion.id}`)).status,
        204,
      );
      assert.deepEqual(await financeHistory(f.promotion.id), h);
      const fresh = await checkoutFixture(kind);
      await request("PATCH", `/promotions/${fresh.promotion.id}`, {
        endDate: "2000-01-01T00:00:00Z",
      });
      assert.equal(
        (await request("POST", fresh.path, fresh.body, null, fresh.token))
          .status,
        409,
      );
      assert.equal(
        (await financeHistory(fresh.promotion.id)).payments.length,
        0,
      );
    }));
}
// Permanent accounting invariant: applied attributions reconcile to Finance.
for (const kind of ["class"] as const)
  test(`CRITICAL ${kind} capped stacking: redemption discounts must reconcile with the Finance discount`, async () =>
    isolate(async () => {
      const f = await checkoutFixture(kind);
      await request("PATCH", `/promotions/${f.promotion.id}`, {
        discountValue: 80,
        isStackable: true,
      });
      await create({
        type: "automatic",
        code: "",
        maxUses: null,
        usesPerUser: null,
        isActive: true,
        isStackable: true,
        discountValue: 80,
      });
      const bought = await request(
        "POST",
        f.path,
        {
          ...f.body,
          ...(kind === "class" ? { expectedFinalPriceEgp: 0 } : {}),
        },
        null,
        f.token,
      );
      assert.equal(bought.status, 201, JSON.stringify(bought.data));
      const h = await financeHistory(f.promotion.id);
      const all = (await pool.query("select discount_amount from promotion_redemptions where booking_id=$1",[h.bookings[0].id])).rows;
      assert.equal(
        all.reduce((s, r) => s + Number(r.discount_amount), 0) * 100,
        h.payments[0].discount_amount_minor,
      );
      assert.deepEqual(all.map(r => Math.round(Number(r.discount_amount) * 100)),
        [15000, 15000]);
      assert.equal(h.payments[0].gross_amount_minor, f.gross * 100);
      assert.equal(h.payments[0].final_payable_amount_minor, 0);
    }));
for (const limit of [
  "maxGlobalUses",
  "maxUsesPerUser",
  "maxUses",
  "usesPerUser",
]) {
  test(`limit ${limit} is enforced from historical redemptions`, async () =>
    isolate(async () => {
      const p = await create({
        isActive: true,
        maxUses: null,
        usesPerUser: null,
        ...(["maxGlobalUses", "maxUsesPerUser"].includes(limit)
          ? { rulesConfig: { [limit]: 1 } }
          : { [limit]: 1 }),
      });
      assert.equal((await evaluate(p.id, p.codes[0].code)).eligible, true);
      await addRedemption(p, "class");
      assert.equal((await evaluate(p.id, p.codes[0].code)).eligible, false);
    }));
}
test("automatic discounts exclude packages and apply to direct-class without a code", async () =>
  isolate(async () => {
    const p = await create({
      type: "automatic",
      code: "",
      maxUses: null,
      usesPerUser: null,
      isActive: true,
      discountValue: 25,
    });
    const f = await checkoutFixture("package");
    await request("DELETE", `/promotions/${f.promotion.id}`);
    const bought = await request(
      "POST",
      f.path,
      { packageId: f.body.packageId },
      null,
      f.token,
    );
    assert.equal(bought.status, 201);
    const h = await financeHistory(p.id);
    assert.equal(h.redemptions.length,0);
    const payment=(await pool.query("select * from payment_records where student_id=$1",[f.studentId])).rows[0];
    assert.equal(payment.gross_amount_minor,40000);assert.equal(payment.discount_amount_minor,0);assert.equal(payment.final_payable_amount_minor,40000);
    const cls = await checkoutFixture("class");
    await request("DELETE", `/promotions/${cls.promotion.id}`);
    const {
      promoCode: _code,
      expectedFinalPriceEgp: _expected,
      ...body
    } = cls.body;
    const booked = await request("POST", cls.path, body, null, cls.token);
    assert.equal(booked.status, 201);
    const rows = (
      await pool.query(
        "select * from payment_records where student_id=$1 and flow_type='single_class_booking'",
        [cls.studentId],
      )
    ).rows;
    assert.equal(rows[0].discount_amount_minor, 7500);
    assert.equal(rows[0].gross_amount_minor, 30000);
  }));
test("tampered package prices are rejected and direct-class expected prices cannot override server values", async () =>
  isolate(async () => {
    for (const kind of ["package", "class"] as const) {
      const f = await checkoutFixture(kind);
      const result = await request(
        "POST",
        f.path,
        {
          ...f.body,
          ...(kind === "package" ? { priceEgp: 1 } : { expectedPriceEgp: 1 }),
        },
        null,
        f.token,
      );
      assert.equal(result.status, kind === "package" ? 400 : 409);
      assert.equal((await financeHistory(f.promotion.id)).payments.length, 0);
    }
  }));
test("legacy JSON null rules follow current empty-rule runtime fallback without silent repair", async () =>
  isolate(async () => {
    const id = await legacy("manual", [unique()]);
    await pool.query(
      "update promotions set rules_config='null'::jsonb where id=$1",
      [id],
    );
    const code = (await codes(id))[0];
    assert.equal((await evaluate(id, code.code)).eligible, true);
    assert.equal(
      (await request("PATCH", `/promotions/${id}`, { description: "blocked" }))
        .status,
      400,
    );
    assert.equal(
      (
        await pool.query("select rules_config from promotions where id=$1", [
          id,
        ])
      ).rows[0].rules_config,
      null,
    );
  }));
test("class branch restriction uses stored schedule context, not supplied customer context", async () =>
  isolate(async () => {
    const f = await checkoutFixture("class"),
      schedule = (f.body as Record<string, unknown>).scheduleId;
    await request("PATCH", `/promotions/${f.promotion.id}`, {
      rulesConfig: { branches: ["Main"] },
    });
    await pool.query("update schedules set location=' Main ' where id=$1", [
      schedule,
    ]);
    const quote = await request<{ eligible: boolean }>(
      "POST",
      "/promotions/validate",
      { scheduleId: schedule, promoCode: f.promotion.codes[0].code },
      null,
      f.token,
    );
    assert.equal(quote.data.eligible, true);
    assert.equal(
      (await request("POST", f.path, f.body, null, f.token)).status,
      201,
    );
  }));
test("package-credit bookings ignore Promo Codes and create no promotion/Finance rows", async () =>
  isolate(async () => {
    const f = await checkoutFixture("class");
    await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,discountValue:80});
    const pkg = (
      await pool.query(
        "insert into price_packages(name,type,price_egp,sessions,validity_months,is_active,allow_all_ages) values($1,'per_class',1000,8,6,true,true) returning id",
        [unique()],
      )
    ).rows[0].id;
    const order = (
      await pool.query(
        "insert into package_orders(student_name,student_email,student_id,package_id,package_name,total_credits,remaining_credits,status,activated_at,expires_at,participant_type,participant_name_snapshot,participant_date_of_birth_snapshot,participant_age_at_purchase,eligibility_evaluated_on,package_allow_all_ages_snapshot,purchase_eligibility_configuration_state,allowed_dance_type_ids_snapshot) values('Phase1A',$1,$2,$3,'Test',8,8,'active',now(),now()+interval '6 months','self','Phase1A','2000-01-01',26,current_date,true,'configured',ARRAY[]::integer[]) returning id",
        [(f.body as Record<string, unknown>).studentEmail, f.studentId, pkg],
      )
    ).rows[0].id;
    await pool.query(
      "update package_orders set dance_type_restriction_state_snapshot='unrestricted' where id=$1",
      [order],
    );
    await pool.query(
      "insert into credit_transactions(package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,created_by) values($1,$2,'self','package_activated',8,0,8,'test')",
      [order, f.studentId],
    );
    const response = await request(
      "POST",
      f.path,
      { ...f.body, paymentMode: "package_credit", packageOrderId: order },
      null,
      f.token,
    );
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const h = await financeHistory(f.promotion.id);
    assert.equal(h.redemptions.length, 0);
    assert.equal(
      Number(
        (
          await pool.query(
            "select count(*) from payment_records where student_id=$1",
            [f.studentId],
          )
        ).rows[0].count,
      ),
      0,
    );
  }));

test("class automatic quote remains valid without a manual activation code",async()=>isolate(async()=>{
 const f=await checkoutFixture("class");await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,discountValue:20});
 const quote=await request<{eligible:boolean;promotionCode:string|null;finalSubtotal:number}>("POST","/promotions/validate",{scheduleId:(f.body as Record<string,unknown>).scheduleId},null,f.token);assert.equal(quote.data.eligible,true);assert.equal(quote.data.promotionCode,null);assert.equal(quote.data.finalSubtotal,240);
 const {promoCode:_code,...body}=f.body;
 const response=await request("POST",f.path,{...body,expectedFinalPriceEgp:quote.data.finalSubtotal},null,f.token);
 assert.equal(response.status,201);assert.equal(Number((await pool.query("select count(*) from payment_records where student_id=$1",[f.studentId])).rows[0].count),1);
}));
test("class keeps the entered activation code when an automatic candidate wins the quote",async()=>isolate(async()=>{
 const f=await checkoutFixture("class");const automatic=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,discountValue:20});
 const result=await request("POST",f.path,{...f.body,promoCode:f.promotion.codes[0].code,expectedFinalPriceEgp:240},null,f.token);assert.equal(result.status,201,JSON.stringify(result.data));const history=await financeHistory(automatic.id);assert.equal(history.payments[0].discount_amount_minor,6000);assert.equal(history.payments[0].final_payable_amount_minor,24000);
}));

// New attribution coverage uses the same authenticated checkout routes and real
// financial tables as the original two regression failures.
const allocationCases = [
  {
    name: "unequal capped",
    types: ["fixed_amount", "fixed_amount"],
    values: [300, 200],
    applied: 400,
    expected: [240, 160],
  },
  {
    name: "uncapped fixed",
    types: ["fixed_amount", "fixed_amount"],
    values: [100, 150],
    applied: 250,
    expected: [100, 150],
  },
  {
    name: "mixed percentage/fixed",
    types: ["percentage", "fixed_amount"],
    values: [75, 200],
    applied: 400,
    expected: [240, 160],
  },
  {
    name: "equal piastre remainder",
    types: ["fixed_amount", "fixed_amount"],
    values: [0.02, 0.02],
    subtotal: 0.03,
    applied: 0.03,
    expected: [0.02, 0.01],
  },
  {
    name: "three fractional shares",
    types: ["fixed_amount", "fixed_amount", "fixed_amount"],
    values: [0.05, 0.03, 0.02],
    subtotal: 0.07,
    applied: 0.07,
    expected: [0.04, 0.02, 0.01],
  },
  {
    name: "zero attributed rows still consume usage",
    types: ["fixed_amount", "fixed_amount", "fixed_amount"],
    values: [0.01, 0.01, 0.01],
    subtotal: 0.01,
    applied: 0.01,
    expected: [0.01, 0, 0],
  },
  {
    name: "single capped fixed",
    types: ["fixed_amount"],
    values: [500],
    applied: 400,
    expected: [400],
  },
  {
    name: "zero aggregate keeps no-redemption semantics",
    types: ["percentage"],
    values: [0.01],
    subtotal: 0.01,
    applied: 0,
    expected: [],
  },
];
for (const kind of ["class"] as const)
  for (const originalScenario of allocationCases) {
    // Schedule catalog prices are integer EGP; retain that existing contract.
    const scenario =
      kind === "class" && originalScenario.subtotal != null
        ? originalScenario.name ===
          "zero aggregate keeps no-redemption semantics"
          ? { ...originalScenario, subtotal: 1 }
          : originalScenario.name === "zero attributed rows still consume usage"
            ? {
                ...originalScenario,
                subtotal: 1,
                types: ["percentage", "fixed_amount"],
                values: [0.01, 2],
                applied: 1,
                expected: [0, 1],
              }
            : {
                ...originalScenario,
                subtotal: 1,
                types: ["fixed_amount", "fixed_amount", "fixed_amount"],
                values: [0.8, 0.8, 0.8],
                applied: 1,
                expected: [0.34, 0.33, 0.33],
              }
        : originalScenario;
    test(`${kind} proportional attribution: ${scenario.name}`, async () =>
      isolate(async () => {
        const f = await checkoutFixture(kind);
        const subtotal = scenario.subtotal ?? 400;
          await pool.query("update schedules set price_egp=$1 where id=$2", [
            subtotal,
            (f.body as Record<string, unknown>).scheduleId,
          ]);
        assert.equal(
          (
            await request("PATCH", `/promotions/${f.promotion.id}`, {
              discountType: scenario.types[0],
              discountValue: scenario.values[0],
              isStackable: true,
            })
          ).status,
          200,
        );
        const ids = [f.promotion.id];
        for (let i = 1; i < scenario.values.length; i++)
          ids.push(
            (
              await create({
                type: "automatic",
                code: "",
                maxUses: null,
                usesPerUser: null,
                isActive: true,
                isStackable: true,
                discountType: scenario.types[i],
                discountValue: scenario.values[i],
              })
            ).id,
          );
        const bought = await request(
          "POST",
          f.path,
          {
            ...f.body,
            ...(kind === "class"
              ? {
                  expectedPriceEgp: subtotal,
                  expectedFinalPriceEgp: subtotal - scenario.applied,
                }
              : {}),
          },
          null,
          f.token,
        );
        assert.equal(bought.status, 201, JSON.stringify(bought.data));
        const rows = (
          await pool.query(
            "select * from promotion_redemptions where student_id=$1 order by promotion_id",
            [f.studentId],
          )
        ).rows;
        const payments = (
          await pool.query(
            "select * from payment_records where student_id=$1",
            [f.studentId],
          )
        ).rows;
        assert.equal(payments.length, 1);
        assert.equal(
          payments[0].gross_amount_minor,
          Math.round(subtotal * 100),
        );
        assert.equal(
          payments[0].discount_amount_minor ?? 0,
          Math.round(scenario.applied * 100),
        );
        assert.equal(
          payments[0].final_payable_amount_minor,
          Math.round((subtotal - scenario.applied) * 100),
        );
        assert.deepEqual(
          rows.map((r) => Math.round(Number(r.discount_amount) * 100)),
          scenario.expected.map((n) => Math.round(n * 100)),
        );
        assert.equal(
          rows.reduce(
            (n, r) => n + Math.round(Number(r.discount_amount) * 100),
            0,
          ),
          payments[0].discount_amount_minor ?? 0,
        );
        assert.deepEqual(
          rows.map((r) => r.promotion_id),
          scenario.applied > 0 ? ids : [],
        );
        if (rows.length)
          assert.equal(rows[0].promotion_code_id, f.promotion.codes[0].id);
        assert.equal(
          (await codes(f.promotion.id))[0].current_uses,
          scenario.applied > 0 ? 1 : 0,
        );
        const history = await financeHistory(f.promotion.id);
        assert.equal(
          (
            await request("PATCH", `/promotions/${f.promotion.id}`, {
              description: "Later configuration",
              isActive: false,
            })
          ).status,
          200,
        );
        assert.deepEqual(await financeHistory(f.promotion.id), history);
      }));
  }

async function cappedFixture(kind: "package" | "class") {
  const f = await checkoutFixture(kind);
  assert.equal(
    (
      await request("PATCH", `/promotions/${f.promotion.id}`, {
        discountValue: 80,
        isStackable: true,
        maxUses: null,
        usesPerUser: null,
      })
    ).status,
    200,
  );
  const automatic = await create({
    type: "automatic",
    code: "",
    maxUses: null,
    usesPerUser: null,
    isActive: true,
    isStackable: true,
    discountValue: 80,
  });
  return {
    ...f,
    automatic,
    body: {
      ...f.body,
      ...(kind === "class" ? { expectedFinalPriceEgp: 0 } : {}),
    },
  };
}
async function assertReconciles(student: number) {
  const payments = (
    await pool.query("select * from payment_records where student_id=$1", [
      student,
    ])
  ).rows;
  assert.equal(payments.length, 1);
  const payment = payments[0];
  const rows = (
    await pool.query(
      "select * from promotion_redemptions where package_order_id=$1 or booking_id=$2 order by promotion_id",
      [payment.package_order_id, payment.booking_id],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((s, r) => s + Math.round(Number(r.discount_amount) * 100), 0),
    payment.discount_amount_minor,
  );
  assert.equal(payment.final_payable_amount_minor, 0);
  return rows;
}
for (const kind of ["class"] as const) {
  test(`${kind} capped allocation persistence failure rolls back all financial writes`, async () =>
    isolate(async () => {
      const f = await cappedFixture(kind);
      await pool.query(
        "create function phase1c_allocation_failure() returns trigger language plpgsql as $$ begin if exists(select 1 from promotion_redemptions where student_id=NEW.student_id) then raise exception 'second attribution insert fails'; end if; return NEW; end $$",
      );
      await pool.query(
        "create trigger phase1c_allocation_failure before insert on promotion_redemptions for each row execute function phase1c_allocation_failure()",
      );
      try {
        const result = await request("POST", f.path, f.body, null, f.token);
        assert.equal(result.status, 500);
        for (const table of [
          "promotion_redemptions",
          "payment_records",
          "package_orders",
          "bookings",
        ])
          assert.equal(
            Number(
              (
                await pool.query(
                  `select count(*) from ${table} where ${table === "bookings" ? "account_owner_student_id" : "student_id"}=$1`,
                  [f.studentId],
                )
              ).rows[0].count,
            ),
            0,
          );
        assert.equal((await codes(f.promotion.id))[0].current_uses, 0);
      } finally {
        await pool.query(
          "drop trigger phase1c_allocation_failure on promotion_redemptions",
        );
        await pool.query("drop function phase1c_allocation_failure()");
      }
      assert.equal(
        (await request("POST", f.path, f.body, null, f.token)).status,
        201,
      );
      await assertReconciles(f.studentId);
    }));
  test(`${kind} concurrent capped purchases reconcile under deterministic lock barriers`, async () =>
    isolate(async () => {
      const f = await cappedFixture(kind),
        second = await checkoutFixture(kind);
      await request("DELETE", `/promotions/${second.promotion.id}`);
      // Checkout locks every discovered Automatic identity, including inactive
      // rows, in ascending order. Block the first identity to observe both requests.
      const barrierId = Number(
        (
          await pool.query(
            "select min(id) as id from promotions where type='automatic'",
          )
        ).rows[0].id,
      );
      const client = await pool.connect();
      const pending: Array<ReturnType<typeof request>> = [];
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(918201,$1)", [
          barrierId,
        ]);
        pending.push(request("POST", f.path, f.body, null, f.token));
        pending.push(
          request(
            "POST",
            f.path,
            {
              ...second.body,
              promoCode: f.promotion.codes[0].code,
              ...(kind === "class" ? { expectedFinalPriceEgp: 0 } : {}),
            },
            null,
            second.token,
          ),
        );
        const deadline = Date.now() + 8000;
        while (true) {
          const waiting = Number(
            (
              await pool.query(
                "select count(*) from pg_locks where locktype='advisory' and classid=918201 and objid=$1 and not granted",
                [barrierId],
              )
            ).rows[0].count,
          );
          if (waiting === 2) break;
          assert.ok(
            Date.now() < deadline,
            "both purchases must reach the database lock barrier",
          );
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await client.query("commit");
        for (const result of await Promise.all(pending))
          assert.equal(result.status, 201, JSON.stringify(result.data));
        const old = await financeHistory(f.promotion.id);
        await assertReconciles(f.studentId);
        await assertReconciles(second.studentId);
        assert.equal((await codes(f.promotion.id))[0].current_uses, 2);
        await request("PATCH", `/promotions/${f.promotion.id}`, {
          isActive: false,
          description: "After concurrent purchase",
        });
        assert.deepEqual(await financeHistory(f.promotion.id), old);
      } finally {
        await client.query("rollback");
        client.release();
        await Promise.allSettled(pending);
      }
    }));
}
test("legacy duplicate automatic/manual candidate keeps one row and existing code-count semantics", async () =>
  isolate(async () => {
    const f = await checkoutFixture("class");
    await pool.query(
      "update promotions set type='automatic',is_stackable=true,discount_value=80 where id=$1",
      [f.promotion.id],
    );
    assert.equal(
      (await request("POST", f.path, {...f.body,expectedFinalPriceEgp:0}, null, f.token)).status,
      201,
    );
    const h = await financeHistory(f.promotion.id);
    assert.equal(h.redemptions.length, 1);
    assert.equal(h.redemptions[0].promotion_code_id, null);
    assert.equal(
      Math.round(Number(h.redemptions[0].discount_amount) * 100),
      h.payments[0].discount_amount_minor,
    );
    assert.equal(h.payments[0].discount_amount_minor, 30000);
    assert.equal((await codes(f.promotion.id))[0].current_uses, 0);
  }));

for (const suppliedCode of ["valid", "invalid", "automatic", "empty"] as const) {
 test(`single-class policy: package ${suppliedCode} request never discounts or consumes usage`, async()=>isolate(async()=>{
  const f=await checkoutFixture("package");
  const automatic=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,discountValue:80,isStackable:true});
  const beforeManual=await snapshot(f.promotion.id),beforeAuto=await snapshot(automatic.id);
  const promoCode=suppliedCode==="valid"?f.promotion.codes[0].code:suppliedCode==="invalid"?"INVALID-EXPLICIT":suppliedCode==="empty"?"  ":undefined;
  const preview=await request<{eligible:boolean;discountAmount:number;finalSubtotal:number}>("POST","/promotions/validate",{packageId:f.body.packageId,promoCode:promoCode?.trim()||undefined},null,f.token);
  assert.equal(preview.status,200);assert.equal(preview.data.eligible,false);assert.equal(preview.data.discountAmount,0);assert.equal(preview.data.finalSubtotal,400);
  const result=await request("POST",f.path,{packageId:f.body.packageId,promoCode},null,f.token);
  const rejected=suppliedCode==="valid"||suppliedCode==="invalid";
  assert.equal(result.status,rejected?409:201,JSON.stringify(result.data));
  const payments=(await pool.query("select * from payment_records where student_id=$1",[f.studentId])).rows;
  assert.equal(payments.length,rejected?0:1);
  if(!rejected){assert.equal(payments[0].gross_amount_minor,40000);assert.equal(payments[0].discount_amount_minor,0);assert.equal(payments[0].final_payable_amount_minor,40000);}
  assert.equal((await pool.query("select id from package_orders where student_id=$1",[f.studentId])).rowCount,rejected?0:1);
  assert.deepEqual(await snapshot(f.promotion.id),beforeManual);assert.deepEqual(await snapshot(automatic.id),beforeAuto);
 }));
}
test("single-class policy: invalid explicit class code never falls back to Automatic",async()=>isolate(async()=>{
 const f=await checkoutFixture("class");const p=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,discountValue:80});
 const result=await request("POST",f.path,{...f.body,promoCode:"INVALID-EXPLICIT",expectedFinalPriceEgp:60},null,f.token);
 assert.equal(result.status,409);assert.equal((await pool.query("select id from bookings where account_owner_student_id=$1",[f.studentId])).rowCount,0);assert.equal((await financeHistory(p.id)).payments.length,0);
}));
test("single-class policy: package history still consumes class limits without rewriting history",async()=>isolate(async()=>{
 const p=await create({isActive:true,maxUses:1});await addRedemption(p,"package");const before=await snapshot(p.id);
 assert.equal((await evaluate(p.id,p.codes[0].code)).eligible,false);assert.deepEqual(await snapshot(p.id),before);
}));
test("single-class policy: persistence refuses package-linked redemptions before any write",async()=>isolate(async()=>{
 const p=await create({isActive:true});const evaluation=await evaluate(p.id,p.codes[0].code);const before=await snapshot(p.id);
 const {createPromotionRedemptions}=await import("../lib/promotionService");
 await assert.rejects(()=>database.transaction(tx=>createPromotionRedemptions(tx,evaluation,{studentId,packageOrderId:1})),/Package promotion redemptions are prohibited/);
 assert.deepEqual(await snapshot(p.id),before);
}));
for(const rules of [{packageIds:[1]},{packageIds:[]},{firstPackagePurchaseOnly:true},{firstPackagePurchaseOnly:false}]){
 test(`single-class policy: Admin refuses obsolete condition ${JSON.stringify(rules)} without writes`,async()=>{
  const result=await request("POST","/promotions",payload({rulesConfig:rules}));assert.equal(result.status,409);
 });
}
