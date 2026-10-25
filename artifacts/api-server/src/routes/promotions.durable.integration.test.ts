/** Real PostgreSQL + independent API processes. No fake durable storage. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
const databaseUrl = process.env.DISPOSABLE_PROMOTIONS_DURABLE_DATABASE_URL;
if (!databaseUrl) throw Error("Set DISPOSABLE_PROMOTIONS_DURABLE_DATABASE_URL");
const u = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1"].includes(u.hostname) ||
  !/disposable/.test(u.pathname) ||
  /railway|rlwy/i.test(databaseUrl)
)
  throw Error("New disposable local database required");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  ADMIN_JWT_SECRET: "durable-disposable-secret",
  NODE_ENV: "test",
});
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;
delete process.env.PROMOTIONS_REQUIRE_IDEMPOTENCY;
delete process.env.PROMOTIONS_REQUIRE_REVISION;
let pool: typeof import("@workspace/db").pool;
let cleanup: typeof import("../lib/promotionOperations").cleanupPromotionOperations;
let adminId: number, otherId: number, token: string, otherToken: string;
const children = new Set<ChildProcess>();
let first: { child: ChildProcess; base: string },
  second: { child: ChildProcess; base: string };
const run = `${Date.now()}-${process.pid}`;
const payload = (extra: Record<string, unknown> = {}) => ({
  name: `Durable-${randomUUID()}`,
  type: "automatic",
  discountType: "percentage",
  discountValue: 10,
  isActive: false,
  ...extra,
});
async function launch() {
  const child = fork(
    path.resolve(
      "artifacts/api-server/src/test-fixtures/promotionOperationServer.ts",
    ),
    [],
    {
      execArgv: [
        "--import",
        path.resolve("lib/db/node_modules/tsx/dist/loader.mjs"),
      ],
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.add(child);
  let stderr = "";
  child.stderr?.on("data", (b) => (stderr += b.toString()));
  child.stdout?.resume();
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error(`Server timeout ${stderr}`)),
      15000,
    );
    child.once("message", (m) => {
      clearTimeout(timer);
      resolve((m as { port: number }).port);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error(`Server exit ${stderr}`));
    });
  });
  return { child, base: `http://127.0.0.1:${port}/api` };
}
async function stop(child: ChildProcess, crash = false) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill(crash ? "SIGKILL" : "SIGTERM");
  });
  children.delete(child);
}
async function request(
  method: string,
  p: string,
  body?: unknown,
  key?: string,
  opts: {
    base?: string;
    token?: string | null;
    revision?: string;
    drop?: boolean;
  } = {},
) {
  const res = await fetch(`${opts.base ?? first.base}${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token === null ? {} : { "x-admin-token": opts.token ?? token }),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(opts.revision ? { "If-Match": opts.revision } : {}),
      ...(opts.drop ? { "x-test-drop-response": "true" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: (await res.json().catch(() => null)) as {
      id: number;
      revision: string;
      code?: string;
      state?: string;
      outcome?: string;
      version?: number;
      response: { id: number };
    },
    replay: res.headers.get("Promotion-Operation-Replayed"),
  };
}
async function row(key: string) {
  return (
    await pool.query(
      "select * from promotion_admin_operations where operation_id=$1",
      [key],
    )
  ).rows[0];
}
async function counts(id: number) {
  return {
    promotions: Number(
      (await pool.query("select count(*) from promotions where id=$1", [id]))
        .rows[0].count,
    ),
    audit: Number(
      (
        await pool.query(
          "select count(*) from promotion_audit_logs where promotion_id=$1",
          [id],
        )
      ).rows[0].count,
    ),
    activity: Number(
      (
        await pool.query(
          "select count(*) from admin_activity_logs where module='promotions' and entity_type='promotion' and entity_id=$1",
          [id],
        )
      ).rows[0].count,
    ),
  };
}
async function waitUntil(fn: () => Promise<boolean>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Database barrier timed out");
}
async function failAudit(table: string, work: () => Promise<void>) {
  await pool.query(
    `create function durable_test_fail() returns trigger language plpgsql as $$begin raise exception 'private failure details';end$$;create trigger durable_test_failure before insert on ${table} for each row execute function durable_test_fail()`,
  );
  try {
    await work();
  } finally {
    await pool.query(
      `drop trigger durable_test_failure on ${table};drop function durable_test_fail()`,
    );
  }
}
before(async () => {
  ({ pool } = await import("@workspace/db"));
  ({ cleanupPromotionOperations: cleanup } =
    await import("../lib/promotionOperations"));
  const jwt = (await import("jsonwebtoken")).default;
  adminId = (
    await pool.query(
      "insert into system_users(username,email,password_hash,full_name,is_super_admin) values($1,$2,'unused','Durable Admin',true) returning id",
      [`durable-${run}`, `durable-${run}@example.invalid`],
    )
  ).rows[0].id;
  otherId = (
    await pool.query(
      "insert into system_users(username,email,password_hash,full_name,is_super_admin) values($1,$2,'unused','Other Admin',true) returning id",
      [`other-${run}`, `other-${run}@example.invalid`],
    )
  ).rows[0].id;
  token = jwt.sign(
    { sub: adminId, tokenVersion: 1 },
    process.env.ADMIN_JWT_SECRET!,
  );
  otherToken = jwt.sign(
    { sub: otherId, tokenVersion: 1 },
    process.env.ADMIN_JWT_SECRET!,
  );
  first = await launch();
  second = await launch();
});
after(async () => {
  for (const child of children) await stop(child);
  await pool?.end();
});

test("previously blocked: concurrent Automatic creates with one identity mutate and audit once", async () => {
  const key = randomUUID(),
    body = payload();
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      request("POST", "/promotions", body, key, {
        base: i % 2 ? second.base : first.base,
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  assert.equal(results.filter((r) => r.replay !== "true").length, 1);
  assert.deepEqual(await counts(results[0].data.id), {
    promotions: 1,
    audit: 1,
    activity: 1,
  });
});
test("previously blocked: lost response after commit recovers same automatic promotion", async () => {
  const key = randomUUID(),
    body = payload();
  await assert.rejects(
    request("POST", "/promotions", body, key, { drop: true }),
  );
  const stored = await row(key);
  assert.equal(stored.state, "succeeded");
  const retry = await request("POST", "/promotions", body, key);
  assert.equal(retry.status, 201);
  assert.equal(retry.data.id, stored.result_promotion_id);
  assert.equal(retry.replay, "true");
  assert.deepEqual(await counts(retry.data.id), {
    promotions: 1,
    audit: 1,
    activity: 1,
  });
});
test("previously blocked: changed payload cannot reuse an admitted identity", async () => {
  const key = randomUUID(),
    body = payload();
  assert.equal((await request("POST", "/promotions", body, key)).status, 201);
  const conflict = await request(
    "POST",
    "/promotions",
    { ...body, discountValue: 20 },
    key,
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "OPERATION_KEY_REUSED");
});
test("previously blocked: successful replay adds no audit and returns original snapshot", async () => {
  const key = randomUUID(),
    body = payload();
  const saved = await request("POST", "/promotions", body, key);
  await request(
    "PATCH",
    `/promotions/${saved.data.id}`,
    { name: "Later configuration" },
    randomUUID(),
    { revision: `"${saved.data.revision}"` },
  );
  const before = await counts(saved.data.id);
  const replay = await request("POST", "/promotions", body, key);
  assert.deepEqual(replay.data, saved.data);
  assert.deepEqual(await counts(saved.data.id), before);
});
test("previously blocked: second independent API instance replays committed result", async () => {
  const key = randomUUID(),
    body = payload();
  const saved = await request("POST", "/promotions", body, key);
  const replay = await request("POST", "/promotions", body, key, {
    base: second.base,
  });
  assert.equal(replay.replay, "true");
  assert.deepEqual(replay.data, saved.data);
});
test("previously blocked: current authorization is required before replay", async () => {
  const key = randomUUID(),
    body = payload();
  const saved = await request("POST", "/promotions", body, key);
  const before = await counts(saved.data.id);
  await pool.query("update system_users set is_super_admin=false where id=$1", [
    adminId,
  ]);
  try {
    assert.equal(
      (await request("POST", "/promotions", body, key, { base: second.base }))
        .status,
      403,
    );
    assert.equal(
      (await request("GET", `/promotions/operations/${key}`)).status,
      403,
    );
  } finally {
    await pool.query(
      "update system_users set is_super_admin=true where id=$1",
      [adminId],
    );
  }
  assert.deepEqual(await counts(saved.data.id), before);
});
test("actor, method, target and revision are immutable request bindings", async () => {
  const key = randomUUID(),
    body = payload(),
    saved = await request("POST", "/promotions", body, key);
  assert.equal(
    (await request("POST", "/promotions", body, key, { token: otherToken }))
      .status,
    409,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/promotions/operations/${key}`,
        undefined,
        undefined,
        { token: otherToken },
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("DELETE", `/promotions/${saved.data.id}`, undefined, key))
      .status,
    409,
  );
  const editKey = randomUUID(),
    patch = { description: "bound" };
  assert.equal(
    (
      await request("PATCH", `/promotions/${saved.data.id}`, patch, editKey, {
        revision: `"${saved.data.revision}"`,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("PATCH", `/promotions/${saved.data.id}`, patch, editKey, {
        revision: `"${"a".repeat(64)}"`,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        `/promotions/${saved.data.id + 1}`,
        patch,
        editKey,
        { revision: `"${saved.data.revision}"` },
      )
    ).status,
    409,
  );
});
for (const table of ["promotion_audit_logs", "admin_activity_logs"]) {
  test(`${table} failure rolls back mutation; admitted key survives and same request can retry`, async () => {
    const key = randomUUID(),
      body = payload();
    await failAudit(table, async () => {
      const result = await request("POST", "/promotions", body, key);
      assert.equal(result.status, 500);
      assert.deepEqual(result.data, { error: "Internal server error" });
      assert.equal((await row(key)).state, "reserved");
      assert.equal(
        Number(
          (
            await pool.query("select count(*) from promotions where name=$1", [
              body.name,
            ])
          ).rows[0].count,
        ),
        0,
      );
    });
    assert.equal(
      (
        await request(
          "POST",
          "/promotions",
          { ...body, name: "Changed after rollback" },
          key,
        )
      ).status,
      409,
    );
    const retry = await request("POST", "/promotions", body, key);
    assert.equal(retry.status, 201);
    assert.deepEqual(await counts(retry.data.id), {
      promotions: 1,
      audit: 1,
      activity: 1,
    });
  });
}
test("deterministic rejected result is retained and replayed without business/audit changes", async () => {
  const key = randomUUID(),
    body = payload({ discountValue: 101 });
  const rejected = await request("POST", "/promotions", body, key);
  assert.equal(rejected.status, 400);
  assert.equal((await row(key)).state, "rejected");
  const retry = await request("POST", "/promotions", body, key, {
    base: second.base,
  });
  assert.deepEqual(retry.data, rejected.data);
  assert.equal(retry.replay, "true");
});
test("stale revision rejection is durable and cannot overwrite newer configuration", async () => {
  const saved = await request("POST", "/promotions", payload(), randomUUID());
  await request(
    "PATCH",
    `/promotions/${saved.data.id}`,
    { name: "Current" },
    randomUUID(),
    { revision: `"${saved.data.revision}"` },
  );
  const key = randomUUID(),
    body = { name: "Stale" };
  const stale = await request(
    "PATCH",
    `/promotions/${saved.data.id}`,
    body,
    key,
    { revision: `"${saved.data.revision}"` },
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "PROMOTION_CHANGED");
  assert.equal((await row(key)).state, "rejected");
  assert.equal(
    (
      await request("PATCH", `/promotions/${saved.data.id}`, body, key, {
        revision: `"${saved.data.revision}"`,
      })
    ).replay,
    "true",
  );
});
test("deactivation replay preserves 204 and audits exactly once", async () => {
  const saved = await request(
      "POST",
      "/promotions",
      payload({ isActive: true }),
      randomUUID(),
    ),
    key = randomUUID(),
    opts = { revision: `"${saved.data.revision}"` };
  assert.equal(
    (
      await request(
        "DELETE",
        `/promotions/${saved.data.id}`,
        undefined,
        key,
        opts,
      )
    ).status,
    204,
  );
  const before = await counts(saved.data.id);
  const replay = await request(
    "DELETE",
    `/promotions/${saved.data.id}`,
    undefined,
    key,
    { ...opts, base: second.base },
  );
  assert.equal(replay.status, 204);
  assert.equal(replay.replay, "true");
  assert.deepEqual(await counts(saved.data.id), before);
});
test("restart reconciles a committed operation without process memory", async () => {
  const key = randomUUID(),
    body = payload();
  const saved = await request("POST", "/promotions", body, key);
  await stop(first.child);
  first = await launch();
  const status = await request("GET", `/promotions/operations/${key}`);
  assert.equal(status.data.state, "succeeded");
  assert.equal(status.data.response.id, saved.data.id);
  assert.equal(
    (await request("POST", "/promotions", body, key)).replay,
    "true",
  );
});
test("canonical v1 handles defaults, numeric strings, offsets, code normalization and rejects unknown fields", async () => {
  const key = randomUUID(),
    body = payload({ startDate: "2026-11-01T10:00:00.123456Z" });
  const saved = await request("POST", "/promotions", body, key);
  assert.equal(saved.status, 201);
  const equivalent = {
    ...body,
    discountValue: "10",
    startDate: "2026-11-01T12:00:00.123456+02:00",
    priority: 0,
    isExclusive: false,
    isStackable: false,
    rulesConfig: {},
  };
  assert.equal(
    (await request("POST", "/promotions", equivalent, key)).replay,
    "true",
  );
  assert.equal(
    (
      await request(
        "POST",
        "/promotions",
        { ...body, unknown: true },
        randomUUID(),
      )
    ).status,
    400,
  );
  const mkey = randomUUID(),
    manual = payload({ type: "manual", code: `MANUAL-${randomUUID()}` });
  const m = await request("POST", "/promotions", manual, mkey);
  assert.equal(m.status, 201);
  assert.equal(
    (
      await request(
        "POST",
        "/promotions",
        {
          ...manual,
          code: String((manual as Record<string, unknown>).code).toLowerCase(),
        },
        mkey,
      )
    ).replay,
    "true",
  );
});
test("database rejects duplicate identity, binding edits, terminal resurrection and history deletion", async () => {
  const key = randomUUID();
  await request("POST", "/promotions", payload(), key);
  await assert.rejects(
    pool.query(
      "insert into promotion_admin_operations select * from promotion_admin_operations where operation_id=$1",
      [key],
    ),
    { code: "23505" },
  );
  await assert.rejects(
    pool.query(
      "update promotion_admin_operations set actor_admin_id=$2 where operation_id=$1",
      [key, otherId],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query(
      "update promotion_admin_operations set state='reserved' where operation_id=$1",
      [key],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query("delete from promotion_admin_operations where operation_id=$1", [
      key,
    ]),
    { code: "23514" },
  );
});

for (const phase of ["before-admission", "after-admission"]) {
  test(`actual API process crash ${phase} is recoverable with the original key`, async () => {
    const key = randomUUID(),
      body = payload(),
      table =
        phase === "before-admission"
          ? "promotion_admin_operations"
          : "promotions";
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(918209,1)");
    await pool.query(
      `create function durable_crash_barrier() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(918209,1);return NEW;end$$;create trigger durable_crash_barrier before insert on ${table} for each row execute function durable_crash_barrier()`,
    );
    let pending: Promise<unknown> | undefined;
    try {
      pending = request("POST", "/promotions", body, key).catch(() => null);
      await waitUntil(
        async () =>
          Number(
            (
              await pool.query(
                "select count(*) from pg_locks where locktype='advisory' and classid=918209 and objid=1 and not granted",
              )
            ).rows[0].count,
          ) > 0,
      );
      if (phase === "after-admission")
        assert.equal((await row(key)).state, "reserved");
      else assert.equal(await row(key), undefined);
      await stop(first.child, true);
      await blocker.query("rollback");
      await pending;
      await waitUntil(
        async () =>
          Number(
            (
              await pool.query(
                "select count(*) from pg_locks where locktype='advisory' and classid=918209 and objid=1",
              )
            ).rows[0].count,
          ) === 0,
      );
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await pool.query(
        `drop trigger durable_crash_barrier on ${table};drop function durable_crash_barrier()`,
      );
    }
    first = await launch();
    const retry = await request("POST", "/promotions", body, key);
    assert.equal(retry.status, 201);
    assert.deepEqual(await counts(retry.data.id), {
      promotions: 1,
      audit: 1,
      activity: 1,
    });
  });
}

test("same-key concurrent changed payload admits exactly one immutable intention", async () => {
  const key = randomUUID(),
    body = payload();
  const results = await Promise.all([
    request("POST", "/promotions", body, key),
    request(
      "POST",
      "/promotions",
      { ...body, name: `Different-${randomUUID()}` },
      key,
      { base: second.base },
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const saved = results.find((r) => r.status === 201)!;
  assert.deepEqual(await counts(saved.data.id), {
    promotions: 1,
    audit: 1,
    activity: 1,
  });
});
test("authorization revoked while waiting on operation row prevents replay", async () => {
  const key = randomUUID(),
    body = payload();
  await request("POST", "/promotions", body, key);
  const blocker = await pool.connect();
  await blocker.query("begin");
  await blocker.query(
    "select * from promotion_admin_operations where operation_id=$1 for update",
    [key],
  );
  const waiting = request("POST", "/promotions", body, key);
  try {
    await waitUntil(
      async () =>
        Number(
          (
            await pool.query(
              "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%promotion_admin_operations%' and pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ) > 0,
    );
    await pool.query(
      "update system_users set is_super_admin=false where id=$1",
      [adminId],
    );
    await blocker.query("commit");
    assert.equal((await waiting).status, 403);
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await pool.query(
      "update system_users set is_super_admin=true where id=$1",
      [adminId],
    );
  }
});
async function insertExpired(
  key: string,
  body: Record<string, unknown>,
  state: "reserved" | "succeeded" = "reserved",
) {
  const { promotionRequestFingerprint } =
    await import("../lib/promotionOperations");
  // Apply the pinned v1 POST defaults used by the route.
  const normalized = {
    description: null,
    startDate: null,
    endDate: null,
    code: "",
    maxUses: null,
    usesPerUser: null,
    type: "automatic",
    discountType: "percentage",
    priority: 0,
    isExclusive: false,
    isStackable: false,
    isActive: true,
    rulesConfig: {},
    ...body,
  };
  const fingerprint = promotionRequestFingerprint(
    "POST",
    null,
    null,
    normalized,
  );
  if (state === "reserved")
    await pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,expires_at) values($1,$2,'POST',1,$3,now()-interval '1 second')",
      [key, adminId, fingerprint],
    );
  else
    await pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,expires_at,state,terminal_outcome,result_promotion_id,response_status,response_body,completed_at) values($1,$2,'POST',1,$3,now()-interval '1 second','succeeded','succeeded',1,201,'{}',now()-interval '31 days')",
      [key, adminId, fingerprint],
    );
}
test("expired reservation becomes a permanent non-executable tombstone", async () => {
  const key = randomUUID(),
    body = payload();
  await insertExpired(key, body);
  const result = await request("POST", "/promotions", body, key);
  assert.equal(result.status, 410);
  assert.equal(result.data.outcome, "not_executed");
  assert.equal((await row(key)).state, "expired");
  assert.equal((await request("POST", "/promotions", body, key)).status, 410);
  assert.equal(
    (await request("POST", "/promotions", { ...body, name: "Other" }, key))
      .status,
    409,
  );
});
test("bounded cleanup purges expired response bodies, keeps identities and all business history", async () => {
  const key = randomUUID(),
    body = payload();
  await insertExpired(key, body, "succeeded");
  const before = (
    await pool.query(
      "select (select count(*) from promotions) p,(select count(*) from promotion_redemptions) r,(select count(*) from payment_records) f,(select count(*) from payment_events) e,(select count(*) from promotion_audit_logs) a",
    )
  ).rows;
  assert.ok((await cleanup(1)) >= 1);
  const tombstone = await row(key);
  assert.equal(tombstone.state, "expired");
  assert.equal(tombstone.response_body, null);
  assert.equal(tombstone.terminal_outcome, "succeeded");
  assert.equal((await request("POST", "/promotions", body, key)).status, 410);
  assert.deepEqual(
    (
      await pool.query(
        "select (select count(*) from promotions) p,(select count(*) from promotion_redemptions) r,(select count(*) from payment_records) f,(select count(*) from payment_events) e,(select count(*) from promotion_audit_logs) a",
      )
    ).rows,
    before,
  );
});
test("cleanup skips an in-flight operation and reconciliation reports pending", async () => {
  const key = randomUUID(),
    body = payload();
  await insertExpired(key, body);
  const blocker = await pool.connect();
  await blocker.query("begin");
  await blocker.query(
    "select * from promotion_admin_operations where operation_id=$1 for update",
    [key],
  );
  try {
    assert.equal(
      (await request("GET", `/promotions/operations/${key}`)).data.state,
      "pending",
    );
    await cleanup();
    assert.equal((await row(key)).state, "reserved");
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
  await cleanup();
  assert.equal((await row(key)).state, "expired");
});
test("response size is checked before commit; failure retains an executable reservation", async () => {
  const { executePromotionOperation, operationErrorResult } =
    await import("../lib/promotionOperations");
  const { resolveOptionalAdminIdentity } = await import("./adminAuth");
  const req = {
    method: "POST",
    headers: { "x-admin-token": token },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  } as unknown as import("./adminAuth").AdminRequest;
  const key = randomUUID();
  req.adminUser = (await resolveOptionalAdminIdentity(req))!;
  const body = payload();
  await assert.rejects(
    executePromotionOperation({
      req,
      action: "create",
      target: null,
      normalizedBody: body,
      knownError: () => null,
      mutate: async (tx) => {
        const { promotionsTable } = await import("@workspace/db");
        const [p] = await tx
          .insert(promotionsTable)
          .values({ name: body.name as string })
          .returning();
        return {
          status: 201,
          promotionId: p.id,
          body: JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) }),
        };
      },
    }),
    /exceeds durable storage limit/,
  );
  assert.equal((await row(key)).state, "reserved");
  assert.equal(
    Number(
      (
        await pool.query("select count(*) from promotions where name=$1", [
          body.name,
        ])
      ).rows[0].count,
    ),
    0,
  );
  // Database enforces the same bound independently of the writer.
  await assert.rejects(
    pool.query(
      "insert into promotion_admin_operations(operation_id,actor_admin_id,method,canonical_version,request_fingerprint,expires_at,state,terminal_outcome,result_promotion_id,response_status,response_body,completed_at) values($1,$2,'POST',1,$3,now(),'succeeded','succeeded',1,201,$4,now())",
      [randomUUID(), adminId, "a".repeat(64), "x".repeat(2 * 1024 * 1024 + 1)],
    ),
    { code: "23514" },
  );
  assert.equal(operationErrorResult(400, "SAFE", "Safe error").status, 400);
});
test("authentication and malformed operation identities never admit work", async () => {
  const key = randomUUID();
  assert.equal(
    (await request("POST", "/promotions", payload(), key, { token: null }))
      .status,
    401,
  );
  assert.equal(await row(key), undefined);
  assert.equal(
    (await request("POST", "/promotions", payload(), "invalid-key")).status,
    400,
  );
  assert.equal(
    (await request("GET", `/promotions/operations/${key}`)).status,
    404,
  );
});
test("replay bodies store only the existing authorized promotion response", async () => {
  const key = randomUUID(),
    saved = await request("POST", "/promotions", payload(), key),
    stored = await row(key);
  assert.deepEqual(JSON.parse(stored.response_body), saved.data);
  assert.doesNotMatch(
    stored.response_body,
    /"(?:password|token|studentEmail|payment_record|stack)"/i,
  );
  assert.equal(stored.actor_admin_id, adminId);
});

test("durable Manual saves preserve redeemed code identity and historical Finance snapshots", async () => {
  const p = (
    await request(
      "POST",
      "/promotions",
      payload({ type: "manual", code: `HISTORY-${randomUUID()}` }),
      randomUUID(),
    )
  ).data;
  const student = (
    await pool.query(
      "insert into students(name,email,email_verified) values('Durable History',$1,true) returning id",
      [`history-${randomUUID()}@example.invalid`],
    )
  ).rows[0].id;
  const booking = (
    await pool.query(
      "insert into bookings(student_name,student_email) values('History','history@example.invalid') returning id",
    )
  ).rows[0].id;
  const code = (
    await pool.query("select * from promotion_codes where promotion_id=$1", [
      p.id,
    ])
  ).rows[0];
  await pool.query(
    "insert into promotion_redemptions(promotion_id,promotion_code_id,student_id,booking_id,original_subtotal,discount_amount,final_subtotal,metadata) values($1,$2,$3,$4,100,10,90,$5)",
    [p.id, code.id, student, booking, { promoCode: code.code }],
  );
  const payment = (
    await pool.query(
      "insert into payment_records(flow_type,booking_id,capture_origin,occurred_at,evidence_class,amount_availability,amount_source,gross_amount_minor,discount_amount_minor,final_payable_amount_minor,status) values('single_class_booking',$1,'live_capture',now(),'confirmed','exact','creation_snapshot',10000,1000,9000,'unpaid') returning id",
      [booking],
    )
  ).rows[0].id;
  await pool.query(
    "insert into payment_events(payment_record_id,event_type,new_status,actor_type) values($1,'created','unpaid','system')",
    [payment],
  );
  const history = async () => ({
    redemptions: (
      await pool.query(
        "select * from promotion_redemptions where promotion_id=$1",
        [p.id],
      )
    ).rows,
    records: (
      await pool.query("select * from payment_records where id=$1", [payment])
    ).rows,
    events: (
      await pool.query(
        "select * from payment_events where payment_record_id=$1",
        [payment],
      )
    ).rows,
  });
  const before = await history(),
    key = randomUUID(),
    body = { code: `RENAMED-${randomUUID()}` };
  const denied = await request("PATCH", `/promotions/${p.id}`, body, key, {
    revision: `"${p.revision}"`,
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.code, "CODE_ALREADY_REDEEMED");
  assert.equal(
    (
      await request("PATCH", `/promotions/${p.id}`, body, key, {
        revision: `"${p.revision}"`,
      })
    ).replay,
    "true",
  );
  const editKey = randomUUID(),
    edit = { description: "Safe historical edit" };
  assert.equal(
    (
      await request("PATCH", `/promotions/${p.id}`, edit, editKey, {
        revision: `"${p.revision}"`,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("PATCH", `/promotions/${p.id}`, edit, editKey, {
        revision: `"${p.revision}"`,
      })
    ).replay,
    "true",
  );
  assert.deepEqual(await history(), before);
  const afterCode = (
    await pool.query("select * from promotion_codes where id=$1", [code.id])
  ).rows[0];
  assert.deepEqual(
    { ...afterCode, updated_at: null },
    { ...code, updated_at: null },
  );
});
test("canonical PATCH preserves absence/null distinctions and ordered arrays", async () => {
  const p = (await request("POST", "/promotions", payload(), randomUUID()))
      .data,
    key = randomUUID(),
    body = { rulesConfig: { verifiedStudentOnly: true, branches: ["A", "B"] } };
  assert.equal(
    (await request("PATCH", `/promotions/${p.id}`, body, key)).status,
    200,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        `/promotions/${p.id}`,
        { rulesConfig: { branches: ["A", "B"], verifiedStudentOnly: true } },
        key,
      )
    ).replay,
    "true",
  );
  assert.equal(
    (
      await request(
        "PATCH",
        `/promotions/${p.id}`,
        { rulesConfig: { verifiedStudentOnly: true, branches: ["B", "A"] } },
        key,
      )
    ).status,
    409,
  );
  const nullKey = randomUUID();
  assert.equal(
    (
      await request(
        "PATCH",
        `/promotions/${p.id}`,
        { description: null },
        nullKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("PATCH", `/promotions/${p.id}`, {}, nullKey)).status,
    409,
  );
});
test("revoked token version cannot replay or reconcile", async () => {
  const key = randomUUID(),
    body = payload();
  await request("POST", "/promotions", body, key);
  await pool.query("update system_users set token_version=2 where id=$1", [
    adminId,
  ]);
  try {
    assert.equal((await request("POST", "/promotions", body, key)).status, 401);
    assert.equal(
      (await request("GET", `/promotions/operations/${key}`)).status,
      401,
    );
  } finally {
    await pool.query("update system_users set token_version=1 where id=$1", [
      adminId,
    ]);
  }
});
test("enforcement is optional by default and strict activation remains explicitly configurable", async () => {
  assert.equal((await request("POST", "/promotions", payload())).status, 201);
  assert.equal(
    (await request("GET", "/promotions/save-protocol")).data.version,
    1,
  );
  process.env.PROMOTIONS_REQUIRE_IDEMPOTENCY = "true";
  process.env.PROMOTIONS_REQUIRE_REVISION = "true";
  let strict: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    strict = await launch();
    assert.equal(
      (
        await request("POST", "/promotions", payload(), undefined, {
          base: strict.base,
        })
      ).status,
      428,
    );
    const p = await request("POST", "/promotions", payload(), randomUUID(), {
      base: strict.base,
    });
    assert.equal(p.status, 201);
    assert.equal(
      (
        await request(
          "PATCH",
          `/promotions/${p.data.id}`,
          { description: "blocked" },
          randomUUID(),
          { base: strict.base },
        )
      ).status,
      428,
    );
    assert.equal(
      (
        await request(
          "PATCH",
          `/promotions/${p.data.id}`,
          { description: "allowed" },
          randomUUID(),
          { base: strict.base, revision: `"${p.data.revision}"` },
        )
      ).status,
      200,
    );
  } finally {
    delete process.env.PROMOTIONS_REQUIRE_IDEMPOTENCY;
    delete process.env.PROMOTIONS_REQUIRE_REVISION;
    if (strict) await stop(strict.child);
  }
});

test("retention maintenance starts a bounded cleanup and can be stopped", async () => {
  const key = randomUUID();
  await insertExpired(key, payload());
  const { startPromotionOperationCleanup } =
    await import("../lib/promotionOperationCleanup");
  const stopCleanup = startPromotionOperationCleanup();
  try {
    await waitUntil(async () => (await row(key)).state === "expired");
  } finally {
    stopCleanup();
  }
});
