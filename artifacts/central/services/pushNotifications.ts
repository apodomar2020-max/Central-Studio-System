import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";

const DEVICE_ID_KEY = "notificationDeviceId";

type ExpoNotificationsModule = typeof import("expo-notifications");

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

export async function registerPushNotificationsForCurrentUser(): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;

  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const current = await Notifications.getPermissionsAsync();
  const finalPermission = permissionGranted(current)
    ? current
    : await Notifications.requestPermissionsAsync();
  if (!permissionGranted(finalPermission)) return;

  const projectId = getProjectId();
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const pushToken = tokenResponse.data;
  if (!pushToken) return;

  await customFetch("/api/notifications/devices/register", {
    method: "POST",
    body: JSON.stringify({
      pushToken,
      provider: "expo",
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
      deviceId: await getDeviceId(),
    }),
  });
}
