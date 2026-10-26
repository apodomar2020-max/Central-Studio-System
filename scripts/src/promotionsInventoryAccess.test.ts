import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  readFileSync,
  statSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { INVENTORY_COLUMNS } from "./promotionsInventoryAccess";
import {
  pinnedInventoryTls,
  saveInventoryReport,
} from "./promotionsInventoryPinned";
import {
  inventoryPromotions,
  inventoryPromotionsOnClient,
  serializeInventory,
} from "./promotionsInventory";

const url = process.env.DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL;
const caPath = process.env.DISPOSABLE_INVENTORY_CA;
const leafPath = process.env.DISPOSABLE_INVENTORY_LEAF;
if (
  !url ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname) ||
  !new URL(url).pathname.includes("disposable") ||
  !caPath ||
  !leafPath
)
  throw new Error(
    "Fresh TLS-enabled disposable local database and certificates required",
  );
const loader = resolve("lib/db/node_modules/tsx/dist/loader.mjs");
const database = new URL(url).pathname.slice(1);
const ca = readFileSync(caPath, "utf8"),
  leaf = readFileSync(leafPath, "utf8");
const role = "central_promotions_inventory_ro";
const admin = new pg.Client({ connectionString: url });
let promotionId: number;
const business =
  /\bfrom\s+(?:public\.)?(?:promotions|promotion_codes|promotion_redemptions|price_packages|payment_records)\b/i;

before(async () => {
  await admin.connect();
  await admin.query(
    `create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`,
  );
  await admin.query(`grant usage on schema public to ${role}`);
  for (const [table, columns] of Object.entries(INVENTORY_COLUMNS))
    await admin.query(
      `grant select (${columns.join(",")}) on public.${table} to ${role}`,
    );
  promotionId = (
    await admin.query(`insert into promotions(name,type,is_active,discount_value,rules_config)
    values('Access fixture','manual',false,10,'{}') returning id`)
  ).rows[0].id;
  await admin.query(
    `insert into promotion_codes(promotion_id,code) values($1,'PRIVATE-RAW-ACCESS-CODE')`,
    [promotionId],
  );
});
after(async () => {
  await admin.query("delete from promotion_codes where promotion_id=$1", [
    promotionId,
  ]);
  await admin.query("delete from promotions where id=$1", [promotionId]);
  await admin.query(`drop owned by ${role}`);
  await admin.query(`drop role ${role}`);
  await admin.end();
});

async function restricted(expectedDatabase = database, ssl = true) {
  const client = new pg.Client({
    connectionString: url,
    ssl: ssl ? pinnedInventoryTls(ca, leaf) : false,
  });
  await client.connect();
  let queries = 0;
  const observed = {
    query: async (sql: string, values?: unknown[]) => {
      if (business.test(sql)) {
        queries++;
        const state = (
          await client.query(`select current_user actor,current_setting('transaction_read_only') ro,
        current_setting('transaction_isolation') isolation,current_setting('statement_timeout') timeout,
        current_setting('lock_timeout') lock_timeout,current_setting('idle_in_transaction_session_timeout') idle`)
        ).rows[0];
        assert.deepEqual(state, {
          actor: role,
          ro: "on",
          isolation: "repeatable read",
          timeout: "5s",
          lock_timeout: "500ms",
          idle: "15s",
        });
      }
      return client.query(sql, values);
    },
  } as unknown as Pick<pg.Client, "query">;
  try {
    const result = await inventoryPromotionsOnClient(
      observed,
      expectedDatabase,
    );
    assert.equal(queries, 8);
    return result;
  } catch (error) {
    assert.equal(
      queries,
      0,
      "preflight rejection must precede every business query",
    );
    throw error;
  } finally {
    assert.equal(
      (await client.query("select current_user actor")).rows[0].actor,
      "postgres",
      "LOCAL role restored on commit/rollback",
    );
    await client.end();
  }
}

