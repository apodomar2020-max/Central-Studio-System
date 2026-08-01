/**
 * Ballet routes — /api/ballet/*
 *
 * Public routes (shared API key only):
 *   GET  /api/ballet/settings                     — admin-managed mobile presentation settings
 *   GET  /api/ballet/summary                      — public aggregate programme counts
 *   GET  /api/ballet/available-assessment-schedules — schedule-based assessment occurrences
 *   GET  /api/ballet/instructors                  — active instructor roster
 *   GET  /api/ballet/classes                      — active classes with schedules, instructor, group/level ids
 *   GET  /api/ballet/packages                     — active monthly Ballet packages with level ids
 *   GET  /api/ballet/levels                       — active levels, ordered by sortOrder
 *   GET  /api/ballet/performances                 — upcoming performance opportunities
 *   GET  /api/ballet/groups                       — active groups (id/name/levelId — resolves classes' groupIds)
 *
 * Student-authenticated routes (student JWT required via requireStudentAuth):
 *   POST /api/ballet/applications                 — submit new application (duplicate-safe)
 *   GET  /api/ballet/applications/my             — authenticated parent's own applications
 *                                                   (Phase 4E: each row also carries
 *                                                   assignedGroupId, resolved from the
 *                                                   application's current active
 *                                                   ballet_level_assignments row)
 *   GET  /api/ballet/classes/my                  — owned children and entitled weekly Classes
 *   PATCH  /api/ballet/applications/:id          — edit editable fields (status-gated)
 *   POST /api/ballet/applications/:id/cancel     — cancel an application (status-gated)
 *
 * Duplicate prevention:
 *   Open statuses = pending | accepted | needsFollowUp | assignedToLevel | active
 *   If the same authenticated parent already has an active application for the
 *   same child — matched by childId when a saved child profile is linked,
 *   else by name + birthday — POST returns 409 with existingApplicationId so
 *   the mobile can redirect to the status screen without a second round-trip.
 *   This app-level SELECT is a fast path only (Phase A / P0-3) — the real
 *   guarantee is the pair of partial unique indexes on ballet_applications
 *   added in migration 0050 (ballet_applications_active_per_child,
 *   ballet_applications_active_per_manual_identity); a 23505 from either is
 *   caught and translated to the same 409 shape. Rejected, cancelled, and
 *   withdrawn are terminal and allow reapplication.
 *
 * Assessment schedule submission:
 *   Assessment options are projected from active ballet_schedules connected to
 *   active classes and age-eligible active levels. Submissions store only the
 *   selected schedule occurrence on ballet_applications.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, lte, ilike, isNotNull, isNull, or, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletSettingsTable,
  balletApplicationsTable,
  balletApplicationEventsTable,
  childrenTable,
  balletInstructorsTable,
  balletClassesTable,
  balletSchedulesTable,
  balletLevelsTable,
  balletPerformanceOpportunitiesTable,
  balletProgramRequirementSectionsTable,
  balletProgramRequirementItemsTable,
  balletFaqsTable,
  balletGroupsTable,
  balletPackagesTable,
  balletPackageLevelsTable,
  balletClassLevelsTable,
  balletLevelAssignmentsTable,
  balletPaymentsTable,
  balletRefundsTable,
  BALLET_PAYMENT_METHODS,
  studentsTable,
  studioBranchesTable,
  studioRoomsTable,
} from "@workspace/db";
import { BALLET_ASSESSMENT_BOOKING_WINDOW_DAYS } from "@workspace/api-zod";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { logger } from "../lib/logger";
import { computeBalletMonthlyAttendanceSummary, currentBillingMonth } from "../lib/balletAttendance";
import { normalizeInstructorPhotoUrlForResponse } from "../lib/instructorPhotoUrl";
import { buildActiveBalletInstructorCountQuery } from "../lib/balletInstructorCountQuery";
import { isAssignmentReadyClass, isOperationalBalletClass, isOperationalBalletSchedule, scheduleShapeCondition } from "../lib/balletClassEntitlement";
import { buildActiveBalletWeeklyScheduleCountQuery } from "../lib/balletWeeklyScheduleCountQuery";
import { currentSubscription, getPaymentCyclesForApplications } from "../lib/balletSubscriptions";
import { buildMyBalletClassesResponse } from "../lib/balletMyClasses";
import { computeAgeAsOf, isAgeEligible } from "../lib/balletAgeEligibility";
import { cairoNow } from "../lib/occurrence";

export { computeAgeAsOf, isAgeEligible };

const router: IRouter = Router();

// ─── Statuses ─────────────────────────────────────────────────────────────────

/**
 * Statuses that mean an application is still open — i.e. the parent has
 * an open slot and should not be allowed to submit a duplicate.
 * "rejected", "cancelled", and "withdrawn" are terminal-inactive statuses.
 */
const ACTIVE_STATUSES = [
  "pending",
  "accepted",
  "needsFollowUp",
  "assignedToLevel",
  "active",
] as const;

/** Statuses that allow the parent to edit fields on their application. */
const EDITABLE_STATUSES = ["pending", "needsFollowUp"] as const;

/** Statuses that allow the parent to cancel before active enrollment. */
const CANCELLABLE_STATUSES = ["pending", "needsFollowUp", "accepted", "assignedToLevel"] as const;

const SUPPORTED_MOBILE_ASSESSMENT_PAYMENT_METHOD = "inPerson" as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

function dayOfWeekFromDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return DAY_NAMES[d.getUTCDay()] ?? "Unknown";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeTimeLabel(time: string): string {
  const [hourRaw, minuteRaw = "00"] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * Computes age in whole years as of `referenceDateIso`, NOT as of today —
 * used to check assessment-slot age eligibility against the child's age on
 * the slot's actual date, not the date the application happens to be
 * submitted. Returns null if either date string is not a valid calendar.
 */
export type AssessmentOccurrence = {
  scheduleId: number;
  classId: number;
  className: string;
  levelId: number;
  levelName: string;
  date: string;
  day: string;
  time: string;
  startTime: string;
  endTime: string;
  capacity?: number | null;
};

export type ListAvailableAssessmentSchedulesResult = {
  schedules: AssessmentOccurrence[];
  emptyReason?: string;
  code?: string;
};

export async function listAvailableAssessmentSchedules(
  childBirthday: string,
): Promise<ListAvailableAssessmentSchedulesResult> {
  if (!childBirthday || !/^\d{4}-\d{2}-\d{2}$/.test(childBirthday)) {
    return {
      schedules: [],
      emptyReason: "A valid child birthday is required to view available assessment appointments.",
      code: "MISSING_BIRTHDAY",
    };
  }

  const today = todayIso();
  const end = addDaysIso(today, BALLET_ASSESSMENT_BOOKING_WINDOW_DAYS);

  const ageAtToday = computeAgeAsOf(childBirthday, today);
  const ageAtEnd = computeAgeAsOf(childBirthday, end);

  if (ageAtToday == null || ageAtEnd == null) {
    return {
      schedules: [],
      emptyReason: "A valid child birthday is required to view available assessment appointments.",
      code: "MISSING_BIRTHDAY",
    };
  }

  const activeLevels = await db
    .select({
      id: balletLevelsTable.id,
      name: balletLevelsTable.name,
      ageMin: balletLevelsTable.ageMin,
      ageMax: balletLevelsTable.ageMax,
    })
    .from(balletLevelsTable)
    .where(eq(balletLevelsTable.isActive, true));

  const eligibleLevels = activeLevels.filter((l) => {
    return (
      (l.ageMin == null || ageAtEnd >= l.ageMin) &&
      (l.ageMax == null || ageAtToday <= l.ageMax)
    );
  });

  if (activeLevels.length > 0 && eligibleLevels.length === 0) {
    return {
      schedules: [],
      emptyReason: "No ballet levels are currently configured for your child's age group.",
      code: "NO_AGE_ELIGIBLE_LEVEL",
    };
  }

  const rows = await db
    .select({
      scheduleId: balletSchedulesTable.id,
      dayOfWeek:  balletSchedulesTable.dayOfWeek,
      startTime:  balletSchedulesTable.startTime,
      endTime:    balletSchedulesTable.endTime,
      classId:    balletClassesTable.id,
      className:  balletClassesTable.title,
      levelId:    balletLevelsTable.id,
      levelName:  balletLevelsTable.name,
      ageMin:     balletLevelsTable.ageMin,
      ageMax:     balletLevelsTable.ageMax,
      capacity:   balletSchedulesTable.capacity,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .leftJoin(
      balletClassLevelsTable,
      and(
        isNull(balletClassesTable.levelId),
        eq(balletClassLevelsTable.classId, balletClassesTable.id),
      ),
    )
    .innerJoin(
      balletLevelsTable,
      eq(
        balletLevelsTable.id,
        sql<number>`coalesce(${balletClassesTable.levelId}, ${balletClassLevelsTable.levelId})`,
      ),
    )
    .where(and(
      eq(balletSchedulesTable.status, "active"),
      eq(balletClassesTable.isActive, true),
      eq(balletLevelsTable.isActive, true),
    ))
    .orderBy(asc(balletLevelsTable.sortOrder), asc(balletClassesTable.title), asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime));

  if (rows.length === 0) {
    return {
      schedules: [],
      emptyReason: "No assessment appointments are currently scheduled for your child's level.",
      code: "NO_ACTIVE_SCHEDULES",
    };
  }

  const bookings = await db
    .select({
      scheduleId: balletApplicationsTable.assessmentScheduleId,
      date:       balletApplicationsTable.assessmentDate,
      count:      count(),
    })
    .from(balletApplicationsTable)
    .where(and(
      inArray(balletApplicationsTable.status, ["pending", "accepted", "needsFollowUp", "assignedToLevel", "active"]),
      isNotNull(balletApplicationsTable.assessmentScheduleId),
      isNotNull(balletApplicationsTable.assessmentDate),
      gte(balletApplicationsTable.assessmentDate, today),
      lte(balletApplicationsTable.assessmentDate, end),
    ))
    .groupBy(balletApplicationsTable.assessmentScheduleId, balletApplicationsTable.assessmentDate);

  const bookedCountMap = new Map<string, number>();
  for (const b of bookings) {
    if (b.scheduleId != null && b.date != null) {
      bookedCountMap.set(`${b.scheduleId}:${b.date}`, b.count);
    }
  }

  const occurrenceKeys = new Set<string>();
  const occurrences: AssessmentOccurrence[] = [];
  let totalCandidates = 0;
  let fullCandidates = 0;

  for (const row of rows) {
    for (let cursor = today; cursor <= end; cursor = addDaysIso(cursor, 1)) {
      const date = new Date(`${cursor}T12:00:00Z`);
      if (date.getUTCDay() !== row.dayOfWeek) continue;

      const age = computeAgeAsOf(childBirthday, cursor);
      if (age == null) continue;
      const eligible = isAgeEligible(age, row.ageMin, row.ageMax);
      if (!eligible) continue;

      const bookedKey = `${row.scheduleId}:${cursor}`;
      if (occurrenceKeys.has(bookedKey)) continue;

      totalCandidates++;
      const booked = bookedCountMap.get(bookedKey) ?? 0;
      if (row.capacity != null && booked >= row.capacity) {
        fullCandidates++;
        continue;
      }

      occurrenceKeys.add(bookedKey);
      occurrences.push({
        scheduleId: row.scheduleId,
        classId:    row.classId,
        className:  row.className,
        levelId:    row.levelId,
        levelName:  row.levelName,
        date:       cursor,
        day:        DAY_NAMES[row.dayOfWeek] ?? dayOfWeekFromDate(cursor),
        time:       normalizeTimeLabel(row.startTime),
        startTime:  row.startTime,
        endTime:    row.endTime,
        capacity:   row.capacity,
      });
    }
  }

  if (occurrences.length === 0) {
    if (totalCandidates > 0 && fullCandidates === totalCandidates) {
      return {
        schedules: [],
        emptyReason: "Assessment appointments for your child's level are currently fully booked.",
        code: "SCHEDULES_FULL",
      };
    }
    return {
      schedules: [],
      emptyReason: "No assessment appointments are currently scheduled for your child's level.",
      code: "NO_ACTIVE_SCHEDULES",
    };
  }

  occurrences.sort((a, b) => (
    a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) ||
    a.className.localeCompare(b.className) ||
    a.levelName.localeCompare(b.levelName)
  ));

  return { schedules: occurrences };
}

export async function resolveAssessmentOccurrence(scheduleId: number, assessmentDate: string, childBirthday: string): Promise<AssessmentOccurrence | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) return null;

  const rows = await db
    .select({
      scheduleId: balletSchedulesTable.id,
      dayOfWeek:  balletSchedulesTable.dayOfWeek,
      startTime:  balletSchedulesTable.startTime,
      endTime:    balletSchedulesTable.endTime,
      classId:    balletClassesTable.id,
      className:  balletClassesTable.title,
      levelId:    balletLevelsTable.id,
      levelName:  balletLevelsTable.name,
      ageMin:     balletLevelsTable.ageMin,
      ageMax:     balletLevelsTable.ageMax,
      capacity:   balletSchedulesTable.capacity,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .leftJoin(
      balletClassLevelsTable,
      and(
        isNull(balletClassesTable.levelId),
        eq(balletClassLevelsTable.classId, balletClassesTable.id),
      ),
    )
    .innerJoin(
      balletLevelsTable,
      eq(
        balletLevelsTable.id,
        sql<number>`coalesce(${balletClassesTable.levelId}, ${balletClassLevelsTable.levelId})`,
      ),
    )
    .where(and(
      eq(balletSchedulesTable.id, scheduleId),
      eq(balletSchedulesTable.status, "active"),
      eq(balletClassesTable.isActive, true),
      eq(balletLevelsTable.isActive, true),
    ))
    .orderBy(asc(balletLevelsTable.sortOrder))
    .limit(10);

  const selectedDate = new Date(`${assessmentDate}T12:00:00Z`);
  if (Number.isNaN(selectedDate.getTime())) return null;

  for (const row of rows) {
    if (selectedDate.getUTCDay() !== row.dayOfWeek) continue;
    const age = computeAgeAsOf(childBirthday, assessmentDate);
    if (age == null) return null;
    const eligible = isAgeEligible(age, row.ageMin, row.ageMax);
    if (!eligible) continue;
    return {
      scheduleId: row.scheduleId,
      classId:    row.classId,
      className:  row.className,
      levelId:    row.levelId,
      levelName:  row.levelName,
      date:       assessmentDate,
      day:        DAY_NAMES[row.dayOfWeek] ?? dayOfWeekFromDate(assessmentDate),
      time:       normalizeTimeLabel(row.startTime),
      startTime:  row.startTime,
      endTime:    row.endTime,
      capacity:   row.capacity,
    };
  }

  return null;
}

// ─── Default settings ─────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  homeCardImageUrl: null,
  whatsappNumber: null,
  phoneNumber: null,
  email: null,
  studioLocationUrl: null,
};

// ─── GET /api/ballet/settings ─────────────────────────────────────────────────

