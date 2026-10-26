import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DISPOSABLE_PROMOTIONS_RELEASE_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/^\/promotions_final_release.*disposable$/.test(new URL(url).pathname)
)
  throw Error("Fresh local release disposable database required");
const client = new pg.Client({ connectionString: url });
const cleanup = readFileSync(
  new URL("./promotionsTestPromotionCleanup.sql", import.meta.url),
  "utf8",
);
before(async () => {
  await client.connect();
});
after(async () => {
  await client.query("rollback");
  await client.end();
});
beforeEach(async () => {
  // Only this dedicated synthetic fixture DB is accepted above. Never production.
  await client.query("rollback");
  await client.query(
    "delete from promotion_audit_logs where promotion_id in (3,999)",
  );
  await client.query(
    "delete from admin_activity_logs where module='promotions'",
  );
  await client.query(
    "delete from promotion_redemptions where promotion_id in (3,999)",
  );
  await client.query(
    "delete from promotion_codes where promotion_id in (3,999)",
  );
  await client.query("delete from promotions where id in (3,999)");
  await client.query(
    "insert into promotions(id,name,type) values(3,'Obsolete test','manual'),(999,'Unrelated fixture','automatic')",
  );
  await client.query(
    "insert into promotion_codes(id,promotion_id,code) values(2,3,'TEST-2'),(3,3,'TEST-3'),(6,3,'TEST-6'),(7,3,'TEST-7'),(999,999,'UNRELATED')",
  );
});
const snapshot = async () =>
  (
    await client.query(`select
  (select jsonb_agg(to_jsonb(p) order by id) from promotions p) promotions,
  (select jsonb_agg(to_jsonb(c) order by id) from promotion_codes c) codes,
  (select jsonb_agg(to_jsonb(a) order by id) from promotion_audit_logs a) audits,
  (select count(*) from promotion_redemptions) redemptions,
  (select count(*) from payment_records) payments,
  (select count(*) from payment_events) events,
  (select count(*) from package_orders) orders,
  (select count(*) from bookings) bookings`)
  ).rows;
async function rejectsWithoutChanges(pattern: RegExp) {
  const before = await snapshot();
  await assert.rejects(client.query(cleanup), pattern);
  await client.query("rollback");
  assert.deepEqual(await snapshot(), before);
}
test("exact cleanup deletes only promotion 3 and four codes; unrelated records and finance unchanged", async () => {
  const before = await snapshot();
  await client.query(cleanup);
  const after = await snapshot();
  assert.deepEqual(
    after[0].promotions,
    before[0].promotions.filter((p: { id: number }) => p.id !== 3),
  );
  assert.deepEqual(
    after[0].codes,
    before[0].codes.filter(
      (c: { promotion_id: number }) => c.promotion_id !== 3,
    ),
  );
  for (const key of [
    "audits",
    "redemptions",
    "payments",
    "events",
    "orders",
    "bookings",
  ])
    assert.deepEqual(after[0][key], before[0][key]);
});
test("promotion audit history prevents SET NULL or deletion", async () => {
  await client.query(
    "insert into promotion_audit_logs(promotion_id,action) values(3,'test.created')",
  );
  await rejectsWithoutChanges(/History dependency/);
});
test("code Admin audit identity prevents deletion", async () => {
  await client.query(`insert into admin_activity_logs(actor_name,actor_email,action,module,entity_type,entity_id,summary)
    values('Synthetic','synthetic@example.invalid','create','promotions','promotion_code','2','fixture')`);
  await rejectsWithoutChanges(/History dependency/);
});
test("extra code or changed ownership set prevents cleanup", async () => {
  await client.query(
    "insert into promotion_codes(id,promotion_id,code) values(8,3,'TEST-8')",
  );
  try {
    await rejectsWithoutChanges(/ownership set changed/);
  } finally {
    await client.query("delete from promotion_codes where id=8");
  }
});
test("usage counter changes prevent cleanup", async () => {
  await client.query("update promotion_codes set current_uses=1 where id=2");
  await rejectsWithoutChanges(/usage changed/);
});
test("redemption history prevents cleanup and preserves identities", async () => {
  const student = (
    await client.query(
      "insert into students(name,email,phone) values('Synthetic','cleanup@example.invalid',NULL) returning id",
    )
  ).rows[0].id;
  await client.query(
    "insert into promotion_redemptions(promotion_id,promotion_code_id,student_id) values(3,2,$1)",
    [student],
  );
  try {
    await rejectsWithoutChanges(/History dependency/);
  } finally {
    await client.query(
      "delete from promotion_redemptions where student_id=$1",
      [student],
    );
    await client.query("delete from students where id=$1", [student]);
  }
});
test("unexpected cascading FK blocks cleanup rather than removing dependent rows", async () => {
  await client.query(
    "create table cleanup_unexpected_dependency(id int primary key, promotion_id int references promotions(id) on delete cascade)",
  );
  await client.query("insert into cleanup_unexpected_dependency values(1,3)");
  try {
    await rejectsWithoutChanges(/Unreviewed.*foreign key/);
    assert.equal(
      (
        await client.query(
          "select count(*)::int n from cleanup_unexpected_dependency",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await client.query("drop table cleanup_unexpected_dependency");
  }
});
test("unexpected mutation trigger blocks cleanup before side effects", async () => {
  await client.query(
    "create function cleanup_test_trigger() returns trigger language plpgsql as $$ begin return OLD; end $$",
  );
  await client.query(
    "create trigger cleanup_test before delete on promotions for each row execute function cleanup_test_trigger()",
  );
  try {
    await rejectsWithoutChanges(/Unreviewed.*trigger/);
  } finally {
    await client.query("drop trigger cleanup_test on promotions");
    await client.query("drop function cleanup_test_trigger()");
  }
});
test("durable operation reference prevents cleanup without rewriting operation history", async () => {
  await client.query("begin");
  await client.query(`insert into promotion_admin_operations(operation_id,actor_admin_id,method,target_promotion_id,
    canonical_version,request_fingerprint,expires_at) values('00000000-0000-4000-8000-000000000003',1,'PATCH',3,1,repeat('a',64),now()+interval '1 day')`);
  try {
    await assert.rejects(client.query(cleanup), /History dependency/);
  } finally {
    await client.query("rollback");
  }
  assert.equal(
    (
      await client.query(
        "select count(*)::int n from promotion_codes where promotion_id=3",
      )
    ).rows[0].n,
    4,
  );
});
test("failure after code deletion rolls back the whole cleanup", async () => {
  const before = await snapshot();
  await client.query("create role cleanup_failure_fixture nologin");
  await client.query("grant usage on schema public to cleanup_failure_fixture");
  await client.query(`grant select,update on promotions,promotion_codes,promotion_redemptions,promotion_audit_logs,
    admin_activity_logs,promotion_admin_operations to cleanup_failure_fixture`);
  await client.query(
    "grant delete on promotion_codes to cleanup_failure_fixture",
  );
  try {
    await client.query("set role cleanup_failure_fixture");
    await assert.rejects(
      client.query(cleanup),
      /permission denied for table promotions/,
    );
    await client.query("rollback");
    await client.query("reset role");
    assert.deepEqual(await snapshot(), before);
  } finally {
    await client.query("rollback");
    await client.query("reset role");
    await client.query("drop owned by cleanup_failure_fixture");
    await client.query("drop role cleanup_failure_fixture");
  }
});
test("changed promotion type prevents deleting a different configuration", async () => {
  await client.query("update promotions set type='automatic' where id=3");
  await rejectsWithoutChanges(/missing or changed/);
});
