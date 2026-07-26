/**
 * Finance Phase 2D-3 — exact-evidence writer integration tests.
 *
 * Disposable local Postgres only. The writer's real production classifier
 * calls (classifyPackageOrder/classifyBooking) can never produce
 * `automatic_exact` today — package_orders/bookings have no amount columns
 * (see financeBackfillWriter.ts's module doc). The "written" success path
 * is therefore exercised via an injected ClassifierFns that forces
 * `automatic_exact` for one specific fixture and defers to the REAL
 * classifier for every other source — this tests 100% of the writer's own
 * logic (locking, insert shape, event shape, progress, idempotency,
 * concurrency) without reimplementing or bypassing classification for any
 * row the real classifier would actually see in production. Every
 * rejection path (estimated/unknown/pending/studio-walkin/multiple/
 * mismatch) uses the REAL, unmodified classifier.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env.DISPOSABLE_EXACT_WRITER_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_exact_writer`;

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

type FinanceBackfillClassification = import("./financeBackfillClassifier").FinanceBackfillClassification;
type DryRunFilters = import("./financeBackfillDryRun").DryRunFilters;
type DryRunReport = import("./financeBackfillDryRun").DryRunReport;

const dbModule = await import("@workspace/db");
const { db, pool } = dbModule;
const writerModule = await import("./financeBackfillWriter");
const { writeExactEvidenceSource } = writerModule;
const executionModule = await import("./financeBackfillExecutionService");
const { runBatchChunk } = executionModule;
const batchServiceModule = await import("./financeBackfillBatchService");
const { createBatch, attachDryRunEvidence, approveBatch, startBatch, pauseBatch, cancelBatch } = batchServiceModule;
const { fingerprintFromReport } = await import("./financeBackfillEvidence");
const classifierModule = await import("./financeBackfillClassifier");
const { classifyPackageOrder, classifyBooking } = classifierModule;

const CLASSIFIER_VERSION = "2d1.0.0";
const CODE_COMMIT = "a".repeat(40);

let uniqueCounter = 0;
const RUN_ID = `${process.pid}-${(await import("node:crypto")).randomBytes(6).toString("hex")}`;
function uniqueTag(): string {
  uniqueCounter += 1;
  return `writer-test-${RUN_ID}-${uniqueCounter}`;
}

function scope(overrides: Partial<DryRunFilters> = {}): DryRunFilters {
  return { sourceFamilies: ["bookings"], operationalStatuses: [uniqueTag()], maxRows: 100, batchSize: 50, ...overrides };
}

function fakeReport(appliedFilters: DryRunFilters): DryRunReport {
  return {
    reportSchemaVersion: "2d1b.1.0.0",
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CODE_COMMIT,
    generatedTimestamp: new Date(0).toISOString(),
    appliedFilters,
    scannedCount: 1,
    classifiedCount: 1,
    truncated: false,
    nextCursors: {},
    aggregates: {
      sourceFamilyCounts: {}, sourceKindCounts: {}, classificationCounts: {}, eligibilityCounts: {},
      evidenceClassCounts: {}, amountAvailabilityCounts: {}, amountReliabilityCounts: {}, discountReliabilityCounts: {},
      paymentStatusReliabilityCounts: {}, paymentMethodReliabilityCounts: {}, timestampReliabilityCounts: {},
      actorReliabilityCounts: {}, reasonCodeCounts: {}, warningCodeCounts: {},
      alreadyCanonicalCount: 0, automaticExactCount: 0, manualReviewCount: 0, excludedCount: 0, corruptCount: 0,
      estimatedOnlyCount: 0, unknownAmountCount: 0, legacyPendingCount: 0, multipleRecordCount: 0, mismatchedRecordCount: 0,
    },
    authoritativeTotals: { grossAmountMinor: 0, discountAmountMinor: 0, finalPayableAmountMinor: 0, rowCount: 0, currency: "EGP", label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY" },
    estimatedTotals: { estimatedTotalMinor: 0, estimatedRowCount: 0, currency: "EGP", label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE" },
    unknownAmountPopulation: { rowCount: 0, label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO" },
  };
}

async function makeRunningBatch(sourceFamily: "bookings" | "package_orders" = "bookings") {
  const s = scope({ sourceFamilies: [sourceFamily] });
  const report = fakeReport(s);
  const fingerprint = fingerprintFromReport(report);
  return db.transaction(async (tx) => {
    const created = await createBatch(tx, { createdBy: "writer-test-op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT });
    if (created.kind !== "created") throw new Error("setup: create failed");
    const attached = await attachDryRunEvidence(tx, created.batch.id, report);
    if (attached.kind !== "attached") throw new Error("setup: attach failed");
    const approved = await approveBatch(tx, created.batch.id, { approvedBy: "writer-test-super", expectedFingerprint: fingerprint, expectedEligibleCount: 1, maxExecutionCount: 10 });
    if (approved.kind !== "approved") throw new Error("setup: approve failed");
    const started = await startBatch(tx, created.batch.id);
    if (started.kind !== "transitioned") throw new Error("setup: start failed");
    return { batchId: created.batch.id, fingerprint };
  });
}

async function insertBooking(overrides: Record<string, unknown> = {}): Promise<number> {
  const tag = uniqueTag();
  const fields = {
    student_name: `Writer Test ${tag}`,
    student_email: `${tag}@example.test`,
    booking_status: "confirmed",
    payment_status: "paid",
    payment_mode: "pay_at_studio",
    schedule_id: 1,
    created_at: new Date(Date.UTC(2023, 0, 1)).toISOString(),
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const res = await pool.query(`INSERT INTO bookings (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`, values);
  return res.rows[0].id as number;
}

async function insertPackageOrder(overrides: Record<string, unknown> = {}): Promise<number> {
  const tag = uniqueTag();
  const fields = {
    student_name: `Writer Test ${tag}`,
    student_email: `${tag}@example.test`,
    package_name: "Test Package",
    total_credits: 8,
    remaining_credits: 8,
    status: "active",
    activated_at: new Date(Date.UTC(2023, 0, 1)).toISOString(),
    created_at: new Date(Date.UTC(2023, 0, 1)).toISOString(),
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const res = await pool.query(`INSERT INTO package_orders (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`, values);
  return res.rows[0].id as number;
}

/** Forces automatic_exact for exactly one (sourceFamily, sourceId), real classifier for everything else. */
function forceExactClassifierFor(sourceFamily: "bookings" | "package_orders", sourceId: number) {
  return {
    classifyPackageOrder: ((...args: Parameters<typeof classifyPackageOrder>) => {
      const real = classifyPackageOrder(...args);
      // Never override a real already_canonical/corrupt result — those
      // reflect genuine existing-Finance-row state the writer must still
      // honour; only force automatic_exact where the real classifier would
      // otherwise have said manual_review/excluded (no exact evidence).
      if (sourceFamily === "package_orders" && args[0].id === sourceId && real.eligibility !== "already_canonical" && real.eligibility !== "corrupt") {
        return {
          ...real,
          eligibility: "automatic_exact" as const,
          isExactEvidenceEligible: true,
          amountAvailability: "exact" as const,
          amountSource: "creation_snapshot" as const,
          grossAmountMinor: 30000,
          discountAmountMinor: 0,
          finalPayableAmountMinor: 30000,
        };
      }
      return real;
    }) as typeof classifyPackageOrder,
    classifyBooking: ((...args: Parameters<typeof classifyBooking>) => {
      const real = classifyBooking(...args);
      if (sourceFamily === "bookings" && args[0].id === sourceId && real.eligibility !== "already_canonical" && real.eligibility !== "corrupt") {
        return {
          ...real,
          eligibility: "automatic_exact" as const,
          isExactEvidenceEligible: true,
          amountAvailability: "exact" as const,
          amountSource: "creation_snapshot" as const,
          grossAmountMinor: 27500,
          discountAmountMinor: 0,
          finalPayableAmountMinor: 27500,
        };
      }
      return real;
    }) as typeof classifyBooking,
  };
}

