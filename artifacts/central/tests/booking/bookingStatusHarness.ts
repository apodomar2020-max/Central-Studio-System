import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as bookingStatus from "../../utils/bookingStatus";
import * as eligibility from "../../utils/bookingCancellationEligibility";

const require = createRequire(import.meta.url);
const ts = require("typescript");
export type Node = { type: any; props: any; children: any[] };
export function nodes(tree: any, predicate: (node: Node) => boolean): Node[] {
  return !tree || typeof tree !== "object" ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((child: any) => nodes(child, predicate))];
}
// Execute production JSX and event handlers; native layout/delivery is outside this harness.
export function loadStatusUI(file: string, os = "ios", booking?: any) {
  const alerts: any[] = [], requests: string[] = [];
  const React: any = {
    createElement(type: any, props: any, ...children: any[]) {
      if (type?.name === "ClassCardPresentation") return type(props);
      return { type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) };
    },
    useState: (value: any) => [typeof value === "function" ? value() : value, () => {}],
    useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn, useEffect() {}, useRef: (current: any) => ({ current }),
  };
  const native: any = { Platform: { OS: os }, StyleSheet: { create: (styles: any) => styles, absoluteFill: {} }, useWindowDimensions: () => ({ fontScale: 1 }) };
  for (const name of ["View", "Text", "TouchableOpacity", "Image", "ActivityIndicator"]) native[name] = name;
  class Clock extends Date { constructor(value?: any) { super(value ?? "2026-10-21T12:00:00Z"); } static now() { return Date.parse("2026-10-21T12:00:00Z"); } }
  const mocks = (name: string): any => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return native;
    if (name === "@/utils/bookingStatus") return bookingStatus;
    if (name === "@/utils/bookingCancellationEligibility") return { ...eligibility, isBookingSelfCancellableClientSide: (params: any) => eligibility.isBookingSelfCancellableClientSide(params, new Clock()) };
    if (name === "@/contexts/AppContext") return { useAppContext: () => ({ user: { id: "owner" }, bookings: booking ? [booking] : [], cancelBooking: async (id: string) => requests.push(id) }) };
    if (name === "@/hooks/useCentralAlert") return { useCentralAlert: () => ({ show: (alert: any) => alerts.push(alert) }) };
    if (name === "expo-router") return { useLocalSearchParams: () => ({ id: "own-booking" }), router: { back() {} } };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) };
    if (name === "expo-haptics") return { impactAsync() {}, ImpactFeedbackStyle: { Medium: "medium" } };
    if (name === "@workspace/api-client-react") return { normalizeMediaUrl: (url: any) => url, useGetClass: () => ({}), useGetInstructor: () => ({}), useGetSchedule: () => ({}), useListDanceTypes: () => ({ data: [] }) };
    if (name === "@/utils/iosTypography") return evaluate("utils/iosTypography.ts");
    if (name === "@/utils/bookingCardLayout") return evaluate("utils/bookingCardLayout.ts");
    if (name === "@/constants/classTags") return evaluate("constants/classTags.ts");
    if (name === "./colors") return evaluate("constants/colors.ts");
    if (name === "@/components/BookingDetailsView") return { __esModule: true, default: "BookingDetailsView" };
    return new Proxy({ __esModule: true, default: name }, { get: (target: any, key: any) => key in target ? target[key] : String(key) });
  };
  function evaluate(path: string) {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(resolve("artifacts/central", path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: mocks, Date: Clock, setInterval: () => 0, clearInterval() {} });
    return module.exports;
  }
  return { module: evaluate(file), alerts, requests };
}
