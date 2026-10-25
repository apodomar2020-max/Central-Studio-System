import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import pg from "pg";
import {
  INVENTORY_LIMITS,
  serializeInventory,
  inventoryFailureMessage,
  inventoryPromotions,
} from "./promotionsInventory";
const url = process.env.DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/disposable/.test(new URL(url).pathname)
)
  throw Error("New local disposable database required");
let pool: pg.Pool;
const tag = `INV-${Date.now()}`;
before(() => {
  pool = new pg.Pool({ connectionString: url });
});
after(async () => {
  await pool.end();
});
async function counts() {
  return (
    await pool.query(
      "select (select count(*) from promotions)p,(select count(*) from promotion_codes)c,(select count(*) from promotion_redemptions)r,(select count(*) from payment_records)f,(select count(*) from payment_events)e",
    )
  ).rows;
}
test("read-only inventory classifies synthetic legacy anomalies and outputs no personal/raw-code data", async () => {
  const p = (
    await pool.query(
      "insert into promotions(name,type,is_active,rules_config,discount_value) values('Inventory','manual',true,'{\"unsupported\":true}',10) returning id",
    )
  ).rows[0].id;
  await pool.query(
    "insert into promotion_codes(promotion_id,code,current_uses) values($1,$2,3),($1,$3,0)",
    [p, tag, tag.toLowerCase()],
  );
  const before = await counts(),
    result = await inventoryPromotions(url!);
  assert.equal(result.readOnly, true);
  assert.ok(
    result.anomalies.some(
      (a) =>
        a.promotionId === p &&
        a.categories.includes("ambiguous_manual_code_count") &&
        a.categories.includes("invalid_or_unsupported_rules"),
    ),
  );
  assert.ok(result.normalizedCollisions.length > 0);
  assert.ok(result.counterDiscrepancies.some((c) => c.promotionId === p));
  assert.deepEqual(await counts(), before);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, new RegExp(tag, "i"));
  assert.doesNotMatch(
    output,
    /student_name|student_email|password|phone|credential/,
  );
  assert.equal(result.unusedCodeDistributionUnknown > 0, true);
  await pool.query("delete from promotion_codes where promotion_id=$1", [p]);
  await pool.query("delete from promotions where id=$1", [p]);
});
test("same read-only session configuration rejects attempted mutation at database level", async () => {
  const readOnly = new pg.Pool({
    connectionString: url,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500",
  });
  try {
    await assert.rejects(
      readOnly.query(
        "insert into promotions(name) values('must not be written')",
      ),
      { code: "25006" },
    );
  } finally {
    await readOnly.end();
  }
});

test("inventory aborts oversized rules/code payloads instead of returning a partial report", async () => {
  const id = (
    await pool.query(
      "insert into promotions(name,rules_config) values('Oversized inventory fixture',$1) returning id",
      [JSON.stringify({ unsupported: "x".repeat(17 * 1024 * 1024) })],
    )
  ).rows[0].id;
  try {
    const before = await counts();
    await assert.rejects(inventoryPromotions(url!), /payload byte ceiling/);
    assert.deepEqual(await counts(), before);
  } finally {
    await pool.query("delete from promotions where id=$1", [id]);
  }
});

// All fixtures below are confined to the explicitly guarded disposable URL.
// A rollback-only fixture connection cannot serve the inventory's independent
// snapshot, so each test removes only its own newly created synthetic rows.
async function promotion(rules: unknown = {}, type = "manual") {
  return (
    await pool.query(
      "insert into promotions(name,type,is_active,discount_value,rules_config) values('Bounded inventory fixture',$1,false,10,$2) returning id",
      [type, JSON.stringify(rules)],
    )
  ).rows[0].id as number;
}
async function removePromotion(id: number) {
  await pool.query("delete from promotion_codes where promotion_id=$1", [id]);
  await pool.query("delete from promotions where id=$1", [id]);
}
async function collisionFixture(groups: number) {
  const id = await promotion();
  await pool.query(
    "insert into promotion_codes(promotion_id,code) select $1::int,'BOUNDARY-'||n from generate_series(1,$2::int)n union all select $1::int,'boundary-'||n from generate_series(1,$2::int)n",
    [id, groups],
  );
  return id;
}
// Remove the original classification fixture after its own assertions so all
// boundary fixtures have exact cardinalities and cannot mask each other's bounds.

