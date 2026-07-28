import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

type Effect = () => void | (() => void);
const effects: Effect[] = [];
let currentUser: { id: string; emailVerified: boolean } | null = null;
let retryCalls = 0;
let registrationCalls = 0;
let appStateHandler: ((state: string) => void) | null = null;

Object.defineProperty(globalThis, "__DEV__", { value: false, configurable: true });

mock.module("react", {
  namedExports: {
    useEffect: (effect: Effect) => { effects.push(effect); },
  },
});

mock.module("react-native", {
  namedExports: {
    AppState: {
      addEventListener: (_event: string, handler: (state: string) => void) => {
        appStateHandler = handler;
        return { remove() {} };
      },
    },
  },
});

mock.module("@/contexts/AppContext", {
  namedExports: {
    useAppContext: () => ({ user: currentUser }),
  },
});

mock.module("@/services/pushNotifications", {
  namedExports: {
    isExpoGo: () => false,
    isPushLogoutInProgress: () => false,
    registerPushNotificationsForCurrentUser: async () => { registrationCalls += 1; },
    retryPendingInstallationUnregister: async () => { retryCalls += 1; return true; },
  },
});

after(() => {
  mock.reset();
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

test("actual PushRegistrationGate retries pending unregister while user is null on mount and app activation", async () => {
  const PushRegistrationGate = (await import("./PushRegistrationGate")).default;
  currentUser = null;
  PushRegistrationGate();
  const mountedEffects = effects.splice(0);
  for (const effect of mountedEffects) effect();
  await Promise.resolve();

  assert.equal(retryCalls, 1, "logged-out initial mount must attempt pending installation unregister");
  assert.equal(registrationCalls, 0, "logged-out gate must not register a token");
  assert.ok(appStateHandler, "logged-out gate must subscribe to AppState");

  appStateHandler?.("active");
  await Promise.resolve();
  assert.equal(retryCalls, 2, "returning to active state must retry while logged out");
});
