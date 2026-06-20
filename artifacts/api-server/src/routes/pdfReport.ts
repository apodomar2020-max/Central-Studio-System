/**
 * Executive-style PDF report builder for the admin Reports → Export Center.
 *
 * Consumes the SAME { columns, rows, summary } produced by the JSON/Excel report
 * builder in reports.ts — it performs NO queries and NO analytics of its own, so
 * Preview = Excel = PDF by construction.
 *
 * Built with pdf-lib (pure JS) so it bundles cleanly into the esbuild single-file
 * output — no Chromium, no headless browser, no runtime font/file reads.
 *
 * Internationalisation: Latin text uses the built-in Helvetica. Any cell that
 * contains Arabic is rendered with an embedded Amiri (Unicode) font after proper
 * shaping (arabic-reshaper → Presentation Forms-B) and bidirectional reordering
 * (bidi-js), and is right-aligned — so Arabic names/content render correctly,
 * never as "?".
 *
 * Layout (A4 landscape): repeating header (logo + wordmark / title / generated
 * stamp) and footer (Central Studio / Page X of Y / Confidential) on every page;
 * filters strip + executive summary cards on page 1; then a paginated, zebra-
 * striped table whose header repeats on each page.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";
import { CENTRAL_LOGO_PNG_BASE64 } from "./centralLogo";
import { AMIRI_TTF_BASE64 } from "./amiriFont";

export interface PdfReportColumn {
  key: string;
  label: string;
}
export interface PdfReportInput {
  title: string;
  entityLabel: string;
  columns: PdfReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
  filters: { from?: string; to?: string; status?: string };
  generatedBy: string;
}

// ─── Monochrome enterprise palette (cyan used only as a thin brand accent) ──────
const INK = rgb(0.07, 0.09, 0.13);
const SUBTLE = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.88, 0.9);
const ZEBRA = rgb(0.969, 0.973, 0.98);
const HEADER_FILL = rgb(0.93, 0.94, 0.95);
const ACCENT = rgb(0.0, 0.71, 0.84); // #00B6D7 — Central Studio brand cyan

// Dark header band (body stays white — NOT a full dark-mode document).
const HEADER_BG = rgb(6 / 255, 12 / 255, 16 / 255); // #060C10
const HEADER_TEXT = rgb(1, 1, 1); // white
const HEADER_MUTED = rgb(0.63, 0.69, 0.75); // muted light grey for labels on dark

// ─── Geometry ───────────────────────────────────────────────────────────────
const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 36;
const HEADER_H = 56;
const FOOTER_RULE_Y = 30;
const CONTENT_TOP = PAGE_H - HEADER_H - 10;
const BOTTOM_LIMIT = FOOTER_RULE_Y + 8;
const USABLE_W = PAGE_W - 2 * MARGIN;

const CELL_PAD_Y = 4;
const MAX_CELL_LINES = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Text helpers ─────────────────────────────────────────────────────────────
const bidi = bidiFactory();

// Arabic + Syriac/Thaana neighbours + Arabic Presentation Forms A/B.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
function hasArabic(s: string): boolean {
  return ARABIC_RE.test(s);
}

function rawStr(v: unknown): string {
  if (v == null) return "";
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

// Map common typographic codepoints to ASCII, then drop anything still outside
// WinAnsi (Latin-1) so Helvetica never throws on Latin-only text.
const CHAR_MAP: Record<string, string> = {
  "—": "-", "–": "-", "‘": "'", "’": "'",
  "“": '"', "”": '"', "…": "...", "•": "*",
  "→": "->", "€": "EUR", "™": "(TM)", "·": "-",
};
function sanitizeLatin(s: string): string {
  return s
    .replace(/[—–‘’“”…•→€™·]/g, (c) => CHAR_MAP[c] ?? "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

// For Arabic cells (rendered with the embedded Unicode font) keep ASCII, Latin-1,
// Arabic + presentation forms and joiners; drop anything the font can't cover.
function sanitizeArabic(s: string): string {
  return s.replace(
    /[^\x20-\x7E\xA0-\xFF؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌‍]/g,
    "",
  );
}

function isRtlBase(s: string): boolean {
  for (const ch of s) {
    if (ARABIC_RE.test(ch)) return true;
    if (/[A-Za-z]/.test(ch)) return false;
  }
  return false;
}

/**
 * Turn a logical-order Arabic (or mixed) string into a display-order string:
 * join letters into presentation forms, then apply the Unicode bidi algorithm
 * (mirroring + reordering) so it can be drawn left-to-right by pdf-lib.
 */