router.get("/ballet/settings", async (_req, res): Promise<void> => {
  try {
    const [row] = await db
      .select()
      .from(balletSettingsTable)
      .where(eq(balletSettingsTable.id, 1))
      .limit(1);

    if (!row) {
      logger.warn("ballet_settings row id=1 is missing — returning defaults");
      res.json(DEFAULT_SETTINGS);
      return;
    }

    res.json({
      homeCardImageUrl: row.homeCardImageUrl ?? null,
      whatsappNumber: row.whatsappNumber ?? null,
      phoneNumber: row.phoneNumber ?? null,
      email: row.email ?? null,
      studioLocationUrl: row.studioLocationUrl ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/settings failed");
    res.status(500).json({ error: "Failed to load ballet settings" });
  }
});

// ─── GET /api/ballet/program-requirements ─────────────────────────────────────

router.get("/ballet/program-requirements", async (_req, res): Promise<void> => {
  try {
    const [sections, items] = await Promise.all([
      db
        .select({
          id:          balletProgramRequirementSectionsTable.id,
          title:       balletProgramRequirementSectionsTable.title,
          description: balletProgramRequirementSectionsTable.description,
          sortOrder:   balletProgramRequirementSectionsTable.sortOrder,
        })
        .from(balletProgramRequirementSectionsTable)
        .where(eq(balletProgramRequirementSectionsTable.isActive, true))
        .orderBy(asc(balletProgramRequirementSectionsTable.sortOrder), asc(balletProgramRequirementSectionsTable.id)),
      db
        .select({
          id:        balletProgramRequirementItemsTable.id,
          sectionId: balletProgramRequirementItemsTable.sectionId,
          text:      balletProgramRequirementItemsTable.text,
          sortOrder: balletProgramRequirementItemsTable.sortOrder,
        })
        .from(balletProgramRequirementItemsTable)
        .where(eq(balletProgramRequirementItemsTable.isActive, true))
        .orderBy(asc(balletProgramRequirementItemsTable.sectionId), asc(balletProgramRequirementItemsTable.sortOrder), asc(balletProgramRequirementItemsTable.id)),
    ]);

    const activeSectionIds = new Set(sections.map((section) => section.id));
    const itemsBySection = new Map<number, typeof items>();
    for (const item of items) {
      if (!activeSectionIds.has(item.sectionId)) continue;
      itemsBySection.set(item.sectionId, [...(itemsBySection.get(item.sectionId) ?? []), item]);
    }

    res.json({
      sections: sections.map((section) => ({
        ...section,
        items: itemsBySection.get(section.id) ?? [],
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/program-requirements failed");
    res.status(500).json({ error: "Failed to load ballet program requirements" });
  }
});

// ─── GET /api/ballet/faqs ─────────────────────────────────────────────────────

router.get("/ballet/faqs", async (_req, res): Promise<void> => {
  try {
    const faqs = await db
      .select({
        id:        balletFaqsTable.id,
        question:  balletFaqsTable.question,
        answer:    balletFaqsTable.answer,
        sortOrder: balletFaqsTable.sortOrder,
      })
      .from(balletFaqsTable)
      .where(eq(balletFaqsTable.isActive, true))
      .orderBy(asc(balletFaqsTable.sortOrder), asc(balletFaqsTable.id));

    res.json({ faqs });
  } catch (err) {
    logger.error({ err }, "GET /ballet/faqs failed");
    res.status(500).json({ error: "Failed to load Ballet FAQs" });
  }
});

// ─── GET /api/ballet/summary ─────────────────────────────────────────────────
//
// Public aggregate programme counts for the mobile landing page.
// Returns counts only — no student IDs, names, contact details, or row data.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/summary", async (_req, res): Promise<void> => {
  try {
    const [
      [activeStudents],
      [instructors],
      [levels],
      [weeklySchedules],
    ] = await Promise.all([
      db
        .select({ total: sql<number>`count(distinct coalesce(${balletApplicationsTable.childId}::text, 'application:' || ${balletApplicationsTable.id}::text))::int` })
        .from(balletApplicationsTable)
        .where(eq(balletApplicationsTable.status, "active")),
      // See buildActiveBalletInstructorCountQuery's doc comment: this used to
      // INNER JOIN through ballet_classes/ballet_schedules, which silently
      // excluded any active instructor without a fully wired class+schedule.
      buildActiveBalletInstructorCountQuery(),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(balletLevelsTable)
        .where(eq(balletLevelsTable.isActive, true)),
      buildActiveBalletWeeklyScheduleCountQuery(),
    ]);

    res.json({
      activeStudents: activeStudents?.total ?? 0,
      instructors: instructors?.total ?? 0,
      levels: levels?.total ?? 0,
      weeklySchedules: weeklySchedules?.total ?? 0,
      classes: weeklySchedules?.total ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/summary failed");
    res.status(500).json({ error: "Failed to load ballet summary" });
  }
});

// ─── GET /api/ballet/available-assessment-schedules ─────────────────────────
//
// Query params:
//   childBirthday (required) — used server-side to derive age eligibility
//     against each projected schedule occurrence in the next 4 weeks.
// ─────────────────────────────────────────────────────────────────────────────

const AvailableAssessmentSchedulesQuery = z.object({
  childBirthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "childBirthday must be YYYY-MM-DD").optional(),
  childId: z.coerce.number().int().positive().optional(),
});

router.get("/ballet/available-assessment-schedules", async (req, res): Promise<void> => {
  const parsedQuery = AvailableAssessmentSchedulesQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues[0]?.message ?? "Invalid query parameters" });
    return;
  }

  let resolvedBirthday = parsedQuery.data.childBirthday;

  if (parsedQuery.data.childId != null) {
    // If student auth header is present or childId requested, validate ownership
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        const jwt = await import("jsonwebtoken");
        const secret = process.env.STUDENT_JWT_SECRET ?? "dev-student-secret-change-in-production";
        const decoded = jwt.default.verify(token, secret) as { sub?: number };
        if (decoded?.sub) {
          const [child] = await db
            .select({ birthday: childrenTable.birthday })
            .from(childrenTable)
            .where(and(
              eq(childrenTable.id, parsedQuery.data.childId),
              eq(childrenTable.parentId, decoded.sub),
            ))
            .limit(1);

          if (!child) {
            res.status(404).json({ error: "Child profile not found or does not belong to your account" });
            return;
          }

          // Authoritative canonical stored birthday overrides any client override
          resolvedBirthday = child.birthday;
        }
      } catch {
        // invalid token ignored for optional auth check
      }
    }
  }

  if (!resolvedBirthday) {
    res.status(400).json({ error: "childBirthday or a valid owned childId is required" });
    return;
  }

  try {
    const result = await listAvailableAssessmentSchedules(resolvedBirthday);
    if (result.schedules.length > 0) {
      res.json(result.schedules);
    } else {
      if (result.emptyReason) res.header("X-Empty-Reason", result.emptyReason);
      if (result.code) res.header("X-Empty-Code", result.code);
      res.json([]);
    }
  } catch (err) {
    logger.error({ err }, "GET /ballet/available-assessment-schedules failed");
    res.status(500).json({ error: "Failed to load available assessment schedules" });
  }
});

// ─── GET /api/ballet/instructors ──────────────────────────────────────────────
//
// Public read-only instructor roster. Active instructors only.
// Response: { instructors: BalletInstructor[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/instructors", async (_req, res): Promise<void> => {
  try {
    const instructors = await db
      .select({
        id:                     balletInstructorsTable.id,
        name:                   balletInstructorsTable.name,
        bio:                    balletInstructorsTable.bio,
        photoUrl:               balletInstructorsTable.photoUrl,
        specialties:            balletInstructorsTable.specialties,
        experienceYears:        balletInstructorsTable.experienceYears,
        rating:                 balletInstructorsTable.rating,
        instagramUrl:           balletInstructorsTable.instagramUrl,
        tiktokUrl:              balletInstructorsTable.tiktokUrl,
        youtubeUrl:             balletInstructorsTable.youtubeUrl,
        teachingLevel:          balletInstructorsTable.teachingLevel,
        achievements:           balletInstructorsTable.achievements,
        teachingPhilosophy:     balletInstructorsTable.teachingPhilosophy,
        professionalExperience: balletInstructorsTable.professionalExperience,
      })
      .from(balletInstructorsTable)
      .where(eq(balletInstructorsTable.isActive, true))
      .orderBy(asc(balletInstructorsTable.name));

    res.json({ instructors: instructors.map((instructor) => ({
      ...instructor,
      photoUrl: normalizeInstructorPhotoUrlForResponse(instructor.photoUrl),
    })) });
  } catch (err) {
    logger.error({ err }, "GET /ballet/instructors failed");
    res.status(500).json({ error: "Failed to load instructors" });
  }
});

// ─── GET /api/ballet/instructors/:id ─────────────────────────────────────────
//
// Public read-only instructor detail. Active instructors only.
// Response: { instructor: BalletInstructor }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/instructors/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid instructor ID" });
    return;
  }

  try {
    const [instructor] = await db
      .select({
        id:                     balletInstructorsTable.id,
        name:                   balletInstructorsTable.name,
        bio:                    balletInstructorsTable.bio,
        photoUrl:               balletInstructorsTable.photoUrl,
        specialties:            balletInstructorsTable.specialties,
        experienceYears:        balletInstructorsTable.experienceYears,
        rating:                 balletInstructorsTable.rating,
        instagramUrl:           balletInstructorsTable.instagramUrl,
        tiktokUrl:              balletInstructorsTable.tiktokUrl,
        youtubeUrl:             balletInstructorsTable.youtubeUrl,
        teachingLevel:          balletInstructorsTable.teachingLevel,
        achievements:           balletInstructorsTable.achievements,
        teachingPhilosophy:     balletInstructorsTable.teachingPhilosophy,
        professionalExperience: balletInstructorsTable.professionalExperience,
      })
      .from(balletInstructorsTable)
      .where(and(eq(balletInstructorsTable.id, id), eq(balletInstructorsTable.isActive, true)))
      .limit(1);

    if (!instructor) {
      res.status(404).json({ error: "Instructor not found" });
      return;
    }

    res.json({
      instructor: {
        ...instructor,
        photoUrl: normalizeInstructorPhotoUrlForResponse(instructor.photoUrl),
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/instructors/:id failed");
    res.status(500).json({ error: "Failed to load instructor" });
  }
});

// ─── GET /api/ballet/levels ────────────────────────────────────────────────────
//
// Public read-only level list. Active levels only, ordered by sortOrder.
// Response: { levels: BalletLevel[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/levels", async (_req, res): Promise<void> => {
  try {
    const levels = await db
      .select({
        id:           balletLevelsTable.id,
        name:         balletLevelsTable.name,
        sortOrder:    balletLevelsTable.sortOrder,
        isActive:     balletLevelsTable.isActive,
        description:  balletLevelsTable.description,
        requirements: balletLevelsTable.requirements,
        imageUrl:     balletLevelsTable.imageUrl,
        ageMin:       balletLevelsTable.ageMin,
        ageMax:       balletLevelsTable.ageMax,
      })
      .from(balletLevelsTable)
      .where(eq(balletLevelsTable.isActive, true))
      .orderBy(asc(balletLevelsTable.sortOrder), asc(balletLevelsTable.id));

    res.json({ levels });
  } catch (err) {
    logger.error({ err }, "GET /ballet/levels failed");
    res.status(500).json({ error: "Failed to load levels" });
  }
});

// ─── GET /api/ballet/groups ────────────────────────────────────────────────────
//
// Public read-only group list — lets the mobile resolve the groupIds returned
// by GET /api/ballet/classes into display names. Active groups only.
// Response: { groups: { id, name, levelId }[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/groups", async (_req, res): Promise<void> => {
  try {
    const groups = await db
      .select({
        id:      balletGroupsTable.id,
        name:    balletGroupsTable.name,
        levelId: balletGroupsTable.levelId,
      })
      .from(balletGroupsTable)
      .where(eq(balletGroupsTable.isActive, true))
      .orderBy(asc(balletGroupsTable.name));

    res.json({ groups });
  } catch (err) {
    logger.error({ err }, "GET /ballet/groups failed");
    res.status(500).json({ error: "Failed to load groups" });
  }
});

