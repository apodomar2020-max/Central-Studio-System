/**
 * Phase B3B0-1A: atomic, provenance-aware student email-change service.
 *
 * Every production path that can CHANGE an existing student's email
 * (currently: Admin PATCH /students/:id in routes/students.ts) MUST call
 * this helper rather than issuing its own UPDATE, so provenance capture is
 * never duplicated or skipped by a future new writer.
 *
 * Semantics (single DB transaction):
 *  1. Lock the student row (SELECT ... FOR UPDATE), matching the exact
 *     locking pattern already used by students.ts's deactivate/reactivate
 *     routes.
 *  2. Read the old canonical (normalized) email.
 *  3. Normalize the requested new email.
 *  4. If normalized-new === normalized-old: this is NOT an identity change
 *     (only casing/whitespace differs, if anything) — no provenance interval
 *     churn. The raw students.email column is still updated so casing edits
 *     persist, but no interval is opened/closed and NO provenance write
 *     (and therefore no pepper read) occurs.
 *  5. Otherwise: close the currently-open interval for this student
 *     (validTo = now()), open a new one (validFrom = now(), validTo = null,
 *     newly computed fingerprint), then update students.email.
 *  6. Any failure (provenance insert, students.email update) rolls back the
 *     whole transaction automatically — there is nothing split across
 *     transactions here.
 *
 * IDENTITY_PROVENANCE_PEPPER is only read (via fingerprintStudentEmail) at
 * step 5, i.e. only when an ACTUAL identity-changing email mutation is about
 * to happen. A non-email-changing call (email undefined, or normalization-
 * equivalent) never touches the pepper and must succeed even if it's unset.
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, studentsTable, studentEmailIdentityHistoryTable, provenanceActivationTable } from "@workspace/db";
import { normalizeEmail } from "./membershipIdentity";
import { fingerprintStudentEmail } from "./studentEmailProvenance";

export type ProvenanceSource = "admin_update" | "registration" | "self_service" | "bootstrap";

export type StudentEmailChangeResult =
  | { kind: "notFound" }
  | { kind: "unchanged" } // no raw email field supplied, or exactly identical string
  | { kind: "recasedOnly" } // normalization-equivalent, raw casing/whitespace updated, no interval churn
  | { kind: "changed"; previousNormalizedEmail: string; newNormalizedEmail: string };

/**
 * Applies a (possibly absent) raw email change to a student within an
 * ALREADY-OPEN transaction (`tx`). Callers are responsible for opening the
 * transaction (e.g. via db.transaction) and for locking the row themselves
 * if they need the lock for other fields too — this helper re-locks
 * (FOR UPDATE) the student row itself defensively so it is safe to call
 * standalone as well.
 *
 * `rawEmail` is the NEW email value as submitted (undefined means "no email
 * field was part of this update at all" — a true no-op).
 */
