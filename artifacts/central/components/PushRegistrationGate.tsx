import { useEffect } from "react";
import { AppState } from "react-native";
import { useAppContext } from "@/contexts/AppContext";
import {
  isExpoGo,
  isPushLogoutInProgress,
  registerPushNotificationsForCurrentUser,
  retryPendingInstallationUnregister,
} from "@/services/pushNotifications";

function gateDiag(message: string, data?: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.log(`[PUSH_DIAG] ${message}`, data ?? {});
}

export default function PushRegistrationGate() {
  const { user } = useAppContext();

  useEffect(() => {
    gateDiag("gate mounted");
    return () => {
      gateDiag("gate unmounted");
    };
  }, []);

  useEffect(() => {
    if (user?.id) return;
    const retry = () => { void retryPendingInstallationUnregister(); };
    retry();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") retry();
    });
    return () => subscription.remove();
  }, [user?.id]);

  useEffect(() => {
    const expoGo = isExpoGo();
    const logoutInProgress = isPushLogoutInProgress();
    gateDiag("gate evaluated", {
      userExists: Boolean(user?.id),
      userId: user?.id ?? null,
      emailVerified: Boolean(user?.emailVerified),
      isExpoGo: expoGo,
      logoutInProgress,
    });
    if (logoutInProgress) {
      gateDiag("gate skipped", { reason: "logout_in_progress" });
      return;
    }
    if (expoGo) {
      gateDiag("gate skipped", { reason: "expo_go" });
      return;
    }
    if (!user?.id) {
      gateDiag("gate skipped", { reason: "no_user" });
      return;
    }
    if (!user.emailVerified) {
      gateDiag("gate skipped", { reason: "email_not_verified", userId: user.id });
      return;
    }
    registerPushNotificationsForCurrentUser().catch(() => {
      gateDiag("gate registration failed", { userId: user.id });
      // Permission denial or Expo-token failures should never block app use.
    });
  }, [user?.emailVerified, user?.id]);

  return null;
}