for (const groups of [10000, 10001])
  test(`normalization collision groups: ${groups}`, async () => {
    const id = await collisionFixture(groups);
    try {
      if (groups === 10000)
        assert.equal(
          (await inventoryPromotions(url!)).normalizedCollisions.length,
          groups,
        );
      else
        await assert.rejects(
          inventoryPromotions(url!),
          /Normalization collision group ceiling/,
        );
    } finally {
      await removePromotion(id);
    }
  });
for (const size of [10000, 10001])
  test(`counter discrepancy output: ${size}`, async () => {
    const id = await promotion();
    try {
      await pool.query(
        "insert into promotion_codes(promotion_id,code,current_uses) select $1::int,'COUNTER-'||n,1 from generate_series(1,$2::int)n",
        [id, size],
      );
      if (size === 10000)
        assert.equal(
          (await inventoryPromotions(url!)).counterDiscrepancies.length,
          size,
        );
      else
        await assert.rejects(
          inventoryPromotions(url!),
          /Counter discrepancy ceiling/,
        );
    } finally {
      await removePromotion(id);
    }
  });
for (const size of [10000, 10001])
  test(`package reference output: ${size}`, async () => {
    const id = await promotion({
      packageIds: Array.from({ length: size }, (_, i) => 1000000 + i),
    });
    try {
      if (size === 10000)
        assert.equal(
          (await inventoryPromotions(url!)).packageReferences.length,
          size,
        );
      else
        await assert.rejects(
          inventoryPromotions(url!),
          /Package reference ceiling/,
        );
    } finally {
      await removePromotion(id);
    }
  });
for (const [table, maximum, columns, values, match] of [
  [
    "promotions",
    10000,
    "name,type,is_active,discount_value",
    "'Record ceiling','manual',false,10",
    /Promotion record ceiling/,
  ],
  [
    "promotion_codes",
    50000,
    "promotion_id,code",
    "$1::int,'RECORD-'||n",
    /Code record ceiling/,
  ],
  [
    "price_packages",
    50000,
    "name,price_egp",
    "'Record ceiling',100",
    /Package record ceiling/,
  ],
] as const)
  for (const overflow of [false, true])
    test(`${table} record ${overflow ? "overflow" : "boundary"}`, async () => {
      const parent = table === "promotion_codes" ? await promotion() : null;
      const ids: number[] = [];
      try {
        const count = maximum + (overflow ? 1 : 0);
        const result = await pool.query(
          `insert into ${table}(${columns}) select ${values} from generate_series(1,${count})n returning id`,
          parent === null ? [] : [parent],
        );
        ids.push(...result.rows.map((r) => r.id));
        if (overflow) await assert.rejects(inventoryPromotions(url!), match);
        else {
          const result = await inventoryPromotions(url!);
          assert.equal(
            table === "promotions"
              ? result.totals.promotions
              : table === "promotion_codes"
                ? result.totals.codes
                : result.packageReferences.length,
            table === "price_packages" ? 0 : maximum,
          );
        }
      } finally {
        if (ids.length)
          await pool.query(`delete from ${table} where id=any($1::int[])`, [
            ids,
          ]);
        if (parent !== null) await removePromotion(parent);
      }
    });