function shapeArabic(logical: string): string {
  const reshaped = ArabicReshaper.convertArabic(logical);
  // Pin the base direction from the source text so an Arabic-primary value always
  // resolves RTL (rather than relying on auto-detection, which would flip to LTR
  // for a value that merely starts with a Latin character).
  const baseDir = isRtlBase(logical) ? "rtl" : "ltr";
  const embedding = bidi.getEmbeddingLevels(reshaped, baseDir);
  const chars = reshaped.split(""); // all relevant glyphs are BMP → unit == codepoint
  const mirrored = bidi.getMirroredCharactersMap(reshaped, embedding);
  mirrored.forEach((rep, idx) => {
    chars[idx] = rep;
  });
  for (const [s, e] of bidi.getReorderSegments(reshaped, embedding)) {
    let i = s;
    let j = e;
    while (i < j) {
      const t = chars[i];
      chars[i] = chars[j];
      chars[j] = t;
      i++;
      j--;
    }
  }
  return chars.join("");
}

/** Greedy word-wrap for Latin text; hard-breaks over-long words; caps lines. */
function wrapLatin(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  const pushHardBroken = (word: string) => {
    let chunk = "";
    for (const ch of word) {
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxW) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  };
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(cand, size) <= maxW) {
      cur = cand;
    } else if (!cur) {
      pushHardBroken(w);
    } else {
      lines.push(cur);
      if (font.widthOfTextAtSize(w, size) > maxW) pushHardBroken(w);
      else cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > MAX_CELL_LINES) {
    const capped = lines.slice(0, MAX_CELL_LINES);
    capped[MAX_CELL_LINES - 1] = `${capped[MAX_CELL_LINES - 1].slice(0, -3)}...`;
    return capped;
  }
  return lines.length ? lines : [""];
}

/** Word-wrap Arabic in logical order, returning display-shaped lines. */
function wrapArabic(logical: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = logical.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || font.widthOfTextAtSize(shapeArabic(cand), size) <= maxW) {
      cur = cand;
    } else {
      lines.push(shapeArabic(cur));
      cur = w;
    }
  }
  if (cur) lines.push(shapeArabic(cur));
  return lines.length > MAX_CELL_LINES ? lines.slice(0, MAX_CELL_LINES) : lines;
}

