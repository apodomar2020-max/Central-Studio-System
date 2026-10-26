/** Creates a brand-new database; never migrates an existing application DB. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const adminUrl = process.env.DISPOSABLE_PROMOTIONS_MIGRATION_ADMIN_URL;
if (!adminUrl)
  throw Error("Explicit local disposable-cluster admin URL required");
const u = new URL(adminUrl);
if (
  !["localhost", "127.0.0.1"].includes(u.hostname) ||
  u.pathname !== "/postgres" ||
  /railway|rlwy/i.test(adminUrl)
)
  throw Error("Local cluster admin connection only");
const name = `promotions_upgrade_disposable_${Date.now()}_${process.pid}`;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);
let admin: pg.Pool, pool: pg.Pool, folder: string;
before(async () => {
  admin = new pg.Pool({ connectionString: adminUrl });
  await admin.query(`create database "${name}"`);
  u.pathname = `/${name}`;
  pool = new pg.Pool({ connectionString: u.toString() });
  folder = await mkdtemp(path.join(tmpdir(), "promotion-baseline-migrations-"));
  await mkdir(path.join(folder, "meta"));
  const journal = JSON.parse(
    await readFile(path.join(migrations, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.filter(
    (e: { tag: string }) => e.tag !== "0137_promotion_admin_operations",
  );
  await writeFile(
    path.join(folder, "meta/_journal.json"),
    JSON.stringify(journal),
  );
  for (const f of await readdir(migrations))
    if (f.endsWith(".sql") && f !== "0137_promotion_admin_operations.sql")
      await copyFile(path.join(migrations, f), path.join(folder, f));
  await migrate(drizzle(pool), { migrationsFolder: folder });
});
after(async () => {
  await pool?.end();
  await admin?.end();
  if (folder) await rm(folder, { recursive: true, force: true });
});
async function history() {
  const tables = [
    "promotions",
    "promotion_codes",
    "promotion_redemptions",
    "bookings",
    "payment_records",
    "payment_events",
  ];
  const result: Record<string, unknown> = {};
  for (const t of tables)
    result[t] = (await pool.query(`select * from ${t} order by id`)).rows;
  return result;
}
test("additive migration upgrades a seeded old schema without changing historical promotion/redemption/Finance snapshots", async () => {
  assert.equal(
    (
      await pool.query(
        "select to_regclass('promotion_admin_operations') as name",
      )
    ).rows[0].name,
    null,
  );
  const student = (
    await pool.query(
      "insert into students(name,email,email_verified) values('Migration history','migration@example.invalid',true) returning id",
    )
  ).rows[0].id;
  const promo = (
    await pool.query(
      "insert into promotions(name,type,discount_value) values('Historical promotion','manual',10) returning id",
    )
  ).rows[0].id;
  const code = (
    await pool.query(
      "insert into promotion_codes(promotion_id,code,current_uses) values($1,'MIGRATION-HISTORY',1) returning id",
      [promo],
    )
  ).rows[0].id;
  const booking = (
    await pool.query(
      "insert into bookings(student_name,student_email) values('History','migration@example.invalid') returning id",
    )
  ).rows[0].id;
  await pool.query(
    'insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,booking_id,original_subtotal,discount_amount,final_subtotal,metadata) values($1,$2,$3,$4,100,10,90,\'{"promoCode":"MIGRATION-HISTORY"}\')',
    [promo, code, student, booking],
  );
  const payment = (
    await pool.query(
      "insert into payment_records(flow_type,booking_id,capture_origin,occurred_at,evidence_class,amount_availability,amount_source,gross_amount_minor,discount_amount_minor,final_payable_amount_minor,status,student_id) values('single_class_booking',$1,'live_capture',now(),'confirmed','exact','creation_snapshot',10000,1000,9000,'unpaid',$2) returning id",
      [booking, student],
    )
  ).rows[0].id;
  await pool.query(
    "insert into payment_events(payment_record_id,event_type,new_status,actor_type) values($1,'created','unpaid','system')",
    [payment],
  );
  const before = await history();
  await migrate(drizzle(pool), { migrationsFolder: migrations });
  assert.deepEqual(await history(), before);
  assert.equal(
    (await pool.query("select count(*)::int n from promotion_admin_operations"))
      .rows[0].n,
    0,
  );
});
test("migration runner is repeat-safe and historical migration files need no modification", async () => {
  const before = await history();
  const count = (
    await pool.query("select count(*)::int n from drizzle.__drizzle_migrations")
  ).rows[0].n;
  await migrate(drizzle(pool), { migrationsFolder: migrations });
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from drizzle.__drizzle_migrations",
      )
    ).rows[0].n,
    count,
  );
  assert.deepEqual(await history(), before);
});
test("database constraints reject null target/method state holes and retain identity history", async () => {
  await assert.rejects(
    pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,expires_at) values(gen_random_uuid(),1,'PATCH',1,repeat('a',64),now())",
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,state,expires_at) values(gen_random_uuid(),1,'POST',1,repeat('a',64),'succeeded',now())",
    ),
    { code: "23514" },
  );
  const key = (
    await pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,expires_at) values(gen_random_uuid(),1,'POST',1,repeat('a',64),now()) returning operation_id",
    )
  ).rows[0].operation_id;
  await assert.rejects(
    pool.query("delete from promotion_admin_operations where operation_id=$1", [
      key,
    ]),
    { code: "23514" },
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from promotion_admin_operations where operation_id=$1",
        [key],
      )
    ).rows[0].n,
    1,
  );
});
