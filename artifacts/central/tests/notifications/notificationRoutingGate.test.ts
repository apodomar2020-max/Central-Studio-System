import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as intents from "../../services/notificationIntent";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync("artifacts/central/app/_layout.tsx", "utf8");
const gate = source.slice(source.indexOf("function notificationResponseKey"), source.indexOf("function AndroidHardwareBackGuard"));
function response(id: string, type = "booking_confirmed") {
  return { actionIdentifier: "default", notification: { request: { identifier: id, content: { data: { type, notificationId: id } } } } };
}
function harness(lastResponse: any = null) {
  let cursor = 0, dirty = true, listener: (value: any) => void;
  const slots: any[] = [], effects: Array<() => void> = [], cleanup: Array<() => void> = [];
  const state = { user: null as any, isLoading: true, pathname: "/", inTabs: false, root: true };
  const pushes: string[] = [], clears: string[] = [];
  const N = { DEFAULT_ACTION_IDENTIFIER: "default", getLastNotificationResponse: () => lastResponse,
    clearLastNotificationResponse: () => { clears.push(lastResponse?.notification.request.identifier); lastResponse = null; },
    addNotificationResponseReceivedListener(fn: any) { listener = fn; return { remove() { listener = () => {}; } }; } };
  const module = { exports: {} as any };
  runInNewContext(ts.transpileModule(gate + "\nmodule.exports = NotificationRoutingGate;", { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, ...intents,
    useSegments: () => state.inTabs ? ["(tabs)"] : [], useAppContext: () => state, usePathname: () => state.pathname, useRootNavigationState: () => state.root ? { key: "root" } : null,
    useRef(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useReducer(reducer: any, initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (event: any) => { const next = reducer(slots[i], event); if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
    useCallback(fn: any) { return fn; },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, n) => v !== slots[i][n])) { slots[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    queryClient: { clear() {} }, ensureNotificationHandler: async () => {}, loadExpoNotifications: async () => N,
    customFetch: async () => [], pushOnce: (route: string) => { pushes.push(route); return true; },
  });
  return { state, pushes, clears, tap(value: any) { lastResponse = value; listener(value); }, async flush() {
    dirty = true;
    for (let pass = 0; pass < 12; pass++) {
      if (dirty) { dirty = false; cursor = 0; module.exports(); effects.splice(0).forEach(fn => fn()); }
      await Promise.resolve();
    }
  }, dispose() { cleanup.forEach(fn => fn?.()); } };
}
test("actual gate replays terminated launch after hydration and index redirect, then handles warm/background taps", async () => {
  const h = harness(response("cold")); await h.flush(); assert.deepEqual(h.pushes, []);
  h.state.user = { id: "A", emailVerified: true }; h.state.isLoading = false; await h.flush(); assert.deepEqual(h.pushes, []);
  h.state.pathname = "/"; h.state.inTabs = true; await h.flush(); assert.deepEqual(h.pushes, ["/(tabs)/bookings"]);
  h.tap(response("warm", "package_activated")); await h.flush(); assert.deepEqual(h.pushes, ["/(tabs)/bookings", "/package-center"]);
  h.tap(response("warm", "package_activated")); await h.flush(); assert.equal(h.pushes.length, 2);
  h.tap(response("background")); await h.flush(); assert.equal(h.pushes.length, 3);
  assert.deepEqual(h.clears, ["cold", "warm", "background"]); h.dispose();
});
test("actual gate waits for verification/profile flow and discards pending intent on account switch", async () => {
  const h = harness(); h.state.isLoading = false; h.state.user = { id: "A", emailVerified: false }; h.state.pathname = "/verify-email"; await h.flush();
  h.tap(response("guarded")); await h.flush(); assert.equal(h.pushes.length, 0);
  h.state.user = { id: "A", emailVerified: true }; h.state.pathname = "/auth/complete-profile"; await h.flush(); assert.equal(h.pushes.length, 0);
  h.state.user = { id: "B", emailVerified: true }; await h.flush();
  h.state.pathname = "/"; h.state.inTabs = true; await h.flush(); assert.equal(h.pushes.length, 0);
  h.tap(response("B-new")); await h.flush(); assert.deepEqual(h.pushes, ["/(tabs)/bookings"]); h.dispose();
});
