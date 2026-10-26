import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(resolve("artifacts/central/app/privacy-policy.tsx"), "utf8");
const approvedBodyHash = "80986d773ce8fbd20ac512b8737e5ee5d8bc18031a4b7cd910f838c35c134b06";

function screen(os = "ios") {
  let cursor = 0;
  let mounted = false;
  let effect: (() => (() => void)) | undefined;
  let fulfill: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  let updates = 0;
  const states: unknown[] = [];
  const requests: unknown[][] = [];
  const pending = new Promise((resolve, fail) => { fulfill = resolve; reject = fail; });
  const React = {
    createElement(type: unknown, props: unknown, ...children: unknown[]) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(x => x !== false && x != null) };
    },
    Fragment: "Fragment",
    useState(value: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = value;
      return [states[index], (next: unknown) => { states[index] = next; updates++; }];
    },
    useEffect(callback: () => (() => void)) { if (!mounted) effect = callback; },
  };
  const mocks = (name: string) => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return {
      Platform: { OS: os }, StyleSheet: { create: (value: unknown) => value },
      ActivityIndicator: "ActivityIndicator", Image: "Image", ScrollView: "ScrollView",
      Text: "Text", TouchableOpacity: "TouchableOpacity", View: "View",
    };
    if (name === "@workspace/api-client-react") return {
      customFetch: (...args: unknown[]) => { requests.push(args); return pending; },
    };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "expo-linear-gradient") return { LinearGradient: "LinearGradient" };
    if (name === "react-native-svg") return { __esModule: true, default: "Svg", Defs: "Defs", Path: "Path", RadialGradient: "RadialGradient", Rect: "Rect", Stop: "Stop" };
    return { __esModule: true, default: "Stub", router: {} };
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(source + "\nexport const testFallback = FALLBACK_PAGE; export const testStyles = styles;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: mocks });
  const render = () => { cursor = 0; return module.exports.default(); };
  const initial = render();
  const cleanup = effect!();
  mounted = true;
  return { initial, render, cleanup, fulfill, reject, requests, states,
    fallback: module.exports.testFallback, styles: module.exports.testStyles,
    get updates() { return updates; } };
}

function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap((child: any) => nodes(child, type))];
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("bundled policy exactly matches approved plain text, 24 headings and 74 paragraphs", () => {
  const { fallback } = screen();
  assert.equal(createHash("sha256").update(fallback.content).digest("hex"), approvedBodyHash);
  assert.equal(fallback.title, "Privacy Policy");
  assert.equal(fallback.subtitle, "Effective date: October 10, 2026 | Last updated: October 10, 2026 | Version: cs-privacy-3c00d841fa9fab08");
  const blocks: string[] = fallback.content.split("\n\n");
  const headings = blocks.filter(block => /^\d{2}\. /.test(block));
  assert.equal(headings.length, 24);
  assert.equal(blocks.length - headings.length, 74);
  headings.forEach((heading, index) => assert.ok(heading.startsWith(String(index + 1).padStart(2, "0") + ". ")));
  for (const contact of ["support@centralstudioco.com", "info@centralstudioco.com", "+20 120 181 3112", "53, Narges 3, New Cairo, Cairo, Egypt"]) assert.ok(fallback.content.includes(contact));
  assert.doesNotMatch(fallback.content, /privacy@centralstudio\.eg|XXXX XXXX|June 2026/);
});

test("successful CMS fetch remains authoritative and full text remains scrollable", async () => {
  const view = screen();
  assert.equal(nodes(view.initial, "ActivityIndicator").length, 1);
  assert.deepEqual(view.requests, [["/api/content/pages/privacy-policy"]]);
  const page = { title: "Privacy Policy", subtitle: "CMS publication", content: "Current CMS body" };
  view.fulfill(page); await flush();
  assert.equal(view.states[0], page);
  const tree = view.render();
  assert.equal(nodes(tree, "ScrollView").length, 1);
  const texts = nodes(tree, "Text");
  assert.ok(texts.some(node => node.children.includes(page.content)));
  assert.ok(texts.every(node => node.props.numberOfLines === undefined));
});

for (const reason of ["Network request failed", "HTTP 503"]) {
  test(`${reason} selects complete approved fallback without changing renderer`, async () => {
    const view = screen();
    view.reject(new Error(reason)); await flush();
    assert.equal(view.states[0], view.fallback);
    assert.equal(view.states[1], false);
    assert.ok(nodes(view.render(), "Text").some(node => node.children.includes(view.fallback.content)));
  });
}

for (const outcome of ["success", "failure"]) {
  test(`unmount suppresses late ${outcome} state updates`, async () => {
    const view = screen(); view.cleanup();
    if (outcome === "success") view.fulfill({ title: "late", content: "late" });
    else view.reject(new Error("late"));
    await flush();
    assert.equal(view.updates, 0);
  });
}

test("iOS and Android preserve existing plain-text styles and navigation structure", () => {
  for (const os of ["ios", "android"]) {
    const view = screen(os);
    assert.equal(view.styles.content.fontSize, 10);
    assert.equal(view.styles.content.lineHeight, 12);
    assert.equal(view.styles.fixedHero.height, 304);
    assert.equal(view.styles.contentContainer.paddingBottom, 32);
    assert.equal(nodes(view.initial, "ScrollView").length, 1);
  }
});
