import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { AUTH_MODAL_SCREENS, completedAuthModalHistory, normalRoutePresentation } from "../../utils/iosAuthModalHistory.ts";

const route = (name: string, key = name) => ({ name, key });
const state = (names: string[]) => ({ key: "root", type: "stack", stale: false, index: names.length - 1, routes: names.map(name => route(name)) });

test("normal presentation is explicit on iOS only", () => {
  assert.deepEqual(normalRoutePresentation("ios"), { presentation: "card" });
  assert.deepEqual(normalRoutePresentation("android"), {});
  assert.deepEqual(normalRoutePresentation("web"), {});
});

for (const { name } of AUTH_MODAL_SCREENS) test(`active ${name} retains intentional auth history`, () => {
  assert.equal(completedAuthModalHistory(state(["(tabs)", "auth/login", name]), "ios"), null);
});

for (const target of ["(tabs)", "class/[id]", "instructor/[id]", "ballet/faq", "ballet/levels", "ballet/requirements", "help-support", "package-center", "verify-email", "onboarding/styles", "index"]) {
  test(`auth exit / warm link to ${target} removes stale auth and retains normal Back history`, () => {
    const original = state(["(tabs)", "auth/login", "auth/register", "auth/forgot-password", target]);
    const result = completedAuthModalHistory(original, "ios")!;
    assert.deepEqual(result.routes.map(r => r.name), ["(tabs)", target]);
    assert.equal(result.index, 1);
    assert.equal(result.routes[0], original.routes[0]);
    assert.equal(result.routes[1], original.routes[4]);
    assert.equal(original.routes.length, 5);
    assert.equal(completedAuthModalHistory(result, "ios"), null);
    assert.equal(completedAuthModalHistory(original, "android"), null);
  });
}

test("Expo 57 __root wrapper, destination params, returnTo and nested tabs survive one reset", () => {
  const tabs = { ...route("(tabs)"), state: state(["index", "classes"]) };
  const target = { ...route("class/[id]"), params: { id: "public-class", returnTo: "/class/public-class?source=home" } };
  const stack = { ...state([]), index: 3, routes: [tabs, route("auth/login"), route("auth/complete-profile"), target] };
  const original = { ...state([]), index: 0, routes: [{ ...route("__root"), state: stack }] };
  const result = completedAuthModalHistory(original, "ios")!;
  assert.equal(result.key, original.key);
  assert.equal(result.routes[0].key, "__root");
  assert.deepEqual(result.routes[0].state.routes, [tabs, target]);
  assert.equal(result.routes[0].state.index, 1);
  assert.equal(result.routes[0].state.routes[0].state, tabs.state);
  assert.equal(result.routes[0].state.routes[1].params, target.params);
  assert.equal(completedAuthModalHistory(result, "ios"), null);
});

test("cold content links and malformed/empty states do not reset", () => {
  assert.equal(completedAuthModalHistory(state(["ballet/faq"]), "ios"), null);
  assert.equal(completedAuthModalHistory(undefined, "ios"), null);
  assert.equal(completedAuthModalHistory(state([]), "ios"), null);
});

test("cancel back to a normal route removes inactive obsolete auth history", () => {
  const original = { ...state(["(tabs)", "auth/login", "ballet/faq"]), index: 0 };
  const result = completedAuthModalHistory(original, "ios")!;
  assert.equal(result.index, 0);
  assert.deepEqual(result.routes.map(r => r.name), ["(tabs)", "ballet/faq"]);
});

test("installed native-stack classifies only intentional auth screens as modal with the new policy", () => {
  const require = createRequire(import.meta.url);
  const { getModalRouteKeys } = require("expo-router/build/react-navigation/native-stack/utils/getModalRoutesKeys");
  const routes = [route("auth/login"), route("ballet/faq"), route("class/[id]"), route("package-center")];
  const inherited = Object.fromEntries(routes.map(r => [r.key, { options: r.name === "auth/login" ? { presentation: "modal" } : {} }]));
  assert.equal(getModalRouteKeys(routes, inherited).length, 4);
  const explicit = Object.fromEntries(routes.map(r => [r.key, { options: r.name === "auth/login" ? { presentation: "modal" } : normalRoutePresentation("ios") }]));
  assert.deepEqual(getModalRouteKeys(routes, explicit), ["auth/login"]);
});

test("root guard subscribes/unsubscribes, reads current state, and preserves existing modal gestures and tab policy", () => {
  const source = readFileSync(resolve("artifacts/central/app/_layout.tsx"), "utf8");
  assert.match(source, /navigation\.addListener\("state", reconcile\)/);
  assert.match(source, /return unsubscribe/);
  assert.match(source, /completedAuthModalHistory\(navigation\.getRootState\(\), Platform\.OS\)/);
  assert.match(source, /presentation: "modal", animation, gestureEnabled: false/);
  assert.match(source, /pathname\.startsWith\("\/class\/"\) \|\| pathname\.startsWith\("\/booking\/"\)/);
  assert.doesNotMatch(source, /NAV_LOCAL_CHECK/);
});
