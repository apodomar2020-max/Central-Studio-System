import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync("artifacts/central/components/PackageEmptyAnimation.tsx", "utf8");
function harness() {
  let cursor = 0;
  const slots: any[] = [], effects: Array<() => void> = [], cleanups: Array<() => void> = [];
  const events: Record<string, (value: any) => void> = {};
  const calls: string[] = [];
  let focusCleanup: (() => void) | undefined;
  let resolveMotion!: (value: boolean) => void;
  const motion = new Promise<boolean>(resolve => { resolveMotion = resolve; });
  const player = { play: () => calls.push("play"), pause: () => calls.push("pause"), resume: () => calls.push("resume") };
  const React = {
    createElement(type: any, props: any, ...children: any[]) { if (props?.ref) props.ref.current = player; return { type, props: props || {}, children: children.flat().filter(Boolean) }; },
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { slots[i] = v; }]; },
    useRef(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn: any) { return fn; },
    useEffect(fn: () => any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, n) => v !== slots[i][n])) { effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); slots[i] = deps; } },
  };
  const module = { exports: {} as any };
  const subscribe = (name: string, fn: any) => { events[name] = fn; return { remove() { delete events[name]; } }; };
  const mocks = (name: string) => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return { AccessibilityInfo: { addEventListener: subscribe, isReduceMotionEnabled: () => motion }, AppState: { currentState: "active", addEventListener: subscribe }, StyleSheet: { create: (v: any) => v, absoluteFill: {} }, View: "View" };
    if (name === "expo-router") return { useFocusEffect: (fn: any) => { if (!focusCleanup) focusCleanup = fn(); } };
    if (name === "lottie-react-native") return { __esModule: true, default: "Lottie" };
    return {};
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, { module, exports: module.exports, require: mocks });
  return { calls, events, resolveMotion, render() { cursor = 0; const tree = module.exports.default(); effects.splice(0).forEach(fn => fn()); return tree; }, blur() { focusCleanup?.(); }, dispose() { cleanups.forEach(fn => fn?.()); } };
}
test("supplied animation is byte-exact and self-contained", () => {
  const raw = readFileSync("artifacts/central/assets/animations/c9sB0AweiO.json");
  assert.equal(createHash("sha256").update(raw).digest("hex"), "fd58925c5d0203234959e1a1c495cae4ee4e2fc3755559fab3c0152d996eeb31");
  const animation = JSON.parse(raw.toString());
  assert.equal(animation.w, 426); assert.equal(animation.h, 290);
  assert.ok(animation.assets.every((a: any) => !a.p && !a.u));
});
test("motion preference is resolved before playback; background pauses and foreground resumes", async () => {
  const h = harness(); h.render(); h.render();
  assert.equal(h.calls.includes("play"), false);
  h.resolveMotion(false); await Promise.resolve();
  const tree = h.render();
  assert.equal(h.calls.filter(x => x === "play").length, 1);
  assert.equal(tree.children[0].props.loop, false);
  h.events.change("background"); h.render(); assert.equal(h.calls.at(-1), "pause");
  h.events.change("active"); h.render(); assert.equal(h.calls.at(-1), "resume");
  tree.children[0].props.onAnimationFinish(false);
  h.events.change("background"); h.render(); h.events.change("active"); h.render();
  assert.equal(h.calls.filter(x => x === "play").length, 1);
  assert.equal(h.calls.at(-1), "pause");
  h.dispose(); assert.deepEqual(Object.keys(h.events), []);
});
test("reduced motion is static, animation failure preserves a decorative empty slot", async () => {
  const h = harness(); h.render(); h.resolveMotion(true); await Promise.resolve();
  const tree = h.render(); assert.equal(tree.children[0].props.progress, 0.5);
  assert.equal(h.calls.includes("play"), false);
  assert.equal(tree.props.accessibilityElementsHidden, true);
  tree.children[0].props.onAnimationFailure();
  assert.equal(h.render().children.length, 0);
  h.dispose();
});
test("live reduced-motion preference overrides an older initial read", async () => {
  const h = harness(); h.render(); h.events.reduceMotionChanged(true); h.resolveMotion(false); await Promise.resolve();
  assert.equal(h.render().children[0].props.progress, 0.5);
  assert.equal(h.calls.includes("play"), false); h.dispose();
});
