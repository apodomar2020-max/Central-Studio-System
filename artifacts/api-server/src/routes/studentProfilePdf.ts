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

const NOT_COLLECTED = "Not collected yet";
const EXPORT_LIMIT = 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const CHAR_MAP: Record<string, string> = {
  "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", "•": "*", "→": "->", "™": "(TM)", "·": "-",
};

export interface StudentProfilePdfData {
  user: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    accountType: string | null;
    authProvider: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    city: string | null;
    nationality: string | null;
    howDidYouHearAboutUs: string | null;
  };
  completion: {
    percent: number;
    isComplete: boolean;
    verificationBadge: boolean;
  } | null;
  danceInterests: { name: string }[];
  children: {
    fullName: string;
    gender: string;
    birthday: string | null;
    age: number | null;
    medicalNotes: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
  }[];
  bookings: {
    id: number;
    bookingNumber: string;
    participantName: string;
    participantType: "self" | "child";
    classTitle: string | null;
    occurrenceDate: string | null;
    scheduleStartTime: string | null;
    scheduleEndTime: string | null;
    bookingStatus: string;
    paymentStatus: string;
    createdAt: string;
  }[];
  attendance: {
    classTitle: string | null;
    instructorName: string | null;
    checkedInAt: string;
    status: string;
    creditDeducted: boolean;
  }[];
  feedback: {
    classTitle: string | null;
    instructorName: string | null;
    rating: number;
    commentPreview: string | null;
    hasComment: boolean;
    reviewStatus: string;
    submittedAt: string | null;
  }[];
  packages: {
    recent: {
      packageName: string;
      status: string;
      totalCredits: number;
      remainingCredits: number;
      activatedAt: string | null;
      expiresAt: string | null;
      createdAt: string;
    }[];
  };
  creditTransactions: {
    type: string;
    delta: number;
    balanceAfter: number;
    notes: string | null;
    createdBy: string;
    createdAt: string;
  }[];
  permissions: {
    canViewChildren: boolean;
    canViewBookings: boolean;
    canViewAttendance: boolean;
    canViewPackages: boolean;
    canViewCredits: boolean;
    canViewFeedback: boolean;
    canViewFeedbackComments: boolean;
    canViewProfileCompletion: boolean;
  };
}

export interface StudentProfilePdfInput {
  overview: StudentProfilePdfData;
  generatedBy: string;
  generatedAt?: Date;
}

function hasArabic(s: string): boolean {
  return ARABIC_RE.test(s);
}

