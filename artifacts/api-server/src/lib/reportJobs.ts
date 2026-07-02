import { eq } from "drizzle-orm";
import { db, reportJobsTable } from "@workspace/db";

export async function processReportJob(reportJobId: number): Promise<void> {
  const now = new Date().toISOString();
  await db.update(reportJobsTable).set({
    status: "running",
    startedAt: now,
    updatedAt: now,
  }).where(eq(reportJobsTable.id, reportJobId));

  await db.update(reportJobsTable).set({
    status: "completed",
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(reportJobsTable.id, reportJobId));
}
