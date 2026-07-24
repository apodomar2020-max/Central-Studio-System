import {
  defaultJobOptions,
  getQueue,
  QUEUE_NAMES,
  type BalletAutoAbsenceJob,
} from "./queue";
import {
  balletAbsenceOccurrenceJobId,
  balletAbsencePushJobId,
} from "./balletAutoAbsenceJobIds";

export type AutoAbsenceQueue = Pick<
  NonNullable<ReturnType<typeof getQueue>>,
  "add" | "getJob"
>;

export async function enqueueProcessOccurrence(
  queue: AutoAbsenceQueue,
  balletScheduleId: number,
  classDate: string,
  delayMs: number,
): Promise<"enqueued" | "duplicate"> {
  const jobId = balletAbsenceOccurrenceJobId(balletScheduleId, classDate);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry();
      return "enqueued";
    }
    return "duplicate";
  }
  await queue.add(
    "process_occurrence",
    { type: "process_occurrence", balletScheduleId, classDate, source: "scheduler" } satisfies BalletAutoAbsenceJob,
    { ...defaultJobOptions(), delay: Math.max(0, delayMs), jobId },
  );
  return "enqueued";
}

export async function enqueueAbsencePushDelivery(
  notificationId: number,
  queueOverride?: AutoAbsenceQueue | null,
): Promise<"enqueued" | "duplicate" | "unavailable"> {
  const queue = queueOverride === undefined
    ? getQueue(QUEUE_NAMES.balletAutoAbsence)
    : queueOverride;
  if (!queue) return "unavailable";
  const jobId = balletAbsencePushJobId(notificationId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry();
      return "enqueued";
    }
    return "duplicate";
  }
  await queue.add(
    "deliver_absence_push",
    { type: "deliver_absence_push", notificationId, source: "scheduler" } satisfies BalletAutoAbsenceJob,
    { ...defaultJobOptions(), jobId },
  );
  return "enqueued";
}
