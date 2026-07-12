import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";

const DEVICE_ID_KEY = "notificationDeviceId";
const ANDROID_NOTIFICATION_CHANNEL_ID = "central-default-v1";
const ANDROID_NOTIFICATION_SOUND = "central_notification.wav";

type ExpoNotificationsModule = typeof import("expo-notifications");
type DevicePushToken = Awaited<ReturnType<ExpoNotificationsModule["getDevicePushTokenAsync"]>>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /token|jwt|password|secret|credential|authorization|api[_-]?key/i;

function pushDiag(message: string, data?: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.log(`[PUSH_DIAG] ${message}`, data ?? {});
}

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

function redactForLog(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      safe[entryKey] = redactForLog(entryValue, entryKey);
    });
    return safe;
  }
  return value;
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, entryValue) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
      if (entryValue && typeof entryValue === "object") {
        if (seen.has(entryValue)) return "[Circular]";
        seen.add(entryValue);
      }
      return entryValue;
    });
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

function errorDetails(error: unknown): Record<string, unknown> {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const enumerableFields = record ? redactForLog({ ...record }) : {};
  const details = {
    name: error instanceof Error ? error.name : record && typeof record.name === "string" ? record.name : null,
    code: record?.code ?? null,
    message: error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
    enumerableFields,
  };
  return {
    ...details,
    safeJson: safeJson(details),
  };
}

function constantsExtra(): { eas?: { projectId?: string } } | undefined {
  return Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
}

function androidPackageId(): string | null {
  return Constants.expoConfig?.android?.package ?? null;
}

function isPhysicalDevice(): boolean | null {
  const constants = Constants as typeof Constants & { isDevice?: boolean };
  return typeof constants.isDevice === "boolean" ? constants.isDevice : null;
}

export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

async function loadNotifications(): Promise<ExpoNotificationsModule | null> {
  if (isExpoGo()) return null;
  return import("expo-notifications");
}

function getProjectId(): string | undefined {
  const extra = constantsExtra();
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

function logRuntimeConfig(Notifications: ExpoNotificationsModule, resolvedProjectId: string | undefined): void {
  const physicalDevice = isPhysicalDevice();
  pushDiag("runtime config", {
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    easConfigProjectId: Constants.easConfig?.projectId ?? null,
    expoConfigExtraEasProjectId: constantsExtra()?.eas?.projectId ?? null,
    resolvedProjectId: resolvedProjectId ?? null,
    androidPackageId: androidPackageId(),
    platform: Platform.OS,
    isPhysicalDevice: physicalDevice,
    physicalDeviceKnown: physicalDevice != null,
    physicalDeviceReason: physicalDevice == null ? "not_available_from_expo_constants" : null,
    notificationsModuleAvailable: true,
    notificationsNativeMethods: {
      getPermissionsAsync: typeof Notifications.getPermissionsAsync === "function",
      requestPermissionsAsync: typeof Notifications.requestPermissionsAsync === "function",
      setNotificationChannelAsync: typeof Notifications.setNotificationChannelAsync === "function",
      getDevicePushTokenAsync: typeof Notifications.getDevicePushTokenAsync === "function",
      getExpoPushTokenAsync: typeof Notifications.getExpoPushTokenAsync === "function",
    },
  });
}

async function ensureAndroidNotificationChannel(Notifications: ExpoNotificationsModule): Promise<void> {
  if (Platform.OS !== "android") return;
  pushDiag("android notification channel entered", { channelId: ANDROID_NOTIFICATION_CHANNEL_ID });
  try {
    const channel = await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
      name: "Central Studio Notifications",
      importance: Notifications.AndroidImportance.MAX,
      sound: ANDROID_NOTIFICATION_SOUND,
      vibrationPattern: [0, 250, 250, 250],
    });
    pushDiag("android notification channel ready", {
      channelId: channel?.id ?? ANDROID_NOTIFICATION_CHANNEL_ID,
      importance: channel?.importance ?? null,
      sound: channel?.sound ?? null,
    });
  } catch (error) {
    pushDiag("android notification channel failed", errorDetails(error));
    throw error;
  }
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

  let Notifications: ExpoNotificationsModule | null = null;
  try {
    Notifications = await loadNotifications();
  } catch (error) {
    pushDiag("register skipped", {
      reason: "notifications_module_error",
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
  if (!Notifications) {
    pushDiag("register skipped", { reason: "notifications_module_unavailable" });
    return;
  }

  await ensureAndroidNotificationChannel(Notifications);

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
  logRuntimeConfig(Notifications, projectId);
  pushDiag("project id", { exists: Boolean(projectId), value: projectId ?? null });
  pushDiag("getDevicePushTokenAsync entered");
  let devicePushToken: DevicePushToken;
  try {
    devicePushToken = await Notifications.getDevicePushTokenAsync();
    pushDiag("device push token received", {
      received: Boolean(devicePushToken?.data),
      type: devicePushToken?.type ?? null,
    });
  } catch (error) {
    pushDiag("device push token failed", {
      projectIdExists: Boolean(projectId),
      ...errorDetails(error),
    });
    throw error;
  }

  pushDiag("getExpoPushTokenAsync entered", {
    projectIdExists: Boolean(projectId),
    projectIdPassed: projectId ?? null,
    devicePushTokenProvided: Boolean(devicePushToken?.data),
  });
  let tokenResponse: Awaited<ReturnType<ExpoNotificationsModule["getExpoPushTokenAsync"]>>;
  try {
    tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId, devicePushToken } : { devicePushToken });
  } catch (error) {
    pushDiag("token request failed", {
      projectIdExists: Boolean(projectId),
      projectIdPassed: projectId ?? null,
      devicePushTokenProvided: Boolean(devicePushToken?.data),
      ...errorDetails(error),
    });
    throw error;
  }
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
    pushDiag("register API request", {
      tokenPrefix: tokenPrefix(pushToken),
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
    });
    const response = await customFetch<{ ok?: boolean; id?: number; isActive?: boolean; lastSeenAt?: string }>(
      "/api/notifications/devices/register",
      {
        method: "POST",
        body: JSON.stringify({
          pushToken,
          provider: "expo",
          platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
          deviceId: await getDeviceId(),
        }),
      },
    );
    pushDiag("register API response", {
      ok: response?.ok === true,
      id: response?.id ?? null,
      isActive: response?.isActive ?? null,
      tokenPrefix: tokenPrefix(pushToken),
    });
    pushDiag("register final success", { tokenPrefix: tokenPrefix(pushToken) });
  } catch (error) {
    pushDiag("register API failure", {
      tokenPrefix: tokenPrefix(pushToken),
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}
