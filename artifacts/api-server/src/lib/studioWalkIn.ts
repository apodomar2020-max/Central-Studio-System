/**
 * studioWalkIn — Studio "walk-in" check-in: a participant with no eligible
 * Booking for the current occurrence, checked in at the studio door.
 *
 * A walk-in is represented as a FRESH, system-created Booking row (status
 * "confirmed") immediately fed into performBookingCheckIn() — the SAME
 * shared transactional engine used by QR and the unified Gateway's
 * booking-based Studio path. This is deliberate, not incidental: Booking is
 * the only table the existing Dashboard revenue aggregation reads for
 * generic (non-package, non-Ballet) Studio revenue — see
 * financialAggregates.ts's grossGenericBookingRevenueEgp, which sums
 * coalesce(schedule.priceEgp, classPricingSettings.singleClassPriceEgp) over
 * bookings where paymentStatus='paid' and paymentMode in
 * ('pay_at_studio','online_payment'). Reusing that exact shape means a walk-
 * in's "Paid at Studio" money appears in the existing Dashboard total with
 * zero changes to any reporting query, and reusing performBookingCheckIn
 * means duplicate-per-participant-per-class-today protection, the booking→
 * attended transition, and notifications are not reimplemented here.
 *
 * No schema change / migration is required for any of this — every field
 * used already exists on bookingsTable exactly as normal bookings use it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  childrenTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  bookingsTable,
  attendanceTable,
  classPricingSettingsTable,
} from "@workspace/db";
import { performBookingCheckIn, makeCheckInError, isCheckInError, type BookingCheckInResult } from "./checkInService";
import { attendanceOccurrenceDateForWeeklySchedule, checkInWindowState, cairoNow } from "./occurrence";
import { logActivityWithActorStrict, type ActivityActorSnapshot } from "./activityLog";
import { flushPushQueue } from "./notifications";

export { isCheckInError };
export type { BookingCheckInResult };

/**
 * Canonical, tamper-evident Walk-in identity — recomputed server-side at
 * confirm time and compared exactly against the client-submitted key (same
 * pattern as attendanceResolver.ts's computeStudioCandidateKey /
 * computeBalletCandidateKey). Deliberately contains only canonical ids —
 * never a name, email, phone, QR token, or client timestamp.
 */
export function computeStudioWalkInCandidateKey(
  accountId: number,
  participantChildId: number | null,
  classId: number,
  scheduleId: number,
  occurrenceDate: string,
): string {
  return ["studio-walkin", accountId, participantChildId ?? "self", classId, scheduleId, occurrenceDate].join(":");
}

export interface StudioWalkInOption {
  candidateKey: string;
  classId: number;
  scheduleId: number;
  className: string;
  instructorName: string | null;
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  priceEgp: number;
  packageEligible: boolean;
}

type SelectClient = Pick<typeof db, "select">;

/**
 * True when this exact participant already has a confirmed-or-attended
 * Booking for this Schedule + occurrence — i.e. this occurrence already has
 * a real front door via the normal booked-candidate flow, so it must never
 * also be offered (or written) as a Walk-in. Shared by both the read-side
 * options list and the write-side confirm, so the two can never disagree.
 */
async function participantHasEligibleBookingForOccurrence(
  client: SelectClient,
  accountId: number,
  participantChildId: number | null,
  scheduleId: number,
  occurrenceDate: string,
): Promise<boolean> {
  const [existing] = await client
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(and(
      eq(bookingsTable.scheduleId, scheduleId),
      eq(bookingsTable.occurrenceDate, occurrenceDate),
      inArray(bookingsTable.bookingStatus, ["confirmed", "attended"]),
      participantChildId != null
        ? eq(bookingsTable.participantChildId, participantChildId)
        : and(eq(bookingsTable.accountOwnerStudentId, accountId), sql`${bookingsTable.participantChildId} is null`),
    ))
    .limit(1);
  return Boolean(existing);
}

/**
 * Every currently-open Studio occurrence a given participant (the account
 * owner when participantChildId is null, otherwise that specific child) does
 * not already have Attendance for today. Mirrors attendanceResolver.ts's
 * buildStudioCandidates window/eligibility logic exactly, but scoped to
 * "no existing booking" — this IS the walk-in surface, not a duplicate of
 * the booking-based resolver.
 */
