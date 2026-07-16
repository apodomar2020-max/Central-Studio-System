import { useCentralAlertContext, type CentralAlertApi } from "@/providers/CentralAlertProvider";

/**
 * useCentralAlert — the app-wide replacement for React Native's `Alert.alert`.
 *
 *   const alert = useCentralAlert();
 *   alert.show({
 *     tone: "error",
 *     title: "Unable to continue",
 *     message: errorMessage,
 *     actions: [{ label: "OK", tone: "primary" }],
 *   });
 *
 * Must be called from a component or hook rendered under
 * `CentralAlertProvider` (mounted once in app/_layout.tsx). For the rare
 * plain-function utility module that shows alerts outside any component
 * (utils/authRequired.ts, utils/profileCompletionRequired.ts), use
 * `presentCentralAlert` from `@/providers/CentralAlertProvider` instead —
 * do not add React hooks to non-component files.
 */
export function useCentralAlert(): CentralAlertApi {
  return useCentralAlertContext();
}
