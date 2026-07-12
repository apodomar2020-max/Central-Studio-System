/**
 * Ballet routes — /api/ballet/*
 *
 * Public routes (shared API key only):
 *   GET  /api/ballet/settings                     — admin-managed pricing + instructions
 *   GET  /api/ballet/assessment-slots             — future active slots with live capacity
 *   GET  /api/ballet/instructors                  — active instructor roster
 *   GET  /api/ballet/classes                      — active classes with schedules, instructor, group/level ids
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
 *   PATCH  /api/ballet/applications/:id          — edit editable fields (status-gated)
 *   POST /api/ballet/applications/:id/cancel     — cancel an application (status-gated)
 *
 * Duplicate prevention:
 *   Active statuses = pending | accepted | needsFollowUp | assignedToLevel | active
 *   If the same authenticated parent already has an active application for the
 *   same child — matched by childId when a saved child profile is linked,
 *   else by name + birthday — POST returns 409 with existingApplicationId so
 *   the mobile can redirect to the status screen without a second round-trip.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, inArray, not } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletSettingsTable,
  balletAssessmentSlotsTable,
  balletApplicationsTable,
  balletApplicationEventsTable,
  childrenTable,
  balletInstructorsTable,
  balletClassesTable,
  balletSchedulesTable,
  balletLevelsTable,
  balletPerformanceOpportunitiesTable,
  balletGroupsTable,
  balletClassGroupsTable,
  balletClassLevelsTable,
  balletLevelAssignmentsTable,
} from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Statuses ─────────────────────────────────────────────────────────────────

/**
 * Statuses that mean an application is still "active" — i.e. the parent has
 * an open slot and should not be allowed to submit a duplicate.
 * "rejected" and "cancelled" are the only terminal-inactive statuses.
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

/** Statuses that allow the parent to cancel their application. */
const CANCELLABLE_STATUSES = ["pending", "needsFollowUp"] as const;

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

// ─── Default settings ─────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  preBallet: { monthlyHours: 8, priceEgp: 1950 },
  levels19: { monthlyHours: 12, priceEgp: 2650 },
  assessmentInstructions: null,
  requirements: null,
  acceptanceMessageTemplate: null,
  fewSeatsThreshold: 3,
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
      preBallet: {
        monthlyHours: row.preBalletHoursMonthly,
        priceEgp:     row.preBalletPriceEgp,
      },
      levels19: {
        monthlyHours: row.levelsHoursMonthly,
        priceEgp:     row.levelsPriceEgp,
      },
      assessmentInstructions:    row.assessmentInstructions    ?? null,
      requirements:              row.requirements              ?? null,
      acceptanceMessageTemplate: row.acceptanceMessageTemplate ?? null,
      fewSeatsThreshold:         row.fewSeatsThreshold,
    });
  } catch (err) {
    logger.error({ err }, "GET /ballet/settings failed");
    res.status(500).json({ error: "Failed to load ballet settings" });
  }
});

// ─── GET /api/ballet/assessment-slots ────────────────────────────────────────
//
// Query params:
//   childAge (optional) — when present, only returns slots whose age range
//     covers this age: (ageMin is null OR childAge >= ageMin) AND
//     (ageMax is null OR childAge <= ageMax). A slot with both null is open
//     to all ages.
// ─────────────────────────────────────────────────────────────────────────────

const AssessmentSlotsQuery = z.object({
  childAge: z.coerce.number().int().positive().optional(),
});

