import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as capacity from "../services/accountCapacity";
import * as privacy from "../services/childProfilePrivacy";
import * as errors from "../utils/userFacingError";
import * as previewModel from "../components/ballet/balletStudentPreviewModel";
import * as assessmentModel from "../components/ballet/balletAssessmentStateModel";
const require = createRequire(import.meta.url);
const ts = require("typescript");
export type UINode = { type: any; props: any; children: any[] };
export function nodes(tree: any, predicate: (node: UINode) => boolean): UINode[] {
  return !tree || typeof tree !== "object" ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((child: any) => nodes(child, predicate))];
}
export function text(tree: UINode): string {
  return (tree.children || []).map((child: any) => typeof child === "object" ? text(child) : String(child)).join("");
}
/** Executes the real production JSX/handlers with persistent hook slots.
 * Native layout and delivery remain device QA; effects run only when requested.
 */
export function capacityHarness(file: string, options: { context?: any; fetch?: any; services?: any } = {}) {
  let slots: any[] = [], cursor = 0, effects: any[] = [];
  const alerts: any[] = [], requests: any[] = [], storage = new Map<string, string>();
  const sameDeps = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const cleanups: any[] = [];
  const React: any = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    createContext: () => ({ Provider: "ContextProvider" }),
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value; return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(value: any) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(fn: any, deps: any[]) { const i = cursor++; if (!(i in slots) || !sameDeps(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback: (fn: any, deps: any[]) => React.useMemo(() => fn, deps),
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!(i in slots) || !sameDeps(slots[i], deps)) { slots[i] = deps; effects.push(fn); } },
  };
  const noop = () => {};
  const appStateListeners = new Set<(state: string) => void>();
  const native: any = { Platform: { OS: "ios" }, StyleSheet: { create: (x: any) => x, absoluteFill: {} }, AppState: { currentState: "active", addEventListener: (_: string, listener: (state: string) => void) => { appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) }; } }, useWindowDimensions: () => ({ width: 390 }), Animated: { Value: class { constructor(_: any) {} }, View: "AnimatedView" } };
  for (const name of ["View", "Text", "TouchableOpacity", "TextInput", "ScrollView", "Modal", "Switch", "KeyboardAvoidingView", "Image", "ActivityIndicator"]) native[name] = name;
  const context = options.context || {};
  const mocks = (name: string): any => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return native;
    if (name === "@/contexts/AppContext") return { useAppContext: () => context };
    if (name === "@/services/accountCapacity") return capacity;
    if (name === "@/services/childProfilePrivacy") return privacy;
    if (name === "@/utils/userFacingError") return errors;
    if (name.endsWith("balletStudentPreviewModel")) return previewModel;
    if (name.endsWith("balletAssessmentStateModel")) return assessmentModel;
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async (k: string) => storage.get(k) ?? null, setItem: async (k: string, v: string) => { storage.set(k, v); }, multiSet: async (pairs: string[][]) => { pairs.forEach(([k, v]) => storage.set(k, v)); }, removeItem: async (k: string) => { storage.delete(k); }, multiRemove: async (keys: string[]) => { keys.forEach(k => storage.delete(k)); } } };
    if (name === "@workspace/api-client-react") return { customFetch: async (url: string, init?: any) => { requests.push({ url, init }); return options.fetch?.(url, init) ?? []; } };
    if (name === "@/hooks/useCentralAlert") return { useCentralAlert: () => ({ show: (a: any) => alerts.push(a) }) };
    if (name === "@/components/BackgroundMusicProvider") return { useBackgroundMusic: () => ({ localEnabled: false, setLocalEnabled: noop }) };
    if (name === "@/services/balletAssessmentService") return { ...options.services, ACTIVE_APPLICATION_STATUSES: previewModel.CURRENT_BALLET_APPLICATION_STATUSES, isOfflineError: (e: any) => e instanceof TypeError };
    if (name === "@/services/logoutCoordinator") return { createLogoutCoordinator: () => async () => {} };
    if (name === "@tanstack/react-query") return { useQuery: () => ({ data: {} }) };
    if (name === "expo-router") return { router: { replace: noop }, useLocalSearchParams: () => ({}), useFocusEffect: (fn: any) => React.useEffect(fn, [fn]) };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "expo-haptics") return { impactAsync: noop, notificationAsync: noop, selectionAsync: noop, ImpactFeedbackStyle: { Medium: "medium" } };
    if (name === "@/utils/dateTime") return { formatApiDate: () => "", formatApiTime: () => "", parseApiDate: () => null };
    if (name === "@/constants/colors") return evaluate("constants/colors.ts");
    if (name === "@/utils/contactLinks") return { visibleContactLinks: () => [], isSocialContactLink: () => false, isDirectContactLink: () => false };
    if (name === "@/utils/iosTypography") return { iosCapGuard: () => 0, iosTextInputStyle: () => ({}), iosDisplayTextStyle: () => ({}) };
    if (name === "@/components/ballet/assessmentTokens") return { BA: {}, BA_RADIUS: {} };
    return new Proxy({ __esModule: true, default: name }, { get: (target: any, key: any) => key in target ? target[key] : String(key) });
  };
  function evaluate(path: string) {
    const module = { exports: {} as any };
    let source = readFileSync(resolve("artifacts/central", path), "utf8");
    if (path.endsWith("profile.tsx")) source += "\nexport { AddChildModal };";
    if (path.endsWith("assessment.tsx")) source += "\nexport { BalletAssessmentForm };";
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: mocks, console, Date, AbortController, setTimeout, clearTimeout });
    return module.exports;
  }
  const module = evaluate(file);
  return {
    module, alerts, requests, storage, context,
    foreground() { appStateListeners.forEach(fn => fn("active")); },
    unmount() { cleanups.forEach(fn => fn()); },
    render(fn: any, props: any = {}) { cursor = 0; effects = []; return fn(props); },
    async runEffects() { const pending = effects; effects = []; for (const fn of pending) { const cleanup = fn(); if (typeof cleanup === "function") cleanups.push(cleanup); } await new Promise(r => setImmediate(r)); },
  };
}
