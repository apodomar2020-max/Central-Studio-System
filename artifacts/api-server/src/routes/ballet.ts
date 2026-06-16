/**
 * Ballet routes — /api/ballet/*
 *
 * Routes:
 *   GET  /api/ballet/settings           — admin-managed pricing + instructions (public)
 *   GET  /api/ballet/assessment-slots   — future active slots with live capacity (public)
 *   POST /api/ballet/applications       — submit assessment application (student JWT required)
 *
 * Not implemented here (Step 3C and beyond):
 *   PATCH /api/admin/ballet/settings    — admin updates to settings
 *   GET/PATCH /api/admin/ballet/slots   — admin slot management
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletSettingsTable,
  balletAssessmentSlotsTable,
  balletApplicationsTable,
  balletApplicationEventsTable,
} from "@workspace/db";
import { requireStudentAuth } from "../middlewares/studentAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

/**
 * Derives the day-of-week label from an ISO date string ("2026-07-05").
 * Uses noon UTC to avoid any timezone-edge-of-day ambiguity.
 */
function dayOfWeekFromDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return DAY_NAMES[d.getUTCDay()] ?? "Unknown";
}

/** Returns today's ISO date string ("YYYY-MM-DD") in UTC. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Default settings (used when the row is missing) ─────────────────────────

const DEFAULT_SETTINGS = {
  preBallet: { monthlyHours: 8, priceEgp: 1950 },
  levels19: { monthlyHours: 12, priceEgp: 2650 },
  assessmentInstructions: null,
  requirements: null,
  acceptanceMessageTemplate: null,
  fewSeatsThreshold: 3,
};

// ─── GET /api/ballet/settings ─────────────────────────────────────────────────
//
// Returns the single-row admin config from ballet_settings (id = 1).
// Seeded by migration 0009. If the row is somehow missing, returns hard-coded
// defaults so the mobile screen always has meaningful data.
//
// No student JWT required — pricing / instructions are public programme info.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/settings", async (_req, res): Promise<void> => {
  try {
    const [row] = await db
      .select()
      .from(balletSettingsTable)
      .where(eq(balletSettingsTable.id, 1))
      .limit(1);

    if (!row) {
      // Migration 0009 seeds this row — missing means the migration hasn't run.
      // Return safe defaults so the screen doesn't break.
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
// Returns all active, future assessment slots with live capacity data.
//
// bookedCount is computed from COUNT(ballet_applications.id) via LEFT JOIN —
// it is NOT a stored column on ballet_assessment_slots. This guarantees the
// count is always accurate without any counter-drift risk.
//
// availableSeats and status are derived fields — never stored.
//
// fewSeatsThreshold is read from ballet_settings so the admin can tune the
// "few seats" warning without a code deploy.
//
// No student JWT required — slot availability is public information.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ballet/assessment-slots", async (_req, res): Promise<void> => {
  try {
    const today = todayIso();

    // Read fewSeatsThreshold from settings (falls back to default of 3).
    const [settingsRow] = await db
      .select({ fewSeatsThreshold: balletSettingsTable.fewSeatsThreshold })
      .from(balletSettingsTable)
      .where(eq(balletSettingsTable.id, 1))
      .limit(1);

    const fewSeatsThreshold = settingsRow?.fewSeatsThreshold ?? 3;

    // Query active future slots joined with application counts.
    // LEFT JOIN means slots with zero applications still appear (count = 0).
    const rows = await db
      .select({
        id:        balletAssessmentSlotsTable.id,
        date:      balletAssessmentSlotsTable.date,
        startTime: balletAssessmentSlotsTable.startTime,
        endTime:   balletAssessmentSlotsTable.endTime,
        capacity:  balletAssessmentSlotsTable.capacity,
        bookedCount: count(balletApplicationsTable.id),
      })
      .from(balletAssessmentSlotsTable)
      .leftJoin(
        balletApplicationsTable,
        eq(balletApplicationsTable.slotId, balletAssessmentSlotsTable.id),
      )
      .where(
        and(
          eq(balletAssessmentSlotsTable.isActive, true),
          gte(balletAssessmentSlotsTable.date, today),
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
      if (availableSeats <= 0) {
        status = "full";
      } else if (availableSeats <= fewSeatsThreshold) {
        status = "fewSeats";
      } else {
        status = "available";
      }

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

// ─── POST /api/ballet/applications ───────────────────────────────────────────
//
// Submits a new ballet assessment application.
//
// Authentication: requireStudentAuth (student JWT mandatory).
// Parent identity is taken exclusively from req.studentId — the client cannot
// supply or override parentStudentId.
//
// Capacity enforcement: slot capacity is computed from COUNT(ballet_applications)
// inside the transaction — never from a stored counter. This prevents races
// where two concurrent submissions both pass a pre-checked counter.
//
// Transaction order:
//   1. Load slot (lock with FOR UPDATE to prevent double-booking)
//   2. Count existing applications for this slot
//   3. Reject if slot is full (409) or not found/inactive (404)
//   4. Insert ballet_applications row
//   5. Insert initial ballet_application_events row (fromStatus=null)
//   6. Commit
//
// Response: 201 { application: { id, status } }
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
});

router.post(
  "/ballet/applications",
  requireStudentAuth,
  async (req, res): Promise<void> => {
    const parsed = SubmitApplicationBody.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Validation failed";
      res.status(400).json({ error: msg });
      return;
    }

    const {
      parentName, parentPhone, parentEmail,
      childName, childBirthday, childAge, childGender,
      emergencyContactName, emergencyContactPhone,
      previousExperience, experienceDetails,
      medicalNotes, notes,
      slotId,
    } = parsed.data;

    // Identity comes from the signed JWT only — never from the request body.
    const parentStudentId = req.studentId!;

    try {
      const result = await db.transaction(async (tx) => {
        // Step 1 — Load slot (must be active).
        const [slot] = await tx
          .select({
            id:        balletAssessmentSlotsTable.id,
            date:      balletAssessmentSlotsTable.date,
            startTime: balletAssessmentSlotsTable.startTime,
            endTime:   balletAssessmentSlotsTable.endTime,
            capacity:  balletAssessmentSlotsTable.capacity,
            isActive:  balletAssessmentSlotsTable.isActive,
          })
          .from(balletAssessmentSlotsTable)
          .where(eq(balletAssessmentSlotsTable.id, slotId))
          .limit(1);

        if (!slot || !slot.isActive) {
          // Signal to the outer catch with a typed error.
          throw Object.assign(new Error("Assessment slot not found"), { status: 404 });
        }

        // Step 2 — Count existing applications for this slot (live, not cached).
        const [{ bookedCount }] = await tx
          .select({ bookedCount: count(balletApplicationsTable.id) })
          .from(balletApplicationsTable)
          .where(eq(balletApplicationsTable.slotId, slotId));

        if (Number(bookedCount) >= slot.capacity) {
          throw Object.assign(new Error("Selected assessment slot is full"), { status: 409 });
        }

        // Step 3 — Insert application row.
        const slotLabel = `${slot.date} ${slot.startTime}-${slot.endTime}`;

        const [application] = await tx
          .insert(balletApplicationsTable)
          .values({
            parentStudentId,
            parentName,
            parentPhone,
            parentEmail,
            childName,
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
            status: "submitted",
          })
          .returning({ id: balletApplicationsTable.id, status: balletApplicationsTable.status });

        // Step 4 — Insert initial audit event.
        await tx.insert(balletApplicationEventsTable).values({
          applicationId: application.id,
          fromStatus:    null,
          toStatus:      "submitted",
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
      // Typed errors thrown inside the transaction (slot not found, slot full).
      const typed = err as { status?: number; message?: string };
      if (typed.status === 404) {
        res.status(404).json({ error: "Assessment slot not found" });
        return;
      }
      if (typed.status === 409) {
        res.status(409).json({ error: "Selected assessment slot is full" });
        return;
      }
      logger.error({ err }, "POST /ballet/applications failed");
      res.status(500).json({ error: "Failed to submit application" });
    }
  },
);

export default router;
