import { eq, sql } from "drizzle-orm";
import { studioBranchesTable, studioRoomsTable } from "@workspace/db";
import type { DbClient } from "./dbTypes";

export type ScheduleLocationErrorCode = "BRANCH_NOT_FOUND" | "ROOM_NOT_FOUND" | "ROOM_BRANCH_MISMATCH" | "BRANCH_INACTIVE" | "ROOM_INACTIVE" | "LOCATION_PAIR_REQUIRED";

export class ScheduleLocationError extends Error {
  constructor(public readonly status: 404 | 422, public readonly code: ScheduleLocationErrorCode, message: string) { super(message); }
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