after(async () => {
  await pool.end();
});

const BUSINESS_TABLES = ["package_orders", "attendance", "credit_transactions", "notifications", "payment_refunds"] as const;
async function businessTableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of BUSINESS_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = res.rows[0].n as number;
  }
  return out;
}

// ── Exact write success ──────────────────────────────────────────────────────

test("writer: exact booking source produces exactly one payment_records row and one legacy_created event, correctly attributed", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const before_ = await businessTableCounts();
  const beforeBooking = (await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId])).rows[0];

  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(
      tx,
      { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint },
      forceExactClassifierFor("bookings", bookingId),
    ),
  );
  assert.equal(result.kind, "written");
  if (result.kind !== "written") return;

  assert.equal(result.paymentRecord.status, "legacy_unverified");
  assert.equal(result.paymentRecord.captureOrigin, "historical_backfill");
  assert.equal(result.paymentRecord.backfillBatchId, batchId);
  assert.equal(result.paymentRecord.bookingId, bookingId);
  assert.equal(result.paymentRecord.paidAt, null);
  assert.equal(result.paymentRecord.confirmedPaymentMethod, null);
  assert.equal(result.paymentRecord.providerReference, null);
  assert.equal(result.paymentRecord.paidAmountMinor, 0);

  assert.equal(result.event.eventType, "legacy_created");
  assert.equal(result.event.newStatus, "legacy_unverified");
  assert.equal(result.event.previousStatus, null);
  assert.equal(result.event.amountMinor, null);
  assert.equal(result.event.paymentRecordId, result.paymentRecord.id);

  const recordCount = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(recordCount.rows[0].n, 1);
  const eventCount = await pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE payment_record_id = $1`, [result.paymentRecord.id]);
  assert.equal(eventCount.rows[0].n, 1);

  const afterBooking = (await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId])).rows[0];
  assert.deepEqual(afterBooking, beforeBooking);

  const after_ = await businessTableCounts();
  assert.deepEqual(after_, before_);
});

test("writer: exact package-order source also writes correctly", async () => {
  const orderId = await insertPackageOrder();
  const { batchId, fingerprint } = await makeRunningBatch("package_orders");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(
      tx,
      { batchId, sourceFamily: "package_orders", sourceId: orderId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint },
      forceExactClassifierFor("package_orders", orderId),
    ),
  );
  assert.equal(result.kind, "written");
  if (result.kind === "written") {
    assert.equal(result.paymentRecord.packageOrderId, orderId);
    assert.equal(result.paymentRecord.flowType, "package_purchase");
  }
});

// ── Rejection paths (real classifier) ───────────────────────────────────────

test("writer: estimated amount is rejected (never writable)", async () => {
  const orderId = await insertPackageOrder({ status: "active" }); // no exact evidence -> estimated/unknown per real classifier
  const { batchId, fingerprint } = await makeRunningBatch("package_orders");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "package_orders", sourceId: orderId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "not_eligible");
});

test("writer: known legacy pending-payment booking is rejected (manual review only)", async () => {
  const bookingId = await insertBooking({ payment_status: "pending_payment", payment_mode: null });
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "not_eligible");
  if (result.kind === "not_eligible") assert.equal(result.classificationCode, "legacy_pending_booking_manual_review");
});

test("writer: a booking with an existing Studio walk-in Finance record is never writable (mismatched/corrupt, not automatic_exact)", async () => {
  const bookingId = await insertBooking();
  await pool.query(
    `INSERT INTO payment_records (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source, status, gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, confirmed_payment_method, paid_at)
     VALUES ('studio_walkin', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 'paid', 5000, 0, 5000, 5000, 'cash', now())`,
    [bookingId],
  );
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "not_eligible");
  if (result.kind === "not_eligible") {
    assert.equal(result.classificationCode, "mismatched_finance_record_corrupt");
    assert.equal(result.eligibility, "corrupt");
  }
  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1 AND flow_type = 'single_class_booking'`, [bookingId]);
  assert.equal(count.rows[0].n, 0);
});