// ─── GET /api/ballet/packages ─────────────────────────────────────────────────
//
// Public read-only monthly Ballet package catalogue. Active packages only.
// Response: { packages: { id, name, monthlyClasses, monthlyHours, priceEgp, levelIds }[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/packages", async (_req, res): Promise<void> => {
  try {
    const packages = await db
      .select({
        id:             balletPackagesTable.id,
        name:           balletPackagesTable.name,
        monthlyClasses: balletPackagesTable.monthlyClasses,
        monthlyHours:   balletPackagesTable.monthlyHours,
        priceEgp:       balletPackagesTable.priceEgp,
      })
      .from(balletPackagesTable)
      .where(eq(balletPackagesTable.isActive, true))
      .orderBy(asc(balletPackagesTable.priceEgp), asc(balletPackagesTable.id));

    const packageIds = packages.map((pkg) => pkg.id);
    const levelIdsByPackageId = new Map<number, number[]>();

    if (packageIds.length > 0) {
      const levelRows = await db
        .select({
          packageId: balletPackageLevelsTable.packageId,
          levelId:   balletPackageLevelsTable.levelId,
        })
        .from(balletPackageLevelsTable)
        .where(inArray(balletPackageLevelsTable.packageId, packageIds))
        .orderBy(asc(balletPackageLevelsTable.packageId), asc(balletPackageLevelsTable.levelId));

      for (const row of levelRows) {
        levelIdsByPackageId.set(row.packageId, [...(levelIdsByPackageId.get(row.packageId) ?? []), row.levelId]);
      }
    }

    res.json({
      packages: packages.map((pkg) => ({
        ...pkg,
        levelIds: levelIdsByPackageId.get(pkg.id) ?? [],
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/packages failed");
    res.status(500).json({ error: "Failed to load Ballet packages" });
  }
});

// ─── GET /api/ballet/performances ──────────────────────────────────────────────
//
// Public read-only upcoming performance opportunities (eventDate >= today).
// Response: { performances: BalletPerformanceOpportunity[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/performances", async (_req, res): Promise<void> => {
  try {
    const today = todayIso();

    const performances = await db
      .select({
        id:           balletPerformanceOpportunitiesTable.id,
        eventTitle:   balletPerformanceOpportunitiesTable.eventTitle,
        description:  balletPerformanceOpportunitiesTable.description,
        imageUrl:     balletPerformanceOpportunitiesTable.imageUrl,
        eventType:    balletPerformanceOpportunitiesTable.eventType,
        locationName: balletPerformanceOpportunitiesTable.locationName,
        eventDate:    balletPerformanceOpportunitiesTable.eventDate,
        startTime:    balletPerformanceOpportunitiesTable.startTime,
        endTime:      balletPerformanceOpportunitiesTable.endTime,
        requirements: balletPerformanceOpportunitiesTable.requirements,
        externalCtaUrl: balletPerformanceOpportunitiesTable.externalCtaUrl,
      })
      .from(balletPerformanceOpportunitiesTable)
      .where(and(
        eq(balletPerformanceOpportunitiesTable.status, "active"),
        gte(balletPerformanceOpportunitiesTable.eventDate, today),
      ))
      .orderBy(asc(balletPerformanceOpportunitiesTable.eventDate));

    res.json({ performances });
  } catch (err) {
    logger.error({ err }, "GET /ballet/performances failed");
    res.status(500).json({ error: "Failed to load performance opportunities" });
  }
});

// ─── GET /api/ballet/classes ───────────────────────────────────────────────────
//
// Public read-only class catalogue. Active canonical (non-legacy) classes
// only, each enriched with:
//   - schedules: all active weekly ballet_schedules rows, ordered deterministically
//   - schedule: deprecated compatibility alias for the first active row, or null
//   - groupId / levelId: direct required relationships on ballet_classes
//   - instructor: { id, name, photoUrl } resolved via instructorId, or null
//
// Legacy (is_legacy=true) rows are never surfaced here — they are retired
// historical Classes, not part of the live public catalogue.
//
// Response: { classes: [...] }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/classes", async (_req, res): Promise<void> => {
  try {
    const classRows = await db
      .select({
        id:                 balletClassesTable.id,
        title:              balletClassesTable.title,
        classImageUrl:      balletClassesTable.classImageUrl,
        classVideoUrl:      balletClassesTable.classVideoUrl,
        instructorId:       balletClassesTable.instructorId,
        instructorName:     balletInstructorsTable.name,
        instructorPhotoUrl: balletInstructorsTable.photoUrl,
        groupId:            balletClassesTable.groupId,
        levelId:            balletClassesTable.levelId,
      })
      .from(balletClassesTable)
      .leftJoin(balletInstructorsTable, eq(balletClassesTable.instructorId, balletInstructorsTable.id))
      .where(isOperationalBalletClass())
      .orderBy(asc(balletClassesTable.title));

    const classIds = classRows.map((c) => c.id);

    const scheduleRows = classIds.length > 0
      ? await db
          .select({
            id:           balletSchedulesTable.id,
            classId:      balletSchedulesTable.classId,
            dayOfWeek:    balletSchedulesTable.dayOfWeek,
            startTime:    balletSchedulesTable.startTime,
            endTime:      balletSchedulesTable.endTime,
            durationMins: balletSchedulesTable.durationMins,
            branchId:     balletSchedulesTable.branchId,
            branchName:   studioBranchesTable.name,
            branchCode:   studioBranchesTable.code,
            roomId:       balletSchedulesTable.roomId,
            roomBranchId: studioRoomsTable.branchId,
            roomName:     studioRoomsTable.name,
            roomCode:     studioRoomsTable.code,
          })
          .from(balletSchedulesTable)
          .leftJoin(studioBranchesTable, eq(balletSchedulesTable.branchId, studioBranchesTable.id))
          .leftJoin(studioRoomsTable, eq(balletSchedulesTable.roomId, studioRoomsTable.id))
          .where(and(inArray(balletSchedulesTable.classId, classIds), scheduleShapeCondition()))
          .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime), asc(balletSchedulesTable.id))
      : [];

    type PublicSchedule = { id: number; dayOfWeek: number; startTime: string; endTime: string; durationMins: number | null; branch: { id: number; name: string; code: string } | null; room: { id: number; branchId: number; name: string; code: string } | null };
    const schedulesByClass = new Map<number, PublicSchedule[]>();
    for (const s of scheduleRows) {
      const schedules = schedulesByClass.get(s.classId) ?? [];
      schedules.push({
        id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, durationMins: s.durationMins ?? null,
        branch: s.branchId != null && s.branchName && s.branchCode ? { id: s.branchId, name: s.branchName, code: s.branchCode } : null,
        room: s.roomId != null && s.roomBranchId != null && s.roomName && s.roomCode ? { id: s.roomId, branchId: s.roomBranchId, name: s.roomName, code: s.roomCode } : null,
      });
      schedulesByClass.set(s.classId, schedules);
    }

    const classes = classRows.map((c) => {
      const schedules = schedulesByClass.get(c.id) ?? [];
      return {
        id:            c.id,
        title:         c.title,
        classImageUrl: c.classImageUrl,
        classVideoUrl: c.classVideoUrl,
        instructor:    c.instructorId != null ? { id: c.instructorId, name: c.instructorName, photoUrl: normalizeInstructorPhotoUrlForResponse(c.instructorPhotoUrl) } : null,
        groupId:       c.groupId,
        levelId:       c.levelId,
        schedules,
        schedule:      schedules[0] ?? null,
      };
    });

    res.json({ classes });
  } catch (err) {
    logger.error({ err }, "GET /ballet/classes failed");
    res.status(500).json({ error: "Failed to load classes" });
  }
});