router.get("/ballet/assessment-slots", async (req, res): Promise<void> => {
  const parsedQuery = AssessmentSlotsQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid childAge" });
    return;
  }
  const { childAge } = parsedQuery.data;

  try {
    const today = todayIso();

    const [settingsRow] = await db
      .select({ fewSeatsThreshold: balletSettingsTable.fewSeatsThreshold })
      .from(balletSettingsTable)
      .where(eq(balletSettingsTable.id, 1))
      .limit(1);

    const fewSeatsThreshold = settingsRow?.fewSeatsThreshold ?? 3;

    const ageConditions = childAge != null
      ? [
          or(isNull(balletAssessmentSlotsTable.ageMin), lte(balletAssessmentSlotsTable.ageMin, childAge)),
          or(isNull(balletAssessmentSlotsTable.ageMax), gte(balletAssessmentSlotsTable.ageMax, childAge)),
        ]
      : [];

    const rows = await db
      .select({
        id:          balletAssessmentSlotsTable.id,
        date:        balletAssessmentSlotsTable.date,
        startTime:   balletAssessmentSlotsTable.startTime,
        endTime:     balletAssessmentSlotsTable.endTime,
        capacity:    balletAssessmentSlotsTable.capacity,
        bookedCount: count(balletApplicationsTable.id),
      })
      .from(balletAssessmentSlotsTable)
      .leftJoin(
        balletApplicationsTable,
        and(
          eq(balletApplicationsTable.slotId, balletAssessmentSlotsTable.id),
          // Only count non-cancelled applications against capacity
          not(eq(balletApplicationsTable.status, "cancelled")),
        ),
      )
      .where(
        and(
          eq(balletAssessmentSlotsTable.isActive, true),
          gte(balletAssessmentSlotsTable.date, today),
          ...ageConditions,
        ),
      )
      .groupBy(balletAssessmentSlotsTable.id)
      .orderBy(
        asc(balletAssessmentSlotsTable.date),
        asc(balletAssessmentSlotsTable.startTime),
      );

    const slots = rows.map((row) => {
      const bookedCount    = Number(row.bookedCount);
      const availableSeats = Math.max(0, row.capacity - bookedCount);

      let status: "available" | "fewSeats" | "full";
      if (availableSeats <= 0)              status = "full";
      else if (availableSeats <= fewSeatsThreshold) status = "fewSeats";
      else                                  status = "available";

      return {
        id:             String(row.id),
        date:           row.date,
        dayOfWeek:      dayOfWeekFromDate(row.date),
        startTime:      row.startTime,
        endTime:        row.endTime,
        capacity:       row.capacity,
        bookedCount,
        availableSeats,
        status,
      };
    });

    res.json(slots);
  } catch (err) {
    logger.error({ err }, "GET /ballet/assessment-slots failed");
    res.status(500).json({ error: "Failed to load assessment slots" });
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

    res.json({ instructors });
  } catch (err) {
    logger.error({ err }, "GET /ballet/instructors failed");
    res.status(500).json({ error: "Failed to load instructors" });
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
        description:  balletLevelsTable.description,
        requirements: balletLevelsTable.requirements,
        ageMin:       balletLevelsTable.ageMin,
        ageMax:       balletLevelsTable.ageMax,
      })
      .from(balletLevelsTable)
      .where(eq(balletLevelsTable.isActive, true))
      .orderBy(asc(balletLevelsTable.sortOrder));

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
        eventType:    balletPerformanceOpportunitiesTable.eventType,
        locationName: balletPerformanceOpportunitiesTable.locationName,
        eventDate:    balletPerformanceOpportunitiesTable.eventDate,
        startTime:    balletPerformanceOpportunitiesTable.startTime,
        endTime:      balletPerformanceOpportunitiesTable.endTime,
        requirements: balletPerformanceOpportunitiesTable.requirements,
      })
      .from(balletPerformanceOpportunitiesTable)
      .where(gte(balletPerformanceOpportunitiesTable.eventDate, today))
      .orderBy(asc(balletPerformanceOpportunitiesTable.eventDate));

    res.json({ performances });
  } catch (err) {
    logger.error({ err }, "GET /ballet/performances failed");
    res.status(500).json({ error: "Failed to load performance opportunities" });
  }
});

