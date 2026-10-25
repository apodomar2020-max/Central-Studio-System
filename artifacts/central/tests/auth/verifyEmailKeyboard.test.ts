import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
type Element = { type: any; props: any; children: any[] };

// As in nativeAuthHandlers.test.ts, execute the actual screen with controlled
// hooks and services. These checks do not simulate UIKit/Android keyboard layout.
function screen(os: "ios" | "android", initialUser: any = {
  id: "12", email: "otp-test@example.invalid", emailVerified: false,
}) {
  let cursor = 0;
  let user = initialUser;
  let keyboardVisible = false;
  let failure: any;
  let sendResult: any = {};
  let verifyResult: any = { accessToken: "mock-verification-token" };
  let nextStep = "profile";
  const state: any[] = [];
  const effects: { deps: any[]; cleanup?: () => void }[] = [];
  const pendingEffects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  const requests: any[] = [], alerts: any[] = [], navigation: string[] = [];
  const tokens: string[] = [], events: string[] = [], focused: number[] = [];
  const refs: any[] = [];
  let clearedDrafts = 0;
  let timerId = 0;
  let dismissals = 0;

  const React = {
    createElement(type: any, props: any, ...children: any[]) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(x => x !== false && x != null) };
    },
    memo: (fn: any) => fn,
    useState(value: any) {
      const i = cursor++;
      if (!(i in state)) state[i] = value;
      return [state[i], (v: any) => { state[i] = typeof v === "function" ? v(state[i]) : v; }];
    },
    useRef(value: any) {
      const i = cursor++;
      if (!(i in state)) state[i] = { current: value };
      return state[i];
    },
    useEffect(fn: () => any, deps: any[]) {
      const i = cursor++;
      if (effects[i] && deps.every((v, index) => Object.is(v, effects[i].deps[index]))) return;
      effects[i]?.cleanup?.();
      effects[i] = { deps };
      pendingEffects.push(() => { effects[i].cleanup = fn(); });
    },
  };
  const generic = new Proxy({ __esModule: true, default: "Stub" }, {
    get(target, key) { return key in target ? (target as any)[key] : String(key); },
  });
  const modules = new Map<string, any>();
  function evaluate(path: string): any {
    if (modules.has(path)) return modules.get(path);
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(resolve("artifacts/central", path), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, {
      module, exports: module.exports, require: mocks, __DEV__: false,
      setInterval(fn: () => void) { const id = ++timerId; timers.set(id, fn); return id; },
      clearInterval(id: number) { timers.delete(id); },
    });
    modules.set(path, module.exports);
    return module.exports;
  }
  function mocks(name: string): any {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return {
      ...generic, Platform: { OS: os }, StyleSheet: { create: (s: any) => s, absoluteFill: {} },
      Text: "Text", TextInput: "TextInput", View: "View", TouchableOpacity: "TouchableOpacity",
      ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView",
      Keyboard: { dismiss() { keyboardVisible = false; dismissals++; events.push("dismiss"); } },
    };
    if (name === "expo-haptics") return { impactAsync() {}, ImpactFeedbackStyle: { Medium: "Medium", Light: "Light" } };
    if (name === "expo-router") return { router: { replace: (route: string) => navigation.push(route) } };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "@/contexts/AppContext") return { useAppContext: () => ({ user, async setUser(value: any) { user = value; } }) };
    if (name === "./auth/register") return { clearSignupDrafts() { clearedDrafts++; } };
    if (name === "@/hooks/useCentralAlert") return { useCentralAlert: () => ({ show(alert: any) {
      alerts.push({ ...alert, keyboardVisible }); events.push("alert");
    } }) };
    if (name === "@/services/secureTokenStorage") return { async setStudentToken(token: string) { tokens.push(token); } };
    if (["@/services/authProfile", "@/services/nativeAuthErrors", "@/utils/iosTypography"].includes(name)) {
      return evaluate(name.replace("@/", "") + ".ts");
    }
    if (name === "@/components/signup/SignupKit") return {
      ...generic, CS: { cyan400: "cyan", cyan500: "cyan", amber: "amber" }, PrimaryCTA: "PrimaryCTA",
    };
    if (name === "@workspace/api-client-react") return { async customFetch(url: string, options: any) {
      requests.push({ url, ...options }); events.push("request");
      if (failure) throw failure;
      if (url.endsWith("/native/send-email-otp")) return sendResult;
      if (url.endsWith("/verify-email-otp")) return verifyResult;
      if (url.endsWith("/me")) return { student: { id: 12, email: "otp-test@example.invalid", emailVerified: true, profileCompletion: { nextStep } } };
      throw new Error(`Unexpected test request: ${url}`);
    } };
    return generic;
  }
  const module = evaluate("app/verify-email.tsx");
  function render(): Element {
    cursor = 0;
    const tree = module.default();
    nodes(tree, n => n.type === "TextInput").forEach((node, i) => {
      refs[i] ??= { focus() { keyboardVisible = true; focused.push(i); } };
      node.props.ref(refs[i]);
    });
    pendingEffects.splice(0).forEach(fn => fn());
    return tree;
  }
  return {
    render, requests, alerts, navigation, tokens, events, focused,
    get keyboardVisible() { return keyboardVisible; },
    get dismissals() { return dismissals; },
    get clearedDrafts() { return clearedDrafts; },
    focus(i: number) { refs[i].focus(); },
    digit(i: number, value: string) { nodes(render(), n => n.type === "TextInput")[i].props.onChangeText(value); },
    values() { return nodes(render(), n => n.type === "TextInput").map(n => n.props.value); },
    fail(value: any) { failure = value; },
    sendResult(value: any) { sendResult = value; },
    verifyResult(value: any) { verifyResult = value; },
    nextStep(value: string) { nextStep = value; },
    tick(seconds: number) {
      render();
      for (let i = 0; i < seconds; i++) { [...timers.values()].forEach(fn => fn()); render(); }
    },
  };
}
function nodes(tree: any, predicate: (n: Element) => boolean): Element[] {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((n: any) => nodes(n, predicate))];
}
function verify(s: ReturnType<typeof screen>) {
  return nodes(s.render(), n => n.type === "PrimaryCTA" && n.props.label === "Verify Email")[0];
}
function resend(s: ReturnType<typeof screen>) {
  return nodes(s.render(), n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0];
}
function fill(s: ReturnType<typeof screen>) {
  for (let i = 0; i < 6; i++) s.digit(i, String(i + 1));
}

