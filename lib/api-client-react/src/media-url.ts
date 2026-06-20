export type MediaKind = "image" | "video";

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

function validDriveId(value: string | null | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(decoded) ? decoded : null;
}

export function extractGoogleDriveFileId(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(input.trim());
    if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;

    const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
    return validDriveId(pathMatch?.[1]) ?? validDriveId(url.searchParams.get("id"));
  } catch {
    return null;
  }
}

export function normalizeMediaUrl(
  input: string | null | undefined,
  _kind: MediaKind = "image",
): string | undefined {
  if (!input?.trim()) return undefined;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

    const driveId = extractGoogleDriveFileId(url.toString());
    if (driveId) {
      return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveId)}`;
    }

    if (DRIVE_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isYouTubeUrl(input: string | null | undefined): boolean {
  if (!input) return false;
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" && YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