test("exact serialized UTF-8 byte boundary and overflow", () => {
  // JSON string quotes plus final newline consume three bytes.
  const exact = "x".repeat(INVENTORY_LIMITS.outputBytes - 3);
  assert.equal(
    Buffer.byteLength(serializeInventory(exact)),
    INVENTORY_LIMITS.outputBytes,
  );
  assert.throws(
    () => serializeInventory(exact + "x"),
    /Serialized output byte ceiling/,
  );
  assert.throws(
    () => serializeInventory("é".repeat(INVENTORY_LIMITS.outputBytes / 2)),
    /Serialized output byte ceiling/,
  );
});
async function cli(connection = url, approved = true) {
  const { spawn } = await import("node:child_process");
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        new URL(
          "../../lib/db/node_modules/tsx/dist/loader.mjs",
          import.meta.url,
        ).pathname,
        new URL("./promotionsInventory.ts", import.meta.url).pathname,
        ...(approved ? ["--approved-read-only-inventory"] : []),
      ],
      {
        env: {
          ...process.env,
          PROMOTIONS_INVENTORY_DATABASE_URL: connection ?? "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Error("Disposable CLI exceeded test deadline"));
    }, 15000);
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
test("total output overflow aborts real database inventory and CLI without partial JSON", async () => {
  const ids: number[] = [];
  try {
    ids.push(
      ...(
        await pool.query(
          "insert into promotions(name,type,is_active,discount_value) select 'Output fixture','automatic',false,10 from generate_series(1,10000) returning id",
        )
      ).rows.map((r) => r.id),
    );
    await pool.query(
      "insert into promotion_codes(promotion_id,code,current_uses) select id,'OUTPUT-'||id,1 from promotions where id=any($1::int[])",
      [ids],
    );
    await assert.rejects(
      inventoryPromotions(url!),
      /Serialized output byte ceiling/,
    );
    const result = await cli();
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Serialized output byte ceiling/);
    assert.doesNotMatch(result.stderr, /postgresql:|OUTPUT-|password/);
  } finally {
    await pool.query(
      "delete from promotion_codes where promotion_id=any($1::int[])",
      [ids],
    );
    await pool.query("delete from promotions where id=any($1::int[])", [ids]);
  }
});
test("CLI valid bounded success emits exactly one complete JSON object", async () => {
  const result = await cli();
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 2);
  assert.equal(report.readOnly, true);
  assert.equal(report.limits.outputBytes, INVENTORY_LIMITS.outputBytes);
});
test("CLI rejects missing approval without success output", async () => {
  const result = await cli(url, false);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Separate Owner authorization/);
});
test("URL startup overrides cannot weaken the approved session configuration", async () => {
  for (const key of [
    "options",
    "statement_timeout",
    "application_name",
    "lock_timeout",
    "default_transaction_read_only",
  ]) {
    const target = new URL(url!);
    target.searchParams.set(key, "0");
    await assert.rejects(inventoryPromotions(target.href), /must not override/);
  }
});
test("sanitized failure formatting never exports server or connection messages", () => {
  assert.doesNotMatch(
    inventoryFailureMessage({
      message: "postgresql://secret:password@host/db",
      detail: "customer@example.invalid",
    }),
    /secret|password|example.invalid|postgresql:/,
  );
  assert.match(
    inventoryFailureMessage({ code: "57014" }),
    /timed out or was cancelled/,
  );
  assert.match(inventoryFailureMessage({ code: "55P03" }), /lock timeout/);
});
test("bounded classification distinguishes null, malformed, unsupported, broad and branch-context rules privately", async () => {
  const ids: number[] = [];
  try {
    ids.push(
      await promotion(null, "automatic"),
      await promotion("PRIVATE-RULE-secret"),
      await promotion({ privateCredential: "PRIVATE-RULE-secret" }),
      await promotion({}, "automatic"),
      await promotion({ branches: ["PRIVATE-BRANCH"] }),
      await promotion({ verifiedStudentOnly: true }, "automatic"),
      await promotion({}, "PRIVATE-TYPE-secret"),
    );
    const result = await inventoryPromotions(url!);
    const rows = new Map(
      result.eligibilityReview.map((r) => [r.promotionId, r]),
    );
    assert.equal(rows.get(ids[0])?.rulesStatus, "null");
    assert.equal(rows.get(ids[0])?.automaticWithoutAudienceRestrictions, true);
    assert.equal(rows.get(ids[1])?.rulesStatus, "malformed");
    assert.equal(rows.get(ids[2])?.rulesStatus, "unsupported");
    assert.equal(rows.get(ids[3])?.automaticWithoutAudienceRestrictions, true);
    assert.equal(rows.get(ids[4])?.packageBranchContextIncompatible, true);
    assert.equal(rows.has(ids[5]), false);
    assert.equal(
      result.eligibilitySummary.automaticWithoutAudienceRestrictions,
      2,
    );
    assert.equal(result.eligibilitySummary.packageBranchContextIncompatible, 1);
    assert.equal(result.shapes["unsupported:zero"], 1);
    assert.doesNotMatch(
      serializeInventory(result),
      /PRIVATE-|privateCredential|postgresql:\/\//,
    );
  } finally {
    for (const id of ids) await removePromotion(id);
  }
});

