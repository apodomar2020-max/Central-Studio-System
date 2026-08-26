/**
 * Security Wave — Mobile SecureStore / Privacy Hardening.
 *
 * Pure Node test: expo-secure-store and @react-native-async-storage/
 * async-storage are both mocked via node:test's mock.module (same pattern
 * as components/PushRegistrationGate.productionPath.test.ts) with tiny
 * in-memory stores, so this exercises the REAL secureTokenStorage.ts
 * module logic — not a re-implementation of it.
 */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

const secureStore = new Map<string, string>();
const asyncStore = new Map<string, string>();
/** When true, the next SecureStore.setItemAsync call silently no-ops (the
 *  "write didn't land" failure mode) instead of actually storing the value —
 *  used to exercise the migration's post-write CONFIRM step. */
let sabotageNextSecureWrite = false;

mock.module("expo-secure-store", {
  namedExports: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "wu-this-device-only",
    setItemAsync: async (key: string, value: string) => {
      if (sabotageNextSecureWrite) {
        sabotageNextSecureWrite = false;
        return; // simulate a write that doesn't actually persist
      }
      secureStore.set(key, value);
    },
    getItemAsync: async (key: string) => secureStore.get(key) ?? null,
    deleteItemAsync: async (key: string) => { secureStore.delete(key); },
  },
});

mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async (key: string) => asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => { asyncStore.set(key, value); },
    removeItem: async (key: string) => { asyncStore.delete(key); },
  },
});

after(() => mock.reset());

beforeEach(() => {
  secureStore.clear();
  asyncStore.clear();
  sabotageNextSecureWrite = false;
});

test("1/2: setStudentToken writes to SecureStore only, never AsyncStorage", async () => {
  const { setStudentToken } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);
  await setStudentToken("jwt.value.1");
  assert.equal(secureStore.get("studentToken"), "jwt.value.1");
  assert.equal(asyncStore.get("studentToken"), undefined, "must never be written to AsyncStorage");
});

test("3: getStudentToken restores a token already present in SecureStore", async () => {
  const { setStudentToken, getStudentToken } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);
  await setStudentToken("restored.jwt");
  assert.equal(await getStudentToken(), "restored.jwt");
});

test("4/5: a legacy AsyncStorage token migrates to SecureStore exactly once, and the legacy key is removed", async () => {
  asyncStore.set("studentToken", "legacy.jwt");
  const { getStudentToken } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);

  const token = await getStudentToken();
  assert.equal(token, "legacy.jwt", "migrated value is returned on the same call");
  assert.equal(secureStore.get("studentToken"), "legacy.jwt", "value now lives in SecureStore");
  assert.equal(asyncStore.get("studentToken"), undefined, "legacy AsyncStorage key removed after migration");

  // Second call: nothing left to migrate, SecureStore already authoritative.
  const second = await getStudentToken();
  assert.equal(second, "legacy.jwt");
});

test("6: a migration write that doesn't confirm leaves no duplicate/partial secret — fails safe (null, both stores clear)", async () => {
  asyncStore.set("studentToken", "legacy.jwt");
  sabotageNextSecureWrite = true;
  const { getStudentToken } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);

  const token = await getStudentToken();
  assert.equal(token, null, "unconfirmed migration must not hand back a token — force login instead");
  assert.equal(secureStore.get("studentToken"), undefined, "no partial secret left in SecureStore");
  assert.equal(asyncStore.get("studentToken"), undefined, "legacy key removed even on failure — never left duplicated");
});

test("7/8: clearStudentToken removes the token from SecureStore and any legacy AsyncStorage key", async () => {
  const { setStudentToken, clearStudentToken, getStudentToken } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);
  await setStudentToken("to-be-cleared");
  asyncStore.set("studentToken", "stale-legacy-copy"); // simulate an unmigrated legacy leftover
  await clearStudentToken();

  assert.equal(secureStore.get("studentToken"), undefined);
  assert.equal(asyncStore.get("studentToken"), undefined);
  assert.equal(await getStudentToken(), null);
});

test("16: secureTokenStorageAdapter.setItem writes through to SecureStore, matching the TokenStorage shape passwordRecoveryFlow.ts expects", async () => {
  const { secureTokenStorageAdapter } = await import(`./secureTokenStorage.ts?t=${Math.random()}`);
  await secureTokenStorageAdapter.setItem("studentToken", "adapter.jwt");
  assert.equal(secureStore.get("studentToken"), "adapter.jwt");
  assert.equal(asyncStore.get("studentToken"), undefined);
});
