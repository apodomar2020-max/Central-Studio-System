/**
 * Ballet routes — /api/ballet/*
 *
 * Step 3A — public read-only endpoints required by the mobile Assessment screen.
 * No authentication beyond the shared API key (applied globally in app.ts).
 *
 * Routes:
 *   GET /api/ballet/settings           — admin-managed pricing + instructions
 *   GET /api/ballet/assessment-slots   — future active slots with live capacity
 *
 * Not implemented here (Step 3B and beyond):
 *   POST /api/ballet/applications      — submit assessment application
 *   PATCH /api/admin/ballet/settings   — admin updates to settings
 *   GET/PATCH /api/admin/ballet/slots  — admin slot management
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, gte } from "drizzle-orm";
import {
  db,
  balletSettingsTable,
  balletAssessmentSlotsTable,
  balletApplicationsTable,
} from "@workspace/db";
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

export default router;