test("all eight actual queries work with only approved column grants under NOLOGIN role and verified TLS", async () => {
  const expected = await inventoryPromotions(url!);
  const actual = await restricted();
  assert.deepEqual(actual, expected);
  assert.doesNotMatch(serializeInventory(actual), /PRIVATE-RAW-ACCESS-CODE/);
});
test("inventory leaves synthetic business records unchanged", async () => {
  const snapshot = async () =>
    (
      await admin.query(
        "select row_to_json(p) snapshot from promotions p order by id",
      )
    ).rows;
  const before = await snapshot();
  await restricted();
  assert.deepEqual(await snapshot(), before);
});
test("wrong database identity fails before business reads", async () => {
  await assert.rejects(restricted("wrong_database"), /preflight failed/);
});
test("non-TLS connection fails before business reads", async () => {
  await assert.rejects(restricted(database, false), /preflight failed/);
});
test("missing required column grant fails before business reads", async () => {
  await admin.query(
    `revoke select (discount_amount_minor) on payment_records from ${role}`,
  );
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(
      `grant select (discount_amount_minor) on payment_records to ${role}`,
    );
  }
});
test("extra sensitive-column read privilege fails before business reads", async () => {
  await admin.query(`grant select (name) on promotions to ${role}`);
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(`revoke select (name) on promotions from ${role}`);
  }
});
test("unapproved table access fails before business reads", async () => {
  await admin.query(`grant select (id) on students to ${role}`);
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(`revoke select (id) on students from ${role}`);
  }
});
test("effective write privilege fails before business reads", async () => {
  await admin.query(`grant delete on promotions to ${role}`);
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(`revoke delete on promotions from ${role}`);
  }
});
test("RLS cannot silently produce an incomplete clean report", async () => {
  await admin.query("alter table promotions enable row level security");
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query("alter table promotions disable row level security");
  }
});
test("LOGIN-enabled role fails the approved NOLOGIN role boundary", async () => {
  await admin.query(`alter role ${role} login`);
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(`alter role ${role} nologin`);
  }
});
test("role membership fails even with NOINHERIT", async () => {
  await admin.query(`grant pg_read_all_data to ${role}`);
  try {
    await assert.rejects(restricted(), /preflight failed/);
  } finally {
    await admin.query(`revoke pg_read_all_data from ${role}`);
  }
});
test("pin verifies the service certificate rather than pretending the proxy is localhost", async () => {
  assert.equal(new X509Certificate(leaf).checkHost("127.0.0.1"), undefined);
  let verified = false;
  const ssl = pinnedInventoryTls(ca, leaf),
    original = ssl.checkServerIdentity!;
  ssl.checkServerIdentity = (hostname, cert) => {
    verified = true;
    return original(hostname, cert);
  };
  const client = new pg.Client({ connectionString: url, ssl });
  try {
    await client.connect();
    assert.equal(verified, true);
  } finally {
    await client.end();
  }
});
test("mismatched server pin rejects a real TLS PostgreSQL connection", async () => {
  const ssl = pinnedInventoryTls(ca, leaf);
  ssl.checkServerIdentity = (_hostname, cert) =>
    cert.raw.equals(new X509Certificate(ca).raw)
      ? undefined
      : new Error("Service certificate pin mismatch");
  const client = new pg.Client({ connectionString: url, ssl });
  try {
    await assert.rejects(client.connect(), /pin mismatch/);
  } finally {
    await client.end();
  }
});
test("certificate pair rejects a non-CA trust anchor", () => {
  assert.throws(
    () => pinnedInventoryTls(leaf, leaf),
    /certificate pair is invalid/,
  );
});
test("custom pin does not bypass the real TLS CA-chain verification", async () => {
  const ssl = pinnedInventoryTls(ca, leaf);
  ssl.ca = [];
  const client = new pg.Client({ connectionString: url, ssl });
  try {
    await assert.rejects(client.connect(), /issuer|verify|self.signed/i);
  } finally {
    await client.end();
  }
});
test("complete report is stored with private directory/file permissions", () => {
  const parent = mkdtempSync(join(tmpdir(), "inventory-private-output-"));
  try {
    const path = saveInventoryReport({ version: 2, readOnly: true }, parent);
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      version: 2,
      readOnly: true,
    });
    assert.deepEqual(readdirSync(dirname(path)), ["inventory.json"]);
  } finally {
    rmSync(parent, { recursive: true });
  }
});
test("oversized output is rejected before creating a report directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "inventory-no-partial-output-"));
  try {
    assert.throws(
      () => saveInventoryReport({ huge: "x".repeat(4 * 1024 * 1024) }, parent),
      /Serialized output byte/,
    );
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true });
  }
});
test("private password prompt accepts input through a real terminal without echo or secret output", () => {
  const program = `import {promptInventoryPassword} from './scripts/src/promotionsInventoryPinned.ts';
    const value=await promptInventoryPassword();
    if(value!=='synthetic-private-password')process.exit(2);
    console.log('accepted');`;
  const harness = String.raw`import os,pty,subprocess,select,sys,time
master,slave=pty.openpty()
p=subprocess.Popen([sys.argv[1],'--import',sys.argv[3],'--input-type=module','-e',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
output=b''
sent=False
deadline=time.monotonic()+10
while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],0.2)
    if ready:
        try: data=os.read(master,65536)
        except OSError: break
        if not data: break
        output+=data
        if b'no echo): ' in output and not sent:
            os.write(master,b'synthetic-private-password\n'); sent=True
    elif p.poll() is not None: break
if p.poll() is None: p.kill()
code=p.wait()
os.close(master)
assert code==0 and sent and b'accepted' in output and b'synthetic-private-password' not in output
`;
  const result = spawnSync(
    "/usr/bin/python3",
    ["-c", harness, process.execPath, program, loader],
    { encoding: "utf8", timeout: 12000 },
  );
  assert.equal(
    result.status,
    0,
    "private synthetic terminal prompt must complete without echo",
  );
});
test("CLI without separate transport and inventory approval emits no report and never prompts", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", loader, "scripts/src/promotionsInventoryPinned.ts"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Read-only inventory failed/);
  assert.doesNotMatch(result.stderr, /password|postgresql:\/\//i);
});
test("CLI rejects non-interactive secret input before connecting", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      loader,
      "scripts/src/promotionsInventoryPinned.ts",
      "--approved-read-only-inventory",
      "--approved-pinned-admin-transport",
      caPath!,
      leafPath!,
    ],
    { encoding: "utf8", input: "not-a-real-password" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Read-only inventory failed/);
  assert.doesNotMatch(result.stderr, /not-a-real-password|postgresql:\/\//i);
});
