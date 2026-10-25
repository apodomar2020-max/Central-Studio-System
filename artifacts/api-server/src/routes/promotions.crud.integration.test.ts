/** Phase 1A: real routes/auth + disposable PostgreSQL. No checkout race-safety claim:
 * checkout's post-lock candidate revalidation remains a Phase 1B release dependency.
 * Provision the current schema in a NEW disposable database before running.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

const databaseUrl = process.env.DISPOSABLE_PROMOTIONS_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DISPOSABLE_PROMOTIONS_DATABASE_URL to a newly provisioned local disposable database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/disposable|test/i.test(url.pathname) || /railway|rlwy/i.test(databaseUrl)) {
  throw new Error("Promotions tests refuse non-local or non-disposable databases.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.ADMIN_JWT_SECRET = "promotions-disposable-admin-secret";
process.env.STUDENT_JWT_SECRET = "promotions-disposable-student-secret";
process.env.NODE_ENV = "test";
delete process.env.REDIS_URL;
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
const unique = () => `P1A-${run}-${++sequence}`;

type Code = { id: number; promotionId: number; code: string; maxUses: number | null; usesPerUser: number | null; currentUses: number };
type Saved = { id: number; name: string; type: string; codes: Code[]; rulesConfig: Record<string, unknown>; isActive: boolean };
async function request<T = Saved & { code: string; error: string }>(method: string, path: string, body?: unknown, token: string | null = adminToken, bearer?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-admin-token": token } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Error and success shapes intentionally differ; assertions inspect the real HTTP contract.
  const data = await res.json().catch(() => null) as T;
  return { status: res.status, data };
}
const payload = (extra: Record<string, unknown> = {}) => ({
  name: unique(), description: null, type: "manual", discountType: "percentage", discountValue: 10,
  priority: 0, isActive: false, isExclusive: false, isStackable: false,
  startDate: null, endDate: null, code: unique(), maxUses: 12, usesPerUser: 2,
  rulesConfig: {}, ...extra,
});
async function create(extra: Record<string, unknown> = {}): Promise<Saved> {
  const result = await request("POST", "/promotions", payload(extra));
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data as Saved;
}
async function codes(id: number) {
  return (await pool.query("select * from promotion_codes where promotion_id=$1 order by id", [id])).rows;
}
async function snapshot(id: number) {
  return {
    promotion: (await pool.query("select * from promotions where id=$1", [id])).rows,
    codes: await codes(id),
    redemptions: (await pool.query("select * from promotion_redemptions where promotion_id=$1 order by id", [id])).rows,
    audits: (await pool.query("select * from promotion_audit_logs where promotion_id=$1 order by id", [id])).rows,
  };
}
async function addRedemption(p: Saved, kind: "package" | "class") {
  const target = kind === "package"
    ? await pool.query("insert into package_orders(student_name,student_email,student_id,package_name,total_credits,remaining_credits) values ('Phase1A',$1,$2,'Test',1,1) returning id", [`history-${run}@example.invalid`, studentId])
    : await pool.query("insert into bookings(student_name,student_email) values ('Phase1A',$1) returning id", [`history-${run}@example.invalid`]);
  await pool.query(`insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,package_order_id,booking_id,original_subtotal,discount_amount,final_subtotal,metadata)
    values ($1,$2,$3,$4,$5,100,10,90,$6)`, [p.id, p.codes[0].id, studentId, kind === "package" ? target.rows[0].id : null, kind === "class" ? target.rows[0].id : null, { source: `${kind}_checkout`, promoCode: p.codes[0].code }]);
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
  const a = await pool.query("insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Test',true) returning id", [`promo-admin-${run}`, `admin-${run}@example.invalid`]);
  const r = await pool.query("insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Restricted',false) returning id", [`promo-restricted-${run}`, `restricted-${run}@example.invalid`]);
  const st = await pool.query("insert into students(name,email,email_verified) values ('Promo Test',$1,true) returning id", [`student-${run}@example.invalid`]);
  studentId = st.rows[0].id;
  packageId = (await pool.query("insert into price_packages(name,price_egp) values ($1,100) returning id", [`package-${run}`])).rows[0].id;
  adminToken = jwt.sign({ sub: a.rows[0].id, tokenVersion: 1 }, process.env.ADMIN_JWT_SECRET!);
  restrictedToken = jwt.sign({ sub: r.rows[0].id, tokenVersion: 1 }, process.env.ADMIN_JWT_SECRET!);
  studentToken = jwt.sign({ sub: studentId, type: "student", emailVerified: true, tokenVersion: 1 }, process.env.STUDENT_JWT_SECRET!);
  const app = express(); app.use(express.json()); app.use("/api", requireAuth); app.use("/api", promotions); app.use("/api", packageOrders); app.use("/api", bookings);
  // Same sanitized unexpected-error body as app.ts; no unrelated full-app startup side effects.
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => { unexpectedErrors.push(_err); res.status(500).json({ error: "Internal server error" }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (pool) await pool.end(); });

test("fresh manual creates one normalized code with limits and audit", async () => {
  const raw = unique().toLowerCase(); const p = await create({ code: ` ${raw} ` });
  assert.equal(p.codes.length, 1); assert.equal(p.codes[0].promotionId, p.id);
  assert.equal(p.codes[0].code, raw.toUpperCase()); assert.equal(p.codes[0].maxUses, 12);
  assert.equal((await snapshot(p.id)).audits.length, 1);
});
test("fresh automatic accepts current Admin empty/null code fields and creates no code", async () => {
  const p = await create({ type: "automatic", code: "", maxUses: null, usesPerUser: null });
  assert.deepEqual(p.codes, []);
});
for (const variant of ["exact", "case", "space"] as const) test(`duplicate ${variant} code is 409 and leaves no partial primary rows`, async () => {
  const p = await create(); const name = unique(); const code = p.codes[0].code;
  const prior = await snapshot(p.id);
  const result = await request("POST", "/promotions", payload({ name, code: variant === "case" ? code.toLowerCase() : variant === "space" ? ` ${code} ` : code }));
  assert.equal(result.status, 409); assert.equal(result.data.code, "CODE_ALREADY_IN_USE");
  assert.equal((await pool.query("select id from promotions where name=$1", [name])).rowCount, 0);
  assert.deepEqual(await snapshot(p.id), prior);
});
test("legacy noncanonical normalized collision is rejected without rewriting it", async () => {
  const p = await create(); const text = ` ${unique().toLowerCase()} `;
  await pool.query("update promotion_codes set code=$1 where id=$2", [text,p.codes[0].id]);
  const prior = await snapshot(p.id);
  const result = await request("POST", "/promotions", payload({ code: text.trim().toUpperCase() }));
  assert.equal(result.status, 409); assert.deepEqual(await snapshot(p.id), prior);
});
test("unused rename preserves identity, owner, limits, counter and removes old lookup", async () => {
  const p = await create(); const beforeRows = await codes(p.id); const code = unique();
  const result = await request("PATCH", `/promotions/${p.id}`, { code }); assert.equal(result.status, 200);
  const rows = await codes(p.id); assert.equal(rows.length, 1);
  for (const field of ["id","promotion_id","max_uses","uses_per_user","current_uses","created_at"]) assert.deepEqual(rows[0][field], beforeRows[0][field]);
  assert.equal(rows[0].code, code);
  assert.equal((await pool.query("select id from promotion_codes where code=$1", [p.codes[0].code])).rowCount, 0);
  assert.equal(result.data.codes[0].code, code);
});
for (const kind of ["package", "class"] as const) test(`actual ${kind} redemption blocks rename even with zero counter; history unchanged`, async () => {
  const p = await create(); await addRedemption(p, kind); const prior = await snapshot(p.id);
  assert.equal(prior.codes[0].current_uses, 0);
  const result = await request("PATCH", `/promotions/${p.id}`, { code: unique() });
  assert.equal(result.status, 409); assert.equal(result.data.code, "CODE_ALREADY_REDEEMED");
  assert.deepEqual(await snapshot(p.id), prior);
});
test("normalized-equivalent used code is not a rename", async () => {
  const p = await create(); await addRedemption(p, "class");
  const result = await request("PATCH", `/promotions/${p.id}`, { code: ` ${p.codes[0].code.toLowerCase()} ` });
  assert.equal(result.status, 200); assert.equal(result.data.codes[0].id, p.codes[0].id);
});
test("another promotion's code cannot be acquired", async () => {
  const a = await create(), b = await create(); const beforeA = await snapshot(a.id), beforeB = await snapshot(b.id);
  const result = await request("PATCH", `/promotions/${b.id}`, { code: a.codes[0].code });
  assert.equal(result.status, 409); assert.deepEqual(await snapshot(a.id), beforeA); assert.deepEqual(await snapshot(b.id), beforeB);
});
test("omitted code, limits and all supported rules are preserved", async () => {
  const rules = { verifiedStudentOnly: true, firstPackagePurchaseOnly: true, minimumBasketAmount: 5, packageIds:[packageId], branches:["Downtown"], maxGlobalUses:8, maxUsesPerUser:1 };
  const p = await create({ rulesConfig: rules });
  const result = await request("PATCH", `/promotions/${p.id}`, { name: "Renamed promotion" });
  assert.equal(result.status, 200); assert.deepEqual(result.data.rulesConfig, rules);
  assert.equal(result.data.codes[0].code,p.codes[0].code); assert.equal(result.data.codes[0].maxUses,12); assert.equal(result.data.codes[0].usesPerUser,2);
});
test("limits can change without a code field; explicit null clears only its limit", async () => {
  const p = await create();
  const result = await request("PATCH", `/promotions/${p.id}`, { maxUses: null, usesPerUser: 3 });
  assert.equal(result.status,200); assert.equal(result.data.codes[0].maxUses,null); assert.equal(result.data.codes[0].usesPerUser,3);
  assert.equal(result.data.codes[0].id,p.codes[0].id);
});
const invalid: Array<[string, Record<string, unknown>]> = [
  ["empty name",{name:" "}], ["unknown type",{type:"other"}], ["unknown discount type",{discountType:"other"}],
  ["over 100",{discountValue:101}], ["zero",{discountValue:0}], ["negative",{discountValue:-1}],
  ["null",{discountValue:null}], ["blank",{discountValue:""}], ["boolean",{discountValue:true}],
  ["NaN string",{discountValue:"NaN"}], ["Infinity",{discountValue:"Infinity"}], ["unsafe money",{discountValue:1e100}],
  ["invalid date",{startDate:"nonsense"}], ["calendar rollover",{startDate:"2026-02-30T00:00:00Z"}],
  ["unsupported timezone offset",{startDate:"2026-10-22T10:00:00+23:00"}],
  ["missing timezone",{startDate:"2026-01-01T12:00:00"}], ["reversed dates",{startDate:"2026-12-01T00:00:00Z",endDate:"2026-01-01T00:00:00Z"}],
  ["zero limit",{maxUses:0}], ["negative limit",{usesPerUser:-1}], ["fractional limit",{maxUses:1.5}],
  ["overflow limit",{maxUses:2147483648}], ["priority overflow",{priority:2147483648}],
  ["promotion usage zero",{rulesConfig:{maxGlobalUses:0}}], ["promotion usage overflow",{rulesConfig:{maxUsesPerUser:2147483648}}],
  ["unknown rule",{rulesConfig:{unknown:true}}], ["invalid package id",{rulesConfig:{packageIds:[0]}}],
  ["missing package",{rulesConfig:{packageIds:[2147483647]}}], ["missing code",{code:""}], ["short code",{code:"AB"}], ["null character code",{code:"ABC\0"}], ["null character name",{name:"ABC\0"}],
];
for (const [label, fields] of invalid) test(`POST/PATCH reject ${label} without changing persisted state`, async () => {
  const p = await create(); const prior = await snapshot(p.id);
  assert.equal((await request("POST","/promotions",payload(fields))).status,400);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,fields)).status,400);
  assert.deepEqual(await snapshot(p.id),prior);
});
test("numeric strings and offset dates round-trip through partial PATCH", async () => {
  const p = await create({ discountValue:"15",priority:"-1",maxUses:"3",startDate:"2026-02-28T12:00:00+02:00",endDate:"2026-03-01T12:00:00+02:00" });
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{description:"valid"})).status,200);
});
test("PATCH validates merged discount type and value", async () => {
  const p = await create({ discountType:"fixed_amount",discountValue:300 }); const prior=await snapshot(p.id);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{discountType:"percentage"})).status,400);
  assert.deepEqual(await snapshot(p.id),prior);
});
test("automatic cannot acquire a code or non-null code limits on POST/PATCH", async () => {
  const p = await create({type:"automatic",code:"",maxUses:null,usesPerUser:null});
  for (const fields of [{code:unique()},{maxUses:3},{usesPerUser:1}]) {
    assert.equal((await request("POST","/promotions",payload({type:"automatic",code:"",maxUses:null,usesPerUser:null,...fields}))).status,400);
    assert.equal((await request("PATCH",`/promotions/${p.id}`,fields)).status,400);
  }
  assert.equal((await codes(p.id)).length,0);
});
test("manual to automatic is a conflict with all original rows preserved", async () => {
  const p=await create();const prior=await snapshot(p.id);
  const result=await request("PATCH",`/promotions/${p.id}`,{type:"automatic",code:"",maxUses:null,usesPerUser:null});
  assert.equal(result.status,409);assert.equal(result.data.code,"TYPE_CHANGE_NOT_ALLOWED");assert.deepEqual(await snapshot(p.id),prior);
});
test("clean automatic to manual requires a code, creates exactly one and preserves promotion rules", async () => {
  const p=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,rulesConfig:{maxGlobalUses:9}});
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{type:"manual"})).status,400);
  const result=await request("PATCH",`/promotions/${p.id}`,{type:"manual",code:unique(),maxUses:5});
  assert.equal(result.status,200);assert.equal(result.data.id,p.id);assert.equal(result.data.codes.length,1);assert.deepEqual(result.data.rulesConfig,{maxGlobalUses:9});
});
for (const kind of ["multiple", "automatic", "missing"] as const) test(`legacy ${kind} code configuration blocks edit/reactivation, permits audited DELETE deactivation`, async () => {
  const p=await create({isActive:true});
  if (kind==="multiple") await pool.query("insert into promotion_codes(promotion_id,code) values ($1,$2)",[p.id,unique()]);
  if (kind==="automatic") await pool.query("update promotions set type='automatic' where id=$1",[p.id]);
  if (kind==="missing") await pool.query("delete from promotion_codes where promotion_id=$1",[p.id]);
  const prior=await snapshot(p.id);
  for (const fields of [{name:"Other"},{isActive:true}]) {assert.equal((await request("PATCH",`/promotions/${p.id}`,fields)).status,409);assert.deepEqual(await snapshot(p.id),prior);}
  assert.equal((await request("DELETE",`/promotions/${p.id}`)).status,204);
  const after=await snapshot(p.id);assert.deepEqual(after.codes,prior.codes);assert.deepEqual(after.redemptions,prior.redemptions);assert.equal(after.promotion[0].is_active,false);assert.equal(after.audits.length,prior.audits.length+1);
});
test("unknown stored rules are not stripped by a partial edit", async () => {
  const p=await create();await pool.query("update promotions set rules_config=$1 where id=$2",[{legacyUnknown:true},p.id]);const prior=await snapshot(p.id);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{description:"edit"})).status,400);assert.deepEqual(await snapshot(p.id),prior);
});
test("cross-owner history blocks ordinary edits without moving historical references", async () => {
  const a=await create(),b=await create();await addRedemption(a,"class");
  // Keep exactly one code per owner, so both history checks (not cardinality) are exercised.
  await pool.query("delete from promotion_codes where id=$1",[b.codes[0].id]);
  await pool.query("update promotion_codes set promotion_id=$1 where id=$2",[b.id,a.codes[0].id]);
  await pool.query("insert into promotion_codes(promotion_id,code) values ($1,$2)",[a.id,unique()]);
  const priorA=await snapshot(a.id),priorB=await snapshot(b.id);
  assert.equal((await request("PATCH",`/promotions/${b.id}`,{description:"edit"})).status,409);
  assert.equal((await request("PATCH",`/promotions/${a.id}`,{description:"edit"})).status,409);
  assert.deepEqual(await snapshot(a.id),priorA);assert.deepEqual(await snapshot(b.id),priorB);
});
test("GET includes every legacy code in deterministic id order", async () => {
  const p=await create();await pool.query("insert into promotion_codes(promotion_id,code) values ($1,$2)",[p.id,unique()]);
  const result=await request<Saved[]>("GET","/promotions");assert.equal(result.status,200);
  const found=result.data.find((row:Saved)=>row.id===p.id) as Saved;
  assert.deepEqual(found.codes.map((c)=>c.id),(await codes(p.id)).map((c)=>c.id));assert.equal(found.codes.length,2);
});
test("concurrent duplicate create: unique-index race returns one 201 and one 409, no orphan", async () => {
  const code=unique(),name=unique();
  const blocker=await pool.connect();
  let pending: ReturnType<typeof request>[] = [];
  try {
    await blocker.query("begin");
    await blocker.query("lock table promotion_codes in share mode");
    pending=[request("POST","/promotions",payload({code,name})),request("POST","/promotions",payload({code,name}))];
    const deadline=Date.now()+5000;
    let waiting=0;
    while (Date.now()<deadline) {
      waiting=Number((await pool.query("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'insert into \"promotion_codes\"%'")).rows[0].count);
      if (waiting===2) break;
      await new Promise((resolve)=>setTimeout(resolve,10));
    }
    assert.equal(waiting,2,"Both requests must pass preflight and wait on their code INSERT.");
  } finally { await blocker.query("commit"); blocker.release(); }
  const results=await Promise.all(pending);
  assert.deepEqual(results.map((r)=>r.status).sort(),[201,409]);
  assert.equal((await pool.query("select id from promotions where name=$1",[name])).rowCount,1);
});
test("concurrent edits to one promotion retain exactly one code identity", async () => {
  const p=await create();const results=await Promise.all([request("PATCH",`/promotions/${p.id}`,{code:unique()}),request("PATCH",`/promotions/${p.id}`,{code:unique()})]);
  assert.deepEqual(results.map((r)=>r.status),[200,200]);const rows=await codes(p.id);assert.equal(rows.length,1);assert.equal(rows[0].id,p.codes[0].id);
  // Last-writer behavior is intentional in 1A; stale Admin revisions are 1B.
});
test("unexpected code-insert database failure rolls back promotion and remains sanitized", async () => {
  const code=unique(),name=unique();
  await pool.query(`create function p1a_fail_code_insert() returns trigger language plpgsql as $$ begin if NEW.code = '${code}' then raise unique_violation using message='private SQL detail', constraint='unrelated_unique'; end if; return NEW; end $$`);
  await pool.query("create trigger p1a_fail_code_insert before insert on promotion_codes for each row execute function p1a_fail_code_insert()");
  try {
    const result=await request("POST","/promotions",payload({code,name}));assert.equal(result.status,500);assert.deepEqual(result.data,{error:"Internal server error"});
    assert.equal((await pool.query("select id from promotions where name=$1",[name])).rowCount,0);assert.equal((await pool.query("select id from promotion_codes where code=$1",[code])).rowCount,0);
  } finally {await pool.query("drop trigger p1a_fail_code_insert on promotion_codes");await pool.query("drop function p1a_fail_code_insert()");}
});
test("auth and RBAC gates remain effective for all CRUD methods", async () => {
  const p=await create();const prior=await snapshot(p.id);
  for (const [method,path,body] of [["GET","/promotions",undefined],["POST","/promotions",payload()],["PATCH",`/promotions/${p.id}`,{name:"denied"}],["DELETE",`/promotions/${p.id}`,undefined]] as const) {
    assert.equal((await request(method,path,body,null)).status,401);
    assert.equal((await request(method,path,body,restrictedToken)).status,403);
    assert.equal((await request(method,path,body,adminToken,studentToken)).status,403);
  }
  assert.deepEqual(await snapshot(p.id),prior);
});
test("unknown promotion returns 404; invalid route integer returns 400", async () => {
  assert.equal((await request("PATCH","/promotions/2147483647",{name:"missing"})).status,404);
  assert.equal((await request("PATCH","/promotions/2147483648",{name:"missing"})).status,400);
});

// Modern checkout fixtures supplement older atomicity suites whose phone fixtures
// violate the current canonical-phone constraint before reaching their routes.
async function checkoutFixture(kind: "package" | "class") {
  const email = `${unique()}@example.invalid`;
  const st = (await pool.query("insert into students(name,email,email_verified,account_type,date_of_birth) values ('Phase1A',$1,true,'student','2000-01-01') returning id", [email])).rows[0];
  const { default: jwt } = await import("jsonwebtoken");
  const token = jwt.sign({ sub: st.id, email, type: "student", emailVerified: true, tokenVersion: 1 }, process.env.STUDENT_JWT_SECRET!);
  const promotion = await create({ isActive: true });
  if (kind === "package") {
    const pkg = (await pool.query("insert into price_packages(name,type,price_egp,sessions,validity_months,is_active,allow_all_ages) values ($1,'per_class',400,8,6,true,true) returning id", [unique()])).rows[0];
    return { studentId: st.id, token, promotion, path: "/package-orders", body: { packageId: pkg.id, promoCode: promotion.codes[0].code }, gross:400 };
  }
  const instructor = (await pool.query("insert into instructors(name,is_active) values ($1,true) returning id", [unique()])).rows[0];
  const cls = (await pool.query("insert into classes(title,category,instructor_id,is_active,allow_all_ages) values ($1,'general',$2,true,true) returning id", [unique(),instructor.id])).rows[0];
  const schedule = (await pool.query("insert into schedules(class_id,type,status,day_of_week,start_time,end_time,price_egp) values ($1,'weekly','active',4,'10:00','11:00',300) returning id", [cls.id])).rows[0];
  return { studentId: st.id, token, promotion, path: "/bookings", body: { studentName:"Phase1A",studentEmail:email,scheduleId:schedule.id,classId:cls.id,paymentMode:"pay_at_studio",promoCode:promotion.codes[0].code,expectedPriceEgp:300,expectedFinalPriceEgp:270 }, gross:300 };
}
async function financeHistory(promotionId: number) {
  const redemptions = (await pool.query("select * from promotion_redemptions where promotion_id=$1 order by id", [promotionId])).rows;
  const payments = (await pool.query("select * from payment_records where package_order_id in (select package_order_id from promotion_redemptions where promotion_id=$1) or booking_id in (select booking_id from promotion_redemptions where promotion_id=$1) order by id", [promotionId])).rows;
  const events = (await pool.query("select * from payment_events where payment_record_id=any($1::int[]) order by id", [payments.map(p=>p.id)])).rows;
  const orders = (await pool.query("select * from package_orders where id=any($1::int[]) order by id", [redemptions.map(r=>r.package_order_id).filter(Boolean)])).rows;
  const bookings = (await pool.query("select * from bookings where id=any($1::int[]) order by id", [redemptions.map(r=>r.booking_id).filter(Boolean)])).rows;
  return { redemptions, payments, events, orders, bookings };
}
for (const kind of ["package", "class"] as const) {
  test(`${kind} HTTP checkout preserves discount and financial snapshots after CRUD edits`, async () => {
    const f = await checkoutFixture(kind);
    const response = await request("POST",f.path,f.body,null,f.token);
    assert.equal(response.status,201,JSON.stringify(response.data) + String(unexpectedErrors.at(-1)));
    const history = await financeHistory(f.promotion.id);
    assert.equal(history.redemptions.length,1); assert.equal(history.payments.length,1);
    assert.ok(history.events.length > 0);
    assert.equal(history.orders.length + history.bookings.length,1);
    assert.equal(history.payments[0].gross_amount_minor,f.gross * 100);
    assert.equal(history.payments[0].discount_amount_minor,f.gross * 10);
    assert.equal(history.payments[0].final_payable_amount_minor,f.gross * 90);
    assert.equal(Number(history.redemptions[0].original_subtotal),f.gross);
    assert.equal(Number(history.redemptions[0].discount_amount),f.gross / 10);
    assert.equal(Number(history.redemptions[0].final_subtotal),f.gross * 0.9);
    assert.equal((await request("PATCH",`/promotions/${f.promotion.id}`,{code:unique()})).status,409);
    assert.equal((await request("PATCH",`/promotions/${f.promotion.id}`,{name:unique(),discountValue:20})).status,200);
    assert.deepEqual(await financeHistory(f.promotion.id),history);
    assert.equal((await codes(f.promotion.id))[0].current_uses,1);
  });
  test(`${kind} HTTP checkout rolls back purchase and finance rows when redemption insertion fails`, async () => {
    const f = await checkoutFixture(kind);
    await pool.query(`create or replace function phase1a_fail_redemption() returns trigger language plpgsql as $$ begin raise exception 'phase1a forced redemption failure'; end $$`);
    await pool.query(`create trigger phase1a_fail_redemption before insert on promotion_redemptions for each row when (new.promotion_id = ${f.promotion.id}) execute function phase1a_fail_redemption()`);
    try {
      const response = await request("POST",f.path,f.body,null,f.token);
      assert.equal(response.status,500,JSON.stringify(response.data));
      const failure = unexpectedErrors.at(-1) as Error & { cause?: Error };
      assert.match(String(failure.cause ?? failure), /phase1a forced redemption failure/);
      assert.deepEqual(await financeHistory(f.promotion.id),{redemptions:[],payments:[],events:[],orders:[],bookings:[]});
      const table = kind === "package" ? "package_orders" : "bookings";
      const column = kind === "package" ? "student_id" : "account_owner_student_id";
      assert.equal((await pool.query(`select id from ${table} where ${column}=$1`,[f.studentId])).rowCount,0);
      assert.equal((await codes(f.promotion.id))[0].current_uses,0);
    } finally {
      await pool.query("drop trigger phase1a_fail_redemption on promotion_redemptions");
      await pool.query("drop function phase1a_fail_redemption()");
    }
  });
}
