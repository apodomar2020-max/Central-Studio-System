import assert from "node:assert/strict";
import test from "node:test";
import {
  hashUnregisterSecret,
  resolveRegistrationSecret,
  unregisterByInstallation,
  type InstallationUnregisterStore,
} from "./installationUnregister";

type Row = { deviceId: string; secretHash: string | null; isActive: boolean };

function memoryStore(rows: Row[]): InstallationUnregisterStore {
  return {
    async deactivate(deviceId, secretHash) {
      let matched = false;
      for (const row of rows) {
        if (row.deviceId === deviceId && row.secretHash === secretHash) {
          matched = true;
          row.isActive = false;
        }
      }
      return matched;
    },
  };
}

test("legacy pending deviceId alone cannot authorize deactivation", async () => {
  const rows = [{ deviceId: "install-a", secretHash: hashUnregisterSecret("correct-secret"), isActive: true }];
  await unregisterByInstallation(memoryStore(rows), "install-a", "");
  assert.equal(rows[0].isActive, true);
});

test("wrong secret cannot deactivate and valid secret affects only its installation", async () => {
  const secret = "correct-high-entropy-secret-value";
  const rows = [
    { deviceId: "install-a", secretHash: hashUnregisterSecret(secret), isActive: true },
    { deviceId: "install-b", secretHash: hashUnregisterSecret(secret), isActive: true },
  ];
  await unregisterByInstallation(memoryStore(rows), "install-a", "wrong-secret");
  assert.equal(rows[0].isActive, true);
  await unregisterByInstallation(memoryStore(rows), "install-a", secret);
  assert.deepEqual(rows.map((row) => row.isActive), [false, true]);
});

test("installation unregister is idempotent and reveals no ownership result", async () => {
  const secret = "correct-high-entropy-secret-value";
  const rows = [{ deviceId: "install-a", secretHash: hashUnregisterSecret(secret), isActive: true }];
  const first = await unregisterByInstallation(memoryStore(rows), "install-a", secret);
  const second = await unregisterByInstallation(memoryStore(rows), "install-a", secret);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(rows[0].isActive, false);
});

test("historical registration without a secret receives a 256-bit credential once", () => {
  const generated = resolveRegistrationSecret();
  assert.equal(generated.returnSecret, true);
  assert.ok(generated.secret.length >= 43);
  assert.equal(generated.secretHash, hashUnregisterSecret(generated.secret));

  const preserved = resolveRegistrationSecret(generated.secret);
  assert.equal(preserved.returnSecret, false);
  assert.equal(preserved.secretHash, generated.secretHash);
});
