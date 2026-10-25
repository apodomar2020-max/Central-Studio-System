import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve("artifacts/central");
type Node = { type: string; props: any; children: Node[] };

// Execute the real platform branches with lightweight host-element/hook stubs.
// This tests hierarchy and style policy, NOT UIKit glyph measurement.
function load(file: string, os: string, user: object | null = null, packageQuery: Record<string, unknown> = {}) {
  let cursor = 0;
  const query = { enabled: false, refetches: 0 };
  const navigation: unknown[] = [];
  const states: any[] = [];
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
  const React: any = {
    createElement(type: any, props: any, ...children: any[]) { if (type?.name === "ClassCardPresentation") return type(props); return { type, props: props || {}, children: children.flat(Infinity).filter(x => x !== false && x != null) }; },
    Fragment: "Fragment", memo: (fn: any) => fn, useEffect() {}, useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn, useRef: (current: any) => ({ current }),
    useState(value: any) { const i = cursor++; if (!(i in states)) states[i] = typeof value === "function" ? value() : value; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
  };
  const generic = new Proxy({ __esModule: true, default: "Stub" }, { get(target, key) { return key in target ? (target as any)[key] : () => undefined; } });
  const native = { Platform: { OS: os }, StyleSheet: { create: (s: any) => s, flatten, absoluteFill: {}, absoluteFillObject: {} }, Text: "Text", View: "View", TouchableOpacity: "TouchableOpacity", ScrollView: "ScrollView", TextInput: "TextInput", Image: "Image", ActivityIndicator: "ActivityIndicator" };
  const mocks = (name: string): any => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return { ...native, useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), UIManager: {}, Dimensions: { get: () => ({ width: 390, height: 844 }) }, Animated: { Value: class {}, event: () => () => {}, FlatList: "FlatList" }, RefreshControl: "RefreshControl" };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "@/utils/navigation") return { pushOnce: (target: unknown) => navigation.push(target) };
    if (name === "expo-haptics") return { impactAsync() {}, ImpactFeedbackStyle: { Light: "light" } };
    if (name === "expo-linear-gradient") return { LinearGradient: "LinearGradient" };
    if (name === "expo-glass-effect") return { GlassView: "GlassView" };
    if (name === "@workspace/api-client-react") return { normalizeMediaUrl: (s: any) => s, getGetMyPackagesQueryKey: () => ["/api/my-packages"], useGetMyPackages: (options: any) => { query.enabled = options.query.enabled; return { data: [], isLoading: false, isError: true, ...packageQuery, refetch: async () => { query.refetches++; } }; } };
    if (name === "expo-router/unstable-native-tabs") return { NativeTabs: Object.assign("NativeTabs", { Trigger: { Icon: "Icon", Label: "Label" } }) };
    if (name === "expo-router") return { useLocalSearchParams: () => ({}), useFocusEffect: (fn: any) => fn(), router: {} };
    if (name === "@/contexts/AppContext") return { useAppContext: () => ({ user, cancelPackage() {} }) };
    if (name === "@/hooks/useCentralAlert") return { useCentralAlert: () => ({ show() {} }) };
    if (name === "@/utils/packageAgeBands") return { parsePackageAgeBand: () => undefined };
    if (name === "@/utils/mediaRevision") return { withMediaRevision: (s: any) => s };
    if (name === "@/utils/bookingCardLayout") return evaluate("utils/bookingCardLayout.ts");
    if (name === "@/constants/classTags") return evaluate("constants/classTags.ts");
    if (name === "./colors" || name === "@/constants/colors") return evaluate("constants/colors.ts");
    if (name === "./BookingCard") return { ClassCardPresentation: "ClassCardPresentation", twentyFourHourTime: (time: string) => time?.slice(0, 5) || "--:--" };
    if (name === "@/utils/iosTypography") return evaluate("utils/iosTypography.ts");
    return generic;
  };
  function evaluate(path: string, extra = "") {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(resolve(root, path), "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: mocks, Date, setTimeout, clearTimeout, setInterval, clearInterval });
    return module.exports;
  }
  const styleName = /app\/ballet\/(levels|classes|faq|performances|instructors)\.tsx/.test(file) || file.includes("PackageVisualCard") ? "s" : "styles";
  const extra = file === "app/(tabs)/_layout.tsx" ? "\nexport const nativeLayout = NativeTabLayout;"
    : file === "app/ballet/requirements.tsx" ? "\nexport const accordion = RequirementAccordion;" : "";
  const module = evaluate(file, `\nexport const layoutStyles = ${file === "app/(tabs)/_layout.tsx" ? "{}" : styleName};` + extra);
  return { navigation, renderPresentation(props: any) { cursor = 0; return module.ClassCardPresentation(props) as Node; }, styles: module.layoutStyles, nativeLayout: module.nativeLayout, accordion: module.accordion, flatten, query, render(props: any = {}) { cursor = 0; return module.default(props) as Node; } };
}
function nodes(tree: any, predicate: (n: Node) => boolean): Node[] {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((n: Node) => nodes(n, predicate))];
}

