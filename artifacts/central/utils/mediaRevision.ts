/**
 * Adds an in-memory query revision to remote media URLs so React Native does
 * not briefly reuse an older cached image after fresh Home data arrives.
 */
export function withMediaRevision(url: string | null | undefined, revision: number): string | null | undefined {
  if (!url || revision <= 0 || !/^https?:\/\//i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}cs_rev=${revision}`;
}
