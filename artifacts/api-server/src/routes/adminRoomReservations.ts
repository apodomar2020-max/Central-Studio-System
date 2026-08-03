import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  studioRoomReservationsTable,
  studioBranchesTable,
  studioRoomsTable,
  schedulesTable,
  balletSchedulesTable,
  classesTable,
  balletClassesTable,
} from "@workspace/db";
import {
  ListRoomReservationsQueryParams,
  CreateRoomReservationBody,
  CreateRoomReservationResponse,
  GetRoomReservationParams,
  GetRoomReservationResponse,
  UpdateRoomReservationParams,
  UpdateRoomReservationBody,
  UpdateRoomReservationResponse,
} from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import {
  assertNoScheduleConflict,
  ScheduleConflictError,
  type ScheduleOccupancy,
} from "../lib/scheduleConflict";
import { isoDateDayOfWeek } from "../lib/occurrence";

const router: IRouter = Router();

function parseTimeMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Gather existing active room occupancies for conflict checking across:
 * 1. Regular class schedules (`schedules` + `classes`)
 * 2. Ballet schedules (`ballet_schedules` + `ballet_classes`)
 * 3. Studio room reservations (`studio_room_reservations`)
 */
async function fetchRoomOccupancies(
  branchId: number,
  roomId: number,
  excludeReservationId?: number | null,
): Promise<ScheduleOccupancy[]> {
  const [regularRows, balletRows, reservationRows] = await Promise.all([
    db
      .select({
        id: schedulesTable.id,
        status: schedulesTable.status,
        type: schedulesTable.type,
        dayOfWeek: schedulesTable.dayOfWeek,
        date: schedulesTable.date,
        effectiveFrom: schedulesTable.effectiveFrom,
        effectiveUntil: schedulesTable.effectiveUntil,
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        classTitle: classesTable.title,
      })
      .from(schedulesTable)
      .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
      .where(
        and(
          eq(schedulesTable.branchId, branchId),
          eq(schedulesTable.roomId, roomId),
          eq(schedulesTable.status, "active"),
        ),
      ),
    db
      .select({
        id: balletSchedulesTable.id,
        status: balletSchedulesTable.status,
        dayOfWeek: balletSchedulesTable.dayOfWeek,
        startTime: balletSchedulesTable.startTime,
        endTime: balletSchedulesTable.endTime,
        classTitle: balletClassesTable.title,
      })
      .from(balletSchedulesTable)
      .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
      .where(
        and(
          eq(balletSchedulesTable.branchId, branchId),
          eq(balletSchedulesTable.roomId, roomId),
          eq(balletSchedulesTable.status, "active"),
        ),
      ),
    db
      .select({
        id: studioRoomReservationsTable.id,
        status: studioRoomReservationsTable.status,
        date: studioRoomReservationsTable.date,
        startTime: studioRoomReservationsTable.startTime,
        endTime: studioRoomReservationsTable.endTime,
        title: studioRoomReservationsTable.title,
      })
      .from(studioRoomReservationsTable)
      .where(
        and(
          eq(studioRoomReservationsTable.branchId, branchId),
          eq(studioRoomReservationsTable.roomId, roomId),
          eq(studioRoomReservationsTable.status, "active"),
        ),
      ),
  ]);

  const occupancies: ScheduleOccupancy[] = [];

  for (const s of regularRows) {
    occupancies.push({
      id: s.id,
      source: "class",
      branchId,
      roomId,
      status: s.status,
      startTime: s.startTime,
      endTime: s.endTime,
      recurrence:
        s.type === "one_time" && s.date
          ? { type: "one_time", date: s.date }
          : {
              type: "weekly",
              dayOfWeek: s.dayOfWeek ?? 0,
              effectiveFrom: s.effectiveFrom,
              effectiveUntil: s.effectiveUntil,
            },
      classTitle: s.classTitle,
    });
  }

  for (const b of balletRows) {
    occupancies.push({
      id: b.id,
      source: "ballet",
      branchId,
      roomId,
      status: b.status,
      startTime: b.startTime,
      endTime: b.endTime,
      recurrence: {
        type: "weekly",
        dayOfWeek: b.dayOfWeek,
        effectiveFrom: null,
        effectiveUntil: null,
      },
      classTitle: b.classTitle,
    });
  }

  for (const r of reservationRows) {
    if (excludeReservationId != null && r.id === excludeReservationId) continue;
    occupancies.push({
      id: r.id,
      source: "reservation",
      branchId,
      roomId,
      status: r.status,
      startTime: r.startTime,
      endTime: r.endTime,
      recurrence: { type: "one_time", date: r.date },
      classTitle: r.title,
    });
  }

  return occupancies;
}