async function withInventoryView(
  mode: "barrier" | "timeout",
  work: () => Promise<void>,
) {
  // A view is used only in this disposable database to pause the first SELECT
  // after PostgreSQL establishes its snapshot. No production hooks or SQL added.
  await pool.query(
    "alter table promotions rename to promotions_snapshot_source",
  );
  try {
    await pool.query(`create function inventory_snapshot_barrier(value jsonb) returns jsonb language plpgsql volatile as $$ begin
    if current_setting('application_name')='central-promotions-inventory' then
      if current_setting('transaction_read_only')<>'on'
         or current_setting('transaction_isolation')<>'repeatable read'
         or current_setting('statement_timeout')<>'5s'
         or current_setting('lock_timeout')<>'500ms'
         or current_setting('idle_in_transaction_session_timeout')<>'15s' then
        raise exception 'Inventory session safeguard mismatch';
      end if;
      ${mode === "barrier" ? "perform pg_advisory_xact_lock(918290,1);" : "perform pg_sleep(6);"}
    end if; return value; end $$`);
    await pool.query(
      "create view promotions as select id,name,description,type,discount_type,discount_value,priority,is_exclusive,is_stackable,is_active,start_date,end_date,inventory_snapshot_barrier(rules_config) rules_config,created_at,updated_at from promotions_snapshot_source",
    );
    try {
      await work();
    } finally {
      await pool.query("drop view promotions");
      await pool.query("drop function inventory_snapshot_barrier(jsonb)");
    }
  } finally {
    await pool.query(
      "alter table promotions_snapshot_source rename to promotions",
    );
  }
}
async function waitAtBarrier() {
  const deadline = Date.now() + 400;
  while (Date.now() < deadline) {
    const rows = (
      await pool.query(
        "select pid from pg_locks where locktype='advisory' and classid=918290 and objid=1 and not granted",
      )
    ).rows;
    if (rows.length) return rows[0].pid as number;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("Inventory must reach the observed database snapshot barrier");
}
async function noInventorySession() {
  assert.equal(
    Number(
      (
        await pool.query(
          "select count(*) from pg_stat_activity where application_name='central-promotions-inventory' and datname=current_database()",
        )
      ).rows[0].count,
    ),
    0,
  );
}
test("repeatable-read inventory excludes a concurrent insertion after snapshot creation", async () => {
  const id = await promotion();
  let later: number | undefined;
  try {
    await withInventoryView("barrier", async () => {
      const blocker = await pool.connect();
      let pending: ReturnType<typeof inventoryPromotions> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query("select pg_advisory_xact_lock(918290,1)");
        pending = inventoryPromotions(url!);
        await waitAtBarrier();
        later = (
          await pool.query(
            "insert into promotions_snapshot_source(name,type,is_active,discount_value) values('Concurrent fixture','manual',false,10) returning id",
          )
        ).rows[0].id;
        await blocker.query("commit");
        const result = await pending;
        assert.equal(result.totals.promotions, 1);
        assert.equal(result.totals.inactive, 1);
        assert.equal(
          result.anomalies.some((r) => r.promotionId === later),
          false,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "select count(*) from promotions_snapshot_source",
              )
            ).rows[0].count,
          ),
          2,
        );
      } finally {
        await blocker.query("rollback");
        blocker.release();
        if (pending) await pending.catch(() => {});
      }
    });
  } finally {
    await removePromotion(id);
    if (later !== undefined) await removePromotion(later);
  }
  await noInventorySession();
});
test("database statement timeout rolls back and releases the inventory session", async () => {
  const id = await promotion();
  try {
    await withInventoryView("timeout", async () => {
      await assert.rejects(inventoryPromotions(url!), { code: "57014" });
      await noInventorySession();
    });
  } finally {
    await removePromotion(id);
  }
});
test("lock timeout rolls back without a successful CLI report", async () => {
  const blocker = await pool.connect();
  try {
    await blocker.query("begin");
    await blocker.query("lock table promotions in access exclusive mode");
    const result = await cli();
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /lock timeout/);
    await noInventorySession();
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
});
test("explicit database cancellation fails closed and releases the snapshot", async () => {
  const id = await promotion();
  try {
    await withInventoryView("barrier", async () => {
      const blocker = await pool.connect();
      let pending: ReturnType<typeof inventoryPromotions> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query("select pg_advisory_xact_lock(918290,1)");
        pending = inventoryPromotions(url!);
        const pid = await waitAtBarrier();
        await pool.query("select pg_cancel_backend($1)", [pid]);
        await assert.rejects(pending, { code: "57014" });
        await noInventorySession();
      } finally {
        await blocker.query("rollback");
        blocker.release();
        if (pending) await pending.catch(() => {});
      }
    });
  } finally {
    await removePromotion(id);
  }
});