// ─── GET /api/ballet/classes/my ──────────────────────────────────────────────
//
// Minimal authenticated entitlement response for the mobile "My Ballet
// Classes" screen. Account identity is always derived from the verified JWT;
// no parent/child/application identifier from the request controls this query.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ballet/classes/my",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const parentStudentId = req.studentId!;

    try {
      const [children, applications] = await Promise.all([
        db
          .select({
            id: childrenTable.id,
            parentId: childrenTable.parentId,
            fullName: childrenTable.fullName,
          })
          .from(childrenTable)
          .where(eq(childrenTable.parentId, parentStudentId))
          .orderBy(asc(childrenTable.fullName), asc(childrenTable.id)),
        db
          .select({
            id: balletApplicationsTable.id,
            parentStudentId: balletApplicationsTable.parentStudentId,
            childId: balletApplicationsTable.childId,
            childName: balletApplicationsTable.childName,
            childBirthday: balletApplicationsTable.childBirthday,
            status: balletApplicationsTable.status,
            assignedLevelId: balletApplicationsTable.assignedLevelId,
            createdAt: balletApplicationsTable.createdAt,
            updatedAt: balletApplicationsTable.updatedAt,
          })
          .from(balletApplicationsTable)
          .where(and(
            eq(balletApplicationsTable.parentStudentId, parentStudentId),
            isNotNull(balletApplicationsTable.childId),
          ))
          .orderBy(desc(balletApplicationsTable.updatedAt), desc(balletApplicationsTable.id)),
      ]);

      const applicationIds = applications.map((application) => application.id);
      const assignments = applicationIds.length > 0
        ? await db
            .select({
              id: balletLevelAssignmentsTable.id,
              applicationId: balletLevelAssignmentsTable.applicationId,
              childId: balletLevelAssignmentsTable.childId,
              levelId: balletLevelAssignmentsTable.levelId,
              groupId: balletLevelAssignmentsTable.groupId,
              status: balletLevelAssignmentsTable.status,
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
            ))
            .orderBy(desc(balletLevelAssignmentsTable.id))
        : [];

      const paymentCycles = await getPaymentCyclesForApplications(applicationIds);
      const activeSubscriptionApplicationIds = new Set<number>();
      for (const applicationId of applicationIds) {
        if (currentSubscription(paymentCycles.get(applicationId) ?? [])?.hasActiveSubscription) {
          activeSubscriptionApplicationIds.add(applicationId);
        }
      }

      const assignedGroupIds = [...new Set(
        assignments.map((assignment) => assignment.groupId).filter((id): id is number => id != null),
      )];
      const classes = assignedGroupIds.length > 0
        ? await db
            .select({
              id: balletClassesTable.id,
              title: balletClassesTable.title,
              levelId: balletClassesTable.levelId,
              groupId: balletClassesTable.groupId,
              classImageUrl: balletClassesTable.classImageUrl,
              classVideoUrl: balletClassesTable.classVideoUrl,
              isActive: balletClassesTable.isActive,
              isLegacy: balletClassesTable.isLegacy,
              levelName: balletLevelsTable.name,
              levelIsActive: balletLevelsTable.isActive,
              groupName: balletGroupsTable.name,
              groupLevelId: balletGroupsTable.levelId,
              groupIsActive: balletGroupsTable.isActive,
              instructorId: balletInstructorsTable.id,
              instructorName: balletInstructorsTable.name,
              instructorPhotoUrl: balletInstructorsTable.photoUrl,
              instructorIsActive: balletInstructorsTable.isActive,
            })
            .from(balletClassesTable)
            .innerJoin(balletLevelsTable, eq(balletLevelsTable.id, balletClassesTable.levelId))
            .innerJoin(balletGroupsTable, eq(balletGroupsTable.id, balletClassesTable.groupId))
            .innerJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
            .where(and(
              inArray(balletClassesTable.groupId, assignedGroupIds),
              isOperationalBalletClass(),
            ))
            .orderBy(asc(balletClassesTable.title), asc(balletClassesTable.id))
        : [];

      const classIds = classes.map((item) => item.id);
      const schedules = classIds.length > 0
        ? await db
            .select({
              id: balletSchedulesTable.id,
              classId: balletSchedulesTable.classId,
              dayOfWeek: balletSchedulesTable.dayOfWeek,
              startTime: balletSchedulesTable.startTime,
              endTime: balletSchedulesTable.endTime,
              durationMins: balletSchedulesTable.durationMins,
              status: balletSchedulesTable.status,
              branchId: balletSchedulesTable.branchId,
              branchName: studioBranchesTable.name,
              branchCode: studioBranchesTable.code,
              roomId: balletSchedulesTable.roomId,
              roomBranchId: studioRoomsTable.branchId,
              roomName: studioRoomsTable.name,
              roomCode: studioRoomsTable.code,
            })
            .from(balletSchedulesTable)
            .leftJoin(studioBranchesTable, eq(balletSchedulesTable.branchId, studioBranchesTable.id))
            .leftJoin(studioRoomsTable, eq(balletSchedulesTable.roomId, studioRoomsTable.id))
            .where(and(inArray(balletSchedulesTable.classId, classIds), scheduleShapeCondition()))
            .orderBy(
              asc(balletSchedulesTable.dayOfWeek),
              asc(balletSchedulesTable.startTime),
              asc(balletSchedulesTable.endTime),
              asc(balletSchedulesTable.id),
            )
        : [];

      res.json(buildMyBalletClassesResponse({
        parentStudentId,
        children,
        applications,
        assignments,
        activeSubscriptionApplicationIds,
        classes: classes.map((item) => ({
          ...item,
          instructorPhotoUrl: normalizeInstructorPhotoUrlForResponse(item.instructorPhotoUrl),
        })),
        schedules: schedules.map((schedule) => ({
          ...schedule,
          branch: schedule.branchId != null && schedule.branchName && schedule.branchCode
            ? { id: schedule.branchId, name: schedule.branchName, code: schedule.branchCode }
            : null,
          room: schedule.roomId != null && schedule.roomBranchId != null && schedule.roomName && schedule.roomCode
            ? { id: schedule.roomId, branchId: schedule.roomBranchId, name: schedule.roomName, code: schedule.roomCode }
            : null,
        })),
      }));
    } catch (err) {
      logger.error({ err, parentStudentId }, "GET /ballet/classes/my failed");
      res.status(500).json({ error: "Failed to load your Ballet classes" });
    }
  },
);

// ─── GET /api/ballet/applications/my ─────────────────────────────────────────
//
// Returns all ballet applications submitted by the authenticated parent.
// Ordered by creation date descending (newest first).
//
// Each row also carries `assignedGroupId` (Phase 4E) — the groupId on the
// application's current active ballet_level_assignments row, or null if no
// group has been assigned yet. Resolved via a small batched lookup (mirrors
// the level-name enrichment pattern in adminBallet.ts's list route) rather
// than a join, so the primary query shape stays unchanged.
//
// Response: { applications: BalletApplication[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ballet/applications/my",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const parentStudentId = req.studentId!;

    try {
      const applications = await db
        .select()
        .from(balletApplicationsTable)
        .where(eq(balletApplicationsTable.parentStudentId, parentStudentId))
        .orderBy(desc(balletApplicationsTable.createdAt));

      const applicationIds = applications.map((a) => a.id);
      const groupIdByApplicationId = new Map<number, number | null>();
      const assignmentIdByApplicationId = new Map<number, number>();
      if (applicationIds.length > 0) {
        const assignments = await db
          .select({
            id:            balletLevelAssignmentsTable.id,
            applicationId: balletLevelAssignmentsTable.applicationId,
            groupId:       balletLevelAssignmentsTable.groupId,
          })
          .from(balletLevelAssignmentsTable)
          .where(and(inArray(balletLevelAssignmentsTable.applicationId, applicationIds), eq(balletLevelAssignmentsTable.status, "active")));
        for (const row of assignments) {
          groupIdByApplicationId.set(row.applicationId, row.groupId);
          assignmentIdByApplicationId.set(row.applicationId, row.id);
        }
      }

      // ── Resolve real schedule + instructor for active, grouped students (A4) ──
      // Only applications that are BOTH status="active" AND have an assigned
      // group get their placeholder ("Ballet Assessment" / "TBD" / "Assigned
      // Instructor") replaced with real data on the client. Everything else
      // keeps the existing status-based rendering, so we only resolve the
      // groups that actually need it. A group can be linked to more than one
      // schedule slot and more than one class (many-to-many) — we return ALL
      // resolved schedules and instructors rather than picking one arbitrarily
      // (judgment call, per A4). Resolution mirrors the batched-lookup pattern
      // used above (no per-application query).
      const activeGroupIds = [...new Set(
        applications
          .filter((a) => a.status === "active")
          .map((a) => groupIdByApplicationId.get(a.id))
          .filter((gid): gid is number => gid != null),
      )];

      const schedulesByGroupId = new Map<number, {
        id: number;
        classId: number;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        durationMins: number | null;
        branch: { id: number; name: string; code: string } | null;
        room: { id: number; branchId: number; name: string; code: string } | null;
      }[]>();
      const instructorsByGroupId = new Map<number, string[]>();

      if (activeGroupIds.length > 0) {
        // group → ballet_classes → ballet_schedules (day/start/end). Only
        // active, non-legacy Classes with an active Schedule are surfaced —
        // a deactivated/cancelled slot, or a retired legacy Class, must
        // never show as a real class time.
        const scheduleRows = await db
          .select({
            id:        balletSchedulesTable.id,
            classId:   balletClassesTable.id,
            groupId:   balletClassesTable.groupId,
            dayOfWeek: balletSchedulesTable.dayOfWeek,
            startTime: balletSchedulesTable.startTime,
            endTime:   balletSchedulesTable.endTime,
            durationMins: balletSchedulesTable.durationMins,
            branchId: balletSchedulesTable.branchId,
            branchName: studioBranchesTable.name,
            branchCode: studioBranchesTable.code,
            roomId: balletSchedulesTable.roomId,
            roomBranchId: studioRoomsTable.branchId,
            roomName: studioRoomsTable.name,
            roomCode: studioRoomsTable.code,
          })
          .from(balletClassesTable)
          .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
          .leftJoin(studioBranchesTable, eq(balletSchedulesTable.branchId, studioBranchesTable.id))
          .leftJoin(studioRoomsTable, eq(balletSchedulesTable.roomId, studioRoomsTable.id))
          .where(and(
            inArray(balletClassesTable.groupId, activeGroupIds),
            isOperationalBalletSchedule(),
          ))
          .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime), asc(balletSchedulesTable.id));
        for (const row of scheduleRows) {
          if (row.groupId == null) continue;
          const list = schedulesByGroupId.get(row.groupId) ?? [];
          list.push({
            id: row.id,
            classId: row.classId,
            dayOfWeek: row.dayOfWeek,
            startTime: row.startTime,
            endTime: row.endTime,
            durationMins: row.durationMins,
            branch: row.branchId != null && row.branchName && row.branchCode ? { id: row.branchId, name: row.branchName, code: row.branchCode } : null,
            room: row.roomId != null && row.roomBranchId != null && row.roomName && row.roomCode ? { id: row.roomId, branchId: row.roomBranchId, name: row.roomName, code: row.roomCode } : null,
          });
          schedulesByGroupId.set(row.groupId, list);
        }

        // group → ballet_classes → ballet_instructors (direct canonical
        // relationship — no join table). Only active, non-legacy classes
        // with an active instructor contribute. Names are de-duplicated per
        // group.
        const instructorRows = await db
          .select({
            groupId:        balletClassesTable.groupId,
            instructorName: balletInstructorsTable.name,
          })
          .from(balletClassesTable)
          .innerJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
          .where(and(
            inArray(balletClassesTable.groupId, activeGroupIds),
            isAssignmentReadyClass(),
          ));
        for (const row of instructorRows) {
          if (row.groupId == null) continue;
          const list = instructorsByGroupId.get(row.groupId) ?? [];
          if (!list.includes(row.instructorName)) list.push(row.instructorName);
          instructorsByGroupId.set(row.groupId, list);
        }
      }

      // ── Attendance-hours summary for the current calendar month (C4 / D3) ────
      // Only active applications with an active level assignment can have a
      // monthly subscription. We compute per-assignment and surface the FULL
      // summary object (including hasActiveSubscription: false) whenever
      // there's an active assignment — null only when there's no active
      // assignment at all — mirroring the admin detail route's behaviour.
      // D3: this is deliberately NOT collapsed to null just because
      // hasActiveSubscription is false, so the parent-facing full attendance
      // screen (application-status.tsx) can render the distinct "No active
      // monthly subscription for this month" state instead of hiding the
      // section or silently showing zero hours. The compact card in
      // bookings.tsx explicitly checks attendanceSummary?.hasActiveSubscription
      // so its own display is unaffected by this change. Await count == number
      // of the parent's active applications (typically 1, at most a handful).
      const month = currentBillingMonth();
      const attendanceSummaryByApplicationId = new Map<number, Awaited<ReturnType<typeof computeBalletMonthlyAttendanceSummary>>>();
      await Promise.all(
        applications
          .filter((a) => a.status === "active" && assignmentIdByApplicationId.has(a.id))
          .map(async (a) => {
            const summary = await computeBalletMonthlyAttendanceSummary(assignmentIdByApplicationId.get(a.id)!, a.id, month);
            attendanceSummaryByApplicationId.set(a.id, summary);
          }),
      );

      res.json({
        applications: applications.map((a) => {
          const assignedGroupId = groupIdByApplicationId.get(a.id) ?? null;
          const summary = attendanceSummaryByApplicationId.get(a.id);
          const hasActiveSubscription = summary?.hasActiveSubscription === true;
          const isActiveGrouped = a.status === "active" && assignedGroupId != null && hasActiveSubscription;
          return {
            ...a,
            assignedGroupId,
            // Populated only for active + grouped students; null otherwise so
            // the client keeps its existing placeholder rendering for every
            // other status.
            resolvedSchedules:   isActiveGrouped ? schedulesByGroupId.get(assignedGroupId) ?? [] : null,
            resolvedInstructors: isActiveGrouped ? instructorsByGroupId.get(assignedGroupId) ?? [] : null,
            // C4 / D3: full summary (including hasActiveSubscription: false)
            // whenever there's an active assignment; null only when there is
            // none. See the comment above this block for why this is no
            // longer collapsed to null on !hasActiveSubscription.
            attendanceSummary: summary ?? null,
          };
        }),
      });
    } catch (err) {
      logger.error({ err }, "GET /ballet/applications/my failed");
      res.status(500).json({ error: "Failed to load your applications" });
    }
  },
);

