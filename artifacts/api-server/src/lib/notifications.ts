import { and, eq, sql } from "drizzle-orm";
import { db, notificationsTable, studentsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendBroadcastPushNotification, sendPushNotification } from "./pushNotifications";

type NotificationClient = Pick<typeof db, "select" | "insert">;

type StudentNotificationInput = {
  studentId?: number | null;
  studentEmail?: string | null;
  title: string;
  body: string;
  type?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  dedupe?: boolean;
  dispatchPush?: boolean;
};

type BroadcastNotificationInput = {
  title: string;
  body: string;
  type?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  dedupe?: boolean;
  dispatchPush?: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function resolveStudentTarget(
  client: NotificationClient,
  studentId?: number | null,
  studentEmail?: string | null,
): Promise<string | null> {
  if (studentId != null) return `student:${studentId}`;
  if (!studentEmail) {
    logger.warn("Student notification skipped: no student id or email provided");
    return null;
  }

  const [student] = await client
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(sql`lower(trim(${studentsTable.email})) = ${normalizeEmail(studentEmail)}`)
    .limit(1);

  if (!student) {
    logger.warn({ studentEmail: normalizeEmail(studentEmail) }, "Student notification skipped: student not found");
    return null;
  }

  return `student:${student.id}`;
}

async function insertNotification(
  client: NotificationClient,
  target: string,
  title: string,
  body: string,
  input: Pick<StudentNotificationInput, "type" | "relatedEntityType" | "relatedEntityId" | "metadata" | "dispatchPush"> = {},
  dedupe = true,
) {
  if (dedupe) {
    const hasEntityDedupe =
      input.type != null &&
      input.relatedEntityType != null &&
      input.relatedEntityId != null;
    const dedupeConditions = hasEntityDedupe
      ? [
          eq(notificationsTable.target, target),
          eq(notificationsTable.type, input.type!),
          eq(notificationsTable.relatedEntityType, input.relatedEntityType!),
          eq(notificationsTable.relatedEntityId, input.relatedEntityId!),
          eq(notificationsTable.isDraft, false),
        ]
      : [
          eq(notificationsTable.target, target),
          eq(notificationsTable.title, title),
          eq(notificationsTable.body, body),
          eq(notificationsTable.isDraft, false),
        ];
    const [existing] = await client
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(...dedupeConditions))
      .limit(1);

    if (existing) {
      logger.info({
        target,
        type: input.type ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        existingNotificationId: existing.id,
        dedupeMode: hasEntityDedupe ? "entity" : "content",
      }, "Student notification skipped: duplicate suppressed");
      return null;
    }
  }

  const [row] = await client
    .insert(notificationsTable)
    .values({
      title,
      body,
      target,
      type: input.type ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      metadata: input.metadata ?? null,
      isDraft: false,
      sentAt: new Date().toISOString(),
    })
    .returning();

  if (input.dispatchPush !== false) {
    const studentTargetMatch = /^student:(\d+)$/.exec(target);
    if (studentTargetMatch) {
      const studentId = Number(studentTargetMatch[1]);
      setTimeout(() => {
        void sendPushNotification({
          studentId,
          title,
          body,
          data: { type: input.type ?? "notification" },
          notificationId: row.id,
        });
      }, 0);
    } else if (target === "all") {
      setTimeout(() => {
        void sendBroadcastPushNotification({
          title,
          body,
          data: { type: input.type ?? "notification" },
          notificationId: row.id,
        });
      }, 0);
    }
  }

  return row;
}

export async function createStudentNotification(
  client: NotificationClient,
  input: StudentNotificationInput,
) {
  const target = await resolveStudentTarget(client, input.studentId, input.studentEmail);
  if (!target) return null;
  return insertNotification(client, target, input.title, input.body, input, input.dedupe ?? true);
}

export async function createBroadcastNotification(
  client: NotificationClient,
  input: BroadcastNotificationInput,
) {
  return insertNotification(client, "all", input.title, input.body, input, input.dedupe ?? true);
}
