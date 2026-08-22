import assert from "node:assert/strict";
import test from "node:test";
import { createLogoutCoordinator } from "./logoutCoordinator";

test("logout sets the guard and waits for unregister before clearing the JWT", async () => {
  const events: string[] = [];
  let releaseUnregister!: () => void;
  const unregisterWait = new Promise<void>((resolve) => { releaseUnregister = resolve; });
  const logout = createLogoutCoordinator({
    begin: () => events.push("guard"),
    unregister: async () => { events.push("unregister"); await unregisterWait; },
    clearSession: async () => { events.push("clear"); },
    finish: () => events.push("finish"),
  });

  const pending = logout();
  await Promise.resolve();
  assert.deepEqual(events, ["guard", "unregister"]);
  releaseUnregister();
  await pending;
  assert.deepEqual(events, ["guard", "unregister", "clear", "finish"]);
});

test("logout still clears the session when unregister fails", async () => {
  const events: string[] = [];
  const logout = createLogoutCoordinator({
    begin: () => events.push("guard"),
    unregister: async () => { throw new Error("offline"); },
    clearSession: async () => { events.push("clear"); },
    finish: () => events.push("finish"),
  });
  await logout();
  assert.deepEqual(events, ["guard", "clear", "finish"]);
});

test("duplicate logout calls share one unregister and one session clear", async () => {
  let unregisters = 0;
  let clears = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const logout = createLogoutCoordinator({
    begin: () => {},
    unregister: async () => { unregisters += 1; await wait; },
    clearSession: async () => { clears += 1; },
    finish: () => {},
  });
  const first = logout();
  const second = logout();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(unregisters, 1);
  assert.equal(clears, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Security-02B (CS-SEC-H-03): backend session revocation on logout.
// ─────────────────────────────────────────────────────────────────────────────

test("logout attempts backend revocation FIRST, before unregister and clearSession", async () => {
  const events: string[] = [];
  const logout = createLogoutCoordinator({
    begin: () => events.push("guard"),
    revokeSession: async () => { events.push("revoke"); },
    unregister: async () => { events.push("unregister"); },
    clearSession: async () => { events.push("clear"); },
    finish: () => events.push("finish"),
  });
  await logout();
  assert.deepEqual(events, ["guard", "revoke", "unregister", "clear", "finish"]);
});

test("logout still completes (unregisters and clears local state) if the backend revocation call fails", async () => {
  const events: string[] = [];
  const logout = createLogoutCoordinator({
    begin: () => events.push("guard"),
    revokeSession: async () => { throw new Error("network unreachable"); },
    unregister: async () => { events.push("unregister"); },
    clearSession: async () => { events.push("clear"); },
    finish: () => events.push("finish"),
  });
  // Must not throw — a dead backend can never trap the user in a
  // logged-in-looking UI state.
  await logout();
  assert.deepEqual(events, ["guard", "unregister", "clear", "finish"]);
});

test("omitting revokeSession entirely preserves the exact prior local-only-logout behavior", async () => {
  // Backward compatibility: a caller built before this feature (or one that
  // deliberately wants local-only logout, e.g. in a context with no
  // reachable backend) is completely unaffected by revokeSession's addition.
  const events: string[] = [];
  const logout = createLogoutCoordinator({
    begin: () => events.push("guard"),
    unregister: async () => { events.push("unregister"); },
    clearSession: async () => { events.push("clear"); },
    finish: () => events.push("finish"),
  });
  await logout();
  assert.deepEqual(events, ["guard", "unregister", "clear", "finish"]);
});