// ─── POST /api/ballet/applications ───────────────────────────────────────────
//
// Submits a new ballet assessment application.
//
// Duplicate prevention:
//   Before inserting, checks whether the same parent already has an ACTIVE
//   application for the same child. When the request links a saved child
//   profile (childId), that's the match key — reliable regardless of name
//   spelling/casing. Otherwise falls back to name (case-insensitive) +
//   birthday, so two different children sharing a first name aren't treated
//   as duplicates; the birthday condition only applies when both the
//   incoming request and the stored row have a non-null birthday, else it
//   degrades to name-only (today's behavior for legacy/birthday-less rows).
//   Open = pending | needsFollowUp | accepted | assignedToLevel | active.
//   Rejected, cancelled, and withdrawn allow a new application.
//   Returns 409 with existingApplicationId if a duplicate is detected so the
//   mobile client can navigate to the status screen without an extra round-trip.
// ─────────────────────────────────────────────────────────────────────────────

const SubmitApplicationBody = z.object({
  parentName:            z.string().min(1, "Parent name is required"),
  parentPhone:           z.string().min(1, "Parent phone is required"),
  parentEmail:           z.string().email("A valid parent email is required"),
  childName:             z.string().min(1, "Child name is required"),
  childBirthday:         z.string().optional(),
  childAge:              z.number().int().positive().optional(),
  childGender:           z.enum(["male", "female"]).optional(),
  emergencyContactName:  z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  previousExperience:    z.boolean({ required_error: "previousExperience is required" }),
  experienceDetails:     z.string().optional(),
  medicalNotes:          z.string().optional(),
  notes:                 z.string().optional(),
  assessmentScheduleId:  z.number({ required_error: "assessmentScheduleId is required" }).int().positive(),
  assessmentDate:        z.string({ required_error: "assessmentDate is required" }).regex(/^\d{4}-\d{2}-\d{2}$/, "assessmentDate must be YYYY-MM-DD"),
  // C1: parent's chosen payment method at intake — required for new
  // submissions. Preference only; never creates/touches a ballet_payments row.
  preferredPaymentMethod: z.enum(BALLET_PAYMENT_METHODS, {
    required_error: "preferredPaymentMethod is required",
    invalid_type_error: "preferredPaymentMethod is required",
  }),
  preferredPackageId:    z.number().int().positive().optional(),
  // Optional link to a saved child profile (children.id). When present it must
  // belong to the authenticated parent; legacy/manual submissions omit it.
  childId:               z.number().int().positive().optional(),
});

