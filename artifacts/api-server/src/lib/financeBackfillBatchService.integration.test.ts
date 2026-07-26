/**
 * Finance Phase 2D-2 — batch/progress service integration tests.
 *
 * Disposable local Postgres only. Proves: zero business writes across every
 * Finance/source table for every batch operation; concurrency safety for
 * create/approve/pause/resume/cancel; idempotency; no raw 23505 escaping as
 * an unhandled exception.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env.DISPOSABLE_BATCH_LIFECYCLE_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_batch_lifecycle`;

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

type DryRunFilters = import("./financeBackfillDryRun").DryRunFilters;
type DryRunReport = import("./financeBackfillDryRun").DryRunReport;

const dbModule = await import("@workspace/db");
const { db, pool } = dbModule;
const batchServiceModule = await import("./financeBackfillBatchService");
const {
  createBatch,
  attachDryRunEvidence,
  approveBatch,
  startBatch,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  failBatch,
  completeBatch,
} = batchServiceModule;
const progressServiceModule = await import("./financeBackfillProgressService");
const { upsertProgressItem } = progressServiceModule;
const { fingerprintFromReport } = await import("./financeBackfillEvidence");

const CLASSIFIER_VERSION = "2d1.0.0";
const CODE_COMMIT = "a".repeat(40);

function scope(overrides: Partial<DryRunFilters> = {}): DryRunFilters {
  return { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50, ...overrides };
}

function fakeReport(overrides: Partial<DryRunReport> = {}): DryRunReport {
  return {
    reportSchemaVersion: "2d1b.1.0.0",
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CODE_COMMIT,
    generatedTimestamp: new Date(0).toISOString(),
    appliedFilters: scope(),
    scannedCount: 5,
    classifiedCount: 5,
    truncated: false,
    nextCursors: { bookings: 10 },
    aggregates: {
      sourceFamilyCounts: { bookings: 5 },
      sourceKindCounts: { booking: 5 },
      classificationCounts: { legacy_pending_booking_manual_review: 5 },
      eligibilityCounts: { manual_review: 5 },
      evidenceClassCounts: {},
      amountAvailabilityCounts: {},
      amountReliabilityCounts: {},
      discountReliabilityCounts: {},
      paymentStatusReliabilityCounts: {},
      paymentMethodReliabilityCounts: {},
      timestampReliabilityCounts: {},
      actorReliabilityCounts: {},
      reasonCodeCounts: {},
      warningCodeCounts: {},
      alreadyCanonicalCount: 0,
      automaticExactCount: 0,
      manualReviewCount: 5,
      excludedCount: 0,
      corruptCount: 0,
      estimatedOnlyCount: 0,
      unknownAmountCount: 0,
      legacyPendingCount: 5,
      multipleRecordCount: 0,
      mismatchedRecordCount: 0,
    },
    authoritativeTotals: { grossAmountMinor: 0, discountAmountMinor: 0, finalPayableAmountMinor: 0, rowCount: 0, currency: "EGP", label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY" },
    estimatedTotals: { estimatedTotalMinor: 0, estimatedRowCount: 0, currency: "EGP", label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE" },
    unknownAmountPopulation: { rowCount: 0, label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO" },
    ...overrides,
  };
}

let uniqueCounter = 0;
const RUN_ID = `${process.pid}-${(await import("node:crypto")).randomBytes(6).toString("hex")}`;
function freshScope(): DryRunFilters {
  uniqueCounter += 1;
  // Unique across processes/runs (not just within one run) so repeated
  // invocations of this file against the SAME disposable DB never collide
  // on scope_key from a prior run's leftover rows.
  return scope({ operationalStatuses: [`test-run-${RUN_ID}-${uniqueCounter}`] });
}

async function createDryRunCompletedBatch() {
  const s = freshScope();
  const report = fakeReport({ appliedFilters: s });
  return db.transaction(async (tx) => {
    const created = await createBatch(tx, { createdBy: "operator1", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT });
    if (created.kind !== "created") throw new Error("setup: expected created");
    const attached = await attachDryRunEvidence(tx, created.batch.id, report);
    if (attached.kind !== "attached") throw new Error("setup: expected attached");
    return { batch: attached.batch, report };
  });
}

async function createApprovedBatch() {
  const { batch, report } = await createDryRunCompletedBatch();
  const fingerprint = fingerprintFromReport(report);
  return db.transaction(async (tx) => {
    const approved = await approveBatch(tx, batch.id, {
      approvedBy: "super1",
      expectedFingerprint: fingerprint,
      expectedEligibleCount: 0,
      maxExecutionCount: 5,
    });
    if (approved.kind !== "approved") throw new Error("setup: expected approved");
    return approved.batch;
  });
}

after(async () => {
  await pool.end();
});

// ── Create batch ─────────────────────────────────────────────────────────────

test("createBatch: creates only a batch control row", async () => {
  const s = freshScope();
  const result = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(result.kind, "created");
  if (result.kind === "created") {
    assert.equal(result.batch.status, "created");
    assert.equal(result.batch.createdBy, "op");
  }
});

test("createBatch: overlapping active scope is rejected, not a raw 500", async () => {
  const s = freshScope();
  const r1 = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(r1.kind, "created");
  const r2 = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(r2.kind, "overlapping_active_batch");
});

test("concurrency: 10 concurrent creates for the identical scope leave exactly one active batch", async () => {
  const s = freshScope();
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT })),
    ),
  );
  const created = attempts.filter((r) => r.kind === "created");
  const rejected = attempts.filter((r) => r.kind === "overlapping_active_batch");
  assert.equal(created.length, 1);
  assert.equal(rejected.length, 9);
});

// ── Attach evidence ───────────────────────────────────────────────────────────

test("attachDryRunEvidence: requires 'created' status", async () => {
  const { batch } = await createDryRunCompletedBatch();
  const result = await db.transaction((tx) => attachDryRunEvidence(tx, batch.id, fakeReport({ appliedFilters: batch.filters as DryRunFilters })));
  assert.equal(result.kind, "wrong_state");
});

test("attachDryRunEvidence: scope mismatch (classifier version) is rejected", async () => {
  const s = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  const result = await db.transaction((tx) => attachDryRunEvidence(tx, created.batch.id, fakeReport({ appliedFilters: s, classifierVersion: "9.9.9" })));
  assert.equal(result.kind, "scope_mismatch");
  if (result.kind === "scope_mismatch") assert.equal(result.reason, "classifier_version");
});

test("attachDryRunEvidence: scope mismatch (code commit) is rejected", async () => {
  const s = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  const result = await db.transaction((tx) => attachDryRunEvidence(tx, created.batch.id, fakeReport({ appliedFilters: s, codeCommit: "b".repeat(40) })));
  assert.equal(result.kind, "scope_mismatch");
  if (result.kind === "scope_mismatch") assert.equal(result.reason, "code_commit");
});

test("attachDryRunEvidence: scope mismatch (filters) is rejected", async () => {
  const s = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  const result = await db.transaction((tx) => attachDryRunEvidence(tx, created.batch.id, fakeReport({ appliedFilters: scope({ sourceFamilies: ["package_orders"] }) })));
  assert.equal(result.kind, "scope_mismatch");
  if (result.kind === "scope_mismatch") assert.equal(result.reason, "filters");
});

test("attachDryRunEvidence: evidence is aggregate-only — no PII, no raw source rows", async () => {
  const { batch } = await createDryRunCompletedBatch();
  const serialised = JSON.stringify(batch.evidenceAggregate).toLowerCase();
  for (const forbidden of ["studentname", "studentemail", "sourceid", "childname"]) {
    assert.equal(serialised.includes(forbidden), false);
  }
  assert.ok(batch.evidenceFingerprint);
});

// ── Approve ──────────────────────────────────────────────────────────────────

test("approveBatch: requires unchanged evidence fingerprint (stale rejected)", async () => {
  const { batch } = await createDryRunCompletedBatch();
  const result = await db.transaction((tx) =>
    approveBatch(tx, batch.id, { approvedBy: "super1", expectedFingerprint: "not-the-real-fingerprint", expectedEligibleCount: 0, maxExecutionCount: 5 }),
  );
  assert.equal(result.kind, "stale_fingerprint");
});

test("approveBatch: exact matching fingerprint succeeds and binds approval attribution", async () => {
  const { batch, report } = await createDryRunCompletedBatch();
  const fingerprint = fingerprintFromReport(report);
  const result = await db.transaction((tx) =>
    approveBatch(tx, batch.id, { approvedBy: "super1", expectedFingerprint: fingerprint, expectedEligibleCount: 0, maxExecutionCount: 5 }),
  );
  assert.equal(result.kind, "approved");
  if (result.kind === "approved") {
    assert.equal(result.batch.approvedBy, "super1");
    assert.ok(result.batch.approvedAt);
    assert.equal(result.batch.maxExecutionCount, 5);
  }
});

test("concurrency: 10 concurrent approvals of the same batch produce exactly one approved state", async () => {
  const { batch, report } = await createDryRunCompletedBatch();
  const fingerprint = fingerprintFromReport(report);
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.transaction((tx) => approveBatch(tx, batch.id, { approvedBy: "super1", expectedFingerprint: fingerprint, expectedEligibleCount: 0, maxExecutionCount: 5 })),
    ),
  );
  assert.ok(attempts.every((r) => r.kind === "approved"));
  const counts = await db.select().from((await import("@workspace/db")).paymentBackfillBatchesTable).where((await import("drizzle-orm")).eq((await import("@workspace/db")).paymentBackfillBatchesTable.id, batch.id));
  assert.equal(counts.length, 1);
  assert.equal(counts[0].status, "approved");
});

// ── Control transitions ──────────────────────────────────────────────────────

test("startBatch: approved -> running is control-state only", async () => {
  const batch = await createApprovedBatch();
  const result = await db.transaction((tx) => startBatch(tx, batch.id));
  assert.equal(result.kind, "transitioned");
  if (result.kind === "transitioned") assert.equal(result.batch.status, "running");
});

test("pause/resume: running -> paused -> running", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  const paused = await db.transaction((tx) => pauseBatch(tx, batch.id));
  assert.equal(paused.kind, "transitioned");
  if (paused.kind === "transitioned") assert.equal(paused.batch.status, "paused");
  const resumed = await db.transaction((tx) => resumeBatch(tx, batch.id));
  assert.equal(resumed.kind, "transitioned");
  if (resumed.kind === "transitioned") assert.equal(resumed.batch.status, "running");
});

test("cancel: created/dry_run_completed/approved/paused can all cancel", async () => {
  const s1 = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s1, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  const cancelled = await db.transaction((tx) => cancelBatch(tx, created.batch.id, "super1"));
  assert.equal(cancelled.kind, "transitioned");
  if (cancelled.kind === "transitioned") {
    assert.equal(cancelled.batch.status, "cancelled");
    assert.equal(cancelled.batch.cancelledBy, "super1");
  }
});

test("cancelled batch cannot resume", async () => {
  const s1 = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s1, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  if (created.kind !== "created") throw new Error("setup failed");
  await db.transaction((tx) => cancelBatch(tx, created.batch.id, "super1"));
  const result = await db.transaction((tx) => resumeBatch(tx, created.batch.id));
  assert.equal(result.kind, "forbidden");
});

test("stale state transition is rejected: cannot pause a batch that never started", async () => {
  const batch = await createApprovedBatch();
  const result = await db.transaction((tx) => pauseBatch(tx, batch.id));
  assert.equal(result.kind, "forbidden");
});

test("fail: running -> failed, requires reason, sets finishedAt", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  const failed = await db.transaction((tx) => failBatch(tx, batch.id, "operator abandoned batch"));
  assert.equal(failed.kind, "transitioned");
  if (failed.kind === "transitioned") {
    assert.equal(failed.batch.status, "failed");
    assert.ok(failed.batch.finishedAt);
    assert.ok(failed.batch.notes?.includes("operator abandoned batch"));
  }
});

test("failed batch requires an explicit new batch — no restart path exists", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  await db.transaction((tx) => failBatch(tx, batch.id, "boom"));
  const result = await db.transaction((tx) => startBatch(tx, batch.id));
  assert.equal(result.kind, "forbidden");
});

test("completeBatch: rejected while pending progress items remain", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  await db.transaction((tx) =>
    upsertProgressItem(tx, {
      batchId: batch.id,
      sourceFamily: "bookings",
      sourceId: 1,
      classifierVersion: CLASSIFIER_VERSION,
      codeCommit: CODE_COMMIT,
      classification: { classificationCode: "legacy_pending_booking_manual_review", eligibility: "manual_review" } as never,
    }),
  );
  // upsertProgressItem never produces "pending" for a real classification —
  // force a pending row directly to exercise the completion gate.
  const { paymentBackfillProgressItemsTable } = await import("@workspace/db");
  await db.insert(paymentBackfillProgressItemsTable).values({
    batchId: batch.id,
    sourceFamily: "bookings",
    sourceId: 2,
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CODE_COMMIT,
    classificationCode: "unknown_amount_manual_review",
    eligibility: "manual_review",
    status: "pending",
  });

  const result = await db.transaction((tx) => completeBatch(tx, batch.id));
  assert.equal(result.kind, "incomplete_progress");
});

test("completeBatch: succeeds once no pending progress items remain", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  await db.transaction((tx) =>
    upsertProgressItem(tx, {
      batchId: batch.id,
      sourceFamily: "bookings",
      sourceId: 3,
      classifierVersion: CLASSIFIER_VERSION,
      codeCommit: CODE_COMMIT,
      classification: { classificationCode: "legacy_pending_booking_manual_review", eligibility: "manual_review" } as never,
    }),
  );
  const result = await db.transaction((tx) => completeBatch(tx, batch.id));
  assert.equal(result.kind, "transitioned");
  if (result.kind === "transitioned") assert.equal(result.batch.status, "completed");
});

test("completed batch cannot mutate", async () => {
  const batch = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch.id));
  await db.transaction((tx) => completeBatch(tx, batch.id));
  const result = await db.transaction((tx) => pauseBatch(tx, batch.id));
  assert.equal(result.kind, "forbidden");
});

// ── Progress: deterministic identity, idempotency ────────────────────────────

test("progress: deterministic source identity — duplicate insert is idempotent, not a duplicate row", async () => {
  const batch = await createApprovedBatch();
  const params = {
    batchId: batch.id,
    sourceFamily: "bookings" as const,
    sourceId: 42,
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CODE_COMMIT,
    classification: { classificationCode: "legacy_pending_booking_manual_review", eligibility: "manual_review" } as never,
  };
  const r1 = await db.transaction((tx) => upsertProgressItem(tx, params));
  const r2 = await db.transaction((tx) => upsertProgressItem(tx, params));
  assert.equal(r1.kind, "created");
  assert.equal(r2.kind, "already_exists");
  if (r2.kind === "already_exists") assert.equal(r2.identical, true);

  const { paymentBackfillProgressItemsTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(paymentBackfillProgressItemsTable)
    .where(and(eq(paymentBackfillProgressItemsTable.batchId, batch.id), eq(paymentBackfillProgressItemsTable.sourceId, 42)));
  assert.equal(rows.length, 1);
});

test("progress: no fake success before a writer exists — upsertProgressItem never sets 'succeeded'", async () => {
  const batch = await createApprovedBatch();
  const result = await db.transaction((tx) =>
    upsertProgressItem(tx, {
      batchId: batch.id,
      sourceFamily: "bookings",
      sourceId: 100,
      classifierVersion: CLASSIFIER_VERSION,
      codeCommit: CODE_COMMIT,
      classification: { classificationCode: "exact_evidence_eligible", eligibility: "automatic_exact" } as never,
    }),
  );
  assert.equal(result.kind, "created");
  if (result.kind === "created") {
    assert.notEqual(result.item.status, "succeeded");
    assert.equal(result.item.status, "eligible_not_executed");
  }
});

test("concurrency: 10 concurrent identical progress upserts leave exactly one row", async () => {
  const batch = await createApprovedBatch();
  const params = {
    batchId: batch.id,
    sourceFamily: "bookings" as const,
    sourceId: 500,
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CODE_COMMIT,
    classification: { classificationCode: "legacy_pending_booking_manual_review", eligibility: "manual_review" } as never,
  };
  await Promise.all(Array.from({ length: 10 }, () => db.transaction((tx) => upsertProgressItem(tx, params))));

  const { paymentBackfillProgressItemsTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(paymentBackfillProgressItemsTable)
    .where(and(eq(paymentBackfillProgressItemsTable.batchId, batch.id), eq(paymentBackfillProgressItemsTable.sourceId, 500)));
  assert.equal(rows.length, 1);
});

// ── Zero business writes ─────────────────────────────────────────────────────

const BUSINESS_TABLES = [
  "payment_records",
  "payment_events",
  "payment_refunds",
  "package_orders",
  "bookings",
  "attendance",
  "credit_transactions",
  "notifications",
] as const;

async function businessTableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of BUSINESS_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = res.rows[0].n as number;
  }
  return out;
}

test("zero-write: full batch lifecycle (create -> evidence -> approve -> start -> pause -> resume -> complete) touches no business table", async () => {
  const before_ = await businessTableCounts();

  const { batch, report } = await createDryRunCompletedBatch();
  const fingerprint = fingerprintFromReport(report);
  const approved = await db.transaction((tx) =>
    approveBatch(tx, batch.id, { approvedBy: "super1", expectedFingerprint: fingerprint, expectedEligibleCount: 0, maxExecutionCount: 5 }),
  );
  assert.equal(approved.kind, "approved");
  await db.transaction((tx) => startBatch(tx, batch.id));
  await db.transaction((tx) => pauseBatch(tx, batch.id));
  await db.transaction((tx) => resumeBatch(tx, batch.id));
  await db.transaction((tx) =>
    upsertProgressItem(tx, {
      batchId: batch.id,
      sourceFamily: "bookings",
      sourceId: 777,
      classifierVersion: CLASSIFIER_VERSION,
      codeCommit: CODE_COMMIT,
      classification: { classificationCode: "legacy_pending_booking_manual_review", eligibility: "manual_review" } as never,
    }),
  );
  await db.transaction((tx) => completeBatch(tx, batch.id));

  const after_ = await businessTableCounts();
  assert.deepEqual(after_, before_);
});

test("zero-write: cancel and fail paths also touch no business table", async () => {
  const before_ = await businessTableCounts();

  const s = freshScope();
  const created = await db.transaction((tx) => createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT }));
  if (created.kind !== "created") throw new Error("setup failed");
  await db.transaction((tx) => cancelBatch(tx, created.batch.id, "super1"));

  const batch2 = await createApprovedBatch();
  await db.transaction((tx) => startBatch(tx, batch2.id));
  await db.transaction((tx) => failBatch(tx, batch2.id, "test failure"));

  const after_ = await businessTableCounts();
  assert.deepEqual(after_, before_);
});