export async function listStudioWalkInOptions(
  accountId: number,
  participantChildId: number | null,
  now: Date = new Date(),
): Promise<StudioWalkInOption[]> {
  const nowCairo = cairoNow(now);

  const [account] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.id, accountId))
    .limit(1);
  if (!account) return [];

  if (participantChildId != null) {
    const [child] = await db
      .select({ id: childrenTable.id, parentId: childrenTable.parentId })
      .from(childrenTable)
      .where(eq(childrenTable.id, participantChildId))
      .limit(1);
    if (!child || child.parentId !== accountId) return [];
  }

  const [classPricing] = await db
    .select({ singleClassPriceEgp: classPricingSettingsTable.singleClassPriceEgp })
    .from(classPricingSettingsTable)
    .where(eq(classPricingSettingsTable.id, 1))
    .limit(1);
  const fallbackPriceEgp = classPricing?.singleClassPriceEgp ?? 0;

  const rows = await db
    .select({
      classId: classesTable.id,
      className: classesTable.title,
      instructorName: instructorsTable.name,
      scheduleId: schedulesTable.id,
      scheduleType: schedulesTable.type,
      scheduleDate: schedulesTable.date,
      dayOfWeek: schedulesTable.dayOfWeek,
      startTime: schedulesTable.startTime,
      endTime: schedulesTable.endTime,
      priceEgp: schedulesTable.priceEgp,
      packageEligible: schedulesTable.packageEligible,
    })
    .from(schedulesTable)
    .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
    .leftJoin(instructorsTable, eq(instructorsTable.id, classesTable.instructorId))
    .where(and(
      eq(schedulesTable.status, "active"),
      eq(classesTable.isActive, true),
      sql`(${instructorsTable.id} is null or ${instructorsTable.isActive} = true)`,
    ));

  const options: StudioWalkInOption[] = [];
  for (const row of rows) {
    const occurrenceDate =
      row.scheduleType === "one_time"
        ? row.scheduleDate
        : row.dayOfWeek != null
          ? attendanceOccurrenceDateForWeeklySchedule({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime }, now)
          : null;
    if (!occurrenceDate) continue;
    // one_time schedules must fall on today/tomorrow to be walk-in-relevant —
    // a stale one_time date in the past or far future is never surfaced.
    if (row.scheduleType === "one_time" && occurrenceDate !== nowCairo.date) continue;

    const windowState = checkInWindowState({ startTime: row.startTime, endTime: row.endTime }, occurrenceDate, now);
    if (windowState !== "open") continue;

    const [existing] = await db
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .innerJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
      .where(and(
        eq(bookingsTable.scheduleId, row.scheduleId),
        eq(bookingsTable.occurrenceDate, occurrenceDate),
        participantChildId != null
          ? eq(bookingsTable.participantChildId, participantChildId)
          : and(eq(bookingsTable.accountOwnerStudentId, accountId), sql`${bookingsTable.participantChildId} is null`),
      ))
      .limit(1);
    if (existing) continue;

    // This occurrence already has an eligible (confirmed/attended) Booking
    // for this exact participant — never surface it as a Walk-in option even
    // when it hasn't been checked in yet. It already has a real front door
    // (the normal booked-candidate card in the resolver); offering it here
    // too would let an admin create a second, synthetic Booking for the
    // same seat. This is what makes Walk-in visibility per-occurrence rather
    // than "this participant has some unrelated Booking elsewhere."
    if (await participantHasEligibleBookingForOccurrence(db, accountId, participantChildId, row.scheduleId, occurrenceDate)) continue;

    options.push({
      candidateKey: computeStudioWalkInCandidateKey(accountId, participantChildId, row.classId, row.scheduleId, occurrenceDate),
      classId: row.classId,
      scheduleId: row.scheduleId,
      className: row.className,
      instructorName: row.instructorName,
      occurrenceDate,
      startTime: row.startTime,
      endTime: row.endTime,
      priceEgp: row.priceEgp ?? fallbackPriceEgp,
      packageEligible: row.packageEligible,
    });
  }
  return options;
}

export type StudioWalkInPaymentDecision =
  | { type: "package_credit"; packageOrderId: number }
  | { type: "paid_at_studio" }
  | { type: "not_paid" };

export interface PerformStudioWalkInCheckInParams {
  accountId: number;
  participantChildId: number | null;
  classId: number;
  scheduleId: number;
  occurrenceDate: string;
  payment: StudioWalkInPaymentDecision;
  /** The recording admin — also the audit actor. */
  actor: ActivityActorSnapshot;
  now?: Date;
}

export type StudioWalkInResult =
  | (Omit<BookingCheckInResult, "pendingPushJobs"> & { paymentSource: "package_credit" | "pay_at_studio"; bookingId: number; priceEgp: number | null })
  | { notPaid: true };

/**
 * The single Studio Walk-in write engine. Re-validates everything from the
 * database — never trusts a resolved option handed back by the client — and
 * commits the created Booking + Attendance (+ credit ledger, when
 * applicable) atomically via the existing performBookingCheckIn transaction.
 *
 * The "not_paid" decision is a pure no-op: no row of any kind is written.
 * Prefer not calling this function at all for that case (see the route) —
 * it exists here only so the contract is total and callers that do reach it
 * get a well-defined, zero-mutation result rather than an error.
 */