test("Instructor name: parent-only iOS cap guard with unchanged absolute anchor and colored spans", () => {
  const ios = load("components/InstructorProfileView.tsx", "ios").styles;
  const android = load("components/InstructorProfileView.tsx", "android").styles;
  assert.equal(ios.name.fontSize, 38); assert.equal(ios.name.lineHeight, 42); assert.equal(ios.name.paddingTop, 3);
  assert.equal(android.name.paddingTop, undefined); assert.equal(android.name.fontSize, 38);
  for (const styles of [ios, android]) {
    assert.equal(styles.name.position, "absolute"); assert.equal(styles.name.bottom, 18);
    assert.equal(styles.name.left, "8%"); assert.equal(styles.name.right, "8%");
    assert.equal(styles.name.marginBottom, undefined); assert.equal(styles.hero.height, 455);
    assert.equal(styles.firstName.paddingTop, undefined); assert.equal(styles.lastName.paddingTop, undefined);
  }
  const source = readFileSync(resolve(root, "components/InstructorProfileView.tsx"), "utf8");
  assert.match(source, /<Text style=\{styles.name\} numberOfLines=\{2\} adjustsFontSizeToFit>[\s\S]*?<Text style=\{styles.firstName\}/);
  assert.match(source, /<Text style=\{styles.lastName\}> \{name.rest\}/);
});

test("Current package: guarded iOS labels and three-level expiry warning; Android unchanged", () => {
  const ios = load("app/package-center.tsx", "ios").styles;
  const android = load("app/package-center.tsx", "android").styles;
  for (const [name, size, line, guard] of [["packageName", 19, 20, 3], ["statusText", 16, 18, 1], ["expirationDate", 24, 25, 4]] as const) {
    assert.equal(ios[name].fontSize, size); assert.equal(ios[name].lineHeight, line);
    assert.equal(ios[name].paddingTop, guard); assert.equal(ios[name].marginBottom, -guard);
    assert.equal(android[name].fontSize, size); assert.equal(android[name].lineHeight, line);
    assert.equal(android[name].paddingTop, undefined); assert.equal(android[name].marginBottom, undefined);
  }
  assert.equal(ios.expirationBox.height, 60); assert.equal(ios.cardFooter.height, 60);
  assert.equal(ios.expirationBox.paddingVertical, 4);
  assert.equal(ios.expirationNote.marginBottom, 2); assert.equal(ios.expirationHelper.marginBottom, 3);
  assert.equal(android.expirationBox.height, 54); assert.equal(android.cardFooter.height, 54);
  assert.equal(android.expirationNote.marginBottom, undefined); assert.equal(android.expirationHelper.marginBottom, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(ios.statusCard)), JSON.parse(JSON.stringify(android.statusCard)));
  assert.equal(ios.creditNumber.fontSize, 86); assert.equal(ios.creditNumber.lineHeight, 102);
  assert.equal(ios.creditNumber.paddingTop, 0); assert.equal(ios.creditNumber.marginBottom, -28);
  assert.equal(android.creditNumber.lineHeight, 82);
  assert.equal(android.creditNumber.marginBottom, undefined);
  assert.equal(ios.creditHero.height, 92); assert.equal(ios.progressTrack.marginTop, 8);
  assert.equal(ios.ownerName.fontSize, 22); assert.equal(ios.ownerName.lineHeight, 24);
  assert.equal(ios.ownerName.paddingTop, 2); assert.equal(ios.ownerName.marginBottom, -2);
  assert.equal(android.ownerName.paddingTop, undefined); assert.equal(android.ownerName.marginBottom, undefined);
  assert.equal(ios.trashButton.height, 54);
});

test("Package Center catalog heading: protected iOS caps, exact Android font retained", () => {
  const ios = load("components/AvailablePackagesSection.tsx", "ios").styles.centerTitle;
  const android = load("components/AvailablePackagesSection.tsx", "android").styles.centerTitle;
  assert.equal(ios.fontSize, 28); assert.equal(ios.lineHeight, 31);
  assert.equal(ios.paddingTop, 3); assert.equal(ios.marginBottom, -3);
  assert.equal(android.fontSize, 28); assert.equal(android.lineHeight, 31);
  assert.equal(android.paddingTop, undefined); assert.equal(android.marginBottom, undefined);
});

