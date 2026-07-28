import assert from "node:assert/strict";
import test from "node:test";
import { retryPendingInstallation } from "./installationUnregisterRetry";

test("logged-out retry uses installation credential without a JWT", async () => {
  const calls: Array<{ deviceId: string; secret: string }> = [];
  let cleared = false;
  const result = await retryPendingInstallation({
    readPending: async () => ({ deviceId: "installation-a" }),
    readSecret: async () => "secure-store-secret",
    unregister: async (deviceId, secret) => {
      calls.push({ deviceId, secret });
      return true;
    },
    clearPending: async () => { cleared = true; },
    wait: async () => {},
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [{ deviceId: "installation-a", secret: "secure-store-secret" }]);
  assert.equal(cleared, true);
});

test("offline logout retains only a device marker and does not clear it on failed retry", async () => {
  let clears = 0;
  const waits: number[] = [];
  const result = await retryPendingInstallation({
    readPending: async () => ({ deviceId: "installation-a" }),
    readSecret: async () => "secure-store-secret",
    unregister: async () => { throw new Error("offline"); },
    clearPending: async () => { clears += 1; },
    wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(result, false);
  assert.equal(clears, 0);
  assert.deepEqual(waits, [250, 500]);
});

test("pending installation unregister completes before new-account registration", async () => {
  const events: string[] = [];
  const cleared = await retryPendingInstallation({
    readPending: async () => ({ deviceId: "installation-a" }),
    readSecret: async () => "secure-store-secret",
    unregister: async () => { events.push("unregister"); return true; },
    clearPending: async () => { events.push("clear-pending"); },
    wait: async () => {},
  });
  if (cleared) events.push("register-new-account");
  assert.deepEqual(events, ["unregister", "clear-pending", "register-new-account"]);
});

test("deviceId without its SecureStore secret cannot retry or clear the marker", async () => {
  let attempted = false;
  let cleared = false;
  const result = await retryPendingInstallation({
    readPending: async () => ({ deviceId: "installation-a" }),
    readSecret: async () => null,
    unregister: async () => { attempted = true; return true; },
    clearPending: async () => { cleared = true; },
    wait: async () => {},
  });
  assert.equal(result, false);
  assert.equal(attempted, false);
  assert.equal(cleared, false);
});