router.post(
  "/ballet/applications",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const parsed = SubmitApplicationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
      return;
    }

    const {
      parentName, parentPhone, parentEmail,
      childName, childBirthday, childGender,
      emergencyContactName, emergencyContactPhone,
      previousExperience, experienceDetails,
      medicalNotes, notes,
      assessmentScheduleId, assessmentDate, childId, preferredPaymentMethod, preferredPackageId,
    } = parsed.data;

    // Future backlog: Online Ballet payment requires a checkout session,
    // verified webhook/callback, reconciliation, and idempotent retry support.
    if (preferredPaymentMethod !== SUPPORTED_MOBILE_ASSESSMENT_PAYMENT_METHOD) {
      res.status(422).json({
        error: "Only Pay at Studio is currently supported for Ballet assessment applications.",
        code: "BALLET_ONLINE_PAYMENT_NOT_AVAILABLE",
      });
      return;
    }

    const parentStudentId = req.studentId!;

    // D4: server-side Parent-account gate. The mobile UI already blocks
    // Student-type accounts from reaching this screen (assessment.tsx checks
    // user.accountType !== "parent" and shows a conversion prompt), but that
    // is a UX convenience, not a security boundary — enforce it here too so
    // a Student-type JWT can never submit a Ballet application directly
    // against the API.
    const [account] = await db
      .select({ accountType: studentsTable.accountType })
      .from(studentsTable)
      .where(eq(studentsTable.id, parentStudentId))
      .limit(1);

    if (!account || account.accountType !== "parent") {
      res.status(403).json({
        error: "A Parent account is required to submit a Ballet application.",
        code: "PARENT_ACCOUNT_REQUIRED",
      });
      return;
    }

    // Phase B / A3 correction: hoisted out of the transaction closure so the
    // catch block below (the 23505 safety-net) can see the final resolved
    // childId regardless of which branch (linked vs. manual) produced it —
    // needed so a manual submission's constraint violation maps to a clean
    // 409 too, not just a linked submission's.
    let resolvedChildId: number | null = childId ?? null;

    try {
      const result = await db.transaction(async (tx) => {
        // ── Duplicate prevention ──────────────────────────────────────────────
        // Prefer matching on the linked saved child (childId) — the most
        // reliable identity signal, immune to name/spelling variants. Falls
        // back to name + birthday (both, when both sides have one on file)
        // when no childId was provided.
        const duplicateWhere = childId != null
          ? and(
              eq(balletApplicationsTable.parentStudentId, parentStudentId),
              eq(balletApplicationsTable.childId, childId),
              inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
            )
          : and(
              eq(balletApplicationsTable.parentStudentId, parentStudentId),
              ilike(balletApplicationsTable.childName, childName.trim()),
              inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
              ...(childBirthday
                ? [or(isNull(balletApplicationsTable.childBirthday), eq(balletApplicationsTable.childBirthday, childBirthday))]
                : []),
            );

        const existing = await tx
          .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status })
          .from(balletApplicationsTable)
          .where(duplicateWhere)
          .limit(1);

        if (existing.length > 0) {
          throw Object.assign(
            new Error("You already have an active ballet application for this child."),
            { status: 409, existingApplicationId: existing[0]!.id },
          );
        }

        // ── Validate child ownership (only when a saved child was selected) ───
        // A provided childId must belong to the authenticated parent — never
        // let one account link a child profile owned by another account.
        let resolvedBirthday: string | null = null;
        if (childId != null) {
          const [ownedChild] = await tx
            .select({ id: childrenTable.id, birthday: childrenTable.birthday })
            .from(childrenTable)
            .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, parentStudentId)))
            .limit(1);
          if (!ownedChild) {
            throw Object.assign(
              new Error("Selected child does not belong to this account."),
              { status: 403 },
            );
          }
          // Phase A / P0-5: the children table's own record is the source of
          // truth for a linked child's birthday — never the request body,
          // which the client could have left stale or sent inconsistently.
          resolvedBirthday = ownedChild.birthday;
        } else {
          // Manual (no saved child profile) submission: the submitted
          // childBirthday is the only signal available. The client-supplied
          // childAge integer is NEVER used for validation in either path —
          // it is stored below purely for display/record-keeping.
          resolvedBirthday = childBirthday ?? null;
        }

        // ── Schedule occurrence eligibility ───────────────────────────────────
        // Assessment choices are projected from real active class schedules.
        // Age eligibility is derived from the linked class level as of the
        // selected occurrence date; no separate assessment capacity exists.
        if (!resolvedBirthday) {
          throw Object.assign(
            new Error(
              childId != null
                ? "This child has no birthday on file. Add one to the child's profile before booking an assessment."
                : "A child birthday is required to book an assessment.",
            ),
            { status: 422, code: "MISSING_BIRTHDAY" },
          );
        }

        const today = todayIso();
        if (resolvedBirthday > today) {
          throw Object.assign(
            new Error("Child birthday cannot be in the future."),
            { status: 400 },
          );
        }

        const maxDate = addDaysIso(today, BALLET_ASSESSMENT_BOOKING_WINDOW_DAYS);
        if (assessmentDate < today || assessmentDate > maxDate) {
          throw Object.assign(
            new Error("Selected date is outside the allowed booking window."),
            { status: 422, code: "ASSESSMENT_DATE_OUT_OF_WINDOW" },
          );
        }

        const ageAtAssessment = computeAgeAsOf(resolvedBirthday, assessmentDate);
        if (ageAtAssessment == null) {
          throw Object.assign(
            new Error("The birthday on file is not a valid date."),
            { status: 422, code: "MISSING_BIRTHDAY" },
          );
        }

        const assessment = await resolveAssessmentOccurrence(assessmentScheduleId, assessmentDate, resolvedBirthday);
        if (!assessment) {
          throw Object.assign(
            new Error("Selected assessment schedule is no longer available for this child's age."),
            { status: 422, code: "ASSESSMENT_SCHEDULE_UNAVAILABLE" },
          );
        }

        if (preferredPackageId != null) {
          const [pkg] = await tx
            .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive })
            .from(balletPackagesTable)
            .where(eq(balletPackagesTable.id, preferredPackageId))
            .limit(1);

          if (!pkg || !pkg.isActive) {
            throw Object.assign(
              new Error("Selected Ballet package is no longer available."),
              { status: 422, code: "BALLET_PACKAGE_UNAVAILABLE" },
            );
          }
        }

        // ── Auto-save manual submissions to the parent's profile (A3) ─────────
        // When no saved child was selected (manual entry), persist the child
        // to the parent's `children` profile so repeat submissions and other
        // flows can link to a real child row.
        //
        // Phase B / A3 concurrency correction: two concurrent manual
        // submissions for the same parent+child previously could both miss
        // each other's uncommitted dedupe SELECT below, each create a
        // distinct child row, and end up with different childIds — which let
        // both slip past migration 0050's unique indexes entirely (different
        // childIds mean ballet_applications_active_per_child never fires,
        // and ballet_applications_active_per_manual_identity no longer
        // applies once both rows carry a non-null childId). A Postgres
        // transaction-scoped advisory lock, keyed deterministically from
        // parentStudentId + normalized(childName) — same hashtext-composite-
        // key idiom already used in authHelpers.ts's OTP issuance — forces
        // concurrent requests for the "same" child to serialize here: the
        // second request blocks until the first commits, so its own
        // re-query below sees the first request's now-committed child row
        // instead of racing it. The lock auto-releases at transaction end
        // (commit or rollback); no manual unlock needed.
        if (childId == null) {
          const normalizedChildName = childName.trim().toLowerCase();
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${parentStudentId}:${normalizedChildName}`}))`,
          );

          const [existingChild] = await tx
            .select({ id: childrenTable.id })
            .from(childrenTable)
            .where(and(
              eq(childrenTable.parentId, parentStudentId),
              ilike(childrenTable.fullName, childName.trim()),
              ...(childBirthday
                ? [or(isNull(childrenTable.birthday), eq(childrenTable.birthday, childBirthday))]
                : []),
            ))
            .orderBy(asc(childrenTable.id))
            .limit(1);

          if (existingChild) {
            resolvedChildId = existingChild.id;
          } else {
            const [createdChild] = await tx
              .insert(childrenTable)
              .values({
                parentId:       parentStudentId,
                fullName:       childName.trim(),
                birthday:       childBirthday ?? null,
                gender:         childGender ?? "female",
                medicalNotes:   medicalNotes ?? null,
                emergencyName:  emergencyContactName ?? null,
                emergencyPhone: emergencyContactPhone ?? null,
              })
              .returning({ id: childrenTable.id });
            resolvedChildId = createdChild.id;
          }

          // Re-check for an active application against the now-resolved
          // childId, still under the advisory lock — this is what actually
          // closes the race. If a concurrent request for the same child
          // committed its application between this request's initial
          // fast-path check (above, name/birthday-based) and here, that
          // application is now visible (the committing transaction held
          // this same lock and released it by the time we reach this line)
          // and this request 409s cleanly instead of also inserting a
          // duplicate. Do not rely on the earlier name/birthday check alone
          // — it ran before resolvedChildId existed. Migration 0050's unique
          // index remains the final backstop regardless of this check.
          const [existingActiveApp] = await tx
            .select({ id: balletApplicationsTable.id })
            .from(balletApplicationsTable)
            .where(and(
              eq(balletApplicationsTable.childId, resolvedChildId),
              inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
            ))
            .limit(1);

          if (existingActiveApp) {
            throw Object.assign(
              new Error("You already have an active ballet application for this child."),
              { status: 409, existingApplicationId: existingActiveApp.id },
            );
          }
        }

        // ── Insert application ────────────────────────────────────────────────
        const [application] = await tx
          .insert(balletApplicationsTable)
          .values({
            parentStudentId,
            childId:               resolvedChildId,
            parentName,
            parentPhone,
            parentEmail,
            childName:             childName.trim(),
            childBirthday:         childBirthday ?? null,
            // Store the server-computed age (as of the assessment occurrence
            // date, derived from resolvedBirthday) —
            // never the client-supplied `childAge`, which is no longer used
            // anywhere in this handler, including for storage.
            childAge:              ageAtAssessment,
            childGender:           childGender ?? null,
            emergencyContactName:  emergencyContactName ?? null,
            emergencyContactPhone: emergencyContactPhone ?? null,
            previousExperience,
            experienceDetails:     experienceDetails ?? null,
            medicalNotes:          medicalNotes ?? null,
            notes:                 notes ?? null,
            assessmentScheduleId,
            assessmentDate,
            // C1: intake payment preference. Stored on the application only —
            // no ballet_payments row is created at submission time.
            preferredPaymentMethod,
            preferredPackageId: preferredPackageId ?? null,
            status: "pending",
          })
          .returning({ id: balletApplicationsTable.id, status: balletApplicationsTable.status });

        // ── Insert initial event ──────────────────────────────────────────────
        await tx.insert(balletApplicationEventsTable).values({
          applicationId: application.id,
          fromStatus:    null,
          toStatus:      "pending",
          changedById:   null,
          note:          "Application submitted via mobile app",
        });

        return application;
      });

      logger.info(
        { applicationId: result.id, studentId: parentStudentId, assessmentScheduleId, assessmentDate },
        "Ballet application submitted",
      );

      res.status(201).json({ application: { id: result.id, status: result.status } });
    } catch (err: unknown) {
      const typed = err as { status?: number; message?: string; existingApplicationId?: number; code?: string };

      if (typed.status === 409 && typed.existingApplicationId != null) {
        // Duplicate active application (fast-path: caught by the app-level
        // SELECT check before any insert was attempted)
        res.status(409).json({
          error: typed.message ?? "You already have an active ballet application for this child.",
          existingApplicationId: typed.existingApplicationId,
          code: "DUPLICATE_APPLICATION",
        });
        return;
      }
      if (typed.status === 404) {
        res.status(404).json({ error: "Assessment schedule not found" });
        return;
      }
      if (typed.status === 403) {
        res.status(403).json({ error: typed.message ?? "Selected child does not belong to this account." });
        return;
      }
      if (typed.status === 422) {
        // Age eligibility / missing-birthday failures (Phase A / P0-5)
        res.status(422).json({ error: typed.message ?? "Validation failed", code: typed.code });
        return;
      }

      // ── Phase A / P0-3: unique-violation safety net ───────────────────────
      // The app-level SELECT check above is a fast path — it closes the vast
      // majority of duplicate-submission attempts without ever reaching the
      // database's own guarantee. But between that SELECT and this request's
      // own INSERT, a concurrent request for the same child/identity can slip
      // through (the classic check-then-act race) and only the DB-level
      // partial unique indexes from migration 0050 are guaranteed to catch
      // it. Postgres reports a unique violation as SQLSTATE 23505 with the
      // specific constraint name attached — we use that name (not the error
      // message text) to distinguish which of the two constraints fired and
      // return an accurate, constraint-specific message.
      //
      // Phase B / A3 correction: this used to key off the request's own
      // `childId`, which is always null for a manual submission — so a
      // manual request that still somehow hit this constraint (the advisory
      // lock above closes the common case, not necessarily every case) fell
      // through to the generic 500 below instead of a clean 409. Use
      // `resolvedChildId` instead — set for BOTH the linked path (childId
      // itself) and the manual path (the reused-or-created child row) before
      // this catch block can ever run, so this branch now always fires for
      // this constraint, regardless of which submission path triggered it.
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === "23505" && pgErr.constraint === "ballet_applications_active_per_child" && resolvedChildId != null) {
        const [existing] = await db
          .select({ id: balletApplicationsTable.id })
          .from(balletApplicationsTable)
          .where(and(
            eq(balletApplicationsTable.childId, resolvedChildId),
            inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
          ))
          .limit(1);
        res.status(409).json({
          error: "You already have an active ballet application for this child.",
          existingApplicationId: existing?.id,
          code: "DUPLICATE_APPLICATION",
        });
        return;
      }
      if (pgErr.code === "23505" && pgErr.constraint === "ballet_applications_active_per_manual_identity") {
        const [existing] = await db
          .select({ id: balletApplicationsTable.id })
          .from(balletApplicationsTable)
          .where(and(
            isNull(balletApplicationsTable.childId),
            eq(balletApplicationsTable.parentStudentId, parentStudentId),
            ilike(balletApplicationsTable.childName, childName.trim()),
            inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
            ...(childBirthday ? [eq(balletApplicationsTable.childBirthday, childBirthday)] : []),
          ))
          .limit(1);
        res.status(409).json({
          error: "You already have an active ballet application for a child with this name and birthday.",
          existingApplicationId: existing?.id,
          code: "DUPLICATE_APPLICATION",
        });
        return;
      }

      logger.error({ err }, "POST /ballet/applications failed");
      const error = err as any;
      const status = error.status ?? 500;
      const message = error.message ?? "Failed to submit application";
      res.status(status).json({ error: message, code: error.code });
    }
  },
);

