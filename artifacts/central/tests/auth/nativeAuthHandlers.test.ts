import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
type Element = { type: any; props: any; children: any[] };

// Execute production screen handlers with controlled hooks/transport. No network
// or credentials are used; UIKit rendering remains a physical-device build check.
function screen(file: string, os: string, user: any = null) {
  let cursor = 0;
  const states: any[] = [], requests: any[] = [], navigation: any[] = [], alerts: any[] = [];
  let response: any = { ok: true }, failure: any;
  const React: any = {
    createElement(type: any, props: any, ...children: any[]) { return { type, props: props || {}, children: children.flat(Infinity).filter(x => x !== false && x != null) }; },
    Fragment: "Fragment", memo: (fn: any) => fn, useEffect() {},
    useState(value: any) { const i = cursor++; if (!(i in states)) states[i] = typeof value === "function" ? value() : value; return [states[i], (v: any) => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
    useRef(value: any) { const i = cursor++; if (!(i in states)) states[i] = { current: value }; return states[i]; },
  };
  const generic = new Proxy({ __esModule: true, default: "Stub" }, { get(target, key) { return key in target ? (target as any)[key] : String(key); } });
  const transport = async (url: string, options: any) => { requests.push({ url, ...options }); if (failure) throw failure; return response; };
  const mocks = (name: string): any => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return { ...generic, Platform: { OS: os }, Keyboard: { dismiss() {} }, StyleSheet: { create: (s: any) => s, absoluteFill: {} }, Text: "Text", TextInput: "TextInput", View: "View", TouchableOpacity: "TouchableOpacity", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView" };
    if (name === "expo-haptics") return { impactAsync() {}, ImpactFeedbackStyle: { Medium: "Medium", Light: "Light" } };
    if (name === "expo-router") return { router: { replace: (v: any) => navigation.push(v) }, useLocalSearchParams: () => ({ email: "test@example.invalid" }) };
    if (name === "@/utils/navigation") return { pushOnce: (v: any) => navigation.push(v) };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "@workspace/api-client-react") return { customFetch: transport };
    if (name === "@/contexts/AppContext") return { useAppContext: () => ({ user, setUser() {} }) };
    if (name === "@/hooks/useCentralAlert") return { useCentralAlert: () => ({ show: (a: any) => alerts.push(a) }) };
    if (/use(Apple|Google|Facebook)SignIn/.test(name)) return { [name.split("/").pop()!]: () => ({ loading: false, signIn() {} }) };
    if (name === "@/services/authProfile") return { continueAfterAuth: async () => navigation.push("authenticated"), postAuthDestination: () => "/verify-email" };
    if (name === "@/constants/danceStyles") return { STORAGE_KEYS: {} };
    if (name === "@/components/signup/SignupKit") return { ...generic, CS: { cyan400: "cyan", cyan500: "cyan", amber: "amber" }, PrimaryCTA: "PrimaryCTA" };
    if (name === "@/services/nativeAuthErrors" || name === "@/services/passwordRecoveryFlow" || name === "@/utils/iosTypography") return evaluate(name.replace("@/", "") + ".ts");
    return generic;
  };
  function evaluate(path: string) {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(resolve("artifacts/central", path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: mocks, process: { env: { EXPO_PUBLIC_API_URL: "https://api.example.invalid" } }, fetch: async (url: string, opts: any) => { const result = await transport(url, opts); return { ok: true, status: 200, json: async () => result }; }, setInterval, clearInterval });
    return module.exports;
  }
  const module = evaluate(file);
  return { states, requests, navigation, alerts, fail(error: any) { failure = error; }, result(value: any) { response = value; }, render() { cursor = 0; return module.default() as Element; } };
}
function nodes(tree: any, predicate: (n: Element) => boolean): Element[] {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((n: any) => nodes(n, predicate))];
}
function button(tree: Element, label: string) {
  return nodes(tree, n => n.props.title === label || n.props.label === label)[0];
}
for (const os of ["ios", "android"]) {
  test(`${os}: registration submits native email-only bot-free registration then ordinary login`, async () => {
    const s = screen("app/auth/register.tsx", os);
    s.render();
    s.states.splice(0, 4, "Test", "Owner", "test@example.invalid", "fixture-password123");
    await button(s.render(), "Continue").props.onPress();
    assert.deepEqual(s.requests.map(r => r.url), ["https://api.example.invalid/api/auth/native/register", "https://api.example.invalid/api/auth/login"]);
    assert.deepEqual(Object.keys(JSON.parse(s.requests[0].body)).sort(), ["accountType", "email", "name", "password"]);
    assert.deepEqual(s.navigation, ["authenticated"]);
  });
  test(`${os}: email send/resend needs a session and ignores body identity`, async () => {
    const s = screen("app/verify-email.tsx", os, { id: 12, emailVerified: false });
    const tree = s.render();
    assert.equal(s.requests.length, 0); // explicit send, never automatic on mount
    const send = nodes(tree, n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0];
    let release!: (value: any) => void;
    s.result(new Promise(resolve => { release = resolve; }));
    const pending = send.props.onPress();
    await send.props.onPress();
    assert.equal(s.requests.length, 1); // ref contains overlapping sends
    release({ ok: true });
    await pending;
    assert.equal(s.requests[0].url, "/api/auth/native/send-email-otp");
    assert.equal(s.requests[0].body, undefined);
    assert.equal(s.requests[0].auth, undefined); // default shared session attachment
    // Rerendered cooldown disables the next request as well.
    const after = s.render();
    assert.equal(nodes(after, n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0].props.disabled, true);
    const unauth = screen("app/verify-email.tsx", os);
    await nodes(unauth.render(), n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0].props.onPress();
    assert.equal(unauth.requests.length, 0);
  });
  test(`${os}: recovery and Verify Identity use generic native recovery without session attachment`, async () => {
    const forgot = screen("app/auth/forgot-password.tsx", os);
    const field = nodes(forgot.render(), n => n.type === "TextInput")[0];
    field.props.onChangeText(" test@example.invalid ");
    await button(forgot.render(), "Send Verification Code").props.onPress();
    assert.equal(forgot.requests[0].url, "/api/auth/native/forgot-password");
    assert.equal(forgot.requests[0].auth, "omit");
    assert.deepEqual(JSON.parse(forgot.requests[0].body), { email: "test@example.invalid" });
    assert.equal(forgot.navigation[0].pathname, "/auth/otp-verification");
    const change = screen("app/change-password.tsx", os, { email: "test@example.invalid" });
    change.render(); change.states[5] = "recovery";
    await button(change.render(), "Send Verification Code").props.onPress();
    assert.equal(change.requests[0].url, "/api/auth/native/forgot-password");
    assert.equal(change.requests[0].auth, "omit");
    assert.deepEqual(JSON.parse(change.requests[0].body), { email: "test@example.invalid" });
  });
  test(`${os}: reset resend honors countdown, resumes native delivery and preserves server cooldown`, async () => {
    const s = screen("app/auth/otp-verification.tsx", os);
    // Locate the resend control by its text rather than relying on control order.
    const control = () => nodes(s.render(), n => n.type === "TouchableOpacity" && nodes(n, c => c.type === "Text" && c.children.some(t => typeof t === "string" && /Resend|Sending/.test(t))).length > 0)[0];
    await control().props.onPress(); assert.equal(s.requests.length, 0);
    s.states[4] = 0;
    await control().props.onPress();
    assert.equal(s.requests[0].url, "/api/auth/native/forgot-password");
    assert.equal(s.requests[0].auth, "omit");
    assert.deepEqual(JSON.parse(s.requests[0].body), { email: "test@example.invalid" });
    assert.equal(s.states[4], 60);
    s.states[4] = 0; s.fail({ status: 429, data: { retryAfterSeconds: 90, error: "private policy" } });
    await control().props.onPress();
    assert.equal(s.states[4], 90);
    assert.doesNotMatch(s.states[3], /private|policy/);
  });
  test(`${os}: email send handles cooldown, unavailable provider, expired session and offline errors`, async () => {
    for (const error of [
      { status: 429, data: { retryAfter: 75, error: "private admission policy" } },
      { status: 503, data: { error: "private provider credentials" } },
      { status: 401, data: { error: "private session data" } },
      new Error("private network diagnostic"),
    ]) {
      const s = screen("app/verify-email.tsx", os, { id: 12, emailVerified: false });
      s.fail(error);
      await nodes(s.render(), n => n.type === "TouchableOpacity" && n.props.style?.paddingVertical === 12)[0].props.onPress();
      assert.equal(s.alerts.length, 1);
      assert.doesNotMatch(s.alerts[0].message, /private|admission|credentials|session data|diagnostic/);
      assert.equal(s.states[2], error.status === 429 ? 75 : 0);
      assert.equal(s.states[5], false); // loading restored
      assert.equal(s.states[6].current, false); // request guard restored
    }
  });
}
