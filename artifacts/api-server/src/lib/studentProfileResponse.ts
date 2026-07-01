/**
 * Shared "public student" response shape — used by every route that returns
 * a student to the client (register, login, /auth/me, PATCH /auth/profile,
 * PUT /auth/dance-interests, and the social login handlers). Single place
 * that assembles profileCompletion, so auth.ts and socialAuth.ts don't each
 * carry their own (previously divergent) copy of this logic.
 */
import { eq, sql } from "drizzle-orm";
import { db, studentsTable, childrenTable, studentDanceInterestsTable } from "@workspace/db";
import { computeProfileCompletion, type ProfileCompletion } from "./profileCompletion";

type StudentRow = typeof studentsTable.$inferSelect;

/** Old 3-field definition — kept ONLY as the legacy `profileCompleted` DB
 * column's own meaning ("the Complete Profile step's core fields are done"),
 * not as the account-wide completion source of truth. See profileCompletion.ts
 * for that. */
export function legacyProfileMissingFields(student: Pick<StudentRow, "name" | "phone" | "accountType">): string[] {
  const missing: string[] = [];
  if (!student.name?.trim()) missing.push("name");
  if (!student.phone?.trim()) missing.push("phone");
  if (student.accountType !== "student" && student.accountType !== "parent") missing.push("accountType");
  return missing;
}

export function legacyProfileCompletionPatch(student: Pick<StudentRow, "name" | "phone" | "accountType">) {
  const complete = legacyProfileMissingFields(student).length === 0;
  return {
    profileCompleted: complete,
    profileCompletedAt: complete ? new Date().toISOString() : null,
  };
}

/** Fetches the child/dance-interest counts needed by computeProfileCompletion(). */
async function fetchCompletionCounts(studentId: number): Promise<{ childrenCount: number; childrenMissingMedicalCount: number; danceInterestCount: number }> {
  const [[childrenRow], [interestsRow]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        missingMedical: sql<number>`count(*) filter (where ${childrenTable.medicalNotes} is null)::int`,
      })
      .from(childrenTable)
      .where(eq(childrenTable.parentId, studentId)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(studentDanceInterestsTable)
      .where(eq(studentDanceInterestsTable.studentId, studentId)),
  ]);
  return {
    childrenCount: Number(childrenRow?.total ?? 0),
    childrenMissingMedicalCount: Number(childrenRow?.missingMedical ?? 0),
    danceInterestCount: Number(interestsRow?.total ?? 0),
  };
}

export async function buildProfileCompletion(student: StudentRow): Promise<ProfileCompletion> {
  const counts = await fetchCompletionCounts(student.id);
  return computeProfileCompletion({
    emailVerified: student.emailVerified,
    accountType: student.accountType as "student" | "parent" | null,
    name: student.name,
    phone: student.phone,
    gender: student.gender,
    dateOfBirth: student.dateOfBirth,
    city: student.city,
    nationality: student.nationality,
    howDidYouHearAboutUs: student.howDidYouHearAboutUs,
    policiesAcceptedAt: student.policiesAcceptedAt,
    ...counts,
  });
}

export async function publicStudent(student: StudentRow) {
  const profileCompletion = await buildProfileCompletion(student);
  // Legacy fields kept for any caller still reading the old shape — the new
  // `profileCompletion` block below is the actual source of truth going
  // forward (mobile routing must use profileCompletion.nextStep, never these).
  const legacyMissing = legacyProfileMissingFields(student);
  return {
    id: student.id,
    name: student.name,
    email: student.email,
    phone: student.phone,
    accountType: student.accountType,
    gender: student.gender,
    dateOfBirth: student.dateOfBirth,
    city: student.city,
    nationality: student.nationality,
    howDidYouHearAboutUs: student.howDidYouHearAboutUs,
    policiesAcceptedAt: student.policiesAcceptedAt,
    lastCompletionStep: student.lastCompletionStep,
    emailVerified: student.emailVerified,
    emailVerifiedAt: student.emailVerifiedAt,
    authProvider: student.authProvider,
    avatarUrl: student.avatarUrl ?? null,
    providerAvatarUrl: student.providerAvatarUrl ?? null,
    providerDisplayName: student.providerDisplayName ?? null,
    profileCompleted: legacyMissing.length === 0,
    profileMissingFields: legacyMissing,
    profileCompletion,
    joinedAt: student.joinedAt,
    qrToken: student.qrToken,
  };
}
