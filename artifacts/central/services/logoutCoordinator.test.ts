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
