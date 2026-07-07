import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";

const DEVICE_ID_KEY = "notificationDeviceId";

type ExpoNotificationsModule = typeof import("expo-notifications");

function pushDiag(message: string, data?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log(`[PUSH_DIAG] ${message}`, data ?? {});
  }
}

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

async function loadNotifications(): Promise<ExpoNotificationsModule | null> {
  if (isExpoGo()) return null;
  return import("expo-notifications");
}

function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function permissionGranted(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const permission = value as Record<string, unknown>;
  return permission.status === "granted" || permission.granted === true;
}

function permissionStatus(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  return (value as Record<string, unknown>).status ?? null;
}

export async function registerPushNotificationsForCurrentUser(): Promise<void> {
  pushDiag("register start", { platform: Platform.OS, isExpoGo: isExpoGo() });
  if (Platform.OS === "web") {
    pushDiag("register skipped", { reason: "web" });
    return;
  }
  if (isExpoGo()) {
    pushDiag("register skipped", { reason: "expo_go" });
    return;
  }

  const Notifications = await loadNotifications();
  if (!Notifications) {
    pushDiag("register skipped", { reason: "notifications_module_unavailable" });
    return;
  }

  const current = await Notifications.getPermissionsAsync();
  pushDiag("permission current", {
    status: permissionStatus(current),
    granted: permissionGranted(current),
  });
  const finalPermission = permissionGranted(current)
    ? current
    : await Notifications.requestPermissionsAsync();
  pushDiag("permission final", {
    status: permissionStatus(finalPermission),
    granted: permissionGranted(finalPermission),
  });
  if (!permissionGranted(finalPermission)) {
    pushDiag("register skipped", { reason: "permission_denied" });
    return;
  }

  const projectId = getProjectId();
  pushDiag("project id", { exists: Boolean(projectId) });
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const pushToken = tokenResponse.data;
  pushDiag("token received", {
    received: Boolean(pushToken),
    tokenPrefix: pushToken ? tokenPrefix(pushToken) : null,
  });
  if (!pushToken) {
    pushDiag("register skipped", { reason: "empty_token" });
    return;
  }

  try {
    await customFetch("/api/notifications/devices/register", {
      method: "POST",
      body: JSON.stringify({
        pushToken,
        provider: "expo",
        platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
        deviceId: await getDeviceId(),
      }),
    });
    pushDiag("register API success", { tokenPrefix: tokenPrefix(pushToken) });
  } catch (error) {
    pushDiag("register API failure", {
      tokenPrefix: tokenPrefix(pushToken),
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}