// ─── GET /api/ballet/classes ───────────────────────────────────────────────────
//
// Public read-only class catalogue. Active classes only, each enriched with:
//   - schedules: its active (status="active") ballet_schedules rows
//   - groupIds / levelIds: resolved via the ballet_class_groups /
//     ballet_class_levels join tables (mirrors adminBalletClasses.ts's
//     getClassGroupIds/getClassLevelIds pattern)
//   - instructor: { id, name, photoUrl } resolved via instructorId, or null
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
      })
      .from(balletClassesTable)
      .leftJoin(balletInstructorsTable, eq(balletClassesTable.instructorId, balletInstructorsTable.id))
      .where(eq(balletClassesTable.isActive, true))
      .orderBy(asc(balletClassesTable.title));

    const classIds = classRows.map((c) => c.id);

    const [scheduleRows, groupRows, levelRows] = classIds.length > 0
      ? await Promise.all([
          db
            .select({
              id:           balletSchedulesTable.id,
              classId:      balletSchedulesTable.classId,
              dayOfWeek:    balletSchedulesTable.dayOfWeek,
              startTime:    balletSchedulesTable.startTime,
              endTime:      balletSchedulesTable.endTime,
              durationMins: balletSchedulesTable.durationMins,
            })
            .from(balletSchedulesTable)
            .where(and(inArray(balletSchedulesTable.classId, classIds), eq(balletSchedulesTable.status, "active")))
            .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime)),
          db
            .select({ classId: balletClassGroupsTable.classId, groupId: balletClassGroupsTable.groupId })
            .from(balletClassGroupsTable)
            .where(inArray(balletClassGroupsTable.classId, classIds)),
          db
            .select({ classId: balletClassLevelsTable.classId, levelId: balletClassLevelsTable.levelId })
            .from(balletClassLevelsTable)
            .where(inArray(balletClassLevelsTable.classId, classIds)),
        ])
      : [[], [], []];

    const schedulesByClass = new Map<number, Array<{ id: number; dayOfWeek: number; startTime: string; endTime: string; durationMins: number | null }>>();
    for (const s of scheduleRows) {
      const list = schedulesByClass.get(s.classId) ?? [];
      list.push({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, durationMins: s.durationMins ?? null });
      schedulesByClass.set(s.classId, list);
    }

    const groupIdsByClass = new Map<number, number[]>();
    for (const g of groupRows) groupIdsByClass.set(g.classId, [...(groupIdsByClass.get(g.classId) ?? []), g.groupId]);

    const levelIdsByClass = new Map<number, number[]>();
    for (const l of levelRows) levelIdsByClass.set(l.classId, [...(levelIdsByClass.get(l.classId) ?? []), l.levelId]);

    const classes = classRows.map((c) => ({
      id:            c.id,
      title:         c.title,
      classImageUrl: c.classImageUrl,
      classVideoUrl: c.classVideoUrl,
      instructor:    c.instructorId != null ? { id: c.instructorId, name: c.instructorName, photoUrl: c.instructorPhotoUrl } : null,
      groupIds:      groupIdsByClass.get(c.id) ?? [],
      levelIds:      levelIdsByClass.get(c.id) ?? [],
      schedules:     schedulesByClass.get(c.id) ?? [],
    }));

    res.json({ classes });
  } catch (err) {
    logger.error({ err }, "GET /ballet/classes failed");
    res.status(500).json({ error: "Failed to load classes" });
  }
});

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
      if (applicationIds.length > 0) {
        const assignments = await db
          .select({
            applicationId: balletLevelAssignmentsTable.applicationId,
            groupId:       balletLevelAssignmentsTable.groupId,
          })
          .from(balletLevelAssignmentsTable)
          .where(and(inArray(balletLevelAssignmentsTable.applicationId, applicationIds), eq(balletLevelAssignmentsTable.status, "active")));
        for (const row of assignments) groupIdByApplicationId.set(row.applicationId, row.groupId);
      }

      res.json({
        applications: applications.map((a) => ({
          ...a,
          assignedGroupId: groupIdByApplicationId.get(a.id) ?? null,
        })),
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
//   Active = any status except "rejected" and "cancelled".
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
  slotId:                z.number({ required_error: "slotId is required" }).int().positive(),
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
      childName, childBirthday, childAge, childGender,
      emergencyContactName, emergencyContactPhone,
      previousExperience, experienceDetails,
      medicalNotes, notes,
      slotId, childId,
    } = parsed.data;

    const parentStudentId = req.studentId!;

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

        // ── Load slot ─────────────────────────────────────────────────────────
        const [slot] = await tx
          .select({
            id:       balletAssessmentSlotsTable.id,
            date:     balletAssessmentSlotsTable.date,
            startTime: balletAssessmentSlotsTable.startTime,
            endTime:  balletAssessmentSlotsTable.endTime,
            capacity: balletAssessmentSlotsTable.capacity,
            isActive: balletAssessmentSlotsTable.isActive,
          })
          .from(balletAssessmentSlotsTable)
          .where(eq(balletAssessmentSlotsTable.id, slotId))
          .limit(1);

        if (!slot || !slot.isActive) {
          throw Object.assign(new Error("Assessment slot not found"), { status: 404 });
        }

        // ── Capacity check (exclude cancelled) ────────────────────────────────
        const [{ bookedCount }] = await tx
          .select({ bookedCount: count(balletApplicationsTable.id) })
          .from(balletApplicationsTable)
          .where(
            and(
              eq(balletApplicationsTable.slotId, slotId),
              not(eq(balletApplicationsTable.status, "cancelled")),
            ),
          );

        if (Number(bookedCount) >= slot.capacity) {
          throw Object.assign(new Error("Selected assessment slot is full"), { status: 409 });
        }

        // ── Validate child ownership (only when a saved child was selected) ───
        // A provided childId must belong to the authenticated parent — never
        // let one account link a child profile owned by another account.
        if (childId != null) {
          const [ownedChild] = await tx
            .select({ id: childrenTable.id })
            .from(childrenTable)
            .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, parentStudentId)))
            .limit(1);
          if (!ownedChild) {
            throw Object.assign(
              new Error("Selected child does not belong to this account."),
              { status: 403 },
            );
          }
        }

        // ── Insert application ────────────────────────────────────────────────
        const slotLabel = `${slot.date} ${slot.startTime}-${slot.endTime}`;

        const [application] = await tx
          .insert(balletApplicationsTable)
          .values({
            parentStudentId,
            childId:               childId ?? null,
            parentName,
            parentPhone,
            parentEmail,
            childName:             childName.trim(),
            childBirthday:         childBirthday ?? null,
            childAge:              childAge ?? null,
            childGender:           childGender ?? null,
            emergencyContactName:  emergencyContactName ?? null,
            emergencyContactPhone: emergencyContactPhone ?? null,
            previousExperience,
            experienceDetails:     experienceDetails ?? null,
            medicalNotes:          medicalNotes ?? null,
            notes:                 notes ?? null,
            slotId,
            slotLabel,
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
        { applicationId: result.id, studentId: parentStudentId, slotId },
        "Ballet application submitted",
      );

      res.status(201).json({ application: { id: result.id, status: result.status } });
    } catch (err: unknown) {
      const typed = err as { status?: number; message?: string; existingApplicationId?: number };

      if (typed.status === 409 && typed.existingApplicationId != null) {
        // Duplicate active application
        res.status(409).json({
          error: typed.message ?? "You already have an active ballet application for this child.",
          existingApplicationId: typed.existingApplicationId,
          code: "DUPLICATE_APPLICATION",
        });
        return;
      }
      if (typed.status === 409) {
        // Slot full
        res.status(409).json({ error: "Selected assessment slot is full", code: "SLOT_FULL" });
        return;
      }
      if (typed.status === 404) {
        res.status(404).json({ error: "Assessment slot not found" });
        return;
      }
      if (typed.status === 403) {
        res.status(403).json({ error: typed.message ?? "Selected child does not belong to this account." });
        return;
      }

      logger.error({ err }, "POST /ballet/applications failed");
      res.status(500).json({ error: "Failed to submit application" });
    }
  },
);

