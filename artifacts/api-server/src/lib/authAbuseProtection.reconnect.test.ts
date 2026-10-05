import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

// Own an ephemeral localhost Redis; never stop or flush an existing service.
test("same singleton recovers from short and long outages without weakening admission", { timeout: 30_000 }, async (t) => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  process.env.REDIS_URL = `redis://127.0.0.1:${port}/0`;
  process.env.AUTH_ABUSE_PEPPER = "test-only-reconnect-pepper";
  process.env.OTP_PEPPER = "test-only-reconnect-otp-pepper";
  process.env.STUDENT_JWT_SECRET = "test-only-reconnect-jwt";
  process.env.DATABASE_URL = "postgres://localhost:1/disposable_reconnect";
  process.env.BREVO_API_KEY = "test-only-provider-key";
  process.env.EMAIL_FROM = "test@example.invalid";
  process.env.NODE_ENV = "test";
  let server: ChildProcess | undefined;
  async function start() {
    server = spawn("redis-server", ["--bind", "127.0.0.1", "--port", String(port), "--save", "", "--appendonly", "no"], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Disposable Redis startup timeout")), 5000);
      server!.once("error", (err) => { clearTimeout(timer); reject(err); });
      server!.stdout!.on("data", (chunk) => {
        if (String(chunk).includes("Ready to accept connections")) { clearTimeout(timer); resolve(); }
      });
    });
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    server = undefined;
  }
  async function until(predicate: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 8000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error("Recovery condition timed out");
      await delay(25);
    }
  }
  const abuse = await import("./authAbuseProtection");
  const admission = await import("./nativeAuthAdmission");
  const provider = await import("./authHelpers");
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return new Response("{}", { status: 201 }); };
  try {
    await start();
    const client = abuse.getAdmissionRedis()!;
    await until(() => client.status === "ready");
    const listeners = client.eventNames().map((name) => [name, client.listenerCount(name)]);
    await t.test("healthy and short outage: ok → degraded → ok on the same client", async () => {
      assert.equal(await abuse.isRedisHealthy(), true);
      await stop();
      assert.equal(await abuse.isRedisHealthy(), false);
      assert.equal((await abuse.consume("test:short-fallback", 60)).degraded, true);
      await start();
      await until(() => client.status === "ready");
      assert.equal(await abuse.isRedisHealthy(), true);
      assert.equal(abuse.getAdmissionRedis(), client);
    });
    await t.test("long outage exceeds old retry ceiling, keeps capped retries and bounds commands", async () => {
      await stop();
      await until(() => (client as unknown as { retryAttempts: number }).retryAttempts > 4);
      assert.notEqual(client.status, "end");
      const retry = client.options.retryStrategy!;
      assert.deepEqual([1, 2, 3, 4, 5, 100].map((n) => retry(n)), [200, 400, 600, 800, 1000, 1000]);
      const began = Date.now();
      await Promise.all(Array.from({ length: 100 }, () => client.ping().catch(() => undefined)));
      assert.ok(Date.now() - began < 2000, "requests must fail promptly during an outage");
      await delay(1200);
      const queues = client as unknown as { offlineQueue: { length: number }; commandQueue: { length: number } };
      assert.equal(queues.offlineQueue.length + queues.commandQueue.length, 0);
      assert.equal(await abuse.isRedisHealthy(), false);
    });
    await t.test("outage rejects registration before costly work and email before provider call", async () => {
      let costlyWork = 0;
      await assert.rejects(admission.reserveRegistration("test@example.invalid", {}).then(() => { costlyWork++; }), { kind: "unavailable" });
      assert.equal(costlyWork, 0);
      await assert.rejects(provider.sendOtpEmail("test@example.invalid", "123456", "verify"));
      assert.equal(providerCalls, 0);
      const first = await abuse.consume("test:long-fallback", 60);
      const second = await abuse.consume("test:long-fallback", 60);
      assert.equal(first.degraded, true);
      assert.equal(second.count, first.count + 1);
    });
    await t.test("long outage recovery resumes health, legacy counters and native/provider admission", async () => {
      await start();
      await until(() => client.status === "ready");
      assert.equal(abuse.getAdmissionRedis(), client);
      assert.equal(await abuse.isRedisHealthy(), true);
      assert.equal((await abuse.consume("test:recovered", 60)).degraded, false);
      await admission.reserveRegistration("test@example.invalid", {});
      await provider.sendOtpEmail("test@example.invalid", "123456", "verify");
      assert.equal(providerCalls, 1);
      assert.deepEqual(client.eventNames().map((name) => [name, client.listenerCount(name)]), listeners);
    });
  } finally {
    globalThis.fetch = originalFetch;
    abuse.__resetClientForTests();
    await stop();
  }
});
