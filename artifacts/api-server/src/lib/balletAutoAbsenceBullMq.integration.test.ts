import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  balletAbsenceOccurrenceJobId,
  balletAbsencePushJobId,
} from "./balletAutoAbsenceJobIds.ts";

const REDIS_URL = process.env.BULLMQ_TEST_REDIS_URL ?? "redis://127.0.0.1:6389";
const parsedRedisUrl = new URL(REDIS_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedRedisUrl.hostname)) {
  throw new Error("Refusing to run BullMQ integration test against non-local Redis");
}

const queueName = `ballet-auto-absence-job-id-test-${process.pid}-${Date.now()}`;
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 1_000,
  retryStrategy: () => null,
});
const queue = new Queue(queueName, { connection });

before(async () => {
  await connection.ping();
});

after(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await connection.quit().catch(() => connection.disconnect());
});

test("BullMQ 5.79.2 accepts safe deterministic IDs and Redis deduplicates repeats", async () => {
  const occurrenceId = balletAbsenceOccurrenceJobId(21, "2026-07-20");
  const otherOccurrenceId = balletAbsenceOccurrenceJobId(22, "2026-07-20");
  const pushId = balletAbsencePushJobId(301);

  const occurrence = await queue.add("process_occurrence", {}, { jobId: occurrenceId });
  const occurrenceRepeat = await queue.add("process_occurrence", {}, { jobId: occurrenceId });
  const otherOccurrence = await queue.add("process_occurrence", {}, { jobId: otherOccurrenceId });
  const push = await queue.add("deliver_absence_push", {}, { jobId: pushId });

  assert.equal(occurrence.id, occurrenceId);
  assert.equal(occurrenceRepeat.id, occurrenceId);
  assert.equal(otherOccurrence.id, otherOccurrenceId);
  assert.equal(push.id, pushId);

  const jobs = await queue.getJobs(["waiting", "delayed", "prioritized", "paused"]);
  assert.deepEqual(
    new Set(jobs.map((job) => job.id)),
    new Set([occurrenceId, otherOccurrenceId, pushId]),
  );
});

test("installed BullMQ rejects the former colon-containing push custom ID", async () => {
  await assert.rejects(
    queue.add("deliver_absence_push", {}, { jobId: "ballet-absence-push:301" }),
    /Custom Id cannot contain :/,
  );
});