// ─── PATCH /api/ballet/applications/:id ──────────────────────────────────────
//
// Allows the authenticated parent to edit selected fields on their own
// application, but only while the status is pending / needsFollowUp.
//
// Editable fields: medicalNotes, notes, experienceDetails,
//   previousExperience, slotId (re-selects slot, subject to capacity).
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
  slotId:                z.number().int().positive().optional(),
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
        .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, slotId: balletApplicationsTable.slotId })
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
      const { slotId, ...rest } = parsed.data;

      // Copy scalar fields directly
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updates[k] = v;
      }

      // Handle slot change — re-validate capacity
      if (slotId != null && slotId !== app.slotId) {
        const [slot] = await db
          .select({ id: balletAssessmentSlotsTable.id, date: balletAssessmentSlotsTable.date, startTime: balletAssessmentSlotsTable.startTime, endTime: balletAssessmentSlotsTable.endTime, capacity: balletAssessmentSlotsTable.capacity, isActive: balletAssessmentSlotsTable.isActive })
          .from(balletAssessmentSlotsTable)
          .where(eq(balletAssessmentSlotsTable.id, slotId))
          .limit(1);

        if (!slot || !slot.isActive) { res.status(404).json({ error: "Assessment slot not found" }); return; }

        const [{ bookedCount }] = await db
          .select({ bookedCount: count(balletApplicationsTable.id) })
          .from(balletApplicationsTable)
          .where(
            and(
              eq(balletApplicationsTable.slotId, slotId),
              not(eq(balletApplicationsTable.status, "cancelled")),
            ),
          );

        if (Number(bookedCount) >= slot.capacity) {
          res.status(409).json({ error: "Selected assessment slot is full" });
          return;
        }

        updates["slotId"]    = slotId;
        updates["slotLabel"] = `${slot.date} ${slot.startTime}-${slot.endTime}`;
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
    } catch (err) {
      logger.error({ err }, "PATCH /ballet/applications/:id failed");
      res.status(500).json({ error: "Failed to update application" });
    }
  },
);

