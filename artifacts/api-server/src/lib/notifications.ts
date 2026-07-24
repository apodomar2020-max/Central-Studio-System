import { and, eq, sql } from "drizzle-orm";
import { db, notificationsTable, studentsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendBroadcastPushNotification, sendPushNotification } from "./pushNotifications";

type NotificationClient = Pick<typeof db, "select" | "insert">;

/**
 * A push send deferred until after the enclosing DB transaction commits —
 * see pushQueue below. Plain data, no side effect yet.
 */
export type PendingPushJob =
  | { kind: "student"; studentId: number; title: string; body: string; data: Record<string, unknown>; notificationId: number }
  | { kind: "broadcast"; title: string; body: string; data: Record<string, unknown>; notificationId: number };

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
  /**
   * When supplied, the push send is appended here instead of being fired
   * immediately — the caller owns a DB transaction and must flush this
   * queue (flushPushQueue) only AFTER that transaction has committed, so a
   * rollback can never leave a push sent for a write that didn't happen.
   * Omitted entirely: preserves the original fire-and-forget behavior for
   * call sites outside a transaction whose commit boundary matters.
   */
  pushQueue?: PendingPushJob[];
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
  pushQueue?: PendingPushJob[];
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function resolveStudentTarget(
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
  input: Pick<StudentNotificationInput, "type" | "relatedEntityType" | "relatedEntityId" | "metadata" | "dispatchPush" | "pushQueue"> = {},
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
    const data = { type: input.type ?? "notification", ...(input.metadata ?? {}) };
    const studentTargetMatch = /^student:(\d+)$/.exec(target);
    if (studentTargetMatch) {
      const studentId = Number(studentTargetMatch[1]);
      if (input.pushQueue) {
        input.pushQueue.push({ kind: "student", studentId, title, body, data, notificationId: row.id });
      } else {
        // No queue supplied — this caller is not inside a transaction whose
        // commit boundary matters (or predates this mechanism); preserve the
        // original fire-and-forget behavior unchanged.
        setTimeout(() => {
          void sendPushNotification({ studentId, title, body, data, notificationId: row.id });
        }, 0);
      }
    } else if (target === "all") {
      if (input.pushQueue) {
        input.pushQueue.push({ kind: "broadcast", title, body, data, notificationId: row.id });
      } else {
        setTimeout(() => {
          void sendBroadcastPushNotification({ title, body, data, notificationId: row.id });
        }, 0);
      }
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

/**
 * Dispatches every queued push job — call this ONLY after the DB
 * transaction that produced the queue has committed. sendPushNotification /
 * sendBroadcastPushNotification never throw (they catch and report a
 * failure result), so a bad push can never surface as a 500 on an
 * otherwise-successful, already-committed write; genuine send failures are
 * still logged via notification_delivery_logs, not swallowed silently.
 */
export async function flushPushQueue(queue: PendingPushJob[] | undefined): Promise<void> {
  if (!queue || queue.length === 0) return;
  await Promise.all(queue.map((job) =>
    job.kind === "student"
      ? sendPushNotification({ studentId: job.studentId, title: job.title, body: job.body, data: job.data, notificationId: job.notificationId })
      : sendBroadcastPushNotification({ title: job.title, body: job.body, data: job.data, notificationId: job.notificationId }),
  ));
}