// GET /admin/room-reservations
router.get(
  "/admin/room-reservations",
  requireAdminAuth,
  requireAdminPermission("room_reservations", "view"),
  async (req, res): Promise<void> => {
    const query = ListRoomReservationsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const conditions = [];
    if (query.data.branchId != null) conditions.push(eq(studioRoomReservationsTable.branchId, query.data.branchId));
    if (query.data.roomId != null) conditions.push(eq(studioRoomReservationsTable.roomId, query.data.roomId));
    if (query.data.date != null) conditions.push(eq(studioRoomReservationsTable.date, query.data.date));
    if (query.data.status != null) conditions.push(eq(studioRoomReservationsTable.status, query.data.status));

    const rows = await db
      .select({
        reservation: studioRoomReservationsTable,
        branchName: studioBranchesTable.name,
        roomName: studioRoomsTable.name,
      })
      .from(studioRoomReservationsTable)
      .leftJoin(studioBranchesTable, eq(studioBranchesTable.id, studioRoomReservationsTable.branchId))
      .leftJoin(studioRoomsTable, eq(studioRoomsTable.id, studioRoomReservationsTable.roomId))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const result = rows.map(({ reservation, branchName, roomName }) => ({
      ...reservation,
      branchName: branchName ?? null,
      roomName: roomName ?? null,
    }));

    res.json(result);
  },
);

// POST /admin/room-reservations
router.post(
  "/admin/room-reservations",
  requireAdminAuth,
  requireAdminPermission("room_reservations", "create"),
  async (req: AdminRequest, res): Promise<void> => {
    const bodyResult = CreateRoomReservationBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: bodyResult.error.message });
      return;
    }

    const body = bodyResult.data;

    // Verify branch & room existence
    const [[branch], [room]] = await Promise.all([
      db.select({ id: studioBranchesTable.id, name: studioBranchesTable.name }).from(studioBranchesTable).where(eq(studioBranchesTable.id, body.branchId)).limit(1),
      db.select({ id: studioRoomsTable.id, name: studioRoomsTable.name, branchId: studioRoomsTable.branchId }).from(studioRoomsTable).where(eq(studioRoomsTable.id, body.roomId)).limit(1),
    ]);

    if (!branch || !room || room.branchId !== body.branchId) {
      res.status(400).json({ error: "Invalid branchId or roomId combination." });
      return;
    }

    // Conflict detection
    const candidate: ScheduleOccupancy = {
      id: null,
      source: "reservation",
      branchId: body.branchId,
      roomId: body.roomId,
      status: "active",
      startTime: body.startTime,
      endTime: body.endTime,
      recurrence: { type: "one_time", date: body.date },
      classTitle: body.title,
    };

    const existingOccupancies = await fetchRoomOccupancies(body.branchId, body.roomId);

    try {
      assertNoScheduleConflict(candidate, existingOccupancies);
    } catch (err) {
      if (err instanceof ScheduleConflictError) {
        res.status(err.status).json({
          error: err.code,
          message: err.message,
          conflict: err.conflict,
        });
        return;
      }
      throw err;
    }

    const [inserted] = await db
      .insert(studioRoomReservationsTable)
      .values({
        title: body.title,
        reservationType: body.reservationType,
        branchId: body.branchId,
        roomId: body.roomId,
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        description: body.description ?? null,
        organizerName: body.organizerName ?? null,
        organizerContact: body.organizerContact ?? null,
        status: "active",
        createdByUserId: req.adminUserId ?? null,
      })
      .returning();

    res.status(201).json(
      CreateRoomReservationResponse.parse({
        ...inserted,
        branchName: branch.name,
        roomName: room.name,
      }),
    );
  },
);