test("Ballet schedule: guarded typography and content-driven layout on iOS and Android", () => {
  const ios = load("components/ballet/BalletScheduleCard.tsx", "ios").styles;
  const android = load("components/ballet/BalletScheduleCard.tsx", "android").styles;
  assert.equal(ios.time.fontSize, 52); assert.equal(ios.time.lineHeight, 55);
  assert.equal(ios.time.paddingTop, 7); assert.equal(ios.time.marginBottom, -7);
  assert.equal(ios.time.color, "#00B6D7"); assert.equal(ios.time.width, "100%");
  assert.equal(ios.time.textAlign, "right");
  assert.equal(android.time.paddingTop, undefined); assert.equal(android.time.marginBottom, undefined);
  assert.equal(android.time.fontSize, 52); assert.equal(android.time.lineHeight, 55);
  for (const key of ["card", "panelShell", "panelContent", "detailsRow", "classInfoColumn", "infoRow", "timeColumn", "weekday", "countdownPill", "reminderButton", "statusPill"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(ios[key])), JSON.parse(JSON.stringify(android[key])));
  }
  assert.equal(ios.imageArea.height, 214);
  assert.equal(ios.imageArea.position, "absolute");
  assert.equal(ios.card.minHeight, 306); assert.equal(ios.panelShell.minHeight, 162);
  assert.equal(ios.card.height, undefined); assert.equal(ios.panelShell.height, undefined);
  assert.equal(ios.foreground.paddingTop + ios.countdownPill.height, 140);
  assert.equal(ios.panelShell.position, undefined);
  assert.equal(ios.countdownPill.position, undefined);
  assert.equal(ios.className.fontSize, 24); assert.equal(ios.className.lineHeight, 27);
  assert.equal(ios.className.paddingTop, 2); assert.equal(ios.className.marginBottom, 3);
  assert.equal(ios.venueSpacing.marginTop, 5);
  assert.equal(ios.infoRow.minHeight, 25); assert.equal(ios.detailsRow.flex, undefined);
  assert.equal(ios.panelContent.paddingHorizontal, 16);
  assert.equal(ios.reminderButton.marginTop, 6); assert.equal(ios.reminderButton.minHeight, 42);
  assert.equal(android.className.marginBottom, 5); assert.equal(android.className.paddingTop, undefined);
  assert.equal(android.venueSpacing.marginTop, 5);
  assert.equal(ios.panelContent.paddingTop, 14); assert.equal(ios.panelContent.paddingBottom, 12);
  // Native text can exceed nominal line heights. Metadata must determine
  // the row height, with the CTA following it rather than claiming its space.
  assert.equal(ios.panelContent.flex, undefined);
  assert.equal(ios.reminderButton.position, undefined);
  assert.equal(ios.detailsRow.height, undefined);
  assert.equal(ios.detailsRow.minHeight, undefined);
  assert.equal(ios.foreground.paddingHorizontal, 12);
  assert.equal(ios.foreground.paddingBottom, 4);
  const source = readFileSync(resolve(root, "components/ballet/BalletScheduleCard.tsx"), "utf8");
  assert.match(source, /style=\{\[styles.infoRow, styles.venueSpacing\]\}[\s\S]*?<View style=\{styles.locationSlot\}/);
});

