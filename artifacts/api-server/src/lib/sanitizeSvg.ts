import { DOMParser, XMLSerializer, onWarningStopParsing, type Document, type Element } from "@xmldom/xmldom";

/**
 * Strict parser-based SVG allowlist for admin-uploaded dance-style icons.
 * The result is rebuilt in a fresh DOM; no source node or unapproved attribute
 * is serialized back out. External references, CSS, scripts, animation, event
 * handlers, foreign content, and XML entities/DTDs are never retained.
 */
export type SanitizeResult = { svg: string } | { error: string };

const MAX_BYTES = 256 * 1024;
const MAX_NODES = 5_000;
const MAX_ATTRIBUTES = 20_000;
const MAX_ATTRIBUTE_VALUE_CHARS = 8_192;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "rect",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "clip-rule",
  "clip-path",
  "mask",
  "opacity",
  "transform",
  "preserveAspectRatio",
  "vector-effect",
  "color",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "maskUnits",
  "maskContentUnits",
  "clipPathUnits",
  "role",
  "aria-hidden",
  "focusable",
  "version",
]);

const PAINT_ATTRIBUTES = new Set(["fill", "stroke", "color", "stop-color"]);
const LOCAL_REFERENCE_ATTRIBUTES = new Set(["clip-path", "mask"]);
const LOCAL_REFERENCE_RE = /^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/;
const SAFE_ID_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const SAFE_COLOR_RE = /^(?:none|currentColor|transparent|#[0-9A-Fa-f]{3,8}|[A-Za-z]+|(?:rgb|rgba|hsl|hsla)\([0-9A-Za-z.,% +\/-]+\)|url\(#[A-Za-z_][A-Za-z0-9_.:-]*\))$/;

function isSafeAttributeValue(name: string, value: string): boolean {
  if (value.length > MAX_ATTRIBUTE_VALUE_CHARS || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return false;
  const trimmed = value.trim();
  if (/javascript\s*:|data\s*:|vbscript\s*:|https?\s*:|^\/\//i.test(trimmed)) return false;
  if (/url\s*\(/i.test(trimmed) && !LOCAL_REFERENCE_RE.test(trimmed)) return false;
  if (name === "id") return SAFE_ID_RE.test(trimmed);
  if (PAINT_ATTRIBUTES.has(name)) return SAFE_COLOR_RE.test(trimmed);
  if (LOCAL_REFERENCE_ATTRIBUTES.has(name)) return LOCAL_REFERENCE_RE.test(trimmed);
  return true;
}

function copyApprovedAttributes(source: Element, target: Element): number | null {
  let copied = 0;
  for (let index = 0; index < source.attributes.length; index += 1) {
    const attribute = source.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name;
    const lowerName = name.toLowerCase();

    // Namespace declarations are recreated by createDocument. Every other
    // namespace/prefix and all URL/event/style-bearing attributes are denied.
    if (name === "xmlns" && source.localName === "svg" && attribute.value === SVG_NAMESPACE) continue;
    if (
      attribute.namespaceURI
      || name.includes(":")
      || lowerName.startsWith("on")
      || lowerName === "style"
      || lowerName === "href"
      || lowerName === "src"
      || !ALLOWED_ATTRIBUTES.has(name)
      || !isSafeAttributeValue(name, attribute.value)
    ) {
      return null;
    }
    target.setAttribute(name, attribute.value);
    copied += 1;
  }
  return copied;
}

function appendSafeTree(sourceRoot: Element, output: Document): Element | null {
  const targetRoot = output.documentElement;
  if (!targetRoot) return null;
  const rootAttributes = copyApprovedAttributes(sourceRoot, targetRoot);
  if (rootAttributes === null) return null;

  let nodeCount = 1;
  let attributeCount = rootAttributes;
  const stack: Array<{ source: Element; target: Element }> = [{ source: sourceRoot, target: targetRoot }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (let index = 0; index < current.source.childNodes.length; index += 1) {
      const child = current.source.childNodes.item(index);
      if (!child) continue;

      if (child.nodeType === 3) {
        const text = child.nodeValue ?? "";
        if (text.trim().length === 0) continue;
        if (current.source.localName !== "title" && current.source.localName !== "desc") return null;
        current.target.appendChild(output.createTextNode(text));
        continue;
      }

      // Comments are harmless but unnecessary. CDATA, processing instructions,
      // entities, doctypes, and all other node kinds fail the upload closed.
      if (child.nodeType === 8) continue;
      if (child.nodeType !== 1) return null;

      const childElement = child as Element;
      const childName = childElement.localName;
      if (
        !childName
        || !ALLOWED_ELEMENTS.has(childName)
        || (childElement.namespaceURI !== null && childElement.namespaceURI !== SVG_NAMESPACE)
      ) {
        return null;
      }

      const targetChild = output.createElementNS(SVG_NAMESPACE, childName);
      if (!targetChild) return null;
      const copied = copyApprovedAttributes(childElement, targetChild);
      if (copied === null) return null;
      nodeCount += 1;
      attributeCount += copied;
      if (nodeCount > MAX_NODES || attributeCount > MAX_ATTRIBUTES) return null;
      current.target.appendChild(targetChild);
      stack.push({ source: childElement, target: targetChild });
    }
  }

  return targetRoot;
}

export function sanitizeSvg(input: string, maxBytes: number = MAX_BYTES): SanitizeResult {
  if (!input || typeof input !== "string") return { error: "Empty or invalid SVG" };
  if (Buffer.byteLength(input, "utf8") > maxBytes) {
    return { error: `SVG too large (max ${Math.round(maxBytes / 1024)} KB)` };
  }

  try {
    const parsed = new DOMParser({ onError: onWarningStopParsing }).parseFromString(input, "image/svg+xml");
    const root = parsed.documentElement;
    if (
      parsed.doctype
      || !root
      || root.localName !== "svg"
      || (root.namespaceURI !== null && root.namespaceURI !== SVG_NAMESPACE)
    ) {
      return { error: "Unsupported or unsafe SVG content" };
    }

    const output = parsed.implementation.createDocument(SVG_NAMESPACE, "svg", null);
    const safeRoot = appendSafeTree(root, output);
    if (!safeRoot) return { error: "Unsupported or unsafe SVG content" };
    const svg = new XMLSerializer().serializeToString(safeRoot, { requireWellFormed: true });
    return { svg };
  } catch {
    return { error: "Unsupported or unsafe SVG content" };
  }
}
