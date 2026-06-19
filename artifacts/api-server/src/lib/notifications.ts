import { and, eq, sql } from "drizzle-orm";
import { db, notificationsTable, studentsTable } from "@workspace/db";

type NotificationClient = Pick<typeof db, "select" | "insert">;

type StudentNotificationInput = {
  studentId?: number | null;
  studentEmail?: string | null;
  title: string;
  body: string;
  dedupe?: boolean;
};

type BroadcastNotificationInput = {
  title: string;
  body: string;
  dedupe?: boolean;
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
  if (!studentEmail) return null;

  const [student] = await client
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(sql`lower(trim(${studentsTable.email})) = ${normalizeEmail(studentEmail)}`)
    .limit(1);

  return student ? `student:${student.id}` : null;
}

async function insertNotification(
  client: NotificationClient,
  target: string,
  title: string,
  body: string,
  dedupe = true,
) {
  if (dedupe) {
    const [existing] = await client
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.target, target),
        eq(notificationsTable.title, title),
        eq(notificationsTable.body, body),
        eq(notificationsTable.isDraft, false),
      ))
      .limit(1);

    if (existing) return null;
  }

  const [row] = await client
    .insert(notificationsTable)
    .values({
      title,
      body,
      target,
      isDraft: false,
      sentAt: new Date().toISOString(),
    })
    .returning();

  return row;
}

export async function createStudentNotification(
  client: NotificationClient,
  input: StudentNotificationInput,
) {
  const target = await resolveStudentTarget(client, input.studentId, input.studentEmail);
  if (!target) return null;
  return insertNotification(client, target, input.title, input.body, input.dedupe ?? true);
}

export async function createBroadcastNotification(
  client: NotificationClient,
  input: BroadcastNotificationInput,
) {
  return insertNotification(client, "all", input.title, input.body, input.dedupe ?? true);
}
