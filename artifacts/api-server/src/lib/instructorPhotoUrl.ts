const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com"]);

function validGoogleDriveFileId(value: string | null | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(decoded) ? decoded : null;
}

export function extractGoogleDriveFileId(input: string): string | null {
  const url = new URL(input.trim());
  if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
  return validGoogleDriveFileId(pathMatch?.[1]) ?? validGoogleDriveFileId(url.searchParams.get("id"));
}

export function normalizeInstructorPhotoUrl(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Photo URL must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Photo URL must start with http:// or https://");
  }

  if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) {
    return url.toString();
  }

  const fileId = extractGoogleDriveFileId(url.toString());
  if (!fileId) {
    throw new Error("Google Drive photo URL must include a file ID. Use a share link like https://drive.google.com/file/d/FILE_ID/view?usp=sharing.");
  }

  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
}

export function normalizeInstructorPhotoUrlForResponse(input: string | null | undefined): string | null {
  try {
    return normalizeInstructorPhotoUrl(input);
  } catch {
    return input?.trim() || null;
  }
}
