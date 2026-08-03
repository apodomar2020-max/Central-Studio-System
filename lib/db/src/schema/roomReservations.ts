import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { studioBranchesTable, studioRoomsTable } from "./studioBranches";
import { systemUsersTable } from "./systemUsers";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studioRoomReservationsTable = pgTable("studio_room_reservations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  reservationType: text("reservation_type").notNull(),
  branchId: integer("branch_id").notNull().references(() => studioBranchesTable.id, { onDelete: "restrict" }),
  roomId: integer("room_id").notNull().references(() => studioRoomsTable.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  description: text("description"),
  organizerName: text("organizer_name"),
  organizerContact: text("organizer_contact"),
  status: text("status").notNull().default("active"),
  createdByUserId: integer("created_by_user_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  index("room_reservations_room_date_status_idx").on(table.roomId, table.date, table.status),
  index("room_reservations_branch_date_idx").on(table.branchId, table.date),
]);

export const insertStudioRoomReservationSchema = createInsertSchema(studioRoomReservationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStudioRoomReservation = z.infer<typeof insertStudioRoomReservationSchema>;
export type StudioRoomReservation = typeof studioRoomReservationsTable.$inferSelect;
