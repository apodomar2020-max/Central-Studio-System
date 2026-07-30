/**
 * attendanceResolver — the unified account/candidate resolver behind the
 * Admin Attendance gateway's Scan QR / Search Parent Phone / Search Child
 * Name entry points.
 *
 * Every candidate this module returns is READ-ONLY discovery data. Nothing
 * here writes attendance. The confirm step (see routes/adminAttendance.ts)
 * MUST NOT trust any field on a returned candidate — it re-fetches and
 * re-validates everything from the database using only the candidate's
 * canonical ids (bookingId / balletLevelAssignmentId+balletScheduleId+
 * occurrenceDate).
 */
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  childrenTable,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  balletApplicationsTable,
  balletLevelAssignmentsTable,
  balletLevelsTable,
  balletGroupsTable,
  balletSchedulesTable,
  balletClassesTable,
  attendanceTable,
  packageOrdersTable,
} from "@workspace/db";
import { normalizePhone } from "./phoneNormalization";
import { resolveSingleClassPriceEgp } from "./singleClassPricing";
import { isAssignmentReadyClass, scheduleShapeCondition } from "./balletClassEntitlement";
import { getPaymentCyclesForApplication } from "./balletSubscriptions";
import { subscriptionCoversDate } from "./balletAttendanceWrite";
import {
  addDaysToIsoDate,
  attendanceOccurrenceDateForWeeklySchedule,
  checkInWindowState,
  cairoNow,
  isoDateDayOfWeek,
  type CheckInWindowState,
} from "./occurrence";
import { evaluateParticipantOnOccurrence } from "./eligibility/participantOccurrenceEligibility";

export type ResolverSource = "qr" | "phone" | "childName";
export type CandidateProgram = "studio" | "ballet";
export type CandidateEligibility =
  | "eligible"
  | "booking_payment_required"
  | "booking_pending_approval"
  | "ambiguous_active_bookings"
  | "participant_not_eligible"
  | "participant_dob_required"
  | "too_early"
  | "ended"
  | "already_recorded"
  | "inactive_enrollment"
  | "no_active_subscription"
  | "cancelled"
  | "invalid_assignment"
  | "not_scheduled_today";

export interface AttendanceCandidate {
  candidateKey: string;
  program: CandidateProgram;
  participantType: "account" | "child";
  participantId: number;
  participantName: string;
  participantInitials: string;
  parentName: string;
  maskedParentPhone: string | null;
  bookingId: number | null;
  balletApplicationId: number | null;
  balletLevelAssignmentId: number | null;
  classId: number | null;
  className: string | null;
  scheduleId: number | null;
  occurrenceDate: string;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  level: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  eligibility: CandidateEligibility;
  reason: string | null;
  existingAttendanceId: number | null;
  /**
   * Set ONLY on a Studio walk-in candidate (bookingId === null, program ===
   * "studio"): the server-resolved, display-only Single-Class price for
   * this schedule — the exact same value (never a client amount) Finance
   * Phase 2B-4 will capture if this walk-in is confirmed Paid. Null for
   * every booking-based candidate (their economics already exist).
   */
  walkinPriceEgp: number | null;
  /**
   * Set ONLY on a Studio walk-in candidate: the resolved child id when this
   * walk-in is for a specific child (participantType "child"), else null.
   * Carried separately from participantId so the confirm step can populate
   * payment_records.child_id without re-deriving it from the request body.
   */
  walkinChildId: number | null;
  /**
   * Set ONLY on a Studio walk-in candidate: whether this account currently
   * has at least one active package order with remaining credits — display
   * only, so the Admin UI can decide whether to offer Package Credit at
   * all. confirm() re-validates the real package order independently.
   */
  hasPackageCredit: boolean;
  bookingState:
    | "confirmed"
    | "package_pending"
    | "payment_required"
    | "pending_approval"
    | "ambiguous"
    | "attended"
    | "none";
}

