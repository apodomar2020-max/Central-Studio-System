/**
 * Membership Engine — identity resolver.
 *
 * The system has several ways to point at "who this operational record
 * belongs to": a student id, a student email, a booking (which may be for
 * the account owner or for one of their children), an attendance record, or
 * a child id directly. This is the SINGLE place that turns any one of those
 * into the same canonical shape, so callers never have to re-derive
 * "is this a self or child booking" / "who actually owns this" logic.
 *
 * This is a read-only helper — it never writes anything. Adopt it in new or
 * single-record read paths where it removes duplicated resolution logic;
 * do NOT use it inside per-row loops over large result sets (it issues its
 * own queries, so that would reintroduce the N+1 patterns the rest of the
 * codebase already works to avoid — those call sites should keep using a
 * single JOIN, exactly as the admin overview endpoint's bulk sections do).
 */
import { eq, sql } from "drizzle-orm";
import { db, studentsTable, bookingsTable, attendanceTable, childrenTable } from "@workspace/db";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface MemberIdentity {
  accountOwnerStudentId: number | null;
  accountOwnerEmail: string | null;
  accountOwnerName: string | null;
  participantType: "self" | "child";
  participantChildId: number | null;
  participantName: string | null;
  normalizedEmail: string | null;
}

export interface ResolveMemberIdentityInput {
  studentId?: number | null;
  studentEmail?: string | null;
  bookingId?: number | null;
  attendanceId?: number | null;
  childId?: number | null;
}

const EMPTY_IDENTITY: MemberIdentity = {
  accountOwnerStudentId: null,
  accountOwnerEmail: null,
  accountOwnerName: null,
  participantType: "self",
  participantChildId: null,
  participantName: null,
  normalizedEmail: null,
};

async function ownerFromStudentRow(studentId: number): Promise<Pick<MemberIdentity, "accountOwnerStudentId" | "accountOwnerEmail" | "accountOwnerName" | "normalizedEmail"> | null> {
  const [student] = await db
    .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .limit(1);
  if (!student) return null;
  return {
    accountOwnerStudentId: student.id,
    accountOwnerEmail: student.email,
    accountOwnerName: student.name,
    normalizedEmail: normalizeEmail(student.email),
  };
}

async function ownerFromEmail(email: string): Promise<Pick<MemberIdentity, "accountOwnerStudentId" | "accountOwnerEmail" | "accountOwnerName" | "normalizedEmail"> | null> {
  const normalized = normalizeEmail(email);
  const [student] = await db
    .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email })
    .from(studentsTable)
    .where(sql`lower(trim(${studentsTable.email})) = ${normalized}`)
    .limit(1);
  if (!student) {
    // No matching account — still return the normalized email so callers
    // have *something* stable to key off, but no owner identity to attach.
    return { accountOwnerStudentId: null, accountOwnerEmail: null, accountOwnerName: null, normalizedEmail: normalized };
  }
  return {
    accountOwnerStudentId: student.id,
    accountOwnerEmail: student.email,
    accountOwnerName: student.name,
    normalizedEmail: normalized,
  };
}

/**
 * Resolves any one (or combination) of {studentId, studentEmail, bookingId,
 * attendanceId, childId} into the canonical member identity. Priority when
 * multiple inputs are given: bookingId > attendanceId > childId > studentId
 * > studentEmail — the more specific operational record wins, since it
 * carries participant (self vs child) context the bare id/email can't.
 *
 * Never throws for "not found" — returns a mostly-null identity instead, so
 * callers can render an honest empty state rather than crash on a legacy or
 * orphaned record.
 */
export async function resolveMemberIdentity(input: ResolveMemberIdentityInput): Promise<MemberIdentity> {
  if (input.bookingId != null) {
    const [booking] = await db
      .select({
        accountOwnerStudentId: bookingsTable.accountOwnerStudentId,
        studentEmail: bookingsTable.studentEmail,
        studentName: bookingsTable.studentName,
        participantChildId: bookingsTable.participantChildId,
      })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, input.bookingId))
      .limit(1);
    if (!booking) return EMPTY_IDENTITY;

    const owner = booking.accountOwnerStudentId != null
      ? await ownerFromStudentRow(booking.accountOwnerStudentId)
      : await ownerFromEmail(booking.studentEmail);

    if (booking.participantChildId != null) {
      const [child] = await db
        .select({ id: childrenTable.id, fullName: childrenTable.fullName })
        .from(childrenTable)
        .where(eq(childrenTable.id, booking.participantChildId))
        .limit(1);
      return {
        ...EMPTY_IDENTITY,
        ...owner,
        participantType: "child",
        participantChildId: booking.participantChildId,
        participantName: child?.fullName ?? booking.studentName,
      };
    }
    return {
      ...EMPTY_IDENTITY,
      ...owner,
      participantType: "self",
      participantName: booking.studentName,
    };
  }

  if (input.attendanceId != null) {
    const [attendance] = await db
      .select({
        studentId: attendanceTable.studentId,
        studentEmail: attendanceTable.studentEmail,
        studentName: attendanceTable.studentName,
        bookingId: attendanceTable.bookingId,
      })
      .from(attendanceTable)
      .where(eq(attendanceTable.id, input.attendanceId))
      .limit(1);
    if (!attendance) return EMPTY_IDENTITY;

    // Attendance itself has no participant-child column — the only reliable
    // way to know whether this was a child's attendance is via the booking
    // it satisfies (if any). Walk-in attendance (no bookingId) has no child
    // link in the data model today; we report it honestly as "self" rather
    // than guess from the name string.
    if (attendance.bookingId != null) {
      return resolveMemberIdentity({ bookingId: attendance.bookingId });
    }

    const owner = attendance.studentId != null
      ? await ownerFromStudentRow(attendance.studentId)
      : await ownerFromEmail(attendance.studentEmail);
    return {
      ...EMPTY_IDENTITY,
      ...owner,
      participantType: "self",
      participantName: attendance.studentName,
    };
  }

  if (input.childId != null) {
    const [child] = await db
      .select({ id: childrenTable.id, fullName: childrenTable.fullName, parentId: childrenTable.parentId })
      .from(childrenTable)
      .where(eq(childrenTable.id, input.childId))
      .limit(1);
    if (!child) return EMPTY_IDENTITY;
    const owner = await ownerFromStudentRow(child.parentId);
    return {
      ...EMPTY_IDENTITY,
      ...owner,
      participantType: "child",
      participantChildId: child.id,
      participantName: child.fullName,
    };
  }

  if (input.studentId != null) {
    const owner = await ownerFromStudentRow(input.studentId);
    if (!owner) return EMPTY_IDENTITY;
    return { ...EMPTY_IDENTITY, ...owner, participantType: "self", participantName: owner.accountOwnerName };
  }

  if (input.studentEmail != null) {
    const owner = await ownerFromEmail(input.studentEmail);
    if (!owner) return EMPTY_IDENTITY;
    return { ...EMPTY_IDENTITY, ...owner, participantType: "self", participantName: owner.accountOwnerName };
  }

  return EMPTY_IDENTITY;
}