for (const file of ["app/ballet/requirements.tsx", "app/ballet/levels.tsx", "app/ballet/instructors.tsx", "app/ballet/classes.tsx", "app/ballet/faq.tsx", "app/ballet/performances.tsx"]) test(`${file}: tight iOS heading lines with top-only cap accommodation; Android retained`, () => {
  const ios = load(file, "ios").styles.heroTitle;
  const android = load(file, "android").styles.heroTitle;
  assert.equal(ios.fontSize, 44); assert.equal(ios.fontFamily, "Anton_400Regular");
  assert.equal(ios.lineHeight, 40); assert.equal(ios.paddingTop, 12);
  assert.equal(ios.includeFontPadding, false); assert.equal("marginTop" in ios, false);
  assert.equal(ios.marginBottom, 8 - ios.paddingTop);
  assert.equal(android.fontSize, 44); assert.equal(android.fontFamily, "Anton_400Regular");
  assert.equal(android.marginBottom, 8); assert.equal(android.includeFontPadding, undefined);
  assert.equal(android.lineHeight, 40); assert.equal(android.marginTop, -0); assert.equal(android.paddingTop, undefined);
});
test("Help: content-sized iOS hero/search flow; Android fixed hero and floating search retained", () => {
  const ios = load("app/help-support.tsx", "ios").styles;
  const android = load("app/help-support.tsx", "android").styles;
  assert.equal(ios.hero.minHeight, 267); assert.equal(ios.hero.height, undefined);
  assert.equal(ios.heroTitle.fontSize, 72); assert.equal(ios.heroTitle.lineHeight, 68);
  assert.equal(ios.heroTitle.paddingTop, 17); assert.equal(ios.heroTitle.marginBottom, -17);
  assert.equal(ios.heroTitleWrap.marginHorizontal, 50); assert.equal(ios.searchBox.marginHorizontal, 50);
  assert.equal(ios.searchBox.position, undefined); assert.equal(ios.searchBox.height, undefined); assert.equal(ios.searchBox.minHeight, 43);
  assert.equal(android.hero.height, 267); assert.equal(android.heroTitle.lineHeight, 68);
  assert.equal(android.searchBox.position, "absolute"); assert.equal(android.searchBox.bottom, -21); assert.equal(android.searchBox.height, 43);
});
test("Help: topics use one horizontal carousel with readable touch targets on iOS and Android", () => {
  const ios = load("app/help-support.tsx", "ios");
  const android = load("app/help-support.tsx", "android");
  assert.equal(ios.styles.iosTopic.minHeight, 44);
  assert.equal(ios.styles.iosTopic.maxWidth, "100%");
  assert.equal(ios.styles.topicText.fontSize, 13);
  for (const platform of [ios, android]) {
    const horizontalRows = nodes(platform.render(), n => n.type === "ScrollView" && n.props.horizontal);
    assert.equal(horizontalRows.length, 1);
    assert.equal(horizontalRows[0].props.contentContainerStyle, platform.styles.topicList);
    assert.equal(horizontalRows[0].props.style, platform.styles.topicScroller);
  }
  assert.equal(ios.styles.topicList.paddingHorizontal, 17);
  assert.equal(ios.styles.topicList.paddingRight, 34);
  assert.equal(ios.styles.topicList.gap, 5);
  assert.equal(android.styles.topic.minHeight, 34);
});
for (const [name, sessions] of [["Adult Starter Pass", 4], ["Adult Momentum Pass", 8], ["Adult Power Pass", 12], ["A deliberately long package title that may use graceful ellipsis", 120], ["Adult Unlimited Package", null]] as const) test(`Package: independent two-line iOS title and public metrics — ${name}`, () => {
  const props = { pkg: { name, sessions, priceEgp: 1500, ageRangeLabel: "ADULT", cardImageUrl: null, isFeatured: sessions === 8 }, onPress() {} };
  const ios = load("components/PackageVisualCard.tsx", "ios"); const tree = ios.render(props);
  const title = nodes(tree, n => n.type === "Text" && n.children[0] === name)[0];
  assert.equal(title.props.numberOfLines, 2); assert.equal(title.props.accessibilityLabel, name);
  assert.equal(ios.flatten(title.props.style).fontSize, 27); assert.equal(ios.flatten(title.props.style).alignSelf, "stretch");
  assert.equal(ios.flatten(title.props.style).lineHeight, 29);
  assert.equal(ios.flatten(title.props.style).paddingTop, 3);
  assert.equal(ios.flatten(title.props.style).marginBottom, -3);
  assert.equal(ios.styles.iosMetricsRow.alignItems, "center");
  if (sessions != null) {
    const numeral = nodes(tree, n => n.type === "Text" && n.children[0] === sessions)[0];
    assert.equal(ios.flatten(numeral.props.style).fontSize, 82);
    assert.equal(ios.flatten(numeral.props.style).lineHeight, 74);
    assert.equal(ios.flatten(numeral.props.style).paddingTop, 23);
    assert.equal(ios.flatten(numeral.props.style).marginBottom, -23);
  }
  const gradient = nodes(tree, n => n.type === "LinearGradient" && n.props.onLayout)[0];
  assert.equal(ios.flatten(gradient.props.style).height, "auto"); assert.equal(ios.flatten(tree.props.style).width, 232);
  assert.equal(ios.flatten(tree.props.style).height, 320);
  if (props.pkg.isFeatured) {
    const badge = nodes(tree, n => n.type === "View" && n.props.style === ios.styles.featuredBadge)[0];
    badge.props.onLayout({ nativeEvent: { layout: { height: 60 } } });
  }
  gradient.props.onLayout({ nativeEvent: { layout: { height: 410 } } });
  assert.equal(ios.flatten(ios.render(props).props.style).height, props.pkg.isFeatured ? 494 : 410);
  const metrics = nodes(tree, n => n.type === "View" && ios.flatten(n.props.style).flexWrap === "wrap")[0];
  assert.equal(nodes(metrics, n => n === title).length, 0);
  assert.ok(nodes(metrics, n => n.type === "Text" && n.children[0] === (sessions == null ? "UNLIMITED" : sessions)).length);
  const android = load("components/PackageVisualCard.tsx", "android"); const a = android.render(props);
  const row = nodes(a, n => n.type === "View" && n.props.style === android.styles.overlayRow)[0];
  assert.equal(row.children[0].props.style, android.styles.overlayLeft); assert.equal(row.children[1].props.style, android.styles.overlayRight);
  assert.equal(android.flatten(a.props.style).height, 320); assert.equal(android.flatten(a.props.style).width, 232);
  assert.equal(android.styles.name.fontSize, 27);
  assert.equal(android.styles.name.lineHeight, 29);
  assert.equal(android.styles.name.paddingTop, undefined);
  assert.equal(android.styles.sessionsNum.marginBottom, undefined);
  assert.equal(android.styles.overlayRow.alignItems, "flex-end");
});
for (const title of ["Commercial", "Commercial — Ladies Only", "A genuinely long booking title"]) test(`Booking: full-width accessible iOS title; original Android columns — ${title}`, () => {
  const props = { item: { className: title, date: "2026-10-06", time: "18:00", bookingStatus: "confirmed", paymentStatus: "paid" } };
  const ios = load("components/BookingCard.tsx", "ios"); const tree = ios.render(props);
  const content = nodes(tree, n => n.type === "View" && Array.isArray(n.props.style) && n.props.style.includes(ios.styles.iosPanelContent))[0];
  assert.equal(content.children[0].type, "Text"); assert.equal(content.children[0].children[0], title);
  assert.equal(content.children[0].props.numberOfLines, undefined); assert.equal(content.children[0].props.accessibilityLabel, title);
  assert.equal(ios.styles.className.fontSize, 27); assert.equal(ios.styles.className.lineHeight, 31);
  assert.equal(ios.styles.className.paddingTop, 1); assert.equal(ios.styles.className.marginBottom, 6);
  // Guard adds one point to the text box, compensated locally: metadata stays put.
  assert.equal(ios.styles.className.paddingTop + ios.styles.className.marginBottom, 7);
  assert.equal(content.children[1].type, "View"); assert.equal(content.children[1].children.length, 2);
  assert.equal(ios.flatten(content.props.style).flex, 0); assert.equal(ios.styles.iosPanelShell.height, "auto");
  content.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
  assert.equal(ios.flatten(ios.render(props).props.style).height, 470);
  const android = load("components/BookingCard.tsx", "android"); const a = android.render(props);
  const column = nodes(a, n => n.props.style === android.styles.classInfoColumn)[0];
  assert.equal(column.children[0].type, "Text"); assert.equal(column.children[0].props.numberOfLines, undefined);
  assert.equal(android.styles.classInfoColumn.width, "56%"); assert.equal(android.styles.className.fontSize, 27);
  assert.equal(android.styles.className.lineHeight, 31); assert.equal(android.styles.className.paddingTop, undefined);
  assert.equal(android.styles.className.marginBottom, 7);
  assert.equal(android.styles.panelShell.height, "52%");
});
test("No scaling disable/cap, global helper edit or diagnostic dependency in scoped components", () => {
  for (const file of ["app/ballet/requirements.tsx", "app/ballet/levels.tsx", "app/help-support.tsx", "components/PackageVisualCard.tsx", "components/BookingCard.tsx"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(source, /allowFontScaling=\{false\}|maxFontSizeMultiplier|IosTypographyDiagnostic|TYPOGRAPHY_DIAGNOSTIC/);
  }
});

for (const os of ["ios", "android"]) {
  test(`Discovery ${os}: compact absent/blank/failed media, original image layout, and recycled URI recovery`, () => {
    const card = load("components/DiscoveryClassCard.tsx", os);
    const item = { id: "fixture", title: "Commercial — Ladies Only", date: "2026-10-10", categoryName: "Commercial", level: "All Levels", ageGroup: "Adults", status: "available", price: 450 };
    const mediaHeight = (tree: Node) => card.flatten(nodes(tree, n => n.type === "View" && Array.isArray(n.props.style) && n.props.style.includes(card.styles.imageArea))[0].props.style).height;
    for (const photoUrl of [undefined, null, "", "   "]) assert.equal(mediaHeight(card.render({ item: { ...item, photoUrl } })), 64);
    const props = { item: { ...item, photoUrl: "https://example.com/class.jpg" } };
    const withMedia = card.render(props);
    assert.equal(mediaHeight(withMedia), 174);
    const image = nodes(withMedia, n => n.type === "Image" && n.props.onError)[0];
    image.props.onError();
    const failed = card.render(props);
    assert.equal(mediaHeight(failed), 64);
    assert.equal(nodes(failed, n => n.type === "Image" && n.props.onError).length, 0);
    assert.equal(mediaHeight(card.render({ item: { ...item, photoUrl: "https://example.com/replacement.jpg" } })), 174);
    assert.equal(card.styles.compactInfoPanelShell.marginTop, -16);
  });
  test(`Package Center ${os}: guests suppress account query/focus/refresh but retain public catalog`, async () => {
    const guest = load("app/package-center.tsx", os);
    const tree = guest.render();
    assert.equal(guest.query.enabled, false); assert.equal(guest.query.refetches, 0);
    assert.ok(nodes(tree, n => n.type === "Text" && n.children[0] === "YOUR PACKAGES").length);
    assert.equal(nodes(tree, n => n.type === "Text" && n.children[0] === "COULDN'T LOAD PACKAGES").length, 0);
    const scroll = nodes(tree, n => n.type === "ScrollView")[0];
    await scroll.props.refreshControl.props.onRefresh();
    assert.equal(guest.query.refetches, 0);
    const source = readFileSync(resolve(root, "app/package-center.tsx"), "utf8");
    assert.match(source, /<AvailablePackagesSection/);
    const authenticated = load("app/package-center.tsx", os, { id: "test-fixture" });
    const accountTree = authenticated.render();
    assert.equal(authenticated.query.enabled, true); assert.equal(authenticated.query.refetches, 1);
    await nodes(accountTree, n => n.type === "ScrollView")[0].props.refreshControl.props.onRefresh();
    assert.equal(authenticated.query.refetches, 2);
    assert.equal(nodes(accountTree, n => n.type === "Text" && n.children[0] === "YOUR PACKAGES").length, 0);
  });
  for (const title of ["Lyrical", "Intermediate Choreography", "Commercial — Ladies Only"]) test(`Discovery ${os}: full-width title and uncapped metadata — ${title}`, () => {
    const card = load("components/DiscoveryClassCard.tsx", os);
    const metadata = ["An instructor with a meaningfully long name", "Commercial & Hip-hop", "Commercial", "Intermediate", "13–30"];
    const tree = card.render({ item: { id: "fixture", title, date: "2026-10-13", description: "A list summary", categoryName: metadata[2], level: metadata[3], ageGroup: "Adults", ageRangeLabel: metadata[4], status: "available", price: 450 }, instructor: { name: metadata[0], title: metadata[1] } });
    const heading = nodes(tree, n => n.type === "Text" && n.children[0] === title)[0];
    assert.equal(heading.props.numberOfLines, 2);
    assert.equal(card.styles.title.width, undefined);
    assert.equal(card.styles.card.height, undefined);
    assert.equal(card.styles.infoPanelShell.position, undefined);
    assert.equal(card.styles.dateColumn.position, undefined);
    assert.equal(card.styles.tags.flexWrap, "wrap");
    for (const text of metadata) {
      const node = nodes(tree, n => n.type === "Text" && n.children[0] === text)[0];
      assert.ok(node, text); assert.equal(node.props.numberOfLines, undefined);
    }
  });
  test(`Discovery ${os}: protected day, padded glass and compact two-line summary`, () => {
    const card = load("components/DiscoveryClassCard.tsx", os);
    const description = "A long list description that remains available in full on the detail screen.";
    const tree = card.render({ item: { id: "fixture", title: "Commercial — Ladies Only", date: "2026-10-10", description, categoryName: "Commercial", level: "All Levels", ageGroup: "Adults", status: "available", price: 450 }, instructor: { name: "Ariana", title: "Commercial & Hip-hop" } });
    const summary = nodes(tree, n => n.type === "Text" && n.children[0] === description)[0];
    assert.equal(summary.props.numberOfLines, 2);
    assert.equal(summary.props.ellipsizeMode, "tail");
    assert.equal(card.styles.day.fontSize, 66);
    assert.equal(card.styles.day.lineHeight, 68);
    assert.equal(card.styles.day.paddingTop, os === "ios" ? 10 : undefined);
    assert.equal(card.styles.day.marginBottom, os === "ios" ? -10 : -0);
    assert.equal(card.styles.infoPanelContent.paddingHorizontal, 16);
    assert.equal(card.styles.infoPanelContent.paddingVertical, 12);
    assert.equal(card.styles.card.minHeight, undefined);
    const copy = nodes(tree, n => n.props.style === card.styles.copyColumn)[0];
    assert.ok(nodes(copy, n => n.props.style === card.styles.instructor).length);
    const footer = nodes(tree, n => n.props.style === card.styles.footer)[0];
    assert.equal(nodes(footer, n => n.props.style === card.styles.instructor).length, 0);
    assert.ok(nodes(footer, n => n.props.style === card.styles.tags).length);
    assert.equal(card.styles.imageArea.height, 174);
    assert.equal(card.styles.compactImageArea.height, 64);
    assert.equal(card.styles.priceRail.height, 28);
  });
  test(`Booking ${os}: uncapped venue and measured panel growth`, () => {
    const card = load("components/BookingCard.tsx", os);
    const venue = "Central Studio — Room A — Additional rehearsal wing";
    const props = { item: { className: "Ballet Foundations", location: venue, date: "2026-10-06", time: "18:00", bookingStatus: "confirmed", paymentStatus: "paid" } };
    const tree = card.render(props);
    const row = nodes(tree, n => n.props.style === card.styles.venueRow)[0];
    assert.ok(row); assert.equal(card.styles.venueRow.width, undefined);
    const text = nodes(row, n => n.type === "Text" && n.children[0] === venue)[0];
    assert.ok(text); assert.equal(text.props.numberOfLines, undefined);
    const panel = nodes(tree, n => n.props.onLayout && card.flatten(n.props.style).flex === 0)[0];
    assert.ok(panel); panel.props.onLayout({ nativeEvent: { layout: { height: 480 } } });
    assert.equal(card.flatten(card.render(props).props.style).height, 550);
  });
}

test("Ballet menu: all six compact guarded iOS lockups; exact Android typography retained", () => {
  const ios = load("app/ballet/index.tsx", "ios").styles;
  const android = load("app/ballet/index.tsx", "android").styles;
  assert.equal(ios.menuTitleLine.lineHeight, undefined);
  assert.equal(ios.menuTitleNarrowLine.lineHeight, undefined);
  assert.equal(android.menuTitleLine.lineHeight, 25);
  assert.equal(android.menuTitleNarrowLine.lineHeight, 21);
  assert.equal(ios.menuTitleCompact.lineHeight, 25);
  assert.equal(ios.menuTitleCompact.paddingTop, 5);
  assert.equal(ios.menuTitleCompact.marginBottom, -5);
  assert.equal(Object.keys(android.menuTitleCompact).length, 0);
  assert.equal(ios.menuTitleNarrowCompact.lineHeight, 21);
  assert.equal(ios.menuTitleNarrowCompact.paddingTop, 3);
  assert.equal(ios.menuTitleNarrowCompact.marginBottom, -3);
  assert.equal(ios.menuTitleNarrowLine.fontSize, 20);
  assert.equal(Object.keys(android.menuTitleNarrowCompact).length, 0);
  const source = readFileSync(resolve(root, "app/ballet/index.tsx"), "utf8");
  assert.match(source, /const compactTitleStyle = kind === "instructors" \? styles.menuTitleNarrowCompact : styles.menuTitleCompact;/);
  assert.equal((source.match(/, compactTitleStyle\]/g) || []).length, 2);
  assert.equal(ios.balletProgramTitle.fontSize, 36); assert.equal(ios.balletProgramTitle.lineHeight, 35);
  assert.equal(ios.balletProgramTitle.paddingTop, 8); assert.equal(ios.balletProgramTitle.marginBottom, -8);
  assert.equal(android.balletProgramTitle.paddingTop, undefined); assert.equal(android.balletProgramTitle.marginBottom, undefined);
  assert.equal(ios.balletLockup.height, 78); assert.equal(ios.balletLogo.top, -32);
});

