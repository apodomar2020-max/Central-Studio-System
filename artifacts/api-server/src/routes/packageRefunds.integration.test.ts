import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

process.env.ADMIN_JWT_SECRET = "package-refund-route-test-secret";
process.env.DATABASE_URL = process.env.DISPOSABLE_PACKAGE_REFUND_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_refund";
let server: import("node:http").Server;
let port: number;

before(async () => {
  const express = (await import("express")).default;
  const router = (await import("./packageRefunds")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test("refund endpoints block unauthenticated callers", async () => {
  for (const [method, path] of [
    ["GET", "/api/admin/package-orders/1/refund-eligibility"],
    ["POST", "/api/admin/package-orders/1/refunds"],
    ["GET", "/api/admin/package-refunds/1"],
    ["POST", "/api/admin/package-refunds/1/approve"],
    ["POST", "/api/admin/package-refunds/1/reject"],
    ["POST", "/api/admin/package-refunds/1/complete"],
    ["POST", "/api/admin/package-refunds/1/fail"],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("routes separate view and mutation permissions and contain no direct refund database logic", async () => {
  const source = await readFile(new URL("./packageRefunds.ts", import.meta.url), "utf8");
  assert.match(source, /requireAdminPermission\("packageOrders", "view"\)/);
  assert.match(source, /requireAdminPermission\("finance", "view"\)/);
  assert.match(source, /requireAdminPermission\("packageOrders", "cancel"\)/);
  assert.match(source, /requireAdminPermission\("finance", "refundsManage"\)/);
  assert.doesNotMatch(source, /@workspace\/db|\.insert\(|\.update\(/);
});

test("Admin refund controls call every lifecycle API", async () => {
  const source = await readFile(new URL("../../../admin/src/pages/package-orders.tsx", import.meta.url), "utf8");
  for (const endpoint of ["refund-eligibility", "/refunds`,", "/approve`", "/reject`", "/complete`", "/fail`"]) {
    assert.ok(source.includes(endpoint), `missing Admin API call: ${endpoint}`);
  }
  assert.match(source, /idempotencyKey: requestKey\.current/);
  assert.match(source, /completionIdempotencyKey: completionKey\.current/);
});
