import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundMusicConfig } from "./backgroundMusic";
import { getCachedMusicUriWithDeps, type BackgroundMusicCacheDeps } from "./backgroundMusicCache";

type FileEntry = { exists: true; isDirectory: false; size: number } | { exists: false; isDirectory?: false; size?: undefined };

function config(version: number, sourceUrl = "https://cdn.example.com/menu.mp3"): BackgroundMusicConfig {
  return {
    enabled: true,
    sourceUrl,
    sourceTitle: "Menu",
    volume: 0.25,
    loop: true,
    version,
    updatedAt: `2026-07-14T00:00:0${version}.000Z`,
  };
}

function makeDeps(options: {
  status?: number;
  headers?: Record<string, string>;
  downloadedSize?: number;
  failDownload?: boolean;
  initialFiles?: Record<string, number>;
  lastGood?: unknown;
} = {}) {
  const files = new Map<string, number>();
  for (const [uri, size] of Object.entries(options.initialFiles ?? {})) files.set(uri, size);
  const storage = new Map<string, string>();
  if (options.lastGood) storage.set("backgroundMusic:lastGood", JSON.stringify(options.lastGood));
  const deleted: string[] = [];

  const deps: BackgroundMusicCacheDeps = {
    cacheDirectory: "file:///cache/",
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async (dir) => [...files.keys()].filter((uri) => uri.startsWith(dir)).map((uri) => uri.slice(dir.length)),
    getInfoAsync: async (uri): Promise<FileEntry> => {
      const size = files.get(uri);
      return size == null ? { exists: false } : { exists: true, isDirectory: false, size };
    },
    deleteAsync: async (uri) => {
      deleted.push(uri);
      files.delete(uri);
    },
    downloadAsync: async (_url, uri) => {
      if (options.failDownload) throw new Error("network down");
      files.set(uri, options.downloadedSize ?? 123);
      return { uri, status: options.status ?? 200, headers: options.headers ?? { "content-type": "audio/mpeg" }, md5: null };
    },
    moveAsync: async ({ from, to }) => {
      const size = files.get(from);
      if (size == null) throw new Error("missing temp");
      files.delete(from);
      files.set(to, size);
    },
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      storage.set(key, value);
    },
  };

  return { deps, files, storage, deleted };
}

test("downloads a new version to a versioned safe cache URI", async () => {
  const { deps, files } = makeDeps();
  const result = await getCachedMusicUriWithDeps(config(4), deps);
  assert.deepEqual(result, { uri: "file:///cache/central-background-music/background-music-v4.mp3", isFallback: false });
  assert.equal(files.has("file:///cache/central-background-music/background-music-v4.mp3"), true);
});

test("same URL with a new revision creates a new cache key", async () => {
  const { deps, files } = makeDeps({
    initialFiles: { "file:///cache/central-background-music/background-music-v4.mp3": 100 },
  });
  const result = await getCachedMusicUriWithDeps(config(5), deps);
  assert.deepEqual(result, { uri: "file:///cache/central-background-music/background-music-v5.mp3", isFallback: false });
  assert.equal(files.has("file:///cache/central-background-music/background-music-v4.mp3"), true);
  assert.equal(files.has("file:///cache/central-background-music/background-music-v5.mp3"), true);
});

test("failed new download uses the previous valid fallback", async () => {
  const lastGood = {
    version: 3,
    uri: "file:///cache/central-background-music/background-music-v3.mp3",
    sourceUrl: "https://cdn.example.com/old.mp3",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const { deps } = makeDeps({
    failDownload: true,
    initialFiles: { [lastGood.uri]: 100 },
    lastGood,
  });
  const result = await getCachedMusicUriWithDeps(config(4), deps);
  assert.deepEqual(result, { uri: lastGood.uri, isFallback: true });
});

test("partial empty download is not promoted and falls back", async () => {
  const lastGood = {
    version: 2,
    uri: "file:///cache/central-background-music/background-music-v2.mp3",
    sourceUrl: "https://cdn.example.com/old.mp3",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const { deps, files } = makeDeps({
    downloadedSize: 0,
    initialFiles: { [lastGood.uri]: 100 },
    lastGood,
  });
  const result = await getCachedMusicUriWithDeps(config(3), deps);
  assert.deepEqual(result, { uri: lastGood.uri, isFallback: true });
  assert.equal(files.has("file:///cache/central-background-music/background-music-v3.mp3"), false);
});

test("HTML downloads are rejected before becoming last-known-good", async () => {
  const lastGood = {
    version: 2,
    uri: "file:///cache/central-background-music/background-music-v2.mp3",
    sourceUrl: "https://cdn.example.com/old.mp3",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  const { deps, storage } = makeDeps({
    headers: { "content-type": "text/html" },
    initialFiles: { [lastGood.uri]: 100 },
    lastGood,
  });
  const result = await getCachedMusicUriWithDeps(config(3), deps);
  assert.deepEqual(result, { uri: lastGood.uri, isFallback: true });
  assert.equal(JSON.parse(storage.get("backgroundMusic:lastGood") ?? "{}").version, 2);
});

test("stale cache pruning is bounded and preserves current file", async () => {
  const { deps, files } = makeDeps({
    initialFiles: {
      "file:///cache/central-background-music/background-music-v1.mp3": 100,
      "file:///cache/central-background-music/background-music-v2.mp3": 100,
      "file:///cache/central-background-music/background-music-v3.mp3": 100,
      "file:///cache/central-background-music/background-music-v4.mp3": 100,
    },
  });
  await getCachedMusicUriWithDeps(config(5), deps);
  const remaining = [...files.keys()].filter((uri) => uri.includes("background-music-v"));
  assert.equal(remaining.includes("file:///cache/central-background-music/background-music-v5.mp3"), true);
  assert.equal(remaining.length <= 4, true);
});

test("missing source URL produces no playback cache", async () => {
  const { deps } = makeDeps();
  const result = await getCachedMusicUriWithDeps({ ...config(1), sourceUrl: null }, deps);
  assert.equal(result, null);
});
