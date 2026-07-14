import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { customFetch } from "@workspace/api-client-react";
import { getCachedMusicUriWithDeps, type BackgroundMusicCacheDeps } from "./backgroundMusicCache";

export interface BackgroundMusicConfig {
  enabled: boolean;
  sourceUrl: string | null;
  sourceTitle: string | null;
  volume: number;
  loop: boolean;
  version: number;
  updatedAt: string;
}

export const expoBackgroundMusicCacheDeps: BackgroundMusicCacheDeps = {
  cacheDirectory: FileSystem.cacheDirectory,
  makeDirectoryAsync: FileSystem.makeDirectoryAsync,
  readDirectoryAsync: FileSystem.readDirectoryAsync,
  getInfoAsync: FileSystem.getInfoAsync,
  deleteAsync: FileSystem.deleteAsync,
  downloadAsync: FileSystem.downloadAsync,
  moveAsync: FileSystem.moveAsync,
  getItem: AsyncStorage.getItem,
  setItem: AsyncStorage.setItem,
};

export async function fetchBackgroundMusicConfig(): Promise<BackgroundMusicConfig> {
  return customFetch<BackgroundMusicConfig>("/api/settings/background-music", {
    method: "GET",
    responseType: "json",
  });
}

export async function getCachedMusicUri(config: BackgroundMusicConfig): Promise<{ uri: string; isFallback: boolean } | null> {
  return getCachedMusicUriWithDeps(config, expoBackgroundMusicCacheDeps);
}

export type { BackgroundMusicCacheDeps };
export { getCachedMusicUriWithDeps };
