import { eq, sql } from "drizzle-orm";
import {
  attendanceTable,
  balletApplicationsTable,
  bookingsTable,
  studioBranchesTable,
  studioRoomsTable,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";

export type ScheduleLocationErrorCode = "BRANCH_NOT_FOUND" | "ROOM_NOT_FOUND" | "ROOM_BRANCH_MISMATCH" | "BRANCH_INACTIVE" | "ROOM_INACTIVE" | "LOCATION_PAIR_REQUIRED" | "SCHEDULE_LOCATION_IMMUTABLE";

export class ScheduleLocationError extends Error {
  constructor(public readonly status: 404 | 422, public readonly code: ScheduleLocationErrorCode, message: string) { super(message); }
}

type ScheduleLocation = { branchId: number | null; roomId: number | null };
type ScheduleDomain = "regular" | "ballet";

export const IMMUTABLE_SCHEDULE_LOCATION_MESSAGE = "Branch or Room cannot be changed after schedule activity exists. Cancel this schedule and create a new one.";

export async function assertScheduleLocationChangeAllowed(
  existing: ScheduleLocation,
  requested: ScheduleLocation,
  hasHistoricalActivity: () => Promise<boolean>,
): Promise<void> {
  if (existing.branchId === requested.branchId && existing.roomId === requested.roomId) return;
  if (existing.branchId == null && requested.branchId != null) return;
  if (await hasHistoricalActivity()) {
    throw new ScheduleLocationError(422, "SCHEDULE_LOCATION_IMMUTABLE", IMMUTABLE_SCHEDULE_LOCATION_MESSAGE);
  }
}

async function scheduleHasHistoricalActivity(
  client: DbClient,
  domain: ScheduleDomain,
  scheduleId: number,
): Promise<boolean> {
  const bookingCondition = domain === "regular"
    ? eq(bookingsTable.scheduleId, scheduleId)
    : eq(bookingsTable.balletScheduleId, scheduleId);
  const attendanceCondition = domain === "regular"
    ? eq(attendanceTable.scheduleId, scheduleId)
    : eq(attendanceTable.balletScheduleId, scheduleId);

  const [booking] = await client.select({ id: bookingsTable.id }).from(bookingsTable).where(bookingCondition).limit(1);
  if (booking) return true;

  const [attendance] = await client.select({ id: attendanceTable.id }).from(attendanceTable).where(attendanceCondition).limit(1);
  if (attendance) return true;

  if (domain === "ballet") {
    const [application] = await client
      .select({ id: balletApplicationsTable.id })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.assessmentScheduleId, scheduleId))
      .limit(1);
    if (application) return true;
  }

  return false;
}

export async function validateScheduleLocationChangeAllowed(
  client: DbClient,
  domain: ScheduleDomain,
  scheduleId: number,
  existing: ScheduleLocation,
  requested: ScheduleLocation,
): Promise<void> {
  await assertScheduleLocationChangeAllowed(
    existing,
    requested,
    () => scheduleHasHistoricalActivity(client, domain, scheduleId),
  );
}

export async function validateScheduleLocation(
  client: DbClient,
  branchId: number | null,
  roomId: number | null,
  existing?: { branchId: number | null; roomId: number | null },
) {
  if (branchId == null || roomId == null) {
    if (branchId == null && roomId == null) return null;
    throw new ScheduleLocationError(422, "LOCATION_PAIR_REQUIRED", "Branch and Room must be selected together.");
  }
  await client.execute(sql`select id from studio_branches where id = ${branchId} for update`);
  await client.execute(sql`select id from studio_rooms where id = ${roomId} for update`);
  const [branch] = await client.select().from(studioBranchesTable).where(eq(studioBranchesTable.id, branchId)).limit(1);
  if (!branch) throw new ScheduleLocationError(404, "BRANCH_NOT_FOUND", "Branch not found.");
  const [room] = await client.select().from(studioRoomsTable).where(eq(studioRoomsTable.id, roomId)).limit(1);
  if (!room) throw new ScheduleLocationError(404, "ROOM_NOT_FOUND", "Room not found.");
  if (room.branchId !== branch.id) throw new ScheduleLocationError(422, "ROOM_BRANCH_MISMATCH", "The selected Room does not belong to the selected Branch.");
  const unchanged = existing?.branchId === branchId && existing?.roomId === roomId;
  if (!unchanged && !branch.isActive) throw new ScheduleLocationError(422, "BRANCH_INACTIVE", "The selected Branch is inactive.");
  if (!unchanged && !room.isActive) throw new ScheduleLocationError(422, "ROOM_INACTIVE", "The selected Room is inactive.");
  return { branch, room };
}
