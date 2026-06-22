/**
 * Dependency-free SVG sanitizer (defense-in-depth for admin-uploaded icons).
 *
 * Dance-style icons are uploaded by trusted admins, but the markup is served
 * to mobile/web, so we strip the common SVG XSS vectors before storing:
 *   - <script>, <foreignObject> (HTML injection), <style>, <iframe>/<object>/<embed>
 *   - inline event handlers (on*="…")
 *   - javascript: / external href / xlink:href (only `#fragment` refs kept)
 *   - <image> references (external/data)
 *   - XML declarations, DOCTYPE (XXE), comments, CDATA, processing instructions
 *
 * Returns the cleaned SVG string, or an error message.
 */
export type SanitizeResult = { svg: string } | { error: string };

const MAX_BYTES = 256 * 1024; // 256 KB

const DANGEROUS_ELEMENTS =
  "script|foreignObject|style|iframe|object|embed|animate|animateTransform|animateMotion|set|handler|use";

export function sanitizeSvg(input: string, maxBytes: number = MAX_BYTES): SanitizeResult {
  if (!input || typeof input !== "string") return { error: "Empty or invalid SVG" };
  if (Buffer.byteLength(input, "utf8") > maxBytes) {
    return { error: `SVG too large (max ${Math.round(maxBytes / 1024)} KB)` };
  }

  let s = input
    .replace(/^﻿/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<![ \t]*DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .trim();

  if (!/^<svg[\s>]/i.test(s)) {
    return { error: "Not a valid SVG (must start with <svg>)" };
  }

  // Remove dangerous elements (paired tags incl. content)
  const paired = new RegExp(`<(${DANGEROUS_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi");
  s = s.replace(paired, "");
  // Remove dangerous self-closing / void forms
  const selfClosing = new RegExp(`<(${DANGEROUS_ELEMENTS})\\b[^>]*\\/?>`, "gi");
  s = s.replace(selfClosing, "");
  // Remove <image> (external/data refs)
  s = s.replace(/<image\b[\s\S]*?(?:\/>|<\/image\s*>)/gi, "");

  // Strip inline event handlers: on*="…" / on*='…'
  s = s
    .replace(/\son[a-z]+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");

  // Strip href / xlink:href that aren't local `#fragment` references
  s = s
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#)[^']*'/gi, "");

  // Neutralize any leftover javascript: URIs in attributes (e.g. fill="url(javascript:…)")
  s = s.replace(/javascript:/gi, "");

  if (!/^<svg[\s>]/i.test(s) || !/<\/svg\s*>\s*$/i.test(s)) {
    return { error: "SVG structure invalid after sanitization" };
  }
  return { svg: s };
}
