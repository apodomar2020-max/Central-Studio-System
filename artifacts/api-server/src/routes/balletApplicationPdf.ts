import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { bidiFontkit } from "./arabicFontkit";
import { CENTRAL_LOGO_PNG_BASE64 } from "./centralLogo";
import { TAJAWAL_TTF_BASE64 } from "./tajawalFont";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const HEADER_H = 62;
const FOOTER_H = 36;
const CONTENT_TOP = PAGE_H - HEADER_H - 24;
const CONTENT_BOTTOM = FOOTER_H + 16;
const USABLE_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.08, 0.1, 0.14);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.86, 0.88, 0.91);
const SOFT = rgb(0.965, 0.972, 0.98);
const ACCENT = rgb(0, 0.71, 0.84);
const HEADER_BG = rgb(6 / 255, 12 / 255, 16 / 255);
const WHITE = rgb(1, 1, 1);
const DASH = "—";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const CHAR_MAP: Record<string, string> = { "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "*", "→": "->", "™": "(TM)", "·": "-" };

interface PdfAttendanceSummary {
  billingMonth?: unknown;
  subscriptionDisplayStatus?: unknown;
  subscriptionStartDate?: unknown;
  originalExpiresAt?: unknown;
  subscriptionExpiresAt?: unknown;
  daysRemaining?: unknown;
  isRenewal?: unknown;
  monthlyHours?: unknown;
  attendedHours?: unknown;
  absentHours?: unknown;
  consumedHours?: unknown;
  remainingHours?: unknown;
}

interface PdfPayment {
  id?: unknown;
  packageName?: unknown;
  amountEgp?: unknown;
  billingMonth?: unknown;
  paymentMethod?: unknown;
  status?: unknown;
  subscriptionDisplayStatus?: unknown;
  subscriptionStartDate?: unknown;
  originalExpiresAt?: unknown;
  subscriptionExpiresAt?: unknown;
  daysRemaining?: unknown;
  isRenewal?: unknown;
  updatedAt?: unknown;
}

export interface BalletApplicationPdfInput {
  application: Record<string, unknown>;
  assessmentSchedule?: Record<string, unknown> | null;
  level: Record<string, unknown> | null;
  group: Record<string, unknown> | null;
  groupSchedules: Record<string, unknown>[];
  events: Record<string, unknown>[];
  payments: PdfPayment[];
  currentPayment: PdfPayment | null;
  attendanceSummary: PdfAttendanceSummary | null;
  generatedBy: string;
  generatedAt?: Date;
}

function hasArabic(s: string): boolean { return ARABIC_RE.test(s); }
function sanitizeLatin(s: string): string { return s.replace(/[—–‘’“”…•→™·]/g, (c) => CHAR_MAP[c] ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?"); }
function sanitizeArabic(s: string): string { return s.replace(/[^\x20-\x7E\xA0-\xFF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200C\u200D]/g, ""); }
function asText(value: unknown): string { return value == null || value === "" ? DASH : String(value); }
function titleCase(value: unknown): string { const s = asText(value); return s === DASH ? DASH : s.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(); }
function money(value: unknown): string { return typeof value === "number" ? `${value} EGP` : asText(value); }
function boolText(value: unknown): string { return value === true ? "Yes" : value === false ? "No" : DASH; }
function formatDate(value?: unknown): string {
  if (!value) return DASH;
  const parsed = new Date(String(value).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/\+00$/, "Z"));
  if (Number.isNaN(parsed.getTime())) return DASH;
  return `${String(parsed.getDate()).padStart(2, "0")} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}
function formatDateTime(value?: unknown): string {
  if (!value) return DASH;
  const parsed = new Date(String(value).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/\+00$/, "Z"));
  if (Number.isNaN(parsed.getTime())) return DASH;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(parsed);
}
function safeFilenamePart(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "application"; }
export function balletApplicationPdfFilename(applicationId: number, childName: string): string { return `Ballet-Application-${applicationId}-${safeFilenamePart(childName)}.pdf`; }

function wrapText(text: string, font: PDFFont, size: number, maxW: number, maxLines = 5): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) current = candidate;
    else { if (current) lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) { const capped = lines.slice(0, maxLines); capped[maxLines - 1] = `${capped[maxLines - 1].slice(0, Math.max(0, capped[maxLines - 1].length - 3))}...`; return capped; }
  return lines;
}

export async function buildBalletApplicationPdfBuffer(input: BalletApplicationPdfInput): Promise<Buffer> {
  const { application: app, assessmentSchedule, level, group, groupSchedules, events, payments, currentPayment, attendanceSummary, generatedBy } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const doc = await PDFDocument.create();
  doc.registerFontkit(bidiFontkit as Parameters<typeof doc.registerFontkit>[0]);
  doc.setTitle(`Central Studio Ballet Application - ${asText(app.childName)}`);
  doc.setAuthor("Central Studio");
  doc.setCreator("Central Studio Admin System");
  doc.setProducer("Central Studio Admin System");
  doc.setSubject("Ballet Application Export");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let arabicFont: PDFFont | null = null;
  try { arabicFont = await doc.embedFont(Buffer.from(TAJAWAL_TTF_BASE64, "base64"), { subset: false }); } catch { arabicFont = null; }
  let logo: PDFImage | null = null;
  try { logo = await doc.embedPng(Buffer.from(CENTRAL_LOGO_PNG_BASE64, "base64")); } catch { logo = null; }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = CONTENT_TOP;
  const pickFont = (text: string, preferBold = false): PDFFont => arabicFont && hasArabic(text) ? arabicFont : (preferBold ? bold : font);
  const clean = (text: string): string => arabicFont && hasArabic(text) ? sanitizeArabic(text) : sanitizeLatin(text);
  const draw = (text: string, x: number, yPos: number, size = 9, color = INK, preferBold = false, maxW?: number) => {
    const prepared = clean(text); const selected = pickFont(prepared, preferBold);
    if (maxW) { const lines = wrapText(prepared, selected, size, maxW); lines.forEach((line, i) => page.drawText(line, { x, y: yPos - i * (size + 3), size, font: selected, color })); return lines.length * (size + 3); }
    page.drawText(prepared, { x, y: yPos, size, font: selected, color }); return size + 3;
  };
  const ensure = (height: number) => { if (y - height < CONTENT_BOTTOM) { page = doc.addPage([PAGE_W, PAGE_H]); y = CONTENT_TOP; } };
  const section = (title: string) => { ensure(38); y -= 12; page.drawRectangle({ x: MARGIN, y: y - 18, width: USABLE_W, height: 24, color: SOFT, borderColor: LINE, borderWidth: 0.8 }); page.drawRectangle({ x: MARGIN, y: y - 18, width: 3, height: 24, color: ACCENT }); draw(title, MARGIN + 12, y - 10, 11, INK, true); y -= 34; };
  const keyValues = (items: [string, string][]) => { const colW = (USABLE_W - 16) / 2; const rowH = 38; for (let i = 0; i < items.length; i += 2) { ensure(rowH + 4); for (let c = 0; c < 2; c += 1) { const item = items[i + c]; if (!item) continue; const x = MARGIN + c * (colW + 16); page.drawRectangle({ x, y: y - rowH, width: colW, height: rowH, color: WHITE, borderColor: LINE, borderWidth: 0.6 }); draw(item[0].toUpperCase(), x + 9, y - 13, 6.5, MUTED, true); draw(item[1], x + 9, y - 29, 9, INK, false, colW - 18); } y -= rowH + 7; } };
  const table = (columns: { label: string; width: number }[], rows: string[][]) => {
    if (!rows.length) { ensure(30); page.drawRectangle({ x: MARGIN, y: y - 26, width: USABLE_W, height: 26, color: WHITE, borderColor: LINE, borderWidth: 0.6 }); draw("No records found.", MARGIN + 10, y - 16, 8.5, MUTED); y -= 34; return; }
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0); const scale = totalWidth > USABLE_W ? USABLE_W / totalWidth : 1; const widths = columns.map((col) => col.width * scale); const headerH = 24;
    ensure(headerH + 28); page.drawRectangle({ x: MARGIN, y: y - headerH, width: USABLE_W, height: headerH, color: SOFT, borderColor: LINE, borderWidth: 0.6 }); let x = MARGIN; columns.forEach((col, i) => { draw(col.label, x + 5, y - 15, 7, INK, true, widths[i] - 10); x += widths[i]; }); y -= headerH;
    rows.forEach((row, rowIndex) => { const size = 7; const lineSets = row.map((cell, i) => wrapText(clean(cell), pickFont(cell), size, widths[i] - 10, 3)); const rowH = Math.max(24, Math.max(...lineSets.map((lines) => lines.length)) * 10 + 10); ensure(rowH + headerH); if (y === CONTENT_TOP) { page.drawRectangle({ x: MARGIN, y: y - headerH, width: USABLE_W, height: headerH, color: SOFT, borderColor: LINE, borderWidth: 0.6 }); let hx = MARGIN; columns.forEach((col, i) => { draw(col.label, hx + 5, y - 15, 7, INK, true, widths[i] - 10); hx += widths[i]; }); y -= headerH; } page.drawRectangle({ x: MARGIN, y: y - rowH, width: USABLE_W, height: rowH, color: rowIndex % 2 === 0 ? WHITE : SOFT, borderColor: LINE, borderWidth: 0.4 }); x = MARGIN; lineSets.forEach((lines, i) => { const selected = pickFont(row[i]); lines.forEach((line, lineIndex) => page.drawText(line, { x: x + 5, y: y - 13 - lineIndex * 10, size, font: selected, color: INK })); x += widths[i]; }); y -= rowH; }); y -= 14;
  };

  page.drawRectangle({ x: MARGIN, y: y - 118, width: USABLE_W, height: 118, color: SOFT, borderColor: LINE, borderWidth: 1 });
  page.drawRectangle({ x: MARGIN, y: y - 118, width: 5, height: 118, color: ACCENT });
  if (logo) page.drawImage(logo, { x: MARGIN + 16, y: y - 48, width: 32, height: 32 });
  draw("Central Studio", MARGIN + 58, y - 28, 12, INK, true);
  draw("Ballet Application", MARGIN + 58, y - 45, 8, MUTED);
  draw(asText(app.childName), MARGIN + 16, y - 80, 21, INK, true, USABLE_W - 32);
  draw(`Application #${asText(app.id)} - ${titleCase(app.status)} - Payment ${titleCase(currentPayment?.status)}`, MARGIN + 16, y - 103, 9, MUTED, false, USABLE_W - 32);
  y -= 138;

  keyValues([["Generated", formatDateTime(generatedAt.toISOString())], ["Application Status", titleCase(app.status)], ["Application Number", `#${asText(app.id)}`], ["Payment Status", titleCase(currentPayment?.status)]]);

  section("Parent / Guardian"); keyValues([["Name", asText(app.parentName)], ["Phone", asText(app.parentPhone)], ["Email", asText(app.parentEmail)], ["Student/Account ID", asText(app.parentStudentId)]]);
  section("Emergency Contact"); keyValues([["Name", asText(app.emergencyContactName)], ["Phone", asText(app.emergencyContactPhone)]]);
  section("Child"); keyValues([["Name", asText(app.childName)], ["Date of Birth", asText(app.childBirthday)], ["Age", asText(app.childAge)], ["Gender", asText(app.childGender)], ["Linked Child Profile ID", asText(app.childId)], ["Submitted", formatDateTime(app.createdAt)]]);
  const assessmentText = assessmentSchedule
    ? `${asText(assessmentSchedule.classTitle)} - ${asText(assessmentSchedule.levelName)} - ${asText(app.assessmentDate)} ${asText(assessmentSchedule.startTime)}-${asText(assessmentSchedule.endTime)}`
    : asText(app.assessmentDate);
  section("Application"); keyValues([["Previous Ballet Experience", boolText(app.previousExperience)], ["Assessment", assessmentText], ["Preferred Payment Method", titleCase(app.preferredPaymentMethod)], ["Last Update", formatDateTime(app.updatedAt)]]); keyValues([["Experience Details", asText(app.experienceDetails)], ["Medical Notes", asText(app.medicalNotes)], ["Additional Notes", asText(app.notes)], ["Admin Notes", asText(app.adminNotes)]]);
  section("Assignment"); keyValues([["Assigned Level", asText(level?.name)], ["Assigned Group", asText(group?.name)], ["Assigned At", formatDateTime(app.assignedAt)], ["Instructor", groupSchedules.map((s) => asText(s.instructorName)).filter((v, i, arr) => v !== DASH && arr.indexOf(v) === i).join(", ") || DASH]]); table([{ label: "Class", width: 160 }, { label: "Schedule", width: 120 }, { label: "Instructor", width: 120 }, { label: "Status", width: 70 }], groupSchedules.map((s) => [asText(s.classTitle), `${asText(s.dayOfWeek)} ${asText(s.startTime)}-${asText(s.endTime)}`, asText(s.instructorName), titleCase(s.status)]));
  section("Payment"); keyValues([["Package", asText(currentPayment?.packageName)], ["Amount", money(currentPayment?.amountEgp)], ["Billing Month", asText(currentPayment?.billingMonth)], ["Actual Method", titleCase(currentPayment?.paymentMethod)], ["Payment Status", titleCase(currentPayment?.status)], ["Subscription Status", asText(currentPayment?.subscriptionDisplayStatus)], ["Subscription Start", asText(currentPayment?.subscriptionStartDate)], ["Original Expiry", asText(currentPayment?.originalExpiresAt)], ["Current Expiry", asText(currentPayment?.subscriptionExpiresAt)], ["Days Remaining", asText(currentPayment?.daysRemaining)], ["Renewal", currentPayment?.isRenewal ? "Yes" : "No"], ["Payment Updated", formatDateTime(currentPayment?.updatedAt)]]);
  if (payments.length > 1) table([{ label: "Payment", width: 52 }, { label: "Package", width: 92 }, { label: "Amount", width: 55 }, { label: "Month", width: 55 }, { label: "Status", width: 58 }, { label: "Sub.", width: 78 }, { label: "Period", width: 110 }, { label: "Updated", width: 82 }], payments.map((p) => [`#${asText(p.id)}`, asText(p.packageName), money(p.amountEgp), asText(p.billingMonth), titleCase(p.status), asText(p.subscriptionDisplayStatus), `${asText(p.subscriptionStartDate)} to ${asText(p.subscriptionExpiresAt)}`, formatDateTime(p.updatedAt)]));
  if (attendanceSummary) { section("Attendance Summary"); keyValues([["Billing Month", asText(attendanceSummary.billingMonth)], ["Monthly Hours", asText(attendanceSummary.monthlyHours)], ["Attended Hours", asText(attendanceSummary.attendedHours)], ["Absent Hours", asText(attendanceSummary.absentHours)], ["Consumed Hours", asText(attendanceSummary.consumedHours)], ["Remaining Hours", asText(attendanceSummary.remainingHours)]]); }
  section("History"); table([{ label: "From", width: 70 }, { label: "To", width: 80 }, { label: "Note", width: 220 }, { label: "Actor", width: 90 }, { label: "Date", width: 100 }], events.map((ev) => [titleCase(ev.fromStatus), titleCase(ev.toStatus), asText(ev.note), asText(ev.changedByFullName ?? ev.changedByUsername), formatDateTime(ev.createdAt)]));

  const pages = doc.getPages();
  pages.forEach((pg, index) => { const { width, height } = pg.getSize(); pg.drawRectangle({ x: 0, y: height - HEADER_H, width, height: HEADER_H, color: HEADER_BG }); pg.drawRectangle({ x: 0, y: height - HEADER_H, width, height: 2, color: ACCENT }); if (logo) pg.drawImage(logo, { x: MARGIN, y: height - 42, width: 26, height: 26 }); pg.drawText("Central Studio", { x: MARGIN + (logo ? 36 : 0), y: height - 28, size: 11, font: bold, color: WHITE }); pg.drawText("Ballet Application", { x: MARGIN + (logo ? 36 : 0), y: height - 44, size: 7.5, font, color: rgb(0.76, 0.81, 0.86) }); const right = `Generated ${formatDateTime(generatedAt.toISOString())}`; pg.drawText(right, { x: width - MARGIN - font.widthOfTextAtSize(right, 7), y: height - 30, size: 7, font, color: rgb(0.76, 0.81, 0.86) }); pg.drawLine({ start: { x: MARGIN, y: FOOTER_H }, end: { x: width - MARGIN, y: FOOTER_H }, thickness: 0.6, color: LINE }); pg.drawText(`Exported by ${sanitizeLatin(generatedBy || "Admin")}`, { x: MARGIN, y: 20, size: 7, font, color: MUTED }); const pageText = `Page ${index + 1} of ${pages.length}`; pg.drawText(pageText, { x: (width - font.widthOfTextAtSize(pageText, 7)) / 2, y: 20, size: 7, font, color: MUTED }); const confidential = "Confidential"; pg.drawText(confidential, { x: width - MARGIN - font.widthOfTextAtSize(confidential, 7), y: 20, size: 7, font, color: MUTED }); });
  return Buffer.from(await doc.save());
}
