/**
 * Ballet routes — /api/ballet/*
 *
 * Public routes (shared API key only):
 *   GET  /api/ballet/settings                     — admin-managed pricing + instructions
 *   GET  /api/ballet/assessment-slots             — future active slots with live capacity
 *
 * Student-authenticated routes (student JWT required via requireStudentAuth):
 *   POST /api/ballet/applications                 — submit new application (duplicate-safe)
 *   GET  /api/ballet/applications/my             — authenticated parent's own applications
 *   PATCH  /api/ballet/applications/:id          — edit editable fields (status-gated)
 *   POST /api/ballet/applications/:id/cancel     — cancel an application (status-gated)
 *
 * Duplicate prevention:
 *   Active statuses = submitted | pendingAssessment | accepted | needsFollowUp |
 *                     assignedToLevel | activeBallet
 *   If the same authenticated parent already has an active application for the
 *   same child name (case-insensitive), POST returns 409 with existingApplicationId
 *   so the mobile can redirect to the status screen without a second round-trip.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, ilike, or, inArray, not } from "drizzle-orm";
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

// ─── Statuses ─────────────────────────────────────────────────────────────────

/**
 * Statuses that mean an application is still "active" — i.e. the parent has
 * an open slot and should not be allowed to submit a duplicate.
 * "rejected" and "cancelled" are the only terminal-inactive statuses.
 */
const ACTIVE_STATUSES = [
  "submitted",
  "pendingAssessment",
  "accepted",
  "needsFollowUp",
  "assignedToLevel",
  "activeBallet",
] as const;

/** Statuses that allow the parent to edit fields on their application. */
const EDITABLE_STATUSES = ["submitted", "pendingAssessment", "needsFollowUp"] as const;

/** Statuses that allow the parent to cancel their application. */
const CANCELLABLE_STATUSES = ["submitted", "pendingAssessment", "needsFollowUp"] as const;

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

router.get("/ballet/assessment-slots", async (_req, res): Promise<void> => {
  try {
    const today = todayIso();

    const [settingsRow] = await db
      .select({ fewSeatsThreshold: balletSettingsTable.fewSeatsThreshold })
      .from(balletSettingsTable)
      .where(eq(balletSettingsTable.id, 1))
      .limit(1);

    const fewSeatsThreshold = settingsRow?.fewSeatsThreshold ?? 3;

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

// ─── GET /api/ballet/applications/my ─────────────────────────────────────────
//
// Returns all ballet applications submitted by the authenticated parent.
// Ordered by creation date descending (newest first).
//
// Response: { applications: BalletApplication[] }
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ballet/applications/my",
  requireStudentAuth,
  async (req, res): Promise<void> => {
    const parentStudentId = req.studentId!;

    try {
      const applications = await db
        .select()
        .from(balletApplicationsTable)
        .where(eq(balletApplicationsTable.parentStudentId, parentStudentId))
        .orderBy(desc(balletApplicationsTable.createdAt));

      res.json({ applications });
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
//   application for a child with the same name (case-insensitive).
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
});

router.post(
  "/ballet/applications",
  requireStudentAuth,
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
      slotId,
    } = parsed.data;

    const parentStudentId = req.studentId!;

    try {
      const result = await db.transaction(async (tx) => {
        // ── Duplicate prevention ──────────────────────────────────────────────
        // Check if this parent already has an active application for a child with
        // the same name (trimmed, case-insensitive).
        const existing = await tx
          .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status })
          .from(balletApplicationsTable)
          .where(
            and(
              eq(balletApplicationsTable.parentStudentId, parentStudentId),
              ilike(balletApplicationsTable.childName, childName.trim()),
              inArray(balletApplicationsTable.status, [...ACTIVE_STATUSES]),
            ),
          )
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

        // ── Insert application ────────────────────────────────────────────────
        const slotLabel = `${slot.date} ${slot.startTime}-${slot.endTime}`;

        const [application] = await tx
          .insert(balletApplicationsTable)
          .values({
            parentStudentId,
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
            status: "submitted",
          })
          .returning({ id: balletApplicationsTable.id, status: balletApplicationsTable.status });

        // ── Insert initial event ──────────────────────────────────────────────
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

      logger.error({ err }, "POST /ballet/applications failed");
      res.status(500).json({ error: "Failed to submit application" });
    }
  },
);

// ─── PATCH /api/ballet/applications/:id ──────────────────────────────────────
//
// Allows the authenticated parent to edit selected fields on their own
// application, but only while the status is submitted / pendingAssessment /
// needsFollowUp.
//
// Editable fields: parentPhone, parentEmail, emergencyContactName,
//   emergencyContactPhone, medicalNotes, notes, experienceDetails,
//   previousExperience, slotId (re-selects slot, subject to capacity).
// ─────────────────────────────────────────────────────────────────────────────

const UpdateApplicationBody = z.object({
  parentPhone:           z.string().min(1).optional(),
  parentEmail:           z.string().email().optional(),
  emergencyContactName:  z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  medicalNotes:          z.string().optional(),
  notes:                 z.string().optional(),
  experienceDetails:     z.string().optional(),
  previousExperience:    z.boolean().optional(),
  slotId:                z.number().int().positive().optional(),
});

router.patch(
  "/ballet/applications/:id",
  requireStudentAuth,
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
          error: `Application cannot be edited in status "${app.status}". Editing is only allowed while submitted, pending assessment, or needing follow-up.`,
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
// while status is submitted / pendingAssessment / needsFollowUp.
//
// Sets status to "cancelled" and inserts an event row.
// After cancellation the parent may submit a new application.
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/ballet/applications/:id/cancel",
  requireStudentAuth,
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
