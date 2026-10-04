/**
 * SDK 57 Expo Go startup blocker — regression coverage.
 *
 * Root cause: `expo-notifications` (SDK 53+) has no native module in stock
 * Expo Go; a static `import ... from "expo-notifications"` throws
 * ("Cannot find native module 'ExpoNotificationsEmitter'") *during module
 * evaluation*, so `app/_layout.tsx` and `app/notifications.tsx` never produced
 * a default export and Expo Router cascaded into "missing default export" /
 * "Cannot read property 'ErrorBoundary' of undefined".
 *
 * These tests lock in the import-safe lazy access layer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mock, test } from "node:test";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const LAYOUT = "artifacts/central/app/_layout.tsx";
const NOTIF_SCREEN = "artifacts/central/app/notifications.tsx";
const RUNTIME = "artifacts/central/services/notificationsRuntime.ts";
const PUSH = "artifacts/central/services/pushNotifications.ts";

// ── Behavioural: the lazy loader is import-safe and Expo-Go-aware ────────────

test("loadExpoNotifications() returns null in Expo Go WITHOUT importing expo-notifications", async () => {
  mock.restoreAll();
  let expoNotificationsImported = false;
  mock.module("expo-constants", {
    defaultExport: { appOwnership: "expo" }, // === running inside Expo Go
  });
  mock.module("expo-notifications", {
    namedExports: {
      get setNotificationHandler(): never {
        expoNotificationsImported = true;
        throw new Error("expo-notifications must not be imported in Expo Go");
      },
    },
  });

  const mod = await import(`../../services/notificationsRuntime.ts?expoGo=${Date.now()}`);
  assert.equal(mod.isExpoGo(), true);
  const result = await mod.loadExpoNotifications();
  assert.equal(result, null, "Expo Go must resolve the module as unavailable");
  assert.equal(expoNotificationsImported, false, "the dynamic import must be short-circuited before it runs");

  await mod.ensureNotificationHandler(); // must be a no-op, not a throw
  mock.restoreAll();
});

test("loadExpoNotifications() DOES resolve the module in a real build (not Expo Go)", async () => {
  mock.restoreAll();
  const sentinel = { __expoNotifications: true, setNotificationHandler() {} };
  mock.module("expo-constants", {
    defaultExport: { appOwnership: "standalone" }, // real EAS binary
  });
  mock.module("expo-notifications", { namedExports: sentinel });

  const mod = await import(`../../services/notificationsRuntime.ts?build=${Date.now()}`);
  assert.equal(mod.isExpoGo(), false);
  const result = await mod.loadExpoNotifications();
  assert.ok(result, "a real build must load the expo-notifications module");
  assert.equal((result as { __expoNotifications?: boolean }).__expoNotifications, true);
  mock.restoreAll();
});

// ── Source guards: nothing reachable at startup statically imports the module ─

test("app/_layout.tsx never statically imports expo-notifications (type-only is allowed)", () => {
  const src = read(LAYOUT);
  // A value import would be evaluated at startup and crash Expo Go.
  assert.doesNotMatch(
    src,
    /^\s*import\s+(?!type\b)[^;]*from\s+["']expo-notifications["']/m,
    "found a runtime `import ... from \"expo-notifications\"` in the root layout",
  );
  assert.doesNotMatch(src, /import\s+\*\s+as\s+Notifications\s+from\s+["']expo-notifications["']/);
  // Type-only import is fine and expected (erased before Metro sees it).
  assert.match(src, /import\s+type\s+\{[^}]*NotificationResponse[^}]*\}\s+from\s+["']expo-notifications["']/);
});

test("app/_layout.tsx does not call notification APIs at module scope", () => {
  const src = read(LAYOUT);
  // A module-scope statement is unindented (column 0). No unindented line may
  // be a bare `Notifications.something(...)` or `setNotificationHandler(...)`.
  assert.doesNotMatch(
    src,
    /^(?:Notifications\.\w+|setNotificationHandler)\s*\(/m,
    "module-scope notification API call — this is exactly what crashed Expo Go",
  );
  // `setNotificationHandler` must not be referenced anywhere in the root
  // layout any more; it lives behind the lazy loader in notificationsRuntime.
  assert.doesNotMatch(src, /setNotificationHandler/);
  assert.match(src, /ensureNotificationHandler\(\)/, "handler is installed lazily instead");
});

test("app/notifications.tsx never statically imports expo-notifications and keeps its default export", () => {
  const src = read(NOTIF_SCREEN);
  assert.doesNotMatch(src, /import\s+[^;]*from\s+["']expo-notifications["']/);
  assert.match(src, /loadExpoNotifications\(\)/, "must use the lazy loader");
  assert.match(src, /export default function NotificationsScreen\(/);
});

test("app/_layout.tsx keeps its default export (Sentry-wrapped RootLayout)", () => {
  assert.match(read(LAYOUT), /export default Sentry\.wrap\(RootLayout\)/);
});

// ── Expo Go must still render notification history; navigation preserved ─────

test("notification-history UI does not depend on native push APIs", () => {
  const src = read(NOTIF_SCREEN);
  // History list is fed by the server endpoint, not by expo-notifications.
  assert.match(src, /customFetch<ApiItem\[\]>\("\/api\/notifications\/my/);
  // In Expo Go the permission card is simply hidden (optimistic default).
  assert.match(src, /if \(!N\) return;/);
});

test("notification tap-to-navigate wiring is intact in _layout.tsx", () => {
  const src = read(LAYOUT);
  assert.match(src, /resolveNotificationRoute\(response\.notification\.request\.content\.data\)/);
  assert.match(src, /addNotificationResponseReceivedListener/);
  assert.match(src, /getLastNotificationResponse\(\)/);
  assert.match(src, /<NotificationRoutingGate \/>/);
});

// ── Real EAS registration path preserved end-to-end ─────────────────────────

test("pushNotifications.ts still performs the full expo-token registration sequence", () => {
  const src = read(PUSH);
  assert.match(src, /loadExpoNotifications\(\)/, "registration must load the module via the shared lazy loader");
  assert.match(src, /getDevicePushTokenAsync\(\)/);
  assert.match(src, /getExpoPushTokenAsync\(/);
  assert.match(src, /"\/api\/notifications\/devices\/register"/);
  // Expo Go / web / logout are still short-circuited before any native call.
  assert.match(src, /if \(isExpoGo\(\)\) \{[\s\S]{0,120}return;/);
  assert.match(src, /Platform\.OS === "web"/);
});

test("PushRegistrationGate still gates on Expo Go + logout + email verification (login/logout isolation)", () => {
  const src = read("artifacts/central/components/PushRegistrationGate.tsx");
  assert.match(src, /isPushLogoutInProgress\(\)/);
  assert.match(src, /if \(expoGo\)/);
  assert.match(src, /if \(!user\?\.id\)/);
  assert.match(src, /if \(!user\.emailVerified\)/);
});

test("runtime module exposes an import-safe isExpoGo and never statically imports expo-notifications", () => {
  const src = read(RUNTIME);
  assert.match(src, /Constants\.appOwnership === "expo"/);
  assert.doesNotMatch(src, /^\s*import\s+[^;]*from\s+["']expo-notifications["']/m);
  assert.match(src, /import\("expo-notifications"\)/, "the only reference is a guarded dynamic import()");
});