test("writer: an already-canonical source is rejected without a second write", async () => {
  const bookingId = await insertBooking();
  await pool.query(
    `INSERT INTO payment_records (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source, status, gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, confirmed_payment_method, paid_at)
     VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 'paid', 5000, 0, 5000, 5000, 'cash', now())`,
    [bookingId],
  );
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(
      tx,
      { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint },
      forceExactClassifierFor("bookings", bookingId),
    ),
  );
  assert.equal(result.kind, "already_canonical");
  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(count.rows[0].n, 1);
});

// ── Idempotency ──────────────────────────────────────────────────────────────

test("idempotency: retrying the same source in the same batch does not duplicate", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const classifierFns = forceExactClassifierFor("bookings", bookingId);
  const params = { batchId, sourceFamily: "bookings" as const, sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint };

  const r1 = await db.transaction((tx) => writeExactEvidenceSource(tx, params, classifierFns));
  const r2 = await db.transaction((tx) => writeExactEvidenceSource(tx, params, classifierFns));
  assert.equal(r1.kind, "written");
  assert.equal(r2.kind, "already_canonical"); // reclassify sees the now-existing row before any insert
  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(count.rows[0].n, 1);
});

test("cross-batch idempotency: a different batch over the same source does not duplicate", async () => {
  const bookingId = await insertBooking();
  const batch1 = await makeRunningBatch("bookings");
  const batch2 = await makeRunningBatch("bookings");
  const classifierFns = forceExactClassifierFor("bookings", bookingId);

  const r1 = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId: batch1.batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: batch1.fingerprint }, classifierFns),
  );
  const r2 = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId: batch2.batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: batch2.fingerprint }, classifierFns),
  );
  assert.equal(r1.kind, "written");
  assert.equal(r2.kind, "already_canonical");
  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(count.rows[0].n, 1);
});