for (const [label, sql] of [
  ["UPDATE", "update promotions set name='must not be written'"],
  ["DELETE", "delete from promotions"],
  ["TRUNCATE", "truncate promotions cascade"],
  ["DDL", "create table forbidden_inventory_fixture(id int)"],
] as const)
  test(`read-only connection rejects ${label}`, async () => {
    const readonly = new pg.Pool({
      connectionString: url,
      options:
        "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000",
    });
    try {
      await assert.rejects(readonly.query(sql), { code: "25006" });
    } finally {
      await readonly.end();
    }
  });
test("historical aggregate classifications retain ownership evidence without customer identifiers", async () => {
  const ids = [await promotion(), await promotion()];
  let student: number | undefined;
  try {
    student = (
      await pool.query(
        "insert into students(name,email) values('PRIVATE-CUSTOMER','inventory-private@example.invalid') returning id",
      )
    ).rows[0].id;
    const code = (
      await pool.query(
        "insert into promotion_codes(promotion_id,code) values($1,'PRIVATE-HISTORY-CODE') returning id",
        [ids[0]],
      )
    ).rows[0].id;
    await pool.query(
      "insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,discount_amount) values($1,$3,$4,10),($2,$3,$4,10)",
      [ids[0], ids[1], code, student],
    );
    const result = await inventoryPromotions(url!);
    assert.equal(result.totals.promotions_with_redemptions, 2);
    assert.equal(result.totals.referenced_code_ids, 1);
    assert.equal(result.totals.redemptions, 2);
    assert.equal(result.ownershipMismatches.length, 1);
    assert.equal(result.ownershipMismatches[0].promotion_id, ids[1]);
    assert.equal(result.counterDiscrepancies[0].actual, 2);
    assert.doesNotMatch(
      serializeInventory(result),
      /PRIVATE-|inventory-private|studentId|student_id/,
    );
  } finally {
    await pool.query(
      "delete from promotion_redemptions where promotion_id=any($1::int[])",
      [ids],
    );
    for (const id of ids) await removePromotion(id);
    if (student !== undefined)
      await pool.query("delete from students where id=$1", [student]);
  }
});