// ─── PATCH /api/ballet/applications/:id ──────────────────────────────────────
//
// Allows the authenticated parent to edit selected fields on their own
// application, but only while the status is pending / needsFollowUp.
//
// Editable fields: medicalNotes, notes, experienceDetails,
//   previousExperience, assessmentScheduleId + assessmentDate.
//
// Parent/guardian identity fields (parentPhone, parentEmail,
// emergencyContactName, emergencyContactPhone) are intentionally NOT editable
// here — by design, a parent must never be able to alter that information
// after submitting the application.
// ─────────────────────────────────────────────────────────────────────────────

const UpdateApplicationBody = z.object({
  medicalNotes:          z.string().optional(),
  notes:                 z.string().optional(),
  experienceDetails:     z.string().optional(),
  previousExperience:    z.boolean().optional(),
  assessmentScheduleId:  z.number().int().positive().optional(),
  assessmentDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferredPackageId:    z.number().int().positive().optional(),
  preferredPaymentMethod: z.enum(BALLET_PAYMENT_METHODS).optional(),
});

router.patch(
  "/ballet/applications/:id",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parentStudentId = req.studentId!;

    const parsed = UpdateApplicationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    try {
      // Load application — must belong to this parent
      const [app] = await db
        .select({
          id:                   balletApplicationsTable.id,
          status:               balletApplicationsTable.status,
          childId:              balletApplicationsTable.childId,
          childBirthday:        balletApplicationsTable.childBirthday,
          assessmentScheduleId: balletApplicationsTable.assessmentScheduleId,
          assessmentDate:       balletApplicationsTable.assessmentDate,
        })
        .from(balletApplicationsTable)
        .where(
          and(
            eq(balletApplicationsTable.id, id),
            eq(balletApplicationsTable.parentStudentId, parentStudentId),
          ),
        )
        .limit(1);

      if (!app) { res.status(404).json({ error: "Application not found" }); return; }

      if (!(EDITABLE_STATUSES as readonly string[]).includes(app.status)) {
        res.status(422).json({
          error: `Application cannot be edited in status "${app.status}". Editing is only allowed while pending or needing follow-up.`,
        });
        return;
      }

      const updates: Record<string, unknown> = {};
      const { assessmentScheduleId, assessmentDate, preferredPackageId, preferredPaymentMethod, ...rest } = parsed.data;

      // Copy scalar fields directly
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updates[k] = v;
      }

      if (preferredPaymentMethod !== undefined) {
        // Future backlog: Online Ballet payment requires a checkout session,
        // verified webhook/callback, reconciliation, and idempotent retry support.
        if (preferredPaymentMethod !== SUPPORTED_MOBILE_ASSESSMENT_PAYMENT_METHOD) {
          res.status(422).json({
            error: "Only Pay at Studio is currently supported for Ballet assessment applications.",
            code: "BALLET_ONLINE_PAYMENT_NOT_AVAILABLE",
          });
          return;
        }
        updates["preferredPaymentMethod"] = preferredPaymentMethod;
      }

      if (preferredPackageId !== undefined) {
        const [pkg] = await db
          .select({ id: balletPackagesTable.id, isActive: balletPackagesTable.isActive })
          .from(balletPackagesTable)
          .where(eq(balletPackagesTable.id, preferredPackageId))
          .limit(1);
        if (!pkg || !pkg.isActive) {
          res.status(422).json({ error: "Selected Ballet package is no longer available.", code: "BALLET_PACKAGE_UNAVAILABLE" });
          return;
        }
        updates["preferredPackageId"] = preferredPackageId;
      }

      // Handle assessment schedule change — re-validate active schedule,
      // active class, age-eligible level, and date/weekday match.
      if (assessmentScheduleId != null || assessmentDate != null) {
        if (assessmentScheduleId == null || assessmentDate == null) {
          res.status(400).json({ error: "assessmentScheduleId and assessmentDate must be supplied together" });
          return;
        }
        const changed = assessmentScheduleId !== app.assessmentScheduleId || assessmentDate !== app.assessmentDate;
        if (changed) {
          let birthday = app.childBirthday;
          if (app.childId != null) {
            const [child] = await db
              .select({ birthday: childrenTable.birthday })
              .from(childrenTable)
              .where(and(eq(childrenTable.id, app.childId), eq(childrenTable.parentId, parentStudentId)))
              .limit(1);
            birthday = child?.birthday ?? birthday;
          }

          if (!birthday) {
            res.status(422).json({ error: "A child birthday is required to book an assessment.", code: "MISSING_BIRTHDAY" });
            return;
          }

          const today = todayIso();
          if (birthday > today) {
            res.status(400).json({ error: "Child birthday cannot be in the future." });
            return;
          }

          const maxDate = addDaysIso(today, BALLET_ASSESSMENT_BOOKING_WINDOW_DAYS);
          if (assessmentDate < today || assessmentDate > maxDate) {
            res.status(422).json({ error: "Selected date is outside the allowed booking window.", code: "ASSESSMENT_DATE_OUT_OF_WINDOW" });
            return;
          }

          const assessment = await resolveAssessmentOccurrence(assessmentScheduleId, assessmentDate, birthday);
          if (!assessment) {
            res.status(422).json({ error: "Selected assessment schedule is no longer available for this child's age.", code: "ASSESSMENT_SCHEDULE_UNAVAILABLE" });
            return;
          }
          updates["assessmentScheduleId"] = assessmentScheduleId;
          updates["assessmentDate"] = assessmentDate;
        }
      }

      if (Object.keys(updates).length === 0) {
        res.json({ success: true, message: "No changes" });
        return;
      }

      updates["updatedAt"] = new Date().toISOString();

      // Wrap update + event insert in a transaction.
      await db.transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx
          .update(balletApplicationsTable)
          .set(updates as any)
          .where(eq(balletApplicationsTable.id, id));

        await tx.insert(balletApplicationEventsTable).values({
          applicationId: id,
          fromStatus:    app.status,
          toStatus:      app.status,   // status unchanged — this is a field edit
          changedById:   null,
          note:          "Application updated by parent",
        });
      });

      logger.info({ applicationId: id, studentId: parentStudentId, updates: Object.keys(updates) }, "Ballet application updated by parent");

      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, "PATCH /ballet/applications/:id failed");
      const status = err.status ?? 500;
      const message = err.message ?? "Failed to update application";
      res.status(status).json({ error: message, code: err.code });
    }
  },
);

export default router;