function sanitizeLatin(s: string): string {
  return s
    .replace(/[—–‘’“”…•→™·]/g, (c) => CHAR_MAP[c] ?? "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function sanitizeArabic(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌‍]/g, "");
}

function asText(value: unknown): string {
  if (value == null || value === "") return NOT_COLLECTED;
  return String(value);
}

function titleCase(value: string | null | undefined): string {
  if (!value) return NOT_COLLECTED;
  return value.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function formatDate(value?: string | null): string {
  if (!value) return NOT_COLLECTED;
  const parsed = new Date(String(value).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/\+00$/, "Z"));
  if (Number.isNaN(parsed.getTime())) return NOT_COLLECTED;
  return `${String(parsed.getDate()).padStart(2, "0")} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return NOT_COLLECTED;
  const parsed = new Date(String(value).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/\+00$/, "Z"));
  if (Number.isNaN(parsed.getTime())) return NOT_COLLECTED;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function generatedStamp(d: Date): string {
  return formatDateTime(d.toISOString());
}

function wrapText(text: string, font: PDFFont, size: number, maxW: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxW) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const capped = lines.slice(0, maxLines);
    capped[maxLines - 1] = `${capped[maxLines - 1].slice(0, Math.max(0, capped[maxLines - 1].length - 3))}...`;
    return capped;
  }
  return lines;
}

function safeFilenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "user";
}

export function studentProfilePdfFilename(studentId: number, name: string): string {
  return `central-studio-user-${studentId}-${safeFilenamePart(name)}.pdf`;
}

export async function buildStudentProfilePdfBuffer(input: StudentProfilePdfInput): Promise<Buffer> {
  const { overview, generatedBy } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const doc = await PDFDocument.create();
  doc.registerFontkit(bidiFontkit as Parameters<typeof doc.registerFontkit>[0]);
  doc.setTitle(`Central Studio User Profile - ${overview.user.name}`);
  doc.setAuthor("Central Studio");
  doc.setCreator("Central Studio Admin System");
  doc.setProducer("Central Studio Admin System");
  doc.setSubject("User 360 Profile Export");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let arabicFont: PDFFont | null = null;
  try {
    arabicFont = await doc.embedFont(Buffer.from(TAJAWAL_TTF_BASE64, "base64"), { subset: false });
  } catch {
    arabicFont = null;
  }
  let logo: PDFImage | null = null;
  try {
    logo = await doc.embedPng(Buffer.from(CENTRAL_LOGO_PNG_BASE64, "base64"));
  } catch {
    logo = null;
  }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = CONTENT_TOP;

  const pickFont = (text: string, preferBold = false): PDFFont => {
    if (arabicFont && hasArabic(text)) return arabicFont;
    return preferBold ? bold : font;
  };
  const clean = (text: string): string => (arabicFont && hasArabic(text) ? sanitizeArabic(text) : sanitizeLatin(text));
  const draw = (text: string, x: number, yPos: number, size = 9, color = INK, preferBold = false, maxW?: number) => {
    const prepared = clean(text);
    const selected = pickFont(prepared, preferBold);
    if (maxW) {
      const lines = wrapText(prepared, selected, size, maxW);
      lines.forEach((line, index) => page.drawText(line, { x, y: yPos - index * (size + 3), size, font: selected, color }));
      return lines.length * (size + 3);
    }
    page.drawText(prepared, { x, y: yPos, size, font: selected, color });
    return size + 3;
  };
  const ensure = (height: number) => {
    if (y - height < CONTENT_BOTTOM) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = CONTENT_TOP;
    }
  };
  const section = (title: string) => {
    ensure(38);
    y -= 12;
    page.drawRectangle({ x: MARGIN, y: y - 18, width: USABLE_W, height: 24, color: SOFT, borderColor: LINE, borderWidth: 0.8 });
    page.drawRectangle({ x: MARGIN, y: y - 18, width: 3, height: 24, color: ACCENT });
    draw(title, MARGIN + 12, y - 10, 11, INK, true);
    y -= 34;
  };
  const empty = (message: string) => {
    ensure(30);
    page.drawRectangle({ x: MARGIN, y: y - 26, width: USABLE_W, height: 26, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.6 });
    draw(message, MARGIN + 10, y - 16, 8.5, MUTED);
    y -= 34;
  };
  const keyValues = (items: [string, string][]) => {
    const colW = (USABLE_W - 16) / 2;
    const rowH = 38;
    for (let i = 0; i < items.length; i += 2) {
      ensure(rowH + 4);
      for (let c = 0; c < 2; c += 1) {
        const item = items[i + c];
        if (!item) continue;
        const x = MARGIN + c * (colW + 16);
        page.drawRectangle({ x, y: y - rowH, width: colW, height: rowH, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.6 });
        draw(item[0].toUpperCase(), x + 9, y - 13, 6.5, MUTED, true);
        draw(item[1], x + 9, y - 29, 9, INK, false, colW - 18);
      }
      y -= rowH + 7;
    }
  };
  const table = (columns: { label: string; width: number }[], rows: string[][], limitMessage?: string) => {
    if (limitMessage) {
      ensure(18);
      draw(limitMessage, MARGIN, y - 10, 7.5, MUTED);
      y -= 18;
    }
    if (rows.length === 0) {
      empty("No records found.");
      return;
    }
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    const scale = totalWidth > USABLE_W ? USABLE_W / totalWidth : 1;
    const widths = columns.map((col) => col.width * scale);
    const headerH = 24;
    ensure(headerH + 28);
    page.drawRectangle({ x: MARGIN, y: y - headerH, width: USABLE_W, height: headerH, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
    let x = MARGIN;
    columns.forEach((col, i) => {
      draw(col.label, x + 5, y - 15, 7, INK, true, widths[i] - 10);
      x += widths[i];
    });
    y -= headerH;
    rows.forEach((row, rowIndex) => {
      const size = 7;
      const lineSets = row.map((cell, i) => wrapText(clean(cell), pickFont(cell), size, widths[i] - 10, 3));
      const rowH = Math.max(24, Math.max(...lineSets.map((lines) => lines.length)) * 10 + 10);
      ensure(rowH + headerH);
      if (y === CONTENT_TOP) {
        page.drawRectangle({ x: MARGIN, y: y - headerH, width: USABLE_W, height: headerH, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
        let hx = MARGIN;
        columns.forEach((col, i) => {
          draw(col.label, hx + 5, y - 15, 7, INK, true, widths[i] - 10);
          hx += widths[i];
        });
        y -= headerH;
      }
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH,
        width: USABLE_W,
        height: rowH,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : SOFT,
        borderColor: LINE,
        borderWidth: 0.4,
      });
      x = MARGIN;
      lineSets.forEach((lines, i) => {
        const selected = pickFont(row[i]);
        lines.forEach((line, lineIndex) => {
          page.drawText(line, { x: x + 5, y: y - 13 - lineIndex * 10, size, font: selected, color: INK });
        });
        x += widths[i];
      });
      y -= rowH;
    });
    y -= 14;
  };

  const accountType = overview.user.accountType === "parent" ? "Parent" : "Student";
  const completionText = overview.completion ? `${overview.completion.percent}%` : NOT_COLLECTED;
  const verifiedText = overview.user.emailVerified ? `Verified${overview.user.emailVerifiedAt ? ` (${formatDate(overview.user.emailVerifiedAt)})` : ""}` : "Not verified";

  page.drawRectangle({ x: MARGIN, y: y - 118, width: USABLE_W, height: 118, color: SOFT, borderColor: LINE, borderWidth: 1 });
  page.drawRectangle({ x: MARGIN, y: y - 118, width: 5, height: 118, color: ACCENT });
  if (logo) page.drawImage(logo, { x: MARGIN + 16, y: y - 48, width: 32, height: 32 });
  draw("Central Studio", MARGIN + 58, y - 28, 12, INK, true);
  draw("User 360 Profile Export", MARGIN + 58, y - 45, 8, MUTED);
  draw(overview.user.name, MARGIN + 16, y - 80, 21, INK, true, USABLE_W - 32);
  draw(`${accountType} - ${overview.user.email}`, MARGIN + 16, y - 103, 9, MUTED, false, USABLE_W - 32);
  y -= 138;

  keyValues([
    ["Phone", asText(overview.user.phone)],
    ["Export Date", generatedStamp(generatedAt)],
    ["Profile Completion", completionText],
    ["Verification Status", verifiedText],
  ]);

  section("Profile Details");
  keyValues([
    ["Name", overview.user.name],
    ["Email", overview.user.email],
    ["Phone", asText(overview.user.phone)],
    ["Gender", asText(overview.user.gender)],
    ["Birthday", asText(overview.user.dateOfBirth)],
    ["City", asText(overview.user.city)],
    ["Nationality", asText(overview.user.nationality)],
    ["Account Type", accountType],
    ["Auth Provider", titleCase(overview.user.authProvider ?? "local")],
    ["How Did You Hear About Us", asText(overview.user.howDidYouHearAboutUs)],
    ["Email Verified", overview.user.emailVerified ? "Yes" : "No"],
    ["Profile Completed", overview.completion?.isComplete ? "Yes" : "No"],
    ["Dance Interests", overview.danceInterests.length ? overview.danceInterests.map((d) => d.name).join(", ") : NOT_COLLECTED],
  ]);

  if (overview.user.accountType === "parent") {
    section("Children Details");
    if (!overview.permissions.canViewChildren) {
      empty("You do not have permission to view children details.");
    } else if (overview.children.length === 0) {
      empty("No children added yet.");
    } else {
      table(
        [
          { label: "Child", width: 115 },
          { label: "Gender", width: 55 },
          { label: "Birthday / Age", width: 92 },
          { label: "Medical Notes", width: 155 },
          { label: "Emergency Contact", width: 130 },
        ],
        overview.children.map((child) => [
          child.fullName,
          titleCase(child.gender),
          `${asText(child.birthday)} / ${child.age ?? NOT_COLLECTED}`,
          asText(child.medicalNotes),
          child.emergencyName || child.emergencyPhone
            ? `${child.emergencyName ?? ""}${child.emergencyPhone ? ` (${child.emergencyPhone})` : ""}`.trim()
            : NOT_COLLECTED,
        ]),
      );
    }
  }

  section("Bookings");
  if (!overview.permissions.canViewBookings) {
    empty("You do not have permission to view bookings.");
  } else {
    table(
      [
        { label: "Booking", width: 70 },
        { label: "Participant", width: 90 },
        { label: "Class", width: 110 },
        { label: "Schedule", width: 110 },
        { label: "Booking Status", width: 78 },
        { label: "Payment", width: 78 },
        { label: "Booked", width: 82 },
      ],
      overview.bookings.slice(0, EXPORT_LIMIT).map((booking) => [
        booking.bookingNumber || `#${booking.id}`,
        `${booking.participantName} (${booking.participantType})`,
        booking.classTitle ?? NOT_COLLECTED,
        `${formatDate(booking.occurrenceDate)} ${booking.scheduleStartTime ?? ""}${booking.scheduleEndTime ? `-${booking.scheduleEndTime}` : ""}`.trim(),
        titleCase(booking.bookingStatus),
        titleCase(booking.paymentStatus),
        formatDate(booking.createdAt),
      ]),
      overview.bookings.length >= EXPORT_LIMIT ? `Showing latest ${EXPORT_LIMIT} records` : undefined,
    );
  }

  section("Attendance");
  if (!overview.permissions.canViewAttendance) {
    empty("You do not have permission to view attendance.");
  } else {
    table(
      [
        { label: "Class", width: 145 },
        { label: "Instructor", width: 115 },
        { label: "Date / Time", width: 115 },
        { label: "Status", width: 85 },
        { label: "Credit", width: 65 },
      ],
      overview.attendance.slice(0, EXPORT_LIMIT).map((item) => [
        item.classTitle ?? NOT_COLLECTED,
        item.instructorName ?? NOT_COLLECTED,
        formatDateTime(item.checkedInAt),
        titleCase(item.status),
        item.creditDeducted ? "Deducted" : "No",
      ]),
      overview.attendance.length >= EXPORT_LIMIT ? `Showing latest ${EXPORT_LIMIT} records` : undefined,
    );
  }

  section("Feedback");
  if (!overview.permissions.canViewFeedback) {
    empty("You do not have permission to view feedback.");
  } else {
    table(
      [
        { label: "Class", width: 105 },
        { label: "Trainer", width: 90 },
        { label: "Rating", width: 50 },
        { label: "Comment", width: 180 },
        { label: "Submitted", width: 90 },
        { label: "Review", width: 70 },
      ],
      overview.feedback.slice(0, EXPORT_LIMIT).map((item) => [
        item.classTitle ?? NOT_COLLECTED,
        item.instructorName ?? NOT_COLLECTED,
        `${item.rating}/5`,
        item.hasComment ? (item.commentPreview ?? "Hidden - missing feedback.viewComments") : "No comment",
        formatDate(item.submittedAt),
        titleCase(item.reviewStatus),
      ]),
      overview.feedback.length >= EXPORT_LIMIT ? `Showing latest ${EXPORT_LIMIT} records` : undefined,
    );
  }

  section("Packages & Credits");
  if (!overview.permissions.canViewPackages) {
    empty("You do not have permission to view packages.");
  } else {
    table(
      [
        { label: "Package", width: 145 },
        { label: "Status", width: 76 },
        { label: "Credits", width: 70 },
        { label: "Remaining", width: 72 },
        { label: "Activated", width: 88 },
        { label: "Expiry", width: 88 },
      ],
      overview.packages.recent.slice(0, EXPORT_LIMIT).map((item) => [
        item.packageName,
        titleCase(item.status),
        String(item.totalCredits),
        String(item.remainingCredits),
        formatDate(item.activatedAt),
        formatDate(item.expiresAt),
      ]),
      overview.packages.recent.length >= EXPORT_LIMIT ? `Showing latest ${EXPORT_LIMIT} records` : undefined,
    );
  }

  if (overview.permissions.canViewCredits) {
    table(
      [
        { label: "Credit Type", width: 135 },
        { label: "Delta", width: 54 },
        { label: "Balance", width: 62 },
        { label: "Notes", width: 170 },
        { label: "By", width: 70 },
        { label: "Date", width: 95 },
      ],
      overview.creditTransactions.slice(0, EXPORT_LIMIT).map((item) => [
        titleCase(item.type),
        `${item.delta > 0 ? "+" : ""}${item.delta}`,
        String(item.balanceAfter),
        asText(item.notes),
        asText(item.createdBy),
        formatDateTime(item.createdAt),
      ]),
      overview.creditTransactions.length >= EXPORT_LIMIT ? `Showing latest ${EXPORT_LIMIT} credit records` : undefined,
    );
  }

  const pages = doc.getPages();
  pages.forEach((pg, index) => {
    const { width, height } = pg.getSize();
    pg.drawRectangle({ x: 0, y: height - HEADER_H, width, height: HEADER_H, color: HEADER_BG });
    pg.drawRectangle({ x: 0, y: height - HEADER_H, width, height: 2, color: ACCENT });
    if (logo) pg.drawImage(logo, { x: MARGIN, y: height - 42, width: 26, height: 26 });
    pg.drawText("Central Studio", { x: MARGIN + (logo ? 36 : 0), y: height - 28, size: 11, font: bold, color: WHITE });
    pg.drawText("User 360 Profile Export", { x: MARGIN + (logo ? 36 : 0), y: height - 44, size: 7.5, font, color: rgb(0.76, 0.81, 0.86) });
    const right = `Generated ${generatedStamp(generatedAt)}`;
    pg.drawText(right, { x: width - MARGIN - font.widthOfTextAtSize(right, 7), y: height - 30, size: 7, font, color: rgb(0.76, 0.81, 0.86) });
    pg.drawLine({ start: { x: MARGIN, y: FOOTER_H }, end: { x: width - MARGIN, y: FOOTER_H }, thickness: 0.6, color: LINE });
    pg.drawText(`Exported by ${sanitizeLatin(generatedBy || "Admin")}`, { x: MARGIN, y: 20, size: 7, font, color: MUTED });
    const pageText = `Page ${index + 1} of ${pages.length}`;
    pg.drawText(pageText, { x: (width - font.widthOfTextAtSize(pageText, 7)) / 2, y: 20, size: 7, font, color: MUTED });
    const confidential = "Confidential";
    pg.drawText(confidential, { x: width - MARGIN - font.widthOfTextAtSize(confidential, 7), y: 20, size: 7, font, color: MUTED });
  });

  return Buffer.from(await doc.save());
}