export interface AttendanceAccountCandidates {
  accountId: number;
  accountName: string;
  /**
   * Deliberately kept, unlike full phone/QR token/medical notes: the Admin
   * confirm dialog correlates this SPECIFIC, already-disambiguated account
   * against /admin/package-orders (which only exposes studentEmail, not a
   * numeric id — see lib/api-client-react's generated PackageOrder type) to
   * offer Studio package-credit checkout, mirroring the pre-existing
   * scan-check-in-dialog.tsx precedent. Withholding it silently breaks that
   * Studio flow rather than reducing any real exposure — the admin already
   * knows who they're checking in.
   */
  accountEmail: string;
  maskedPhone: string | null;
  candidates: AttendanceCandidate[];
}

export interface AttendanceResolverResult {
  source: ResolverSource;
  accounts: AttendanceAccountCandidates[];
}

const MAX_ACCOUNTS = 10;
const MAX_PHONE_SCAN_ROWS = 5000;
const MIN_NAME_QUERY_LENGTH = 2;
const MAX_NAME_MATCH_ROWS = 50;

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Canonical, tamper-evident candidate identity — the SAME function builds
 * the key at resolve time and re-derives the expected key at confirm time
 * (see routes/adminAttendanceGateway.ts). A submitted candidateKey that
 * doesn't exactly match what this function computes from the server's own
 * resolved records (never from client-supplied names/phones) is rejected
 * before any write is attempted — this is what prevents an admin from
 * pairing Account A's key with Account B's ids, or replaying a stale
 * occurrence's key against a different date.
 */
export function computeStudioCandidateKey(accountId: number, bookingId: number, occurrenceDate: string): string {
  return ["studio", accountId, bookingId, occurrenceDate].join(":");
}

/**
 * Same tamper-evident scheme as computeStudioCandidateKey, for a Studio
 * WALK-IN candidate — one with no pre-existing booking. Keyed on the
 * schedule (not a booking id, since none exists yet) + occurrence date +
 * participant child (or "self"), so a key minted for one
 * account/child/schedule/occurrence combination can never be replayed
 * against another — including swapping which child of the same parent the
 * walk-in is for.
 */
export function computeStudioWalkInCandidateKey(
  accountId: number,
  participantChildId: number | null,
  scheduleId: number,
  occurrenceDate: string,
): string {
  return ["studioWalkin", accountId, participantChildId ?? "self", scheduleId, occurrenceDate].join(":");
}

export function computeBalletCandidateKey(
  accountId: number,
  childId: number,
  levelAssignmentId: number,
  scheduleId: number,
  occurrenceDate: string,
): string {
  return ["ballet", accountId, childId, levelAssignmentId, scheduleId, occurrenceDate].join(":");
}

function eligibilityFromWindow(windowState: CheckInWindowState): { eligibility: CandidateEligibility; reason: string | null } {
  switch (windowState) {
    case "too_early":
      return { eligibility: "too_early", reason: "Check-in opens 2 hours before class" };
    case "ended":
      return { eligibility: "ended", reason: "Check-in closed when the class ended" };
    case "not_today":
      return { eligibility: "not_scheduled_today", reason: "Not scheduled for today" };
    case "open":
    default:
      return { eligibility: "eligible", reason: null };
  }
}

// ── Source resolution: opaque QR / normalized phone / child-name search ────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts ONLY the full-screen My QR payload shape
 * ({app:"centralstudio", token:<uuid>}), or — defensively, for scanners that
 * hand back bare text — a raw UUID-shaped token. Never accepts a raw
 * sequential id: an integer string does not match UUID_RE and is rejected.
 */
export async function resolveAccountIdsFromQr(rawPayload: string): Promise<number[]> {
  let token: string | null = null;
  try {
    const parsed = JSON.parse(rawPayload) as { app?: unknown; token?: unknown };
    if (parsed && parsed.app === "centralstudio" && typeof parsed.token === "string" && UUID_RE.test(parsed.token)) {
      token = parsed.token;
    }
  } catch {
    const trimmed = rawPayload.trim();
    if (UUID_RE.test(trimmed)) token = trimmed;
  }
  if (!token) return [];
  const [student] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.qrToken, token))
    .limit(1);
  return student ? [student.id] : [];
}