// GET /admin/room-reservations/:id
router.get(
  "/admin/room-reservations/:id",
  requireAdminAuth,
  requireAdminPermission("room_reservations", "view"),
  async (req, res): Promise<void> => {
    const params = GetRoomReservationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [row] = await db
      .select({
        reservation: studioRoomReservationsTable,
        branchName: studioBranchesTable.name,
        roomName: studioRoomsTable.name,
      })
      .from(studioRoomReservationsTable)
      .leftJoin(studioBranchesTable, eq(studioBranchesTable.id, studioRoomReservationsTable.branchId))
      .leftJoin(studioRoomsTable, eq(studioRoomsTable.id, studioRoomReservationsTable.roomId))
      .where(eq(studioRoomReservationsTable.id, params.data.id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Room reservation not found." });
      return;
    }

    res.json(
      GetRoomReservationResponse.parse({
        ...row.reservation,
        branchName: row.branchName ?? null,
        roomName: row.roomName ?? null,
      }),
    );
  },
);

// PATCH /admin/room-reservations/:id
router.patch(
  "/admin/room-reservations/:id",
  requireAdminAuth,
  (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const isCancelOnly = body["status"] === "cancelled" && Object.keys(body).length === 1;
    if (isCancelOnly) {
      requireAdminPermission("room_reservations", "cancel")(req, res, next);
    } else {
      requireAdminPermission("room_reservations", "edit")(req, res, next);
    }
  },
  async (req: AdminRequest, res): Promise<void> => {
    const params = GetRoomReservationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const rawBody = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const immutableKeys = ["branchId", "roomId", "date", "startTime", "endTime"];
    const hasImmutableChange = immutableKeys.some((key) => rawBody[key] !== undefined);
    if (hasImmutableChange) {
      res.status(400).json({
        error: "IMMUTABLE_OCCUPANCY_FIELD",
        message: "Changing reservation room, date, or time is not permitted. Please cancel this reservation and create a new one.",
      });
      return;
    }

    const bodyResult = UpdateRoomReservationBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: bodyResult.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(studioRoomReservationsTable)
      .where(eq(studioRoomReservationsTable.id, params.data.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Room reservation not found." });
      return;
    }

    const body = bodyResult.data;

    // A cancelled reservation cannot be re-edited or re-activated
    if (existing.status === "cancelled" && body.status !== "cancelled") {
      res.status(400).json({
        error: "RESERVATION_CANCELLED",
        message: "Cancelled room reservations cannot be modified or re-activated.",
      });
      return;
    }

    const [updated] = await db
      .update(studioRoomReservationsTable)
      .set({
        ...(body.title != null ? { title: body.title } : {}),
        ...(body.reservationType != null ? { reservationType: body.reservationType } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status != null ? { status: body.status } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(studioRoomReservationsTable.id, params.data.id))
      .returning();

    const [[branch], [room]] = await Promise.all([
      db.select({ name: studioBranchesTable.name }).from(studioBranchesTable).where(eq(studioBranchesTable.id, updated.branchId)).limit(1),
      db.select({ name: studioRoomsTable.name }).from(studioRoomsTable).where(eq(studioRoomsTable.id, updated.roomId)).limit(1),
    ]);

    res.json(
      UpdateRoomReservationResponse.parse({
        ...updated,
        branchName: branch?.name ?? null,
        roomName: room?.name ?? null,
      }),
    );
  },
);

export default router;