for (const fixture of [
  { className: "Commercial — Ladies Only", time: "21:15", paymentStatus: "pending_payment" },
  { className: "A longer scheduled rehearsal class title", time: "08:30", paymentStatus: "paid" },
  { className: "Jazz", time: "00:05", paymentStatus: "failed" },
]) test(`Scheduled card: compact iOS metadata and protected time — ${fixture.time}`, () => {
  const props = { item: { ...fixture, date: "2026-10-10", instructorName: "Ariana", location: "Main Branch", bookingStatus: "confirmed" } };
  const ios = load("components/BookingCard.tsx", "ios");
  const tree = ios.render(props);
  const column = nodes(tree, n => n.props.style === ios.styles.classInfoColumn)[0];
  assert.equal(column.children[0].props.label, "Instructor");
  assert.equal(column.children[1].props.style, ios.styles.venueRow);
  assert.equal(ios.styles.venueRow.marginTop, 8);
  const time = nodes(tree, n => n.type === "Text" && n.children[0] === fixture.time)[0];
  assert.ok(time); assert.equal(time.props.numberOfLines, 1);
  assert.equal(ios.styles.classTime.fontSize, 56); assert.equal(ios.styles.classTime.lineHeight, 60);
  assert.equal(ios.styles.classTime.paddingTop, 7); assert.equal(ios.styles.classTime.marginBottom, -7);
  const panel = nodes(tree, n => Array.isArray(n.props.style) && n.props.style.includes(ios.styles.iosPanelInsets))[0];
  const inset = ios.flatten(panel.props.style);
  assert.equal(inset.paddingHorizontal, 18); assert.equal(inset.paddingTop, 14);
  assert.equal(inset.paddingBottom, ios.styles.countdownPill.minHeight + 14);
  assert.equal(nodes(tree, n => n.props.style === ios.styles.venueRow).length, 1);
  const android = load("components/BookingCard.tsx", "android");
  const a = android.render(props);
  const aColumn = nodes(a, n => n.props.style === android.styles.classInfoColumn)[0];
  assert.equal(nodes(aColumn, n => n.props.style === android.styles.venueRow).length, 0);
  assert.equal(android.styles.classTime.paddingTop, undefined);
  assert.equal(android.styles.classTime.marginBottom, undefined);
  const aPanel = nodes(a, n => Array.isArray(n.props.style) && n.props.style.includes(android.styles.iosPanelContent))[0];
  assert.equal(android.flatten(aPanel.props.style).paddingHorizontal, 16);
  assert.equal(android.flatten(aPanel.props.style).paddingTop, 10);
  assert.equal(android.flatten(aPanel.props.style).paddingBottom, 44);
});

