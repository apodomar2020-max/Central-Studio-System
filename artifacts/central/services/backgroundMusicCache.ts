import type { BackgroundMusicConfig } from "./backgroundMusic";

export interface CachedMusicEntry {
  version: number;
  uri: string;
  sourceUrl: string;
  updatedAt: string;
}

export interface BackgroundMusicCacheDeps {
  cacheDirectory: string | null;
  makeDirectoryAsync: (uri: string, options: { intermediates: boolean }) => Promise<void>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; isDirectory?: boolean; size?: number }>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  downloadAsync: (url: string, fileUri: string) => Promise<{ uri: string; status: number; headers?: Record<string, string> }>;
  moveAsync: (options: { from: string; to: string }) => Promise<void>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

const LAST_GOOD_KEY = "backgroundMusic:lastGood";
const MAX_CACHED_FILES = 3;

function extensionForUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(mp3|m4a|aac|wav|ogg|oga|mp4)$/);
    return match?.[1] ?? "mp3";
  } catch {
    return "mp3";
  }
}

function cacheDir(deps: BackgroundMusicCacheDeps): string {
  if (!deps.cacheDirectory) {
    throw new Error("Audio cache is unavailable on this device.");
  }
  return `${deps.cacheDirectory}central-background-music/`;
}

async function ensureCacheDir(deps: BackgroundMusicCacheDeps): Promise<string> {
  const dir = cacheDir(deps);
  await deps.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function readLastGood(deps: BackgroundMusicCacheDeps): Promise<CachedMusicEntry | null> {
  try {
    const raw = await deps.getItem(LAST_GOOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMusicEntry;
    const info = await deps.getInfoAsync(parsed.uri);
    return info.exists && !info.isDirectory && (info.size ?? 0) > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLastGood(deps: BackgroundMusicCacheDeps, entry: CachedMusicEntry): Promise<void> {
  await deps.setItem(LAST_GOOD_KEY, JSON.stringify(entry));
}

async function pruneCache(deps: BackgroundMusicCacheDeps, dir: string, keepUris: Set<string>): Promise<void> {
  try {
    const names = await deps.readDirectoryAsync(dir);
    const files = names
      .filter((name) => name.startsWith("background-music-v") && !name.endsWith(".download"))
      .sort()
      .reverse();
    for (const stale of files.slice(MAX_CACHED_FILES)) {
      const uri = `${dir}${stale}`;
      if (!keepUris.has(uri)) {
        await deps.deleteAsync(uri, { idempotent: true });
      }
    }
  } catch {
    // Cache pruning is opportunistic; playback should not depend on it.
  }
}

function downloadHeadersLookSafe(headers: Record<string, string> | undefined): boolean {
  const contentType = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";", 1)[0]?.toLowerCase();
  if (!contentType) return true;
  if (contentType.startsWith("text/html") || contentType === "application/xhtml+xml") return false;
  return contentType.startsWith("audio/") || contentType === "application/octet-stream" || contentType === "application/x-mpegurl" || contentType === "application/vnd.apple.mpegurl";
}

export async function getCachedMusicUriWithDeps(
  config: BackgroundMusicConfig,
  deps: BackgroundMusicCacheDeps,
): Promise<{ uri: string; isFallback: boolean } | null> {
  if (!config.sourceUrl) return null;
  const dir = await ensureCacheDir(deps);

  const extension = extensionForUrl(config.sourceUrl);
  const finalUri = `${dir}background-music-v${config.version}.${extension}`;
  const existing = await deps.getInfoAsync(finalUri);
  if (existing.exists && !existing.isDirectory && (existing.size ?? 0) > 0) {
    await writeLastGood(deps, { version: config.version, uri: finalUri, sourceUrl: config.sourceUrl, updatedAt: config.updatedAt });
    return { uri: finalUri, isFallback: false };
  }

  const tempUri = `${dir}background-music-v${config.version}.download`;
  try {
    await deps.deleteAsync(tempUri, { idempotent: true });
    const result = await deps.downloadAsync(config.sourceUrl, tempUri);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Download failed with HTTP ${result.status}`);
    }
    if (!downloadHeadersLookSafe(result.headers)) {
      throw new Error("Downloaded file is not an audio response.");
    }
    const downloaded = await deps.getInfoAsync(result.uri);
    if (!downloaded.exists || downloaded.isDirectory || (downloaded.size ?? 0) <= 0) {
      throw new Error("Downloaded audio file is empty.");
    }
    await deps.moveAsync({ from: tempUri, to: finalUri });
    const entry = { version: config.version, uri: finalUri, sourceUrl: config.sourceUrl, updatedAt: config.updatedAt };
    await writeLastGood(deps, entry);
    const fallback = await readLastGood(deps);
    await pruneCache(deps, dir, new Set([finalUri, fallback?.uri].filter(Boolean) as string[]));
    return { uri: finalUri, isFallback: false };
  } catch {
    await deps.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    const fallback = await readLastGood(deps);
    if (fallback) return { uri: fallback.uri, isFallback: true };
    return null;
  }
}