// ─── POST /api/ballet/applications/:id/cancel ────────────────────────────────
//
// Allows the authenticated parent to cancel their own application, but only
// while status is pending / needsFollowUp.
//
// Sets status to "cancelled" and inserts an event row.
// After cancellation the parent may submit a new application.
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/ballet/applications/:id/cancel",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parentStudentId = req.studentId!;

    try {
      const [app] = await db
        .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status })
        .from(balletApplicationsTable)
        .where(
          and(
            eq(balletApplicationsTable.id, id),
            eq(balletApplicationsTable.parentStudentId, parentStudentId),
          ),
        )
        .limit(1);

      if (!app) { res.status(404).json({ error: "Application not found" }); return; }

      if (!(CANCELLABLE_STATUSES as readonly string[]).includes(app.status)) {
        res.status(422).json({
          error: `Application cannot be cancelled in status "${app.status}".`,
        });
        return;
      }

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx
          .update(balletApplicationsTable)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(balletApplicationsTable.id, id));

        await tx.insert(balletApplicationEventsTable).values({
          applicationId: id,
          fromStatus:    app.status,
          toStatus:      "cancelled",
          changedById:   null,
          note:          "Application cancelled by parent via mobile app",
        });
      });

      logger.info({ applicationId: id, studentId: parentStudentId }, "Ballet application cancelled by parent");

      res.json({ success: true, status: "cancelled" });
    } catch (err) {
      logger.error({ err }, "POST /ballet/applications/:id/cancel failed");
      res.status(500).json({ error: "Failed to cancel application" });
    }
  },
);

export default router;