test("Native tabs use template PNG sources with correctly scaled assets, not custom React elements", () => {
  const source = readFileSync(resolve(root, "app/(tabs)/_layout.tsx"), "utf8");
  const native = source.slice(source.indexOf("function NativeTabLayout"), source.indexOf("function ClassicTabLayout"));
  assert.doesNotMatch(native, /src=\{<NavGlyph/);
  assert.equal((native.match(/renderingMode="template"/g) || []).length, 4);
  for (const name of ["home", "classes", "bookings", "profile"]) {
    assert.ok(native.includes(`native-tabs/${name}.png`));
    for (const [suffix, scale] of [["", 1], ["@2x", 2], ["@3x", 3]] as const) {
      const png = readFileSync(resolve(root, `assets/images/native-tabs/${name}${suffix}.png`));
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 24 * scale); assert.equal(png.readUInt32BE(20), 24 * scale);
      assert.equal(png[25], 6, "RGBA asset retains transparency");
    }
  }
  assert.match(source, /tabBarIcon:.*<NavGlyph/s);
});

for (const file of ["app/help-support.tsx", "app/(tabs)/classes.tsx"]) test(`${file}: keyboard-aware scrolling is iOS-only`, () => {
  const source = readFileSync(resolve(root, file), "utf8");
  assert.match(source, /Platform\.OS === "ios" \? KeyboardAwareScrollView : ScrollView/);
  assert.match(source, /keyboardShouldPersistTaps="handled"/);
  assert.match(source, /keyboardDismissMode="interactive"/);
  assert.doesNotMatch(source, /<KeyboardAvoidingView/);
});