export async function applyStudentEmailChange(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    studentId: number;
    rawEmail: string | undefined;
    source: ProvenanceSource;
    changedByAdminId?: number | null;
  },
): Promise<StudentEmailChangeResult> {
  const { studentId, rawEmail, source, changedByAdminId } = params;

  const [locked] = await tx
    .select({ id: studentsTable.id, email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .for("update")
    .limit(1);
  if (!locked) return { kind: "notFound" };

  if (rawEmail === undefined) {
    return { kind: "unchanged" };
  }

  const oldNormalized = normalizeEmail(locked.email);
  const newNormalized = normalizeEmail(rawEmail);

  if (newNormalized === oldNormalized) {
    // Identity-equivalent. Persist raw casing/whitespace changes (if any)
    // but do NOT touch provenance — no pepper read, no interval churn.
    if (rawEmail !== locked.email) {
      await tx.update(studentsTable).set({ email: rawEmail }).where(eq(studentsTable.id, studentId));
      return { kind: "recasedOnly" };
    }
    return { kind: "unchanged" };
  }

  // Real identity change: close current open interval (if any), open a new
  // one, then update students.email. All within the caller's transaction —
  // any failure here rolls back the whole thing, including any other field
  // updates the caller performs in the same transaction.
  const fingerprint = fingerprintStudentEmail(rawEmail);
  // Single transaction-consistent timestamp used for every write below —
  // the closed A-interval's validTo, the new B-interval's validFrom, and (if
  // this is a pre-T0 student's first tracked change) the synthesized
  // A-interval's validTo all read the SAME value. Never two separate now()
  // reads.
  const nowIso = new Date().toISOString();

  // Determine whether this student has ANY provenance history at all. Zero
  // rows is the signal for "pre-T0 student, first tracked change" — not a
  // date-based heuristic. A student with at least one row (open or closed)
  // already has real tracked history (possibly opened atomically at their
  // own creation time by openInitialProvenanceInterval, per Phase
  // B3B0-1A-completion Section F) and uses the ordinary close/open path.
  const [{ count: historyRowCount }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(studentEmailIdentityHistoryTable)
    .where(eq(studentEmailIdentityHistoryTable.studentId, studentId));

  if (historyRowCount === 0) {
    // Pre-T0 student, first tracked change. Per the binding design decision:
    // synthesize BOTH a closed interval for the OLD email (A), anchored at
    // T0 (never at students.createdAt, never fabricated earlier than T0),
    // AND the new open interval for the NEW email (B) — in this same
    // transaction. Before T0, A's ownership is UNKNOWN by design; this
    // interval only asserts "A was the email of record from T0 until this
    // change", which the pre-change students.email row already proves.
    const t0 = await ensureProvenanceActivated(tx);
    // Structurally, ensureProvenanceActivated always resolves or throws
    // (fails closed) — the defensive check below exists only in case this
    // invariant is ever loosened by a future edit.
    if (!t0) {
      throw new Error("Provenance activation (T0) could not be established — refusing to record a T0-anchored identity change.");
    }
    const oldFingerprint = fingerprintStudentEmail(locked.email);
    await tx.insert(studentEmailIdentityHistoryTable).values({
      studentId,
      emailFingerprint: oldFingerprint,
      validFrom: t0,
      validTo: nowIso,
      source,
      changedByAdminId: changedByAdminId ?? null,
    });
  } else {
    await tx
      .update(studentEmailIdentityHistoryTable)
      .set({ validTo: nowIso })
      .where(and(
        eq(studentEmailIdentityHistoryTable.studentId, studentId),
        isNull(studentEmailIdentityHistoryTable.validTo),
      ));
  }

  await tx.insert(studentEmailIdentityHistoryTable).values({
    studentId,
    emailFingerprint: fingerprint,
    validFrom: nowIso,
    validTo: null,
    source,
    changedByAdminId: changedByAdminId ?? null,
  });

  // Stored normalized, matching this route's pre-existing behavior (the old
  // PATCH handler always normalized the incoming email before persisting).
  await tx.update(studentsTable).set({ email: newNormalized }).where(eq(studentsTable.id, studentId));

  return { kind: "changed", previousNormalizedEmail: oldNormalized, newNormalizedEmail: newNormalized };
}

/**
 * Idempotently ensures the T0 provenance-activation row exists and returns
 * its activatedAt. Never backdated (defaultNow() at first-ever insert only —
 * see provenanceActivation.ts). Safe to call repeatedly/concurrently: the
 * DB-level UNIQUE constraint on `singleton` is the sole arbiter of which
 * concurrent INSERT wins; every other caller's INSERT no-ops via
 * ON CONFLICT DO NOTHING and then reads back whichever row actually landed.
 *
 * This is called from TWO contexts: (a) API process startup (real T0
 * establishment — see index.ts), and (b) defensively from inside an
 * in-flight email-change transaction (D's fix) in case activation somehow
 * has not yet happened (structurally should be impossible once (a) is
 * wired in, but this function must never assume that and must always
 * resolve-or-throw). Accepts an optional executor so callers already inside
 * a transaction (`tx`) read/write through the SAME transaction rather than
 * a separate connection.
 */
export async function ensureProvenanceActivated(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db = db,
): Promise<string> {
  await executor.insert(provenanceActivationTable).values({}).onConflictDoNothing({ target: provenanceActivationTable.singleton });
  const [row] = await executor.select().from(provenanceActivationTable).limit(1);
  if (!row) throw new Error("Failed to establish provenance activation row.");
  return row.activatedAt;
}

/**
 * F: opens the initial provenance interval for a BRAND-NEW student, atomic
 * with the student INSERT that created it (caller passes `tx`, the same
 * transaction used for that INSERT). `validFrom` MUST be the same
 * transaction-consistent timestamp used for the student row itself — pass
 * it in explicitly (e.g. read once via `now()`/`new Date().toISOString()`
 * and reuse for both the student insert and this call) rather than letting
 * this function take its own independent timestamp reading, so the two
 * writes can never diverge even by milliseconds.
 *
 * Never called for an EXISTING (pre-this-deploy) student — there is no
 * retroactive/backfill use of this helper anywhere in this phase.
 */
export async function openInitialProvenanceInterval(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { studentId: number; email: string; source: ProvenanceSource; validFrom: string },
): Promise<void> {
  const { studentId, email, source, validFrom } = params;
  const fingerprint = fingerprintStudentEmail(email);
  await tx.insert(studentEmailIdentityHistoryTable).values({
    studentId,
    emailFingerprint: fingerprint,
    validFrom,
    validTo: null,
    source,
    changedByAdminId: null,
  });
}