function fmtDateLong(ymd?: string): string {
  if (!ymd) return "All";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
// Cairo-local timestamp, independent of the server's own timezone: the explicit
// `timeZone: "Africa/Cairo"` makes Intl convert from the instant, and the offset
// label (UTC+2 EET in winter / UTC+3 EEST in summer) is derived from the same
// instant so DST is always reflected correctly.
function fmtGeneratedAt(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const utc = offset.replace("GMT", "UTC");
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} (${utc})`;
}
function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
function titleCase(s: string): string {
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

export async function buildPdfBuffer(input: PdfReportInput): Promise<Buffer> {
  const { title, entityLabel, columns, rows, summary, filters, generatedBy } = input;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setAuthor("Central Studio");
  doc.setCreator("Central Studio Admin System");
  doc.setProducer("Central Studio Admin System");
  doc.setSubject("Operational Report");
  doc.setKeywords(["Central Studio", "Reporting"]);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Embed the Arabic font only when the data actually contains Arabic, so
  // Latin-only reports stay lean (no font embedded at all). NOTE: subsetting is
  // intentionally OFF — @pdf-lib/fontkit's subsetter produces blank glyphs for
  // Amiri, so we embed the full font (~430KB) to guarantee correct rendering.
  const anyArabic =
    rows.some((r) => columns.some((c) => hasArabic(rawStr(r[c.key])))) ||
    Object.values(summary).some((v) => hasArabic(rawStr(v))) ||
    hasArabic(rawStr(generatedBy));
  let arabicFont: PDFFont | null = null;
  if (anyArabic) {
    try {
      arabicFont = await doc.embedFont(Buffer.from(AMIRI_TTF_BASE64, "base64"), { subset: false });
    } catch {
      arabicFont = null; // fall back to "?" rather than failing the whole export
    }
  }
  const arFont = arabicFont;

  let logo: PDFImage | null = null;
  try {
    logo = await doc.embedPng(Buffer.from(CENTRAL_LOGO_PNG_BASE64, "base64"));
  } catch {
    logo = null; // logo is decorative; never fail the export over it
  }

  const generatedAt = fmtGeneratedAt(new Date());

  // Dense tables (many columns, e.g. the 11-column bookings report) use a smaller
  // font and tighter padding so wide rows stay on one line instead of wrapping.
  const dense = columns.length >= 9;
  const BODY_SIZE = dense ? 7 : 8;
  const LINE_H = dense ? 8.4 : 9.6;
  const CELL_PAD_X = dense ? 4 : 6;

  // ── Per-cell preparation: pick font (Latin vs Arabic), shape, wrap, align. ──
  interface Cell {
    lines: string[];
    font: PDFFont;
    rtl: boolean;
  }
  const prepareCell = (value: unknown, maxW: number, numeric: boolean): Cell => {
    const raw = rawStr(value);
    if (arFont && hasArabic(raw)) {
      const logical = sanitizeArabic(raw);
      return { lines: wrapArabic(logical, arFont, BODY_SIZE, maxW), font: arFont, rtl: isRtlBase(logical) };
    }
    return { lines: wrapLatin(sanitizeLatin(raw), font, BODY_SIZE, maxW), font, rtl: numeric };
  };
  // Single-line prep for header/filter/summary values (no wrapping).
  const prepInline = (value: unknown, latinFont: PDFFont): { text: string; font: PDFFont } => {
    const raw = rawStr(value);
    if (arFont && hasArabic(raw)) return { text: shapeArabic(sanitizeArabic(raw)), font: arFont };
    return { text: sanitizeLatin(raw), font: latinFont };
  };
  const valueWidth = (value: unknown): number => {
    const raw = rawStr(value);
    if (arFont && hasArabic(raw)) return arFont.widthOfTextAtSize(shapeArabic(sanitizeArabic(raw)), BODY_SIZE);
    return font.widthOfTextAtSize(sanitizeLatin(raw), BODY_SIZE);
  };

  // ── Column widths: measure header + sampled content, cap wide text columns,
  // then fit to the page (scale down if over budget, share slack if under) so
  // short columns (ids, dates, statuses) don't needlessly wrap. ──
  const sample = rows.slice(0, 300);
  const PAD = 2 * CELL_PAD_X;
  const COL_CAP = 150;
  let colW = columns.map((c) => {
    let valW = 0;
    for (const r of sample) {
      const w = valueWidth(r[c.key]);
      if (w > valW) valW = w;
    }
    const headW = bold.widthOfTextAtSize(sanitizeLatin(c.label), BODY_SIZE);
    return Math.min(Math.max(headW, valW) + PAD + 4, COL_CAP);
  });
  const totalW = colW.reduce((a, b) => a + b, 0) || 1;
  if (totalW > USABLE_W) {
    const k = USABLE_W / totalW;
    colW = colW.map((w) => w * k);
  } else {
    const slack = USABLE_W - totalW;
    colW = colW.map((w) => w + slack * (w / totalW));
  }
  const colX: number[] = [];
  let acc = MARGIN;
  for (const w of colW) {
    colX.push(acc);
    acc += w;
  }
  const tableRight = acc;
  const numericCol = columns.map((c) => rows.some((r) => typeof r[c.key] === "number"));

  // ── Mutable page cursor ──
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = CONTENT_TOP;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = CONTENT_TOP;
  };

  // Draw one prepared cell's lines, left- or right-aligned within its column.
  const drawCell = (cell: Cell, i: number) => {
    const alignRight = cell.rtl;
    cell.lines.forEach((ln, li) => {
      const tx = alignRight
        ? colX[i] + colW[i] - CELL_PAD_X - cell.font.widthOfTextAtSize(ln, BODY_SIZE)
        : colX[i] + CELL_PAD_X;
      page.drawText(ln, { x: tx, y: y - CELL_PAD_Y - BODY_SIZE - li * LINE_H, size: BODY_SIZE, font: cell.font, color: INK });
    });
  };

  const drawTableHeader = () => {
    const lineSets = columns.map((c, i) => wrapLatin(sanitizeLatin(c.label), bold, BODY_SIZE, colW[i] - 2 * CELL_PAD_X));
    const maxLines = Math.max(...lineSets.map((l) => l.length));
    const hH = maxLines * LINE_H + 2 * CELL_PAD_Y;
    page.drawRectangle({ x: MARGIN, y: y - hH, width: USABLE_W, height: hH, color: HEADER_FILL });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: tableRight, y }, thickness: 0.8, color: SUBTLE });
    page.drawLine({ start: { x: MARGIN, y: y - hH }, end: { x: tableRight, y: y - hH }, thickness: 0.8, color: SUBTLE });
    lineSets.forEach((lines, i) => {
      lines.forEach((ln, li) => {
        const tx = numericCol[i]
          ? colX[i] + colW[i] - CELL_PAD_X - bold.widthOfTextAtSize(ln, BODY_SIZE)
          : colX[i] + CELL_PAD_X;
        page.drawText(ln, { x: tx, y: y - CELL_PAD_Y - BODY_SIZE - li * LINE_H, size: BODY_SIZE, font: bold, color: INK });
      });
    });
    y -= hH;
  };

  // ── Page 1: filters strip ──
  const filterItems: [string, unknown][] = [
    ["Date Range", `${fmtDateLong(filters.from)}  to  ${fmtDateLong(filters.to)}`],
    ["Status", filters.status && filters.status !== "all" ? titleCase(filters.status) : "All"],
    ["Entity", entityLabel],
    ["Generated By", generatedBy || "Admin"],
  ];
  const fColW = USABLE_W / filterItems.length;
  filterItems.forEach(([label, value], i) => {
    const fx = MARGIN + i * fColW;
    page.drawText(label.toUpperCase(), { x: fx, y: y - 8, size: 7, font, color: SUBTLE });
    const v = prepInline(value, bold);
    page.drawText(v.text, { x: fx, y: y - 22, size: 9.5, font: v.font, color: INK });
  });
  y -= 34;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: tableRight, y }, thickness: 0.6, color: LINE });
  y -= 22;

  // ── Page 1: executive summary cards ──
  const summaryEntries = Object.entries(summary);
  if (summaryEntries.length > 0) {
    page.drawText("Executive Summary", { x: MARGIN, y: y - 10, size: 10.5, font: bold, color: INK });
    y -= 24;
    const n = summaryEntries.length;
    const gap = 10;
    const cardW = (USABLE_W - (n - 1) * gap) / n;
    const cardH = 48;
    summaryEntries.forEach(([key, val], i) => {
      const cx = MARGIN + i * (cardW + gap);
      const cy = y - cardH;
      page.drawRectangle({ x: cx, y: cy, width: cardW, height: cardH, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: cx, y: cy, width: 2.5, height: cardH, color: ACCENT });
      const label = humanizeKey(key).toUpperCase();
      page.drawText(label.length > 22 ? `${label.slice(0, 20)}...` : label, { x: cx + 10, y: cy + cardH - 16, size: 7, font, color: SUBTLE });
      const v = prepInline(val, bold);
      const valSize = v.text.length > 9 ? 14 : 18;
      page.drawText(v.text, { x: cx + 10, y: cy + 9, size: valSize, font: v.font, color: INK });
    });
    y -= cardH + 22;
  }

  // ── Detail caption + table ──
  page.drawText("Report Detail", { x: MARGIN, y: y - 10, size: 10.5, font: bold, color: INK });
  const caption = `${rows.length.toLocaleString("en-US")} row${rows.length !== 1 ? "s" : ""}`;
  page.drawText(caption, { x: tableRight - font.widthOfTextAtSize(caption, 8), y: y - 9, size: 8, font, color: SUBTLE });
  y -= 22;

  if (rows.length === 0) {
    page.drawText("No records match the selected range and filters.", { x: MARGIN, y: y - 14, size: 10, font, color: SUBTLE });
  } else {
    drawTableHeader();
    rows.forEach((row, idx) => {
      const cells = columns.map((c, i) => prepareCell(row[c.key], colW[i] - 2 * CELL_PAD_X, numericCol[i]));
      const maxLines = Math.max(...cells.map((c) => c.lines.length));
      const rowH = maxLines * LINE_H + 2 * CELL_PAD_Y;
      if (y - rowH < BOTTOM_LIMIT) {
        newPage();
        drawTableHeader();
      }
      if (idx % 2 === 1) {
        page.drawRectangle({ x: MARGIN, y: y - rowH, width: USABLE_W, height: rowH, color: ZEBRA });
      }
      cells.forEach((cell, i) => drawCell(cell, i));
      page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: tableRight, y: y - rowH }, thickness: 0.4, color: LINE });
      y -= rowH;
    });
  }

  // ── Finalize: header + footer on every page (now that page total is known) ──
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((pg, i) => {
    const w = pg.getWidth();
    const h = pg.getHeight();

    // Dark header band — full width, on every page (body below stays white).
    pg.drawRectangle({ x: 0, y: h - HEADER_H, width: w, height: HEADER_H, color: HEADER_BG });
    // thin cyan brand rule along the band's bottom edge
    pg.drawRectangle({ x: 0, y: h - HEADER_H, width: w, height: 1.5, color: ACCENT });

    // Header — left: logo + wordmark (logo repeats on every page; shows well on dark)
    const logoSize = 30;
    if (logo) {
      pg.drawImage(logo, { x: MARGIN, y: h - 12 - logoSize, width: logoSize, height: logoSize });
    }
    pg.drawText("Central Studio", { x: MARGIN + (logo ? logoSize + 8 : 0), y: h - 30, size: 12, font: bold, color: HEADER_TEXT });

    // Header — center: report title
    const tW = bold.widthOfTextAtSize(title, 14);
    pg.drawText(title, { x: (w - tW) / 2, y: h - 30, size: 14, font: bold, color: HEADER_TEXT });
    pg.drawLine({ start: { x: (w - 64) / 2, y: h - 40 }, end: { x: (w + 64) / 2, y: h - 40 }, thickness: 2, color: ACCENT });

    // Header — right: generated stamp (Cairo time)
    const gl = "GENERATED";
    pg.drawText(gl, { x: w - MARGIN - font.widthOfTextAtSize(gl, 7), y: h - 21, size: 7, font, color: HEADER_MUTED });
    pg.drawText(generatedAt, { x: w - MARGIN - bold.widthOfTextAtSize(generatedAt, 9), y: h - 33, size: 9, font: bold, color: HEADER_TEXT });

    // Footer
    pg.drawLine({ start: { x: MARGIN, y: FOOTER_RULE_Y }, end: { x: w - MARGIN, y: FOOTER_RULE_Y }, thickness: 0.6, color: LINE });
    pg.drawText("Central Studio", { x: MARGIN, y: 17, size: 8, font, color: SUBTLE });
    const mid = `Page ${i + 1} of ${total}`;
    pg.drawText(mid, { x: (w - font.widthOfTextAtSize(mid, 8)) / 2, y: 17, size: 8, font, color: SUBTLE });
    const conf = "Confidential";
    pg.drawText(conf, { x: w - MARGIN - font.widthOfTextAtSize(conf, 8), y: 17, size: 8, font, color: SUBTLE });
  });

  return Buffer.from(await doc.save());
}
