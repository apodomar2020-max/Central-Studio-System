import { eq, sql } from "drizzle-orm";
import { db, balletInstructorsTable } from "@workspace/db";

/**
 * Builds (does not execute) the query for "how many active Ballet
 * instructors exist" — the count shown in the mobile Ballet program
 * statistics strip (GET /api/ballet/summary).
 *
 * Deliberately a single-table, unjoined query: an instructor is a member of
 * the Ballet instructor domain purely by having a row in ballet_instructors
 * with isActive true. It must never require a class, schedule, group, or
 * any other linked entity to be countable — that was the bug (an earlier
 * version INNER JOINed through ballet_classes/ballet_schedules, silently
 * excluding any active instructor without a fully wired class+schedule).
 * Matches the definition already used by the public
 * GET /api/ballet/instructors list, which is likewise a plain
 * isActive-filtered select with no join.
 */
export function buildActiveBalletInstructorCountQuery() {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(balletInstructorsTable)
    .where(eq(balletInstructorsTable.isActive, true));
}
