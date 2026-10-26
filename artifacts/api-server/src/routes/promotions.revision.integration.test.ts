/** Phase 1B: deterministic real HTTP/PostgreSQL concurrency and audit verification.
 * Provision the current schema in a NEW disposable database before running.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

const databaseUrl = process.env.DISPOSABLE_PROMOTIONS_REVIEW_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DISPOSABLE_PROMOTIONS_REVIEW_DATABASE_URL to a newly provisioned local disposable database.");
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
const run = `${Date.now()}-${process.pid}`;
let sequence = 0;
const unexpectedErrors: unknown[] = [];
const unique = () => `P1BR-${run}-${++sequence}`;

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
before(async () => {
  ({ pool } = await import("@workspace/db"));
  const { default: jwt } = await import("jsonwebtoken");
  const { default: express } = await import("express");
  const { requireAuth } = await import("../middlewares/auth");
  const { default: promotions } = await import("./promotions");
  const { default: packageOrders } = await import("./packageOrders");
  const { default: bookings } = await import("./bookings");
  const a = await pool.query("insert into system_users(username,email,password_hash,full_name,is_super_admin) values ($1,$2,'unused','Test',true) returning id", [`promo-admin-${run}`, `admin-${run}@example.invalid`]);
  adminToken = jwt.sign({ sub: a.rows[0].id, tokenVersion: 1 }, process.env.ADMIN_JWT_SECRET!);
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
async function stored(p: Saved) {
  const { db, promotionsTable, promotionCodesTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [promotion] = await db.select().from(promotionsTable).where(eq(promotionsTable.id,p.id));
  const codeRows = await db.select().from(promotionCodesTable).where(eq(promotionCodesTable.promotionId,p.id));
  return { promotion, codeRows };
}
const dates = { startDate:"2026-11-01T10:00:00.123456Z",endDate:"2026-12-01T10:00:00.123456Z" };
for (const field of ["startDate","endDate"] as const) {
  test(`DB-derived ${field} is a string; changing only it changes revision and is never a no-op`,async()=>{
    const p=await create(dates),before=await stored(p),prior=await allState(p);
    assert.equal(typeof before.promotion[field],"string");
    const date=field==="startDate"?"2026-11-02T10:00:00.123456Z":"2026-12-02T10:00:00.123456Z";
    const r=await request("PATCH",`/promotions/${p.id}`,{[field]:date},adminToken,undefined,p.revision);
    assert.equal(r.status,200);assert.notEqual(r.data.revision,p.revision);
    const after=await stored(p);assert.notEqual(after.promotion[field],before.promotion[field]);
    const state=await allState(p);assert.equal(state.audits.length,prior.audits.length+1);assert.equal(state.activity.length,prior.activity.length+1);
    assert.equal((await request("PATCH",`/promotions/${p.id}`,{[field]:dates[field]},adminToken,undefined,p.revision)).status,409);
    assert.deepEqual(await allState(p),state);
  });
  test(`equivalent ${field} timezone/fraction representations are a no-op with no extra audit`,async()=>{
    const p=await create(dates),prior=await allState(p);
    const text=field==="startDate"?"2026-11-01T12:00:00.123456+02:00":"2026-12-01T12:00:00.123456+02:00";
    const r=await request("PATCH",`/promotions/${p.id}`,{[field]:text},adminToken,undefined,p.revision);
    assert.equal(r.status,200);assert.equal(r.data.revision,p.revision);assert.deepEqual(await allState(p),prior);
  });
  test(`a one-microsecond ${field} edit remains a real configuration change`,async()=>{
    const p=await create(dates);
    const date=dates[field].replace("123456","123457");
    const r=await request("PATCH",`/promotions/${p.id}`,{[field]:date},adminToken,undefined,p.revision);
    assert.equal(r.status,200);assert.notEqual(r.data.revision,p.revision);
    assert.match((await stored(p)).promotion[field]!,/123457/);
  });
}
test("Date objects derived from real records do not collapse; millisecond-equivalent strings and Dates match",async()=>{
  const {promotionRevision}=await import("../lib/promotionRevision");
  const p=await create({startDate:"2026-11-01T10:00:00.123Z",endDate:null});
  const {promotion,codeRows}=await stored(p);
  const date=new Date(promotion.startDate!);
  assert.equal(promotionRevision(promotion,codeRows),promotionRevision({...promotion,startDate:date},codeRows));
  assert.notEqual(promotionRevision({...promotion,startDate:date},codeRows),promotionRevision({...promotion,startDate:new Date(date.getTime()+1)},codeRows));
  assert.throws(()=>promotionRevision({...promotion,startDate:new Date("invalid")},codeRows),/Invalid promotion timestamp/);
});
test("database timezone representations do not change a revision; pre-epoch microseconds remain distinct",async()=>{
  const {promotionRevision}=await import("../lib/promotionRevision");
  const p=await create({startDate:"1969-12-31T23:59:59.999999Z",endDate:null});
  const {promotion,codeRows}=await stored(p);
  assert.equal(promotionRevision(promotion,codeRows),promotionRevision({...promotion,startDate:"1970-01-01T01:59:59.999999+02:00"},codeRows));
  assert.notEqual(promotionRevision(promotion,codeRows),promotionRevision({...promotion,startDate:"1969-12-31T23:59:59.999998Z"},codeRows));
});
test("supported JSON values retain identity; key order and volatile usage/time fields do not affect revisions",async()=>{
  const {promotionRevision}=await import("../lib/promotionRevision");
  const p=await create({rulesConfig:{verifiedStudentOnly:true,minimumBasketAmount:20,branches:["Main"]}});
  const {promotion,codeRows}=await stored(p),revision=promotionRevision(promotion,codeRows);
  assert.equal(revision,promotionRevision({...promotion,rulesConfig:{branches:["Main"],minimumBasketAmount:20,verifiedStudentOnly:true},updatedAt:"2099-01-01T00:00:00Z"},codeRows.map(c=>({...c,currentUses:99,updatedAt:"2099-01-01T00:00:00Z"}))));
  assert.notEqual(revision,promotionRevision({...promotion,rulesConfig:{...promotion.rulesConfig,verifiedStudentOnly:false}},codeRows));
  assert.notEqual(revision,promotionRevision({...promotion,rulesConfig:{...promotion.rulesConfig,minimumBasketAmount:21}},codeRows));
  assert.notEqual(revision,promotionRevision({...promotion,rulesConfig:{...promotion.rulesConfig,branches:["Other"]}},codeRows));
  assert.notEqual(revision,promotionRevision({...promotion,description:"changed"},codeRows));
});
for (const kind of ["package","class"] as const) {
  test(`${kind} checkout revalidation catches a date-only change after candidate discovery`,async()=>{
    const f=await checkoutFixture(kind);
    const [edit,checkout]=await orderedRace(f.promotion.id,
      ()=>request("PATCH",`/promotions/${f.promotion.id}`,{startDate:"2099-01-01T00:00:00Z"},adminToken,undefined,f.promotion.revision),
      ()=>request("POST",f.path,f.body,null,f.token));
    assert.equal(edit.status,200);assert.equal(checkout.status,409);assert.match(checkout.data.error,/changed during checkout/);
    assert.deepEqual(await financeHistory(f.promotion.id),{redemptions:[],payments:[],events:[],orders:[],bookings:[]});
  });
}