/** Mirrors marketing.ts's resolveRecipients() pattern: bounded fetch, exact
 *  normalized-form comparison in application code (no stored normalized-phone
 *  column on students, no substring/LIKE matching). */
export async function resolveAccountIdsFromPhone(rawPhone: string): Promise<number[]> {
  const target = normalizePhone(rawPhone);
  if (!target) return [];
  const rows = await db
    .select({ id: studentsTable.id, phone: studentsTable.phone })
    .from(studentsTable)
    .where(sql`${studentsTable.phone} is not null`)
    .limit(MAX_PHONE_SCAN_ROWS);
  const matches = rows.filter((row) => normalizePhone(row.phone) === target).map((row) => row.id);
  return matches.slice(0, MAX_ACCOUNTS);
}

/** Name is discovery-only — never an identity. Returns candidate ACCOUNTS to
 *  disambiguate further via their full candidate cards, never a direct write. */
export async function resolveAccountIdsFromChildName(query: string): Promise<number[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_NAME_QUERY_LENGTH) return [];
  const pattern = `%${trimmed}%`;
  const [childRows, appRows] = await Promise.all([
    db.select({ parentId: childrenTable.parentId }).from(childrenTable).where(ilike(childrenTable.fullName, pattern)).limit(MAX_NAME_MATCH_ROWS),
    db
      .select({ parentStudentId: balletApplicationsTable.parentStudentId })
      .from(balletApplicationsTable)
      .where(and(ilike(balletApplicationsTable.childName, pattern), sql`${balletApplicationsTable.parentStudentId} is not null`))
      .limit(MAX_NAME_MATCH_ROWS),
  ]);
  const ids = new Set<number>();
  for (const row of childRows) ids.add(row.parentId);
  for (const row of appRows) if (row.parentStudentId != null) ids.add(row.parentStudentId);
  return Array.from(ids).slice(0, MAX_ACCOUNTS);
}

// ── Per-account candidate building ──────────────────────────────────────────

