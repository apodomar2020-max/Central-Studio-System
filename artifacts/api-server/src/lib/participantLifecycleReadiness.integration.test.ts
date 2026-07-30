import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

const parsed = new URL(DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)
  || !/disposable|test|local/i.test(parsed.pathname)
  || /railway|rlwy/i.test(DATABASE_URL)) {
  throw new Error("Refusing to run participant readiness test outside a disposable local database");
}

process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;
let readReadiness: typeof import("./participantLifecycleReadiness").readParticipantLifecycleReadiness;

before(async () => {
  ({ pool } = await import("@workspace/db"));
  ({ readParticipantLifecycleReadiness: readReadiness } = await import("./participantLifecycleReadiness"));
});

after(async () => {
  await pool.end();
});

test("participant lifecycle readiness distinguishes canonical, legacy, and blocking records without mutation", async () => {
  const client = await pool.connect();
  const queryable = { query: (text: string) => client.query(text) };
  await client.query("BEGIN");
  try {
    const baseline = await readReadiness(queryable);
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const parent = await client.query(
      `INSERT INTO students (
         name, email, account_type, date_of_birth, email_verified, profile_completed
       ) VALUES ('Readiness Parent', $1, 'parent', '1980-01-01', true, true)
       RETURNING id`,
      [`readiness-parent-${run}@example.invalid`],
    );
    const child = await client.query(
      `INSERT INTO children (parent_id, full_name, date_of_birth)
       VALUES ($1, 'Readiness Child', '2015-01-01') RETURNING id`,
      [parent.rows[0].id],
    );
    const pkg = await client.query(
      `INSERT INTO price_packages (
         name, type, price_egp, sessions, validity_months, is_active,
         allow_all_ages, min_age, max_age
       ) VALUES ($1, 'per_class', 1000, 4, 6, false, true, NULL, NULL)
       RETURNING id`,
      [`Readiness Package ${run}`],
    );
    const order = await client.query(
      `INSERT INTO package_orders (
         student_name, student_email, student_id, participant_type,
         participant_child_id, participant_name_snapshot,
         participant_date_of_birth_snapshot, participant_age_at_purchase,
         eligibility_evaluated_on, package_allow_all_ages_snapshot,
         purchase_eligibility_configuration_state, allowed_dance_type_ids_snapshot,
         package_id, package_name, total_credits, remaining_credits, status,
         activated_at, expires_at
       ) VALUES (
         'Readiness Parent', $1, $2, 'child', $3, 'Readiness Child',
         '2015-01-01', 11, CURRENT_DATE, true, 'configured', ARRAY[]::integer[],
         $4, $5, 4, 3, 'active', now(), now() + interval '6 months'
       ) RETURNING id`,
      [
        `readiness-parent-${run}@example.invalid`,
        parent.rows[0].id,
        child.rows[0].id,
        pkg.rows[0].id,
        `Readiness Package ${run}`,
      ],
    );
    await client.query(
      `INSERT INTO credit_transactions (
         package_order_id, student_id, participant_type, participant_child_id,
         type, delta, balance_before, balance_after
       ) VALUES ($1, $2, 'child', $3, 'package_activated', 4, 0, 4)`,
      [order.rows[0].id, parent.rows[0].id, child.rows[0].id],
    );
    const booking = await client.query(
      `INSERT INTO bookings (
         student_name, student_email, account_owner_student_id,
         participant_type, participant_child_id,
         participant_date_of_birth_snapshot, participant_age_on_occurrence,
         eligibility_evaluated_on, class_allow_all_ages_snapshot,
         package_order_id, payment_mode, booking_status
       ) VALUES (
         'Readiness Child', $1, $2, 'child', $3,
         '2015-01-01', 11, CURRENT_DATE, true,
         $4, 'package_credit', 'attended'
       ) RETURNING id`,
      [
        `readiness-parent-${run}@example.invalid`,
        parent.rows[0].id,
        child.rows[0].id,
        order.rows[0].id,
      ],
    );
    const deduction = await client.query(
      `INSERT INTO credit_transactions (
         package_order_id, student_id, participant_type, participant_child_id,
         type, delta, balance_before, balance_after, booking_id
       ) VALUES ($1, $2, 'child', $3, 'booking_deduction', -1, 4, 3, $4)
       RETURNING id`,
      [order.rows[0].id, parent.rows[0].id, child.rows[0].id, booking.rows[0].id],
    );
    const attendance = await client.query(
      `INSERT INTO attendance (
         student_name, student_email, student_id,
         participant_type, participant_child_id,
         participant_date_of_birth_snapshot, participant_age_on_occurrence,
         eligibility_evaluated_on, booking_id, package_order_id,
         attendance_source, payment_source
       ) VALUES (
         'Readiness Child', $1, $2, 'child', $3,
         '2015-01-01', 11, CURRENT_DATE, $4, $5,
         'booking', 'booking_package_credit'
       ) RETURNING id`,
      [
        `readiness-parent-${run}@example.invalid`,
        parent.rows[0].id,
        child.rows[0].id,
        booking.rows[0].id,
        order.rows[0].id,
      ],
    );

    const canonical = await readReadiness(queryable);
    assert.equal(canonical.integrityBlockerCount, baseline.integrityBlockerCount);
    assert.equal(
      canonical.doubleDeductionRisk.bookingBackedAttendanceDeductions,
      baseline.doubleDeductionRisk.bookingBackedAttendanceDeductions,
    );
    assert.equal(
      canonical.launchResetInventory.bookings,
      baseline.launchResetInventory.bookings + 1,
    );

    await client.query(
      `INSERT INTO credit_transactions (
         package_order_id, student_id, participant_type, participant_child_id,
         type, delta, balance_before, balance_after, attendance_id
       ) VALUES ($1, $2, 'child', $3, 'attendance_deduction', -1, 3, 2, $4)`,
      [order.rows[0].id, parent.rows[0].id, child.rows[0].id, attendance.rows[0].id],
    );
    await client.query(
      `UPDATE package_orders SET remaining_credits = -1 WHERE id = $1`,
      [order.rows[0].id],
    );

    const blocked = await readReadiness(queryable);
    assert.equal(
      blocked.doubleDeductionRisk.bookingBackedAttendanceDeductions,
      baseline.doubleDeductionRisk.bookingBackedAttendanceDeductions + 1,
    );
    assert.equal(
      blocked.creditIntegrity.negativeBalances,
      baseline.creditIntegrity.negativeBalances + 1,
    );
    assert.ok(blocked.integrityBlockerCount >= baseline.integrityBlockerCount + 2);

    const stillPresent = await client.query(
      `SELECT count(*)::int AS count FROM credit_transactions WHERE id = $1`,
      [deduction.rows[0].id],
    );
    assert.equal(stillPresent.rows[0].count, 1, "the readiness query must never repair or delete data");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
