import { lookup } from "node:dns/promises";
import net from "node:net";

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{10,200}$/;
const AUDIO_MIME_RE = /^(audio\/|application\/(octet-stream|x-mpegurl|vnd\.apple\.mpegurl))/i;
const HTML_MIME_RE = /^(text\/html|application\/xhtml\+xml)/i;
const MAX_REDIRECTS = 3;
const VALIDATION_TIMEOUT_MS = 6_000;
const MAX_SNIFF_BYTES = 64_000;

export interface NormalizedMusicUrl {
  originalUrl: string;
  normalizedUrl: string;
  sourceType: "google_drive" | "direct";
  fileId?: string;
  title?: string | null;
}

export interface MusicUrlValidationResult extends NormalizedMusicUrl {
  contentType: string | null;
  contentLength: number | null;
}

type LookupAll = (hostname: string, options: { all: true }) => Promise<Array<{ address: string }>>;

export interface ValidationDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupAll;
}

export class MusicUrlValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function isUnsafeIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || // current network
    a === 10 || // private
    a === 100 && b >= 64 && b <= 127 || // carrier-grade NAT
    a === 127 || // loopback
    a === 169 && b === 254 || // link-local
    a === 172 && b >= 16 && b <= 31 || // private
    a === 192 && b === 0 || // IETF protocol assignments
    a === 192 && b === 168 || // private
    a === 198 && (b === 18 || b === 19) || // benchmark
    a >= 224 // multicast/reserved
  );
}

function isUnsafeIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") || // unique local
    normalized.startsWith("fd") || // unique local
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fe90:") ||
    normalized.startsWith("fea0:") ||
    normalized.startsWith("feb0:") ||
    normalized.startsWith("ff") || // multicast
    normalized.startsWith("2001:db8:") || // documentation
    normalized.startsWith("2002:") || // 6to4
    normalized.startsWith("64:ff9b:") // IPv4/IPv6 translation prefix
  );
}

function isUnsafeAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

function extractDriveFileId(url: URL): string | null {
  const queryIds = url.searchParams.getAll("id").filter(Boolean);
  if (queryIds.length > 1) {
    throw new MusicUrlValidationError("This Google Drive link has multiple file IDs.");
  }
  const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (pathMatch?.[1]) {
    if (queryIds.length > 0) {
      throw new MusicUrlValidationError("This Google Drive link has multiple file IDs.");
    }
    return pathMatch[1];
  }
  if (url.pathname === "/open" || url.pathname === "/uc") return queryIds[0] ?? null;
  return null;
}

function validateUrlObject(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new MusicUrlValidationError("Enter a valid HTTPS audio URL.");
  }
  if (url.protocol !== "https:") {
    throw new MusicUrlValidationError("Background music URLs must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new MusicUrlValidationError("Background music URLs cannot include credentials.");
  }
  if (!url.hostname) {
    throw new MusicUrlValidationError("The URL must include a valid host.");
  }
  return url;
}

export function normalizeBackgroundMusicUrl(input: string, title?: string | null): NormalizedMusicUrl {
  const url = validateUrlObject(input);
  const host = url.hostname.toLowerCase();

  if (host === "drive.google.com" || host === "www.drive.google.com") {
    const fileId = extractDriveFileId(url);
    if (!fileId || !DRIVE_FILE_ID_RE.test(fileId)) {
      throw new MusicUrlValidationError("This Google Drive link is missing a valid file ID.");
    }
    return {
      originalUrl: input.trim(),
      normalizedUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      sourceType: "google_drive",
      fileId,
      title: title?.trim() || null,
    };
  }

  return {
    originalUrl: input.trim(),
    normalizedUrl: url.toString(),
    sourceType: "direct",
    title: title?.trim() || null,
  };
}

async function assertSafeHost(url: URL, lookupImpl: LookupAll): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new MusicUrlValidationError("Localhost URLs are not allowed.");
  }

  if (net.isIP(host)) {
    if (isUnsafeAddress(host)) throw new MusicUrlValidationError("Private or local network URLs are not allowed.");
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupImpl(host, { all: true });
  } catch {
    throw new MusicUrlValidationError("The URL host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some((entry) => isUnsafeAddress(entry.address))) {
    throw new MusicUrlValidationError("Private or local network URLs are not allowed.");
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readSmallText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < MAX_SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    received += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // Best effort; validation has enough data.
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveRedirect(base: URL, location: string | null): URL | null {
  if (!location) return null;
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

export async function validateBackgroundMusicUrl(input: string, title?: string | null): Promise<MusicUrlValidationResult> {
  return validateBackgroundMusicUrlWithDeps(input, title);
}

export async function validateBackgroundMusicUrlWithDeps(
  input: string,
  title?: string | null,
  deps: ValidationDeps = {},
): Promise<MusicUrlValidationResult> {
  const normalized = normalizeBackgroundMusicUrl(input, title);
  let current = validateUrlObject(normalized.normalizedUrl);
  let response: Response | null = null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupImpl = deps.lookupImpl ?? (lookup as LookupAll);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertSafeHost(current, lookupImpl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Range: `bytes=0-${MAX_SNIFF_BYTES - 1}`,
          "User-Agent": "CentralStudioMusicValidator/1.0",
          Accept: "audio/*,application/octet-stream;q=0.8,*/*;q=0.2",
        },
      });
    } catch {
      throw new MusicUrlValidationError("The audio URL could not be reached.");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const next = resolveRedirect(current, response.headers.get("location"));
      if (!next) throw new MusicUrlValidationError("The audio URL redirects to an invalid location.");
      validateUrlObject(next.toString());
      current = next;
      continue;
    }

    break;
  }

  if (!response) throw new MusicUrlValidationError("The audio URL could not be validated.");
  if (response.status >= 300 && response.status < 400) {
    throw new MusicUrlValidationError("The audio URL redirects too many times.");
  }
  if (!response.ok && response.status !== 206) {
    throw new MusicUrlValidationError(response.status === 401 || response.status === 403 ? "The audio file is private or inaccessible." : "The audio URL returned an error.");
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? null;
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentType && HTML_MIME_RE.test(contentType)) {
    throw new MusicUrlValidationError("The URL returned a web page instead of an audio file. Check that the file is public.");
  }
  if (contentType && !AUDIO_MIME_RE.test(contentType)) {
    throw new MusicUrlValidationError(`The URL returned ${contentType}, not a supported audio file.`);
  }

  const text = await readSmallText(response);
  const trimmed = text.trimStart().slice(0, 512).toLowerCase();
  if (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    (trimmed.includes("google drive") && (trimmed.includes("sign in") || trimmed.includes("quota") || trimmed.includes("virus scan")))
  ) {
    throw new MusicUrlValidationError("The URL returned an HTML page instead of audio. Make the file public and try again.");
  }

  return {
    ...normalized,
    normalizedUrl: current.toString(),
    contentType,
    contentLength,
  };
}

export function redactMusicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = url.search ? "?[redacted]" : "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}