for (const os of ["ios", "android"] as const) {
  test(`${os}: partial entry advances focus; six digits dismiss without submitting`, () => {
    const s = screen(os);
    s.render(); s.focus(0);
    for (let i = 0; i < 5; i++) {
      s.digit(i, String(i + 1));
      assert.equal(s.keyboardVisible, true);
      assert.equal(s.focused.at(-1), i + 1);
      assert.equal(s.dismissals, 0);
    }
    s.digit(5, "6");
    assert.equal(s.keyboardVisible, false);
    assert.equal(s.dismissals, 1);
    assert.equal(s.values().join(""), "123456");
    assert.equal(s.requests.length, 0);
    assert.equal(s.alerts.length, 0);
  });

  test(`${os}: any digit remains editable; backspace and incomplete final entry preserve focus`, () => {
    const s = screen(os); fill(s);
    for (let i = 0; i < 6; i++) {
      s.focus(i); assert.equal(s.keyboardVisible, true);
      s.digit(i, "9"); assert.equal(s.values()[i], "9");
      assert.equal(s.keyboardVisible, false);
    }
    s.focus(5); s.digit(5, "");
    nodes(s.render(), n => n.type === "TextInput")[5].props.onKeyPress({ nativeEvent: { key: "Backspace" } });
    assert.equal(s.focused.at(-1), 4);
    s.digit(2, ""); s.digit(5, "8");
    assert.equal(s.keyboardVisible, true); // last box alone is not a complete code
    s.digit(2, "7"); assert.equal(s.keyboardVisible, false);
    assert.equal(s.requests.length, 0);
  });

  test(`${os}: incomplete verification dismisses before warning and makes no request`, async () => {
    const s = screen(os); s.render(); s.focus(0); s.digit(0, "1");
    await verify(s).props.onPress();
    assert.equal(s.alerts[0].title, "Incomplete");
    assert.equal(s.alerts[0].keyboardVisible, false);
    assert.equal(s.requests.length, 0);
  });

  test(`${os}: success preserves token refresh, profile navigation and Continue callback`, async () => {
    for (const [step, route, continueRoute] of [["profile", "/auth/complete-profile", "/auth/complete-profile"], ["children", "/onboarding/children", "/onboarding/children"], ["done", "/", "/"]]) {
      const s = screen(os); s.nextStep(step); fill(s); s.focus(5);
      let complete!: (value: any) => void;
      s.verifyResult(new Promise(resolve => { complete = resolve; }));
      const pending = verify(s).props.onPress();
      assert.equal(s.keyboardVisible, false);
      assert.equal(verify(s).props.loading, true);
      s.focus(1); // a user may reopen the keyboard during the request
      complete({ accessToken: "mock-verification-token" }); await pending;
      assert.deepEqual(s.requests.map(r => r.url), ["/api/auth/verify-email-otp", "/api/auth/me"]);
      assert.deepEqual(JSON.parse(s.requests[0].body), { studentId: "12", code: "123456" });
      assert.deepEqual(s.tokens, ["mock-verification-token"]);
      assert.equal(s.clearedDrafts, 1);
      assert.equal(s.alerts[0].keyboardVisible, false);
      assert.equal(s.alerts[0].title, "Email Verified!");
      assert.equal(s.alerts[0].actions[0].label, "Continue");
      s.render(); assert.equal(s.navigation.at(-1), route);
      s.alerts[0].actions[0].onPress(); assert.equal(s.navigation.at(-1), continueRoute);
    }
  });

  test(`${os}: invalid, expired and network errors preserve digits and reset loading`, async () => {
    for (const error of [{ data: { error: "Invalid code.", attemptsLeft: 2 } }, { data: { error: "Code expired.", requiresResend: true } }, new Error("offline")]) {
      const s = screen(os); fill(s); s.focus(5); s.fail(error);
      await verify(s).props.onPress();
      assert.equal(s.alerts[0].title, "Verification Failed");
      assert.equal(s.alerts[0].keyboardVisible, false);
      assert.equal(verify(s).props.loading, false);
      assert.equal(s.values().join(""), "123456");
      assert.equal(s.tokens.length, 0); assert.equal(s.navigation.length, 0);
      if ((error as any).data?.attemptsLeft) assert.match(s.alerts[0].message, /2 attempts remaining/);
      s.focus(0); assert.equal(s.keyboardVisible, true);
    }
  });

  test(`${os}: resend preserves overlap guard, cooldown and server retryAfter`, async () => {
    const s = screen(os); fill(s); s.focus(5);
    let complete!: (value: any) => void;
    s.sendResult(new Promise(resolve => { complete = resolve; }));
    const pending = resend(s).props.onPress();
    await resend(s).props.onPress();
    assert.equal(s.requests.length, 1);
    assert.equal(resend(s).props.disabled, true);
    assert.equal(resend(s).props.accessibilityState.busy, true);
    s.focus(0); complete({}); await pending;
    assert.equal(s.alerts[0].keyboardVisible, false);
    assert.equal(s.requests[0].url, "/api/auth/native/send-email-otp");
    assert.equal(s.requests[0].body, undefined);
    await resend(s).props.onPress(); assert.equal(s.requests.length, 1);
    s.tick(60); assert.equal(resend(s).props.disabled, false);
    s.fail({ status: 429, data: { retryAfter: 90 } }); s.focus(5);
    await resend(s).props.onPress();
    assert.equal(s.alerts.at(-1).keyboardVisible, false);
    s.tick(89); assert.equal(resend(s).props.disabled, true);
    s.tick(1); assert.equal(resend(s).props.disabled, false);
    assert.equal(s.values().join(""), "123456");
  });

  test(`${os}: exit confirmations dismiss; cancel preserves session, confirmed exit clears it`, async () => {
    for (const [label, action, destination] of [["Start over", "Start Over", "/auth/register"], ["Sign in with another account", "Sign In", "/auth/login"]]) {
      const s = screen(os); fill(s); s.focus(5);
      const control = nodes(s.render(), n => n.type === "TouchableOpacity" && n.children.some(c => c.type === "Text" && c.children.includes(label)))[0];
      control.props.onPress();
      assert.equal(s.alerts[0].keyboardVisible, false);
      assert.equal(s.clearedDrafts, 0); assert.equal(s.navigation.length, 0);
      s.alerts[0].actions.find((a: any) => a.label === action).onPress();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(s.clearedDrafts, 1); assert.equal(s.navigation.at(-1), destination);
      assert.equal(nodes(s.render(), n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0].props.disabled, true);
    }
  });

  test(`${os}: scrollable body and separate footer share keyboard avoidance; digit labels are unique`, () => {
    const s = screen(os), tree = s.render();
    const area = nodes(tree, n => n.type === "KeyboardAvoidingView")[0];
    assert.equal(area.props.behavior, os === "ios" ? "padding" : "height");
    const scroll = area.children.find(n => n.type === "ScrollView");
    assert.ok(scroll);
    assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
    assert.equal(scroll.props.keyboardDismissMode, os === "ios" ? "interactive" : "on-drag");
    assert.equal(scroll.props.contentContainerStyle.flex, undefined); // allow content to exceed viewport
    assert.equal(scroll.props.contentContainerStyle.flexGrow, 1);
    assert.equal(nodes(scroll, n => n.type === "PrimaryCTA").length, 0);
    assert.equal(nodes(area.children.find(n => n.type === "View"), n => n.type === "PrimaryCTA").length, 1);
    const inputs = nodes(tree, n => n.type === "TextInput");
    assert.equal(inputs.length, 6);
    inputs.forEach((n, i) => {
      assert.equal(n.props.accessibilityLabel, `Verification code digit ${i + 1} of 6`);
      assert.equal(n.props.autoFocus, undefined);
      assert.equal(n.props.editable, undefined);
      assert.equal(n.props.selectTextOnFocus, true);
      assert.equal(n.props.style[0].height, undefined);
      assert.equal(n.props.style[0].minHeight, 56);
      assert.notEqual(n.props.allowFontScaling, false);
    });
    assert.equal(resend(s).props.accessibilityRole, "button");
  });
}
