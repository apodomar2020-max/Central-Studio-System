import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";
import { retryPendingInstallation } from "./installationUnregisterRetry";

const DEVICE_ID_KEY = "notificationDeviceId";
const PENDING_UNREGISTER_KEY = "notificationPendingUnregister";
const UNREGISTER_SECRET_KEY = "notificationUnregisterSecret";
const ANDROID_NOTIFICATION_CHANNEL_ID = "central-default-v1";
const ANDROID_NOTIFICATION_SOUND = "central_notification.wav";

type ExpoNotificationsModule = typeof import("expo-notifications");
type DevicePushToken = Awaited<ReturnType<ExpoNotificationsModule["getDevicePushTokenAsync"]>>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /token|jwt|password|secret|credential|authorization|api[_-]?key/i;

let logoutInProgress = false;
let registrationInFlight: Promise<void> | null = null;

function pushDiag(message: string, data?: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.log(`[PUSH_DIAG] ${message}`, data ?? {});
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

export function isPushLogoutInProgress(): boolean {
  return logoutInProgress;
}

export function beginPushLogout(): boolean {
  if (logoutInProgress) return false;
  logoutInProgress = true;
  return true;
}

export function finishPushLogout(): void {
  logoutInProgress = false;
}

async function clearPendingUnregister(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_UNREGISTER_KEY);
}

async function getUnregisterSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(UNREGISTER_SECRET_KEY);
}

async function setUnregisterSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(UNREGISTER_SECRET_KEY, secret, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function getOrCreateUnregisterSecret(): Promise<string> {
  const existing = await getUnregisterSecret();
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const secret = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  // Persist before registration can activate/rotate the database row. If this
  // fails, registration aborts and the server never receives the new secret.
  await setUnregisterSecret(secret);
  return secret;
}

async function readPendingUnregister(): Promise<{ deviceId: string } | null> {
  const raw = await AsyncStorage.getItem(PENDING_UNREGISTER_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { deviceId?: unknown };
    return typeof value.deviceId === "string" && value.deviceId ? { deviceId: value.deviceId } : null;
  } catch {
    await clearPendingUnregister();
    return null;
  }
}

async function postUnregister(deviceId: string): Promise<number> {
  const response = await customFetch<{ ok?: boolean; updated?: number }>(
    "/api/notifications/devices/unregister",
    { method: "POST", body: JSON.stringify({ deviceId }) },
  );
  return response.updated ?? 0;
}

function retryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryPendingInstallationUnregister(maxAttempts = 3): Promise<boolean> {
  return retryPendingInstallation({
    readPending: readPendingUnregister,
    readSecret: getUnregisterSecret,
    unregister: async (deviceId, unregisterSecret) => {
      const response = await customFetch<{ ok?: boolean }>(
        "/api/notifications/devices/unregister-by-installation",
        { method: "POST", body: JSON.stringify({ deviceId, unregisterSecret }) },
      );
      return response.ok === true;
    },
    clearPending: clearPendingUnregister,
    wait: retryDelay,
  }, maxAttempts);
}

/** Called while the current student's JWT is still present. */
export async function unregisterPushDeviceForLogout(): Promise<void> {
  const deviceId = await getDeviceId();
  const unregisterSecret = await getUnregisterSecret();
  // AsyncStorage contains only the installation UUID. The authorization
  // credential remains in OS-backed SecureStore.
  if (unregisterSecret) {
    await AsyncStorage.setItem(PENDING_UNREGISTER_KEY, JSON.stringify({ deviceId }));
  }

  // A register that began before logout could otherwise commit afterwards and
  // reactivate the row. The guard prevents any new registration from starting.
  const activeRegistration = registrationInFlight;
  if (activeRegistration) await activeRegistration.catch(() => {});

  const updated = await postUnregister(deviceId);
  if (updated > 0) await clearPendingUnregister();
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

async function registerPushNotifications(): Promise<void> {
  pushDiag("register start", { platform: Platform.OS, isExpoGo: isExpoGo() });
  if (logoutInProgress) {
    pushDiag("register skipped", { reason: "logout_in_progress" });
    return;
  }
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
  if (logoutInProgress) return;

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
  if (logoutInProgress) return;

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
  });
  if (!pushToken) {
    pushDiag("register skipped", { reason: "empty_token" });
    return;
  }
  if (logoutInProgress) return;

  try {
    const pendingCleared = await retryPendingInstallationUnregister();
    if (!pendingCleared) {
      pushDiag("register skipped", { reason: "pending_unregister_not_cleared" });
      return;
    }
    if (logoutInProgress) return;
    pushDiag("register API request", {
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
    });
    const deviceId = await getDeviceId();
    const existingUnregisterSecret = await getOrCreateUnregisterSecret();
    const response = await customFetch<{
      ok?: boolean;
      id?: number;
      isActive?: boolean;
      lastSeenAt?: string;
      unregisterSecret?: string;
    }>(
      "/api/notifications/devices/register",
      {
        method: "POST",
        body: JSON.stringify({
          pushToken,
          provider: "expo",
          platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
          deviceId,
          unregisterSecret: existingUnregisterSecret,
        }),
      },
    );
    pushDiag("register API response", {
      ok: response?.ok === true,
      id: response?.id ?? null,
      isActive: response?.isActive ?? null,
    });
    pushDiag("register final success");
    if (response.unregisterSecret) await setUnregisterSecret(response.unregisterSecret);
    await clearPendingUnregister();
  } catch (error) {
    pushDiag("register API failure", {
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}

export function registerPushNotificationsForCurrentUser(): Promise<void> {
  if (logoutInProgress) return Promise.resolve();
  if (registrationInFlight) return registrationInFlight;
  const operation = registerPushNotifications();
  const tracked = operation.finally(() => {
    if (registrationInFlight === tracked) registrationInFlight = null;
  });
  registrationInFlight = tracked;
  return tracked;
}