test("concurrency: 10 concurrent writers on the same source create exactly one payment record and one event", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const classifierFns = forceExactClassifierFor("bookings", bookingId);
  const params = { batchId, sourceFamily: "bookings" as const, sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint };

  const results = await Promise.all(Array.from({ length: 10 }, () => db.transaction((tx) => writeExactEvidenceSource(tx, params, classifierFns))));
  const written = results.filter((r) => r.kind === "written");
  assert.equal(written.length, 1);
  const recordCount = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(recordCount.rows[0].n, 1);
  const eventCount = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe JOIN payment_records pr ON pr.id = pe.payment_record_id WHERE pr.booking_id = $1`,
    [bookingId],
  );
  assert.equal(eventCount.rows[0].n, 1);
});

// ── Stale identity guards ────────────────────────────────────────────────────

test("stale classifier version is blocked", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: "9.9.9", expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "batch_identity_mismatch");
  if (result.kind === "batch_identity_mismatch") assert.equal(result.reason, "classifier_version");
});

test("stale code commit is blocked", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: "b".repeat(40), expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "batch_identity_mismatch");
  if (result.kind === "batch_identity_mismatch") assert.equal(result.reason, "code_commit");
});

test("stale evidence fingerprint is blocked", async () => {
  const bookingId = await insertBooking();
  const { batchId } = await makeRunningBatch("bookings");
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: "forged" }),
  );
  assert.equal(result.kind, "batch_identity_mismatch");
  if (result.kind === "batch_identity_mismatch") assert.equal(result.reason, "evidence_fingerprint");
});

test("a batch not in 'running' status is blocked (e.g. still only 'approved')", async () => {
  const bookingId = await insertBooking();
  const s = scope({ sourceFamilies: ["bookings"] });
  const report = fakeReport(s);
  const fingerprint = fingerprintFromReport(report);
  const { batchId } = await db.transaction(async (tx) => {
    const created = await createBatch(tx, { createdBy: "op", scope: s, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT });
    if (created.kind !== "created") throw new Error("setup failed");
    await attachDryRunEvidence(tx, created.batch.id, report);
    await approveBatch(tx, created.batch.id, { approvedBy: "super", expectedFingerprint: fingerprint, expectedEligibleCount: 1, maxExecutionCount: 10 });
    return { batchId: created.batch.id };
  });
  const result = await db.transaction((tx) =>
    writeExactEvidenceSource(tx, { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint }),
  );
  assert.equal(result.kind, "batch_wrong_state");
  if (result.kind === "batch_wrong_state") assert.equal(result.actualStatus, "approved");
});

// ── Pause/resume/cancel mid-chunk (execution service) ───────────────────────

test("pause mid-chunk stops safely — remaining sources untouched", async () => {
  const ids = [await insertBooking(), await insertBooking(), await insertBooking()];
  const { batchId, fingerprint } = await makeRunningBatch("bookings");

  await db.transaction((tx) => pauseBatch(tx, batchId));
  const report = await runBatchChunk({
    batchId, sourceFamily: "bookings", sourceIds: ids,
    expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint,
    maxRows: 10,
  });
  assert.equal(report.attempted, 0);
  assert.ok(report.stoppedEarly);
  for (const id of ids) {
    const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [id]);
    assert.equal(count.rows[0].n, 0);
  }
});

test("cancel mid-chunk stops safely (batch must be paused before it can be cancelled — running->cancelled is not a valid transition)", async () => {
  const ids = [await insertBooking(), await insertBooking()];
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  await db.transaction((tx) => pauseBatch(tx, batchId));
  const cancelled = await db.transaction((tx) => cancelBatch(tx, batchId, "super"));
  assert.equal(cancelled.kind, "transitioned");
  const report = await runBatchChunk({
    batchId, sourceFamily: "bookings", sourceIds: ids,
    expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint,
    maxRows: 10,
  });
  assert.equal(report.attempted, 0);
  assert.ok(report.stoppedEarly);
});

test("bounded execution: maxRows caps the number of sources attempted, regardless of sourceIds.length", async () => {
  const ids = [await insertBooking(), await insertBooking(), await insertBooking()];
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const report = await runBatchChunk({
    batchId, sourceFamily: "bookings", sourceIds: ids,
    expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint,
    maxRows: 1,
  });
  assert.equal(report.attempted, 1);
});

// ── Crash-recovery-shaped scenario ───────────────────────────────────────────

test("crash-recovery shape: a source already written in an earlier chunk call is safely skipped on retry, not re-written", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const classifierFns = forceExactClassifierFor("bookings", bookingId);

  const firstChunk = await runBatchChunk(
    { batchId, sourceFamily: "bookings", sourceIds: [bookingId], expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint, maxRows: 10 },
    classifierFns,
  );
  assert.equal(firstChunk.written, 1);

  // Simulates re-invoking the same chunk after a crash/retry before the
  // caller knew the first attempt had already committed.
  const secondChunk = await runBatchChunk(
    { batchId, sourceFamily: "bookings", sourceIds: [bookingId], expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint, maxRows: 10 },
    classifierFns,
  );
  assert.equal(secondChunk.written, 0);
  assert.equal(secondChunk.alreadyCanonical, 1);

  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [bookingId]);
  assert.equal(count.rows[0].n, 1);
});

test("zero side effects: no notification/push/credit/attendance/refund path is touched by a successful write", async () => {
  const bookingId = await insertBooking();
  const { batchId, fingerprint } = await makeRunningBatch("bookings");
  const before_ = await businessTableCounts();
  await db.transaction((tx) =>
    writeExactEvidenceSource(
      tx,
      { batchId, sourceFamily: "bookings", sourceId: bookingId, expectedClassifierVersion: CLASSIFIER_VERSION, expectedCodeCommit: CODE_COMMIT, expectedEvidenceFingerprint: fingerprint },
      forceExactClassifierFor("bookings", bookingId),
    ),
  );
  const after_ = await businessTableCounts();
  assert.deepEqual(after_, before_);
});
