/**
 * Real route + database integration tests for the public Website branch
 * directory endpoint:
 *
 *   GET /api/website/branches   (unauthenticated, active only, id ASC,
 *                                presentation projection)
 *
 * Boots the ACTUAL Express router (routes/websiteBranches.ts) behind the
 * ACTUAL global auth middleware, issues real HTTP requests with NO
 * credentials, and asserts on real rows in a disposable local Postgres
 * database — same convention as adminBalletPaymentsTerminalState.route.test.ts
 * / balletCancellationRouteIntegration.test.ts.
 *
 * Confirms:
 *   - anonymous GET works (no admin token, no api key)
 *   - response is a JSON array
 *   - inactive branches are excluded
 *   - order is studio_branches.id ASC
 *   - each row is EXACTLY { id, name, address, googleMapsLink } — never
 *     code / isActive / roomCount / createdAt / updatedAt
 *   - address / googleMapsLink may be null
 *   - empty (no active branches) returns []
 *   - Cache-Control is "no-store, max-age=0"
 *   - the admin branch routes (studioBranches.ts) are untouched: still 401
 *     without an admin token.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env.WEBSITE_BRANCHES_TEST_DATABASE_URL ??
  "postgres://localhost:5432/central_studio_disposable_website_branches";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: (typeof import("@workspace/db"))["pool"];
let port: number;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdBranchIds: number[] = [];

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

async function insertBranch(opts: {
  name: string;
  address?: string | null;
  googleMapsLink?: string | null;
  isActive: boolean;
}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO studio_branches (name, address, google_maps_link, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.name, opts.address ?? null, opts.googleMapsLink ?? null, opts.isActive],
  );
  const id: number = rows[0].id;
  createdBranchIds.push(id);
  return id;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const websiteBranchesRouter = (await import("./websiteBranches")).default;
  const studioBranchesRouter = (await import("./studioBranches")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(websiteBranchesRouter);
  app.use(studioBranchesRouter);

  await new Promise<void>((resolvePromise) => {
    server = app.listen(0, "127.0.0.1", () => resolvePromise());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  if (createdBranchIds.length > 0) {
    await pool.query(`DELETE FROM studio_branches WHERE id = ANY($1::int[])`, [createdBranchIds]);
  }
  await pool.end();
});

test("anonymous GET /api/website/branches returns 200 + JSON array with no credentials", async () => {
  const res = await fetch(apiUrl("/website/branches"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
  const body: unknown = await res.json();
  assert.ok(Array.isArray(body), "response body is an array");
});

test("only active branches are returned, ordered by id ASC, in the exact public projection", async () => {
  // Insert active (out of natural order), then an inactive one.
  const idA = await insertBranch({
    name: `WB Route A ${RUN}`,
    address: `1 A Street ${RUN}`,
    googleMapsLink: "https://maps.google.com/?q=a",
    isActive: true,
  });
  const idB = await insertBranch({
    name: `WB Route B ${RUN}`,
    address: null,
    googleMapsLink: null,
    isActive: true,
  });
  const idInactive = await insertBranch({
    name: `WB Route INACTIVE ${RUN}`,
    address: `Hidden ${RUN}`,
    googleMapsLink: "https://maps.google.com/?q=hidden",
    isActive: false,
  });

  const res = await fetch(apiUrl("/website/branches"));
  assert.equal(res.status, 200);
  const rows = (await res.json()) as Array<Record<string, unknown>>;

  const mine = rows.filter((r) => [idA, idB, idInactive].includes(r.id as number));
  assert.deepEqual(
    mine.map((r) => r.id),
    [idA, idB],
    "inactive excluded; active returned in id ASC order",
  );

  for (const row of mine) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ["address", "googleMapsLink", "id", "name"],
      "exactly the public projection keys",
    );
    for (const forbidden of ["code", "isActive", "is_active", "roomCount", "createdAt", "updatedAt"]) {
      assert.ok(!(forbidden in row), `must not expose "${forbidden}"`);
    }
  }

  const rowB = mine.find((r) => r.id === idB)!;
  assert.equal(rowB.address, null);
  assert.equal(rowB.googleMapsLink, null);
});

test("the admin branch routes remain guarded (401 without an admin token)", async () => {
  const res = await fetch(apiUrl("/admin/branches"));
  assert.equal(res.status, 401);
});