async function buildStudioCandidates(
  accountId: number,
  accountEmail: string,
  accountName: string,
  maskedPhone: string | null,
  now: Date,
): Promise<AttendanceCandidate[]> {
  const nowCairo = cairoNow(now);
  const tomorrow = addDaysToIsoDate(nowCairo.date, 1);
  const rows = await db
    .select({
      booking: bookingsTable,
      className: classesTable.title,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(classesTable.id, bookingsTable.classId))
    .leftJoin(instructorsTable, eq(instructorsTable.id, classesTable.instructorId))
    .leftJoin(schedulesTable, eq(schedulesTable.id, bookingsTable.scheduleId))
    .where(and(
      eq(bookingsTable.studentEmail, accountEmail),
      inArray(bookingsTable.occurrenceDate, [nowCairo.date, tomorrow]),
      inArray(bookingsTable.bookingStatus, ["pending", "confirmed", "attended"]),
    ));

  const candidates: AttendanceCandidate[] = [];
  const activeBookingCounts = new Map<string, number>();
  for (const row of rows) {
    const key = [
      row.booking.scheduleId ?? "no-schedule",
      row.booking.occurrenceDate ?? "no-occurrence",
      row.booking.participantChildId ?? "self",
    ].join(":");
    activeBookingCounts.set(key, (activeBookingCounts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    const booking = row.booking;
    const bookingGroupKey = [
      booking.scheduleId ?? "no-schedule",
      booking.occurrenceDate ?? "no-occurrence",
      booking.participantChildId ?? "self",
    ].join(":");
    const ambiguous = (activeBookingCounts.get(bookingGroupKey) ?? 0) > 1;
    const windowState = checkInWindowState(
      { startTime: row.scheduleStartTime, endTime: row.scheduleEndTime },
      booking.occurrenceDate,
      now,
    );
    if (booking.occurrenceDate === tomorrow && windowState !== "open") continue;
    const alreadyAttended = booking.bookingStatus === "attended";
    const packagePending = booking.bookingStatus === "pending"
      && (booking.paymentMode === "package_credit" || booking.packageOrderId != null);
    const paymentRequired = booking.bookingStatus === "pending"
      && booking.paymentMode === "pay_at_studio"
      && booking.paymentStatus === "pending_payment";
    let existingAttendanceId: number | null = null;
    let eligibility: CandidateEligibility;
    let reason: string | null;
    if (ambiguous) {
      eligibility = "ambiguous_active_bookings";
      reason = "Multiple active bookings require Admin review";
    } else if (alreadyAttended) {
      const [existing] = await db
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(eq(attendanceTable.bookingId, booking.id))
        .limit(1);
      existingAttendanceId = existing?.id ?? null;
      eligibility = "already_recorded";
      reason = "Already checked in";
    } else if (packagePending) {
      eligibility = "eligible";
      reason = "Package credit already reserved at booking";
    } else if (paymentRequired) {
      eligibility = "booking_payment_required";
      reason = "Payment is required for this existing booking";
    } else if (booking.bookingStatus === "pending") {
      eligibility = "booking_pending_approval";
      reason = "Booking is awaiting approval";
    } else {
      ({ eligibility, reason } = eligibilityFromWindow(windowState));
    }

    const participantIsChild = booking.participantChildId != null;
    const occurrenceDate = booking.occurrenceDate ?? nowCairo.date;
    candidates.push({
      candidateKey: computeStudioCandidateKey(accountId, booking.id, occurrenceDate),
      program: "studio",
      participantType: participantIsChild ? "child" : "account",
      participantId: participantIsChild ? booking.participantChildId! : accountId,
      participantName: booking.studentName,
      participantInitials: initialsOf(booking.studentName),
      parentName: accountName,
      maskedParentPhone: maskedPhone,
      bookingId: booking.id,
      balletApplicationId: null,
      balletLevelAssignmentId: null,
      classId: booking.classId,
      className: row.className ?? null,
      scheduleId: booking.scheduleId,
      occurrenceDate,
      dayOfWeek: row.scheduleDayOfWeek ?? null,
      startTime: row.scheduleStartTime ?? null,
      endTime: row.scheduleEndTime ?? null,
      durationMinutes: null,
      level: null,
      group: null,
      eligibility,
      reason,
      existingAttendanceId,
      walkinPriceEgp: null,
      walkinChildId: participantIsChild ? booking.participantChildId! : null,
      hasPackageCredit: false,
      bookingState: ambiguous
        ? "ambiguous"
        : alreadyAttended
        ? "attended"
        : packagePending
          ? "package_pending"
          : paymentRequired
            ? "payment_required"
            : booking.bookingStatus === "pending"
              ? "pending_approval"
              : "confirmed",
    });
  }

  const walkInCandidates = await buildStudioWalkInCandidates(accountId, accountName, accountEmail, maskedPhone, candidates, now);
  candidates.push(...walkInCandidates);

  return candidates;
}

/**
 * Studio walk-in candidates — Finance Phase 2B-4 (full flow). Every active
 * schedule whose attendance window is open RIGHT NOW, that this account
 * does not already have a booking-based candidate for, is offered as a
 * walk-in option: "check this account into this class now, no pre-existing
 * booking required." Read-only discovery, same as every other candidate —
 * confirm() re-validates everything server-side before writing anything.
 */
async function buildStudioWalkInCandidates(
  accountId: number,
  accountName: string,
  accountEmail: string,
  maskedPhone: string | null,
  existingCandidates: AttendanceCandidate[],
  now: Date,
): Promise<AttendanceCandidate[]> {
  const nowCairo = cairoNow(now);
  const coveredScheduleIds = new Set(
    existingCandidates
      .filter((c) => c.program === "studio" && c.scheduleId != null)
      .map((c) => c.scheduleId as number),
  );

  const [rows, children, packageCredits] = await Promise.all([
    db
      .select({
        scheduleId: schedulesTable.id,
        classId: schedulesTable.classId,
        className: classesTable.title,
        type: schedulesTable.type,
        date: schedulesTable.date,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        priceEgp: schedulesTable.priceEgp,
        allowAllAges: classesTable.allowAllAges,
        minAge: classesTable.minAge,
        maxAge: classesTable.maxAge,
      })
      .from(schedulesTable)
      .leftJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
      .where(eq(schedulesTable.status, "active")),
    // Existing parent/child ownership model — the SAME table Ballet candidate
    // resolution already uses for a child's identity (childrenTable.parentId).
    db
      .select({ id: childrenTable.id, fullName: childrenTable.fullName, dateOfBirth: childrenTable.dateOfBirth })
      .from(childrenTable)
      .where(eq(childrenTable.parentId, accountId)),
    // Display-only preview from canonical participant ownership. The
    // confirmation path independently re-resolves every package invariant.
    db
      .select({
        participantType: packageOrdersTable.participantType,
        participantChildId: packageOrdersTable.participantChildId,
      })
      .from(packageOrdersTable)
      .where(and(
        eq(packageOrdersTable.studentId, accountId),
        eq(packageOrdersTable.status, "active"),
        sql`${packageOrdersTable.remainingCredits} > 0`,
      )),
  ]);

  // Participants this account can walk in as: itself, plus every owned
  // child — mirrors exactly who the Ballet candidate builder already
  // resolves attendance for under this same account.
  const [accountDob] = await db
    .select({ dateOfBirth: studentsTable.dateOfBirth })
    .from(studentsTable)
    .where(eq(studentsTable.id, accountId))
    .limit(1);
  const participants: Array<{ type: "account" | "child"; id: number; name: string; childId: number | null; dateOfBirth: string | null }> = [
    { type: "account", id: accountId, name: accountName, childId: null, dateOfBirth: accountDob?.dateOfBirth ?? null },
    ...children.map((child) => ({ type: "child" as const, id: child.id, name: child.fullName, childId: child.id, dateOfBirth: child.dateOfBirth })),
  ];

  const candidates: AttendanceCandidate[] = [];
  for (const row of rows) {
    if (coveredScheduleIds.has(row.scheduleId)) continue;
    const occurrenceDate = row.type === "one_time"
      ? row.date
      : row.dayOfWeek != null
        ? attendanceOccurrenceDateForWeeklySchedule({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime }, now)
        : null;
    if (!occurrenceDate || occurrenceDate !== nowCairo.date) continue;
    const windowState = checkInWindowState({ startTime: row.startTime, endTime: row.endTime }, occurrenceDate, now);
    if (windowState !== "open") continue;

    // Same server-authoritative resolver Finance Phase 2B-2/2B-4 capture
    // uses (schedule override, else the Studio-wide default) — never the
    // raw, possibly-null schedule column alone, so this preview can never
    // under-report relative to what confirm() actually captures.
    const priceEgp = await resolveSingleClassPriceEgp(db, row.scheduleId);

    for (const participant of participants) {
      const ageEligibility = row.allowAllAges == null && row.minAge == null && row.maxAge == null
        ? { eligible: true, reasonCode: "ELIGIBLE" as const }
        : evaluateParticipantOnOccurrence(participant.dateOfBirth, occurrenceDate, {
            allowAllAges: row.allowAllAges === true,
            minAge: row.minAge,
            maxAge: row.maxAge,
          });
      const hasPackageCredit = packageCredits.some((credit) =>
        participant.childId == null
          ? credit.participantType === "self" && credit.participantChildId == null
          : credit.participantType === "child" && credit.participantChildId === participant.childId,
      );
      candidates.push({
        candidateKey: computeStudioWalkInCandidateKey(accountId, participant.childId, row.scheduleId, occurrenceDate),
        program: "studio",
        participantType: participant.type,
        participantId: participant.id,
        participantName: participant.name,
        participantInitials: initialsOf(participant.name),
        parentName: accountName,
        maskedParentPhone: maskedPhone,
        bookingId: null,
        balletApplicationId: null,
        balletLevelAssignmentId: null,
        classId: row.classId,
        className: row.className ?? null,
        scheduleId: row.scheduleId,
        occurrenceDate,
        dayOfWeek: row.dayOfWeek ?? null,
        startTime: row.startTime,
        endTime: row.endTime,
        durationMinutes: null,
        level: null,
        group: null,
        eligibility: ageEligibility.eligible
          ? "eligible"
          : ageEligibility.reasonCode === "PARTICIPANT_DOB_REQUIRED"
            ? "participant_dob_required"
            : "participant_not_eligible",
        reason: ageEligibility.eligible
          ? null
          : ageEligibility.reasonCode === "PARTICIPANT_DOB_REQUIRED"
            ? "Date of birth is required"
            : "Participant is outside this class age range",
        existingAttendanceId: null,
        // Display-only preview — the confirm step re-resolves this exact
        // value server-side via the same resolveSingleClassPriceEgp() rather
        // than trusting this number back from the client.
        walkinPriceEgp: priceEgp,
        walkinChildId: participant.childId,
        hasPackageCredit,
        bookingState: "none",
      });
    }
  }
  return candidates;
}

async function buildBalletCandidates(
  accountId: number,
  accountName: string,
  maskedPhone: string | null,
  now: Date,
): Promise<AttendanceCandidate[]> {
  const nowCairo = cairoNow(now);
  const tomorrow = addDaysToIsoDate(nowCairo.date, 1);
  const candidateDays = [isoDateDayOfWeek(nowCairo.date), isoDateDayOfWeek(tomorrow)];

  const applications = await db
    .select({
      id: balletApplicationsTable.id,
      childId: balletApplicationsTable.childId,
      childName: balletApplicationsTable.childName,
    })
    .from(balletApplicationsTable)
    .where(and(eq(balletApplicationsTable.parentStudentId, accountId), eq(balletApplicationsTable.status, "active")));
  if (applications.length === 0) return [];

  const applicationIds = applications.map((application) => application.id);
  const applicationById = new Map(applications.map((application) => [application.id, application]));

  const assignments = await db
    .select({
      id: balletLevelAssignmentsTable.id,
      applicationId: balletLevelAssignmentsTable.applicationId,
      childId: balletLevelAssignmentsTable.childId,
      levelId: balletLevelAssignmentsTable.levelId,
      groupId: balletLevelAssignmentsTable.groupId,
      levelName: balletLevelsTable.name,
      levelIsActive: balletLevelsTable.isActive,
      groupName: balletGroupsTable.name,
      groupLevelId: balletGroupsTable.levelId,
      groupIsActive: balletGroupsTable.isActive,
    })
    .from(balletLevelAssignmentsTable)
    .innerJoin(balletLevelsTable, eq(balletLevelsTable.id, balletLevelAssignmentsTable.levelId))
    .leftJoin(balletGroupsTable, eq(balletGroupsTable.id, balletLevelAssignmentsTable.groupId))
    .where(and(
      inArray(balletLevelAssignmentsTable.applicationId, applicationIds),
      eq(balletLevelAssignmentsTable.status, "active"),
    ));

  const candidates: AttendanceCandidate[] = [];
  for (const assignment of assignments) {
    const application = applicationById.get(assignment.applicationId);
    if (!application) continue;

    // Mirrors balletMyClasses.ts's validAssignment(): structural integrity
    // of the Level+Group+child relationship before this assignment counts.
    const structurallyValid =
      assignment.groupId != null
      && (application.childId == null || assignment.childId === application.childId)
      && assignment.levelIsActive
      && assignment.groupIsActive === true
      && assignment.groupLevelId === assignment.levelId;
    if (!structurallyValid) continue;

    const schedules = await db
      .select({
        scheduleId: balletSchedulesTable.id,
        classId: balletSchedulesTable.classId,
        className: balletClassesTable.title,
        dayOfWeek: balletSchedulesTable.dayOfWeek,
        startTime: balletSchedulesTable.startTime,
        endTime: balletSchedulesTable.endTime,
        durationMins: balletSchedulesTable.durationMins,
      })
      .from(balletSchedulesTable)
      .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
      .where(and(
        eq(balletClassesTable.groupId, assignment.groupId!),
        eq(balletClassesTable.levelId, assignment.levelId),
        inArray(balletSchedulesTable.dayOfWeek, candidateDays),
        scheduleShapeCondition(),
        isAssignmentReadyClass(),
      ));
    if (schedules.length === 0) continue;

    const cycles = await getPaymentCyclesForApplication(assignment.applicationId);

    const childId = assignment.childId ?? application.childId ?? application.id;
    for (const schedule of schedules) {
      const occurrenceDate = attendanceOccurrenceDateForWeeklySchedule(schedule, now);
      if (!occurrenceDate) continue;
      const subscribed = cycles.some(
        (cycle) => cycle.status === "paid" && subscriptionCoversDate(cycle.subscriptionStartDate, cycle.subscriptionExpiresAt, occurrenceDate),
      );
      const windowState = checkInWindowState(
        { startTime: schedule.startTime, endTime: schedule.endTime },
        occurrenceDate,
        now,
      );
      const [existing] = await db
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(and(
          eq(attendanceTable.balletLevelAssignmentId, assignment.id),
          eq(attendanceTable.balletScheduleId, schedule.scheduleId),
          eq(attendanceTable.classDate, occurrenceDate),
        ))
        .limit(1);

      let eligibility: CandidateEligibility;
      let reason: string | null;
      if (existing) {
        eligibility = "already_recorded";
        reason = "Attendance already recorded for this class";
      } else if (!subscribed) {
        eligibility = "no_active_subscription";
        reason = "No paid subscription covers this occurrence";
      } else {
        ({ eligibility, reason } = eligibilityFromWindow(windowState));
      }

      candidates.push({
        candidateKey: computeBalletCandidateKey(accountId, childId, assignment.id, schedule.scheduleId, occurrenceDate),
        program: "ballet",
        participantType: "child",
        participantId: childId,
        participantName: application.childName,
        participantInitials: initialsOf(application.childName),
        parentName: accountName,
        maskedParentPhone: maskedPhone,
        bookingId: null,
        balletApplicationId: application.id,
        balletLevelAssignmentId: assignment.id,
        classId: schedule.classId,
        className: schedule.className,
        scheduleId: schedule.scheduleId,
        occurrenceDate,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        durationMinutes: schedule.durationMins,
        level: { id: assignment.levelId, name: assignment.levelName },
        group: assignment.groupId != null && assignment.groupName ? { id: assignment.groupId, name: assignment.groupName } : null,
        eligibility,
        reason,
        existingAttendanceId: existing?.id ?? null,
        walkinPriceEgp: null,
        walkinChildId: null,
        hasPackageCredit: false,
        bookingState: "none",
      });
    }
  }
  return candidates;
}

export async function resolveAttendanceCandidates(
  source: ResolverSource,
  query: string,
  now: Date = new Date(),
): Promise<AttendanceResolverResult> {
  const accountIds =
    source === "qr" ? await resolveAccountIdsFromQr(query)
    : source === "phone" ? await resolveAccountIdsFromPhone(query)
    : await resolveAccountIdsFromChildName(query);

  if (accountIds.length === 0) return { source, accounts: [] };

  const students = await db
    .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email, phone: studentsTable.phone })
    .from(studentsTable)
    .where(inArray(studentsTable.id, accountIds));

  const accounts: AttendanceAccountCandidates[] = [];
  for (const student of students) {
    const maskedPhone = maskPhone(student.phone);
    const [studioCandidates, balletCandidates] = await Promise.all([
      buildStudioCandidates(student.id, student.email, student.name, maskedPhone, now),
      buildBalletCandidates(student.id, student.name, maskedPhone, now),
    ]);
    const candidates = [...studioCandidates, ...balletCandidates];
    // Even with zero current-occurrence candidates, surface the account so
    // the UI can show "no eligible class right now" instead of nothing.
    accounts.push({ accountId: student.id, accountName: student.name, accountEmail: student.email, maskedPhone, candidates });
  }
  return { source, accounts };
}