test("native tabs remain mounted when root content hides the tab bar", () => {
  const { nativeLayout } = load("app/(tabs)/_layout.tsx", "ios");
  const original = nativeLayout({ hidden: false });
  assert.ok(original);
  for (let visit = 0; visit < 3; visit++) {
    const covered = nativeLayout({ hidden: true });
    assert.ok(covered, "hiding tabs must not remove their navigator");
    assert.equal(covered.type, original.type);
    assert.equal(covered.props.hidden, true);
    assert.equal(covered.children.length, 4);
    const restored = nativeLayout({ hidden: false });
    assert.equal(restored.type, original.type);
    assert.equal(restored.props.hidden, false);
    assert.equal(restored.children.map((n: Node) => n.props.name).join(","), "index,classes,bookings,profile");
  }
});

test("Ballet Requirements chevron and body follow the same expanded state", () => {
  const { accordion } = load("app/ballet/requirements.tsx", "ios");
  const section = { id: 1, title: "Welcome to Central Ballet", description: "Preparation notes", items: [] };
  let presses = 0;
  for (const isExpanded of [false, true, false]) {
    const tree = accordion({ section, isExpanded, onPress: () => presses++ });
    const button = nodes(tree, n => n.props.accessibilityRole === "button")[0];
    assert.equal(button.props.accessibilityState.expanded, isExpanded);
    assert.equal(nodes(tree, n => n.props.name === (isExpanded ? "chevron-up-outline" : "chevron-down-outline")).length, 1);
    assert.equal(nodes(tree, n => n.type === "Text" && n.children[0] === section.description).length, isExpanded ? 1 : 0);
    button.props.onPress();
  }
  assert.equal(presses, 3);
});

for (const os of ["ios", "android"]) {
  test(`${os}: detail typography retains fonts while schedule panels can grow with content`, () => {
    for (const file of ["app/class/[id].tsx", "components/BookingDetailsView.tsx"]) {
      const view = load(file, os);
      assert.equal(view.styles.title.fontFamily, "Anton_400Regular");
      assert.equal(view.styles.title.fontSize, 34);
      assert.equal(view.styles.title.lineHeight, 38);
      assert.equal(view.styles.title.paddingTop, os === "ios" ? 3 : undefined);
      assert.equal(view.styles.schedulePanel.height, undefined);
      assert.ok(view.styles.schedulePanel.minHeight >= 78);
    }
    const empty = load("app/package-center.tsx", os).styles.nothingTitle;
    assert.equal(empty.fontSize, 39);
    assert.equal(empty.paddingTop, os === "ios" ? 5 : undefined);
  });
}

