/** Phase 1B: deterministic real HTTP/PostgreSQL concurrency and audit verification.
 * Provision the current schema in a NEW disposable database before running.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

const databaseUrl = process.env.DISPOSABLE_PROMOTIONS_PHASE1B_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DISPOSABLE_PROMOTIONS_PHASE1B_DATABASE_URL to a newly provisioned local disposable database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/disposable|test/i.test(url.pathname) || /railway|rlwy/i.test(databaseUrl)) {
  throw new Error("Promotions tests refuse non-local or non-disposable databases.");
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
const unique = () => `P1B-${run}-${++sequence}`;

type Code = { id: number; promotionId: number; code: string; maxUses: number | null; usesPerUser: number | null; currentUses: number };
type Saved = { revision: string; id: number; name: string; type: string; codes: Code[]; rulesConfig: Record<string, unknown>; isActive: boolean };
async function request<T = Saved & { code: string; error: string }>(method: string, path: string, body?: unknown, token: string | null = adminToken, bearer?: string, revision?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(revision ? { "If-Match": `"${revision}"` } : {}), ...(token ? { "x-admin-token": token } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
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
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    unexpectedErrors.push(_err);
    const error = _err as { expose?: boolean; status?: number; message?: string };
    res.status(error.expose ? error.status! : 500).json({ error: error.expose ? error.message : "Internal server error" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (pool) await pool.end(); });

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
async function waitForPromotionWaiters(id: number, count: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = await pool.query("select count(*) from pg_locks where locktype='advisory' and classid=918201 and objid=$1 and not granted",[id]);
    if (Number(rows.rows[0].count) >= count) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`Expected ${count} waiting transactions for promotion ${id}`);
}
async function orderedRace(id: number, first: ()=>Promise<{ status: number; data: Saved & { code: string; error: string } }>, second: ()=>Promise<{ status: number; data: Saved & { code: string; error: string } }>) {
  const blocker = await pool.connect();
  const requests: Promise<{ status: number; data: Saved & { code: string; error: string } }>[] = [];
  try {
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(918201,$1)",[id]);
    requests.push(first()); await waitForPromotionWaiters(id,1);
    requests.push(second()); await waitForPromotionWaiters(id,2);
  } finally {
    await blocker.query("rollback"); blocker.release();
  }
  return Promise.all(requests);
}
async function activity(p: Saved) {
  return (await pool.query("select * from admin_activity_logs where module='promotions' and ((entity_type='promotion' and entity_id=$1) or (entity_type='promotion_code' and entity_id=any($2::text[]))) order by id",[String(p.id),p.codes.map(c=>String(c.id))])).rows;
}
async function allState(p: Saved) { return {...await snapshot(p.id),activity:await activity(p)}; }
async function injectFailure(table: string, event: string, operation: ()=>Promise<void>) {
  await pool.query("create function phase1b_fail() returns trigger language plpgsql as $$ begin raise exception 'phase1b intentional failure'; end $$");
  await pool.query(`create trigger phase1b_fail before ${event} on ${table} for each row execute function phase1b_fail()`);
  try { await operation(); } finally {
    await pool.query(`drop trigger phase1b_fail on ${table}`); await pool.query("drop function phase1b_fail()");
  }
}
for (const kind of ["class"] as const) {
  test(`${kind}: redemption wins; waiting Admin rename rejects actual usage`,async()=>{
    const f=await checkoutFixture(kind);
    const [checkout,rename]=await orderedRace(f.promotion.id,
      ()=>request("POST",f.path,f.body,null,f.token),
      ()=>request("PATCH",`/promotions/${f.promotion.id}`,{code:unique()}));
    assert.equal(checkout.status,201,JSON.stringify(checkout.data));
    assert.equal(rename.status,409);assert.equal(rename.data.code,"CODE_ALREADY_REDEEMED");
    assert.equal((await codes(f.promotion.id))[0].code,f.promotion.codes[0].code);
    assert.equal((await financeHistory(f.promotion.id)).redemptions.length,1);
  });
  test(`${kind}: rename wins over discovered old code; no checkout records; new code preserves identity`,async()=>{
    const f=await checkoutFixture(kind),newCode=unique();
    const [rename,checkout]=await orderedRace(f.promotion.id,
      ()=>request("PATCH",`/promotions/${f.promotion.id}`,{code:newCode}),
      ()=>request("POST",f.path,f.body,null,f.token));
    assert.equal(rename.status,200);assert.equal(checkout.status,409,JSON.stringify(checkout.data));
    assert.match(checkout.data.error,/changed during checkout/);
    assert.equal((await codes(f.promotion.id))[0].id,f.promotion.codes[0].id);
    const table="bookings",column="account_owner_student_id";
    assert.equal((await pool.query(`select id from ${table} where ${column}=$1`,[f.studentId])).rowCount,0);
    assert.deepEqual(await financeHistory(f.promotion.id),{redemptions:[],payments:[],events:[],orders:[],bookings:[]});
    assert.equal((await request("POST",f.path,{...f.body,promoCode:newCode},null,f.token)).status,201);
  });
}
for (const [label,patch] of [["eligibility",{rulesConfig:{minimumBasketAmount:1000}}],["code limit",{maxUses:1}],["deactivation",{isActive:false}],["discount",{discountValue:20}]] as const) {
  test(`checkout rejects a concurrent ${label} change instead of using its stale snapshot`,async()=>{
    const f=await checkoutFixture("class");
    const [edit,purchase]=await orderedRace(f.promotion.id,
      ()=>request("PATCH",`/promotions/${f.promotion.id}`,patch),
      ()=>request("POST",f.path,f.body,null,f.token));
    assert.equal(edit.status,200);assert.equal(purchase.status,409);
    assert.equal((await financeHistory(f.promotion.id)).redemptions.length,0);
  });
}
test("DELETE deactivation shares the checkout lock and prevents stale redemption",async()=>{
  const f=await checkoutFixture("class");
  const [deactivate,purchase]=await orderedRace(f.promotion.id,
    ()=>request("DELETE",`/promotions/${f.promotion.id}`),
    ()=>request("POST",f.path,f.body,null,f.token));
  assert.equal(deactivate.status,204);assert.equal(purchase.status,409);
});
test("automatic changes reject a waiting no-code class checkout without charging an altered amount",async()=>{
  const f=await checkoutFixture("class");
  const auto=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true});
  try {
    const [edit,purchase]=await orderedRace(auto.id,
      ()=>request("PATCH",`/promotions/${auto.id}`,{discountValue:25}),
      ()=>request("POST",f.path,{...f.body,promoCode:undefined},null,f.token));
    assert.equal(edit.status,200);assert.equal(purchase.status,409);
    assert.equal((await pool.query("select id from bookings where account_owner_student_id=$1",[f.studentId])).rowCount,0);
  } finally { await request("DELETE",`/promotions/${auto.id}`); }
});
test("multiple automatic/manual candidates retain stacking arithmetic and locked identities",async()=>{
  const f=await checkoutFixture("class");
  await request("PATCH",`/promotions/${f.promotion.id}`,{isStackable:true});
  const a=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,isStackable:true});
  const b=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true,isStackable:true});
  try {
    assert.equal((await request("POST",f.path,{...f.body,expectedFinalPriceEgp:210},null,f.token)).status,201);
    const h=await financeHistory(f.promotion.id);
    assert.equal(h.payments[0].gross_amount_minor,30000);assert.equal(h.payments[0].discount_amount_minor,9000);assert.equal(h.payments[0].final_payable_amount_minor,21000);
    const ids=(await pool.query("select promotion_id from promotion_redemptions where booking_id=$1 order by promotion_id",[h.bookings[0].id])).rows.map(r=>r.promotion_id);
    assert.deepEqual(ids,[f.promotion.id,a.id,b.id].sort((x,y)=>x-y));
  } finally { await request("DELETE",`/promotions/${a.id}`);await request("DELETE",`/promotions/${b.id}`); }
});
test("simultaneous cap-one purchases cannot both redeem",async()=>{
  const f=await checkoutFixture("class");await request("PATCH",`/promotions/${f.promotion.id}`,{maxUses:1});
  const other=await checkoutFixture("class");
  const firstLock=Number((await pool.query("select min(id) as id from promotions where type='automatic' or id=$1",[f.promotion.id])).rows[0].id);
  const results=await orderedRace(firstLock,
    ()=>request("POST",f.path,f.body,null,f.token),()=>request("POST",other.path,{...other.body,promoCode:f.promotion.codes[0].code},null,other.token));
  assert.equal(results[0].status,201);assert.notEqual(results[1].status,201);
  assert.equal((await financeHistory(f.promotion.id)).redemptions.length,1);assert.equal((await codes(f.promotion.id))[0].current_uses,1);
});
for (const [table,event,operation] of [["promotions","insert","create"],["promotion_codes","update","edit"],["promotion_audit_logs","insert","create"],["promotion_audit_logs","insert","edit"],["admin_activity_logs","insert","create"],["admin_activity_logs","insert","edit"]] as const) {
  test(`${operation}: ${table} failure rolls back primary state and both audit histories`,async()=>{
    const p=await create(),prior=await allState(p),name=unique();
    const auditTotals=async()=> (await pool.query("select (select count(*) from promotion_audit_logs) as promotion_count,(select count(*) from admin_activity_logs) as activity_count")).rows;
    const beforeTotals=await auditTotals();
    await injectFailure(table,event,async()=>{
      const r=operation==="create"?await request("POST","/promotions",payload({name})):await request("PATCH",`/promotions/${p.id}`,{name,code:unique()});
      assert.equal(r.status,500);assert.deepEqual(r.data,{error:"Internal server error"});
      assert.deepEqual(await allState(p),prior);assert.deepEqual(await auditTotals(),beforeTotals);assert.equal((await pool.query("select id from promotions where name=$1",[name])).rowCount,0);
    });
  });
}
test("successful create/edit has correct actor, redacted code activity, no audit duplicates for no-op",async()=>{
  const p=await create();let a=await activity(p);assert.equal(a.length,2);assert.ok(a.every(r=>r.actor_id!=null&&r.actor_name==="Test"));assert.equal(a.find(r=>r.entity_type==="promotion_code").after.code,"[redacted]");
  const r=await request("PATCH",`/promotions/${p.id}`,{name:unique(),code:unique()},adminToken,undefined,p.revision);assert.equal(r.status,200);
  assert.equal((await snapshot(p.id)).audits.length,2);a=await activity(p);assert.equal(a.length,4);
  const prior=await allState(p);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{},adminToken,undefined,r.data.revision)).status,200);
  assert.deepEqual(await allState(p),prior);
});
test("an identical repeated edit is a no-op even with its earlier revision; it does not replay a stored operation",async()=>{
  const p=await create(),name=unique();
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{name},adminToken,undefined,p.revision)).status,200);
  const prior=await allState(p);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{name},adminToken,undefined,p.revision)).status,200);
  assert.deepEqual(await allState(p),prior);
});
test("simultaneous Admin renames from one revision return one success and one conflict",async()=>{
  const p=await create();const results=await orderedRace(p.id,
    ()=>request("PATCH",`/promotions/${p.id}`,{code:unique()},adminToken,undefined,p.revision),
    ()=>request("PATCH",`/promotions/${p.id}`,{code:unique()},adminToken,undefined,p.revision));
  assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal(results[1].data.code,"PROMOTION_CHANGED");assert.equal((await codes(p.id)).length,1);
});
test("two actual Admins editing stale different fields cannot overwrite newer configuration",async()=>{
  const {default:jwt}=await import("jsonwebtoken");
  const id=(await pool.query("insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Other Admin',true) returning id",[unique(),`${unique()}@example.invalid`])).rows[0].id;
  const other=jwt.sign({sub:id,tokenVersion:1},process.env.ADMIN_JWT_SECRET!);
  const p=await create();assert.equal((await request("PATCH",`/promotions/${p.id}`,{name:unique()},adminToken,undefined,p.revision)).status,200);
  const prior=await allState(p);const r=await request("PATCH",`/promotions/${p.id}`,{maxUses:7},other,undefined,p.revision);
  assert.equal(r.status,409);assert.deepEqual(await allState(p),prior);
});
test("redemption counters do not invalidate an otherwise current configuration revision",async()=>{
  const f=await checkoutFixture("class");assert.equal((await request("POST",f.path,f.body,null,f.token)).status,201);
  const h=await financeHistory(f.promotion.id);
  assert.equal((await request("PATCH",`/promotions/${f.promotion.id}`,{description:"after purchase"},adminToken,undefined,f.promotion.revision)).status,200);
  assert.deepEqual(await financeHistory(f.promotion.id),h);
});
test("old Admin without revision remains compatible; explicit enforcement rejects missing revision; wildcard never bypasses",async()=>{
  const p=await create();assert.equal((await request("PATCH",`/promotions/${p.id}`,{description:"old browser"})).status,200);
  process.env.PROMOTIONS_REQUIRE_REVISION="true";
  try { assert.equal((await request("PATCH",`/promotions/${p.id}`,{description:"blocked"})).status,428); }
  finally { delete process.env.PROMOTIONS_REQUIRE_REVISION; }
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{name:"blocked"},adminToken,undefined,"*")).status,409);
});
test("revision checks never bypass authentication or permissions",async()=>{
  const p=await create();assert.equal((await request("PATCH",`/promotions/${p.id}`,{name:"blocked"},restrictedToken,undefined,p.revision)).status,403);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{name:"blocked"},null,studentToken,p.revision)).status,403);
});
test("preview old code fails and new code succeeds after rename",async()=>{
  const f=await checkoutFixture("class"),code=unique();await request("PATCH",`/promotions/${f.promotion.id}`,{code});
  const body={scheduleId:f.body.scheduleId,promoCode:f.promotion.codes[0].code};
  const old=await request<{eligible:boolean}>("POST","/promotions/validate",body,null,f.token);
  assert.equal(old.status,200);assert.equal(old.data.eligible,false);
  const fresh=await request<{eligible:boolean}>("POST","/promotions/validate",{...body,promoCode:code},null,f.token);assert.equal(fresh.status,200);assert.equal(fresh.data.eligible,true);
});
test("legacy multi-code mutation remains blocked and DELETE remains audited without rewriting history",async()=>{
  const p=await create({isActive:true});await pool.query("insert into promotion_codes(promotion_id,code) values ($1,$2)",[p.id,unique()]);const prior=await codes(p.id);
  assert.equal((await request("PATCH",`/promotions/${p.id}`,{name:"blocked"})).status,409);
  assert.equal((await request("DELETE",`/promotions/${p.id}`)).status,204);assert.deepEqual(await codes(p.id),prior);
});
for (const table of ["promotion_audit_logs","admin_activity_logs"]) {
  test(`DELETE ${table} failure rolls back deactivation`,async()=>{
    const p=await create({isActive:true}),prior=await allState(p);
    await injectFailure(table,"insert",async()=>{
      assert.equal((await request("DELETE",`/promotions/${p.id}`)).status,500);
      assert.deepEqual(await allState(p),prior);
    });
  });
}
test("unchanged legacy automatic-with-code eligibility is not silently disabled by Phase 1B",async()=>{
  const f=await checkoutFixture("class");
  const p=await create({type:"automatic",code:"",maxUses:null,usesPerUser:null,isActive:true});
  await pool.query("insert into promotion_codes(promotion_id,code,max_uses) values ($1,$2,1)",[p.id,unique()]);
  const priorCodes=await codes(p.id);
  try {
    assert.equal((await request("POST",f.path,{...f.body,promoCode:undefined},null,f.token)).status,201);
    const history=await financeHistory(p.id);assert.equal(history.redemptions.length,1);assert.equal(history.redemptions[0].promotion_code_id,null);
    assert.deepEqual(await codes(p.id),priorCodes);
  } finally { await request("DELETE",`/promotions/${p.id}`); }
  // Global legacy eligibility policy is explicitly deferred to Owner-approved Phase 1C.
});
// The six durable-retry scenarios are executable in promotions.durable.integration.test.ts.
