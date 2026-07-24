import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertValidBullMqCustomJobId,
  balletAbsenceOccurrenceJobId,
  balletAbsencePushJobId,
} from "./balletAutoAbsenceJobIds.ts";
import {
  enqueueAbsencePushDelivery,
  enqueueProcessOccurrence,
} from "./balletAutoAbsenceQueue.ts";

function fakeQueue() {
  const jobs = new Map<string, { getState(): Promise<string>; retry(): Promise<void> }>();
  const added: { name: string; jobId: string }[] = [];
  const queue = {
    getJob: async (jobId: string) => jobs.get(jobId) ?? null,
    add: async (name: string, _data: unknown, opts: { jobId?: string }) => {
      assert.ok(opts.jobId);
      const job = {
        getState: async () => "waiting",
        retry: async () => undefined,
      };
      jobs.set(opts.jobId, job);
      added.push({ name, jobId: opts.jobId });
      return job;
    },
  } as unknown as Parameters<typeof enqueueProcessOccurrence>[0];
  return { queue, added };
}

test("push job IDs are stable, distinct, and colon-free", () => {
  assert.equal(balletAbsencePushJobId(101), "ballet-absence-push-101");
  assert.equal(balletAbsencePushJobId(101), balletAbsencePushJobId(101));
  assert.notEqual(balletAbsencePushJobId(101), balletAbsencePushJobId(102));
  assert.equal(balletAbsencePushJobId(101).includes(":"), false);
});

test("occurrence job IDs preserve Schedule/date identity without colons", () => {
  assert.equal(
    balletAbsenceOccurrenceJobId(11, "2026-07-20"),
    "ballet-auto-absence-11-2026-07-20",
  );
  assert.equal(
    balletAbsenceOccurrenceJobId(11, "2026-07-20"),
    balletAbsenceOccurrenceJobId(11, "2026-07-20"),
  );
  assert.notEqual(
    balletAbsenceOccurrenceJobId(11, "2026-07-20"),
    balletAbsenceOccurrenceJobId(11, "2026-07-27"),
  );
  assert.notEqual(
    balletAbsenceOccurrenceJobId(11, "2026-07-20"),
    balletAbsenceOccurrenceJobId(12, "2026-07-20"),
  );
  assert.equal(balletAbsenceOccurrenceJobId(11, "2026-07-20").includes(":"), false);
});

test("custom-ID assertion rejects colons and builders reject noncanonical identity", () => {
  assert.throws(
    () => assertValidBullMqCustomJobId("ballet-absence-push:101"),
    /custom jobId must not contain ':'/,
  );
  assert.throws(() => balletAbsencePushJobId(0), /positive integer Notification ID/);
  assert.throws(() => balletAbsenceOccurrenceJobId(0, "2026-07-20"), /positive integer Schedule ID/);
  assert.throws(() => balletAbsenceOccurrenceJobId(11, "2026-02-30"), /canonical ISO class date/);
});

test("occurrence enqueue uses canonical IDs and deduplicates recovery repeats", async () => {
  const { queue, added } = fakeQueue();
  assert.equal(await enqueueProcessOccurrence(queue, 21, "2026-07-20", 0), "enqueued");
  assert.equal(await enqueueProcessOccurrence(queue, 21, "2026-07-20", 0), "duplicate");
  assert.equal(await enqueueProcessOccurrence(queue, 21, "2026-07-27", 0), "enqueued");
  assert.equal(await enqueueProcessOccurrence(queue, 22, "2026-07-20", 0), "enqueued");
  assert.deepEqual(added, [
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(21, "2026-07-20") },
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(21, "2026-07-27") },
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(22, "2026-07-20") },
  ]);
});

test("push enqueue uses canonical IDs and deduplicates reconciliation repeats", async () => {
  const { queue, added } = fakeQueue();
  assert.equal(await enqueueAbsencePushDelivery(301, queue), "enqueued");
  assert.equal(await enqueueAbsencePushDelivery(301, queue), "duplicate");
  assert.equal(await enqueueAbsencePushDelivery(302, queue), "enqueued");
  assert.deepEqual(added, [
    { name: "deliver_absence_push", jobId: balletAbsencePushJobId(301) },
    { name: "deliver_absence_push", jobId: balletAbsencePushJobId(302) },
  ]);
});