for (const os of ["ios", "android"]) test(`${os}: catalogue reference variant retains availability, occurrence, price and tags without payment fiction`, () => {
  const card = load("components/DiscoveryClassCard.tsx", os);
  for (const [status, expected] of [["available", "Available"], ["fewSeats", "Few Seats"], ["full", "Full"], ["cancelled", "Cancelled"], ["unavailable", "Unavailable"], ["waitingList", "Waitlist"]]) {
    const item = { id: "class", scheduleId: "schedule", title: "Afro Choreography", date: "2026-10-21", startTime: "21:15:00", categoryName: "Afro", level: "Beginner", ageGroup: "Adults", ageRangeLabel: "18+", status, price: 450 };
    let selected: unknown;
    const tree = card.render({ item, presentation: "bookingReference", onSelect: (value: unknown) => { selected = value; }, instructor: { name: "Avatar" } });
    assert.equal(tree.type, "ClassCardPresentation");
    assert.equal(tree.props.status.label, expected);
    assert.equal(tree.props.dateLabel, "21 OCT 2026");
    assert.equal(tree.props.timeLabel, "21:15");
    assert.equal(tree.props.railLabel, expected);
    assert.equal(tree.props.railColor, "#00B6D7");
    assert.equal(tree.props.priceLabel, "Walk-In: 450 EGP");
    const view = load("components/BookingCard.tsx", os);
    const presented = view.renderPresentation(tree.props);
    const pill = nodes(presented, n => n.type === "Text" && Array.isArray(n.props.style) && n.props.style.includes(view.styles.statusText))[0];
    assert.equal(pill.children[0], "Walk-In: 450 EGP");
    assert.equal(nodes(presented, n => n.props.style === view.styles.paymentRailText)[0].children[0], expected);
    assert.equal(tree.props.countdown, undefined);
    assert.equal(tree.props.item.instructorName, "Avatar");
    tree.props.onPress();
    assert.equal(selected, item);
    const tags = nodes(tree.props.tags, n => n.type === "Text").map(n => n.children[0]);
    assert.deepEqual(tags, ["Afro", "Beginner", "18+"]);
  }
});

for (const os of ["ios", "android"]) test(`${os}: package empty illustration is limited to successful zero-visible-package results`, () => {
  for (const fixture of [
    { data: [], isLoading: true, isError: false, empty: false },
    { data: [], isLoading: false, isError: true, empty: false },
    { data: [], isLoading: false, isError: false, empty: true },
    { data: [{ id: 1, status: "active", remainingCredits: 0 }], isLoading: false, isError: false, empty: false },
    { data: [{ id: 2, status: "pending" }], isLoading: false, isError: false, empty: false },
  ]) {
    const screen = load("app/package-center.tsx", os, { id: "owner" }, fixture);
    const tree = screen.render();
    const empties = nodes(tree, n => typeof n.type === "function" && (n.type as Function).name === "NothingYetCard");
    assert.equal(empties.length, fixture.empty ? 1 : 0);
    assert.equal(screen.styles.statusCard.height, 392);
    assert.equal(screen.styles.statusCard.width, 322);
    if (fixture.empty) {
      const content = (empties[0].type as unknown as () => Node)();
      assert.ok(nodes(content, n => n.type === "Text" && n.children[0] === "BUY PACKAGE").length);
      assert.ok(nodes(content, n => n.type === "Text" && n.children[0] === "To track your package credits").length);
    }
  }
});

for (const os of ["ios", "android"]) test(`${os}: catalogue price fallback remains visible in the existing pill and both entry points select the shared variant`, () => {
  const card = load("components/DiscoveryClassCard.tsx", os);
  const item = { title: "Class", status: "available", date: "2026-10-21", startTime: "21:15", price: 0 };
  const tree = card.render({ item, presentation: "bookingReference" });
  assert.equal(tree.props.railLabel, "Available");
  assert.equal(tree.props.priceLabel, "Walk-In: TBC");
  for (const path of ["app/(tabs)/classes.tsx", "app/(tabs)/index.tsx"]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.match(source, /<DiscoveryClassCard\s+presentation="bookingReference"/);
  }
});

for (const os of ["ios", "android"]) test(`${os}: booking payment rail and status pill retain their actual payment semantics`, () => {
  const view = load("components/BookingCard.tsx", os);
  for (const [paymentStatus, expected, color] of [["paid", "Paid", "#269134"], ["pending_payment", "Pending Payment", "#E2AA00"]]) {
    const tree = view.render({ item: { className: "Afro", date: "2026-10-21", time: "21:15", bookingStatus: "confirmed", paymentStatus } });
    assert.equal(nodes(tree, n => n.props.style === view.styles.paymentRailText)[0].children[0], expected);
    assert.equal(view.flatten(tree.props.style).backgroundColor, color);
    const pill = nodes(tree, n => n.type === "Text" && Array.isArray(n.props.style) && n.props.style.includes(view.styles.statusText))[0];
    assert.equal(pill.children[0], "Available");
  }
});

for (const os of ["ios", "android"]) test(`${os}: catalogue default navigation retains the exact selected class and schedule`, () => {
  const card = load("components/DiscoveryClassCard.tsx", os);
  const item = { id: "class-12", scheduleId: "schedule-34", status: "available", date: "2026-10-21", startTime: "21:15", price: 450 };
  card.render({ item, presentation: "bookingReference" }).props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(card.navigation)), [{ pathname: "/class/[id]", params: { id: "class-12", scheduleId: "schedule-34" } }]);
});
