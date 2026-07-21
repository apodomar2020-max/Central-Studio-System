import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

test("classifyWorkerHealth: unknown when no heartbeat row exists", async () => {
  const { classifyWorkerHealth } = await import("./reminderWorkerHeartbeat");
  assert.equal(classifyWorkerHealth(null), "unknown");
  assert.equal(classifyWorkerHealth(undefined), "unknown");
});

test("classifyWorkerHealth: online within the stale threshold", async () => {
  const { classifyWorkerHealth } = await import("./reminderWorkerHeartbeat");
  const now = new Date("2026-07-14T12:00:00.000Z");
  const fiveMinutesAgo = new Date("2026-07-14T11:55:00.000Z").toISOString();
  assert.equal(classifyWorkerHealth({ lastHeartbeatAt: fiveMinutesAgo }, now), "online");
});

test("classifyWorkerHealth: stale past the threshold", async () => {
  const { classifyWorkerHealth } = await import("./reminderWorkerHeartbeat");
  const now = new Date("2026-07-14T12:00:00.000Z");
  const thirtyMinutesAgo = new Date("2026-07-14T11:30:00.000Z").toISOString();
  assert.equal(classifyWorkerHealth({ lastHeartbeatAt: thirtyMinutesAgo }, now), "stale");
});

test("classifyWorkerHealth: unknown for an unparseable timestamp", async () => {
  const { classifyWorkerHealth } = await import("./reminderWorkerHeartbeat");
  assert.equal(classifyWorkerHealth({ lastHeartbeatAt: "not-a-date" }), "unknown");
});