export async function performStudioWalkInCheckIn(
  params: PerformStudioWalkInCheckInParams,
): Promise<StudioWalkInResult> {
  const { accountId, participantChildId, classId, scheduleId, occurrenceDate, payment, actor, now = new Date() } = params;
  const performedBy = actor.actorEmail;

  if (payment.type === "not_paid") {
    return { notPaid: true };
  }

  const txResult = await db.transaction(async (tx) => {
    // Serialize concurrent walk-in attempts for the exact same participant +
    // schedule + occurrence — there is no DB unique index for generic
    // (non-Ballet) Attendance (only attendance_ballet_unique_per_slot_date
    // exists, scoped to Ballet rows), so this advisory lock is the
    // safe-without-a-migration equivalent: the SAME pattern already used by
    // balletAutoAbsence.ts's push-delivery claim. The lock is held for the
    // whole transaction and only released at commit/rollback, so a second
    // concurrent attempt blocks until the first's Booking/Attendance is
    // either fully committed (and this function's own duplicate check below
    // then correctly rejects it) or rolled back (and it proceeds normally).
    const lockKey = computeStudioWalkInCandidateKey(accountId, participantChildId, classId, scheduleId, occurrenceDate);
    await tx.execute(sql`select pg_advisory_xact_lock(2094718344, hashtext(${lockKey}))`);

    const [account] = await tx
      .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email })
      .from(studentsTable)
      .where(eq(studentsTable.id, accountId))
      .limit(1);
    if (!account) throw makeCheckInError(404, "invalid_qr", "Account not found.");

    let studentName = account.name;
    let bookingScope: "self" | "child" = "self";
    if (participantChildId != null) {
      const [child] = await tx
        .select({ id: childrenTable.id, parentId: childrenTable.parentId, fullName: childrenTable.fullName })
        .from(childrenTable)
        .where(eq(childrenTable.id, participantChildId))
        .limit(1);
      if (!child || child.parentId !== accountId) {
        throw makeCheckInError(403, "booking_mismatch", "This child does not belong to the resolved account.");
      }
      studentName = child.fullName;
      bookingScope = "child";
    }

    const [schedule] = await tx
      .select({
        id: schedulesTable.id,
        classId: schedulesTable.classId,
        status: schedulesTable.status,
        type: schedulesTable.type,
        date: schedulesTable.date,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        priceEgp: schedulesTable.priceEgp,
        packageEligible: schedulesTable.packageEligible,
        className: classesTable.title,
        classIsActive: classesTable.isActive,
        instructorIsActive: instructorsTable.isActive,
      })
      .from(schedulesTable)
      .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
      .leftJoin(instructorsTable, eq(instructorsTable.id, classesTable.instructorId))
      .where(eq(schedulesTable.id, scheduleId))
      .limit(1);
    if (!schedule || schedule.classId !== classId) {
      throw makeCheckInError(404, "booking_not_found", "The selected Schedule could not be found.");
    }
    if (schedule.status !== "active" || !schedule.classIsActive || schedule.instructorIsActive === false) {
      throw makeCheckInError(422, "booking_not_actionable", "This Schedule is no longer active.");
    }

    // Never trust the client-supplied occurrenceDate beyond re-deriving and
    // comparing it — the server is the sole authority on which occurrence is
    // currently addressable (mirrors adminAttendanceGateway.ts's Ballet
    // confirm branch).
    const authoritativeOccurrenceDate =
      schedule.type === "one_time"
        ? schedule.date
        : schedule.dayOfWeek != null
          ? attendanceOccurrenceDateForWeeklySchedule({ dayOfWeek: schedule.dayOfWeek, startTime: schedule.startTime, endTime: schedule.endTime }, now)
          : null;
    if (!authoritativeOccurrenceDate || authoritativeOccurrenceDate !== occurrenceDate) {
      throw makeCheckInError(409, "candidate_key_mismatch", "This selection is stale — please search again.");
    }
    const windowState = checkInWindowState({ startTime: schedule.startTime, endTime: schedule.endTime }, occurrenceDate, now);
    if (windowState === "too_early") {
      throw makeCheckInError(400, "check_in_too_early", "Check-in for this class opens 2 hours before it starts.");
    }
    if (windowState !== "open") {
      throw makeCheckInError(400, "check_in_closed", "Check-in for this class closed when it ended.");
    }

    const [existing] = await tx
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .innerJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
      .where(and(
        eq(bookingsTable.scheduleId, scheduleId),
        eq(bookingsTable.occurrenceDate, occurrenceDate),
        participantChildId != null
          ? eq(bookingsTable.participantChildId, participantChildId)
          : and(eq(bookingsTable.accountOwnerStudentId, accountId), sql`${bookingsTable.participantChildId} is null`),
      ))
      .limit(1);
    if (existing) {
      throw makeCheckInError(409, "duplicate_attendance", "This participant already has attendance recorded for this class today.");
    }

    // Re-validated server-side, never trusting that the options list handed
    // back by /walk-in/options is still current: if this participant now has
    // an eligible (confirmed/attended) Booking for this exact Schedule +
    // occurrence, Walk-in must refuse rather than create a second, synthetic
    // Booking for the same seat — the admin should use the normal
    // booked-candidate confirm instead.
    if (await participantHasEligibleBookingForOccurrence(tx, accountId, participantChildId, scheduleId, occurrenceDate)) {
      throw makeCheckInError(409, "booking_exists_use_normal_checkin", "This participant already has a Booking for this class — use the normal check-in instead of Walk-in.");
    }

    if (payment.type === "package_credit" && schedule.packageEligible === false) {
      throw makeCheckInError(400, "package_not_eligible", "This schedule is not eligible for package credits.");
    }

    const [classPricing] = payment.type === "paid_at_studio"
      ? await tx
          .select({ singleClassPriceEgp: classPricingSettingsTable.singleClassPriceEgp })
          .from(classPricingSettingsTable)
          .where(eq(classPricingSettingsTable.id, 1))
          .limit(1)
      : [undefined];
    const priceEgp = schedule.priceEgp ?? classPricing?.singleClassPriceEgp ?? null;

    // The Booking this walk-in is represented as. Inserted "confirmed" (not
    // "attended") so performBookingCheckIn's own state-machine check below
    // treats it exactly like any other confirmed booking about to be
    // checked in — its Step 8 performs the confirmed→attended transition,
    // never this function.
    const [booking] = await tx
      .insert(bookingsTable)
      .values({
        studentName,
        studentEmail: account.email,
        accountOwnerStudentId: accountId,
        participantChildId,
        bookingScope,
        scheduleId,
        classId,
        occurrenceDate,
        status: "confirmed",
        bookingStatus: "confirmed",
        paymentStatus: payment.type === "package_credit" ? "not_required" : "paid",
        paymentMode: payment.type === "package_credit" ? "package_credit" : "pay_at_studio",
        notes: payment.type === "package_credit" ? "Walk-in — package credit" : "Walk-in — paid at studio",
      })
      .returning();

    const checkInResult = await performBookingCheckIn(tx, {
      booking,
      student: account,
      paymentMode: payment.type === "package_credit" ? "package_credit" : "pay_at_studio",
      packageOrderId: payment.type === "package_credit" ? payment.packageOrderId : null,
      performedBy,
      now,
    });

    // Strict — a failure here rolls back the Booking + Attendance (+ ledger)
    // above rather than leaving an unaudited walk-in on the books.
    await logActivityWithActorStrict(tx, actor, {
      action: "checkIn",
      module: "attendance",
      entityType: "attendance",
      entityId: checkInResult.attendanceId,
      entityLabel: checkInResult.studentName,
      after: {
        source: "unified_gateway_walk_in",
        accountId,
        participant: participantChildId != null ? { childId: participantChildId } : { self: true },
        classId,
        scheduleId,
        occurrenceDate,
        paymentSource: payment.type === "package_credit" ? "package_credit" : "pay_at_studio",
        packageOrderId: payment.type === "package_credit" ? payment.packageOrderId : null,
        bookingId: booking.id,
        priceEgp: payment.type === "paid_at_studio" ? priceEgp : null,
        attendanceId: checkInResult.attendanceId,
        status: "checked_in",
      },
      summary: `Recorded Studio walk-in for ${checkInResult.studentName}${checkInResult.classTitle ? ` (${checkInResult.classTitle})` : ""}`,
    });

    return {
      ...checkInResult,
      paymentSource: payment.type === "package_credit" ? "package_credit" : "pay_at_studio",
      bookingId: booking.id,
      priceEgp,
    };
  });

  // Push dispatch happens strictly after the transaction above committed —
  // if logActivityWithActorStrict (or anything else in the transaction)
  // threw, this line is never reached and no push is ever sent for the
  // rolled-back write. flushPushQueue is awaited so callers (including
  // integration tests) that await performStudioWalkInCheckIn() never race a
  // still-in-flight push against their own teardown.
  const { pendingPushJobs, ...result } = txResult;
  await flushPushQueue(pendingPushJobs);
  return result;
}
