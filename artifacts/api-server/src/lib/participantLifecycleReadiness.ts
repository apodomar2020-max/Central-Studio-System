import { pool } from "@workspace/db";

type Queryable = {
  query: (text: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type ParticipantLifecycleReadiness = {
  participantShapes: Record<string, number>;
  packageOwnership: Record<string, number>;
  activationOwnership: Record<string, number>;
  bookingOwnership: Record<string, number>;
  attendanceOwnership: Record<string, number>;
  creditIntegrity: Record<string, number>;
  doubleDeductionRisk: Record<string, number>;
  legacyRecords: Record<string, number>;
  ageConfiguration: Record<string, number>;
  launchResetInventory: Record<string, number>;
  integrityBlockerCount: number;
  legacyRecordCount: number;
};

const toNumber = (value: unknown): number => Number(value ?? 0);

/**
 * PII-free, read-only participant lifecycle audit. Every expression is an
 * aggregate; no customer identity or DOB value leaves the database.
 */
export async function readParticipantLifecycleReadiness(
  queryable: Queryable = pool,
): Promise<ParticipantLifecycleReadiness> {
  const result = await queryable.query(`
    SELECT
      (SELECT count(*) FROM package_orders
        WHERE NOT (
          (participant_type IS NULL AND participant_child_id IS NULL)
          OR (participant_type = 'self' AND participant_child_id IS NULL)
          OR (participant_type = 'child' AND participant_child_id IS NOT NULL)
        )) AS invalid_package_shapes,
      (SELECT count(*) FROM credit_transactions
        WHERE NOT (
          (participant_type IS NULL AND participant_child_id IS NULL)
          OR (participant_type = 'self' AND participant_child_id IS NULL)
          OR (participant_type = 'child' AND participant_child_id IS NOT NULL)
        )) AS invalid_credit_shapes,
      (SELECT count(*) FROM bookings
        WHERE NOT (
          (participant_type IS NULL AND participant_child_id IS NULL)
          OR (participant_type = 'self' AND participant_child_id IS NULL)
          OR (participant_type = 'child' AND participant_child_id IS NOT NULL)
        )) AS invalid_booking_shapes,
      (SELECT count(*) FROM attendance
        WHERE NOT (
          (participant_type IS NULL AND participant_child_id IS NULL)
          OR (participant_type = 'self' AND participant_child_id IS NULL)
          OR (participant_type = 'child' AND participant_child_id IS NOT NULL)
        )) AS invalid_attendance_shapes,
      (SELECT count(*) FROM payment_records
        WHERE participant_type IS NOT NULL AND NOT (
          (participant_type = 'self' AND child_id IS NULL)
          OR (participant_type = 'child' AND child_id IS NOT NULL)
        )) AS invalid_payment_shapes,

      (SELECT count(*) FROM package_orders po
        LEFT JOIN children c ON c.id = po.participant_child_id
        WHERE po.participant_type = 'child'
          AND (c.id IS NULL OR c.parent_id IS DISTINCT FROM po.student_id)) AS package_child_not_owned,
      (SELECT count(*) FROM credit_transactions ct
        LEFT JOIN children c ON c.id = ct.participant_child_id
        WHERE ct.participant_type = 'child'
          AND (c.id IS NULL OR c.parent_id IS DISTINCT FROM ct.student_id)) AS credit_child_not_owned,
      (SELECT count(*) FROM bookings b
        LEFT JOIN children c ON c.id = b.participant_child_id
        WHERE b.participant_type = 'child'
          AND (c.id IS NULL OR c.parent_id IS DISTINCT FROM b.account_owner_student_id)) AS booking_child_not_owned,
      (SELECT count(*) FROM attendance a
        LEFT JOIN children c ON c.id = a.participant_child_id
        WHERE a.participant_type = 'child'
          AND (c.id IS NULL OR c.parent_id IS DISTINCT FROM a.student_id)) AS attendance_child_not_owned,

      (SELECT count(*) FROM credit_transactions ct
        LEFT JOIN package_orders po ON po.id = ct.package_order_id
        WHERE ct.type = 'package_activated'
          AND (po.id IS NULL
            OR po.student_id IS DISTINCT FROM ct.student_id
            OR po.participant_type IS DISTINCT FROM ct.participant_type
            OR po.participant_child_id IS DISTINCT FROM ct.participant_child_id)) AS activation_owner_mismatch,
      (SELECT count(*) FROM bookings b
        LEFT JOIN package_orders po ON po.id = b.package_order_id
        WHERE b.package_order_id IS NOT NULL
          AND (po.id IS NULL
            OR po.student_id IS DISTINCT FROM b.account_owner_student_id
            OR po.participant_type IS DISTINCT FROM b.participant_type
            OR po.participant_child_id IS DISTINCT FROM b.participant_child_id)) AS booking_package_mismatch,
      (SELECT count(*) FROM credit_transactions ct
        LEFT JOIN bookings b ON b.id = ct.booking_id
        WHERE ct.type = 'booking_deduction'
          AND (b.id IS NULL
            OR b.package_order_id IS DISTINCT FROM ct.package_order_id
            OR b.account_owner_student_id IS DISTINCT FROM ct.student_id
            OR b.participant_type IS DISTINCT FROM ct.participant_type
            OR b.participant_child_id IS DISTINCT FROM ct.participant_child_id)) AS booking_deduction_mismatch,
      (SELECT count(*) FROM attendance a
        JOIN bookings b ON b.id = a.booking_id
        WHERE a.student_id IS DISTINCT FROM b.account_owner_student_id
          OR a.participant_type IS DISTINCT FROM b.participant_type
          OR a.participant_child_id IS DISTINCT FROM b.participant_child_id
          OR a.package_order_id IS DISTINCT FROM b.package_order_id) AS attendance_booking_mismatch,
      (SELECT count(*) FROM credit_transactions ct
        JOIN attendance a ON a.id = ct.attendance_id
        WHERE ct.type = 'attendance_deduction'
          AND (a.package_order_id IS DISTINCT FROM ct.package_order_id
            OR a.student_id IS DISTINCT FROM ct.student_id
            OR a.participant_type IS DISTINCT FROM ct.participant_type
            OR a.participant_child_id IS DISTINCT FROM ct.participant_child_id)) AS attendance_deduction_mismatch,

      (SELECT count(*) FROM bookings b
        WHERE b.payment_mode = 'package_credit'
          AND b.booking_status IN ('pending', 'confirmed', 'attended')
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.booking_id = b.id AND ct.type = 'booking_deduction'
          )) AS package_booking_missing_deduction,
      (SELECT count(*) FROM (
        SELECT booking_id FROM credit_transactions
        WHERE type = 'booking_deduction' AND booking_id IS NOT NULL
        GROUP BY booking_id HAVING count(*) > 1
      ) duplicate_booking_deductions) AS duplicate_booking_deductions,
      (SELECT count(*) FROM attendance a
        WHERE a.booking_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM credit_transactions ct
          WHERE ct.attendance_id = a.id AND ct.type = 'attendance_deduction'
        )) AS booking_attendance_second_deduction,
      (SELECT count(*) FROM attendance a
        WHERE a.booking_id IS NULL
          AND a.payment_source = 'walk_in_package_credit'
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.attendance_id = a.id AND ct.type = 'attendance_deduction'
          )) AS package_walkin_missing_deduction,
      (SELECT count(*) FROM (
        SELECT attendance_id FROM credit_transactions
        WHERE type = 'attendance_deduction' AND attendance_id IS NOT NULL
        GROUP BY attendance_id HAVING count(*) > 1
      ) duplicate_attendance_deductions) AS duplicate_attendance_deductions,
      (SELECT count(*) FROM package_orders WHERE remaining_credits < 0) AS negative_package_balances,
      (SELECT count(*) FROM package_orders
        WHERE status = 'fullyUsed' AND remaining_credits > 0) AS fully_used_positive_balance,
      (SELECT count(*) FROM package_orders
        WHERE status <> 'fullyUsed' AND total_credits > 0 AND remaining_credits = 0) AS zero_balance_not_fully_used,

      (SELECT count(*) FROM package_orders
        WHERE participant_type IS NULL AND participant_child_id IS NULL) AS legacy_package_orders,
      (SELECT count(*) FROM credit_transactions
        WHERE participant_type IS NULL AND participant_child_id IS NULL) AS legacy_credits,
      (SELECT count(*) FROM bookings
        WHERE participant_type IS NULL AND participant_child_id IS NULL) AS legacy_bookings,
      (SELECT count(*) FROM attendance
        WHERE participant_type IS NULL AND participant_child_id IS NULL
          AND ballet_class_id IS NULL AND ballet_schedule_id IS NULL) AS legacy_studio_attendance,
      (SELECT count(*) FROM package_orders
        WHERE participant_type IS NOT NULL AND (
          participant_name_snapshot IS NULL
          OR participant_date_of_birth_snapshot IS NULL
          OR participant_age_at_purchase IS NULL
          OR eligibility_evaluated_on IS NULL
        )) AS package_snapshot_missing,
      (SELECT count(*) FROM bookings
        WHERE participant_type IS NOT NULL AND (
          participant_date_of_birth_snapshot IS NULL
          OR participant_age_on_occurrence IS NULL
          OR eligibility_evaluated_on IS NULL
        )) AS booking_snapshot_missing,
      (SELECT count(*) FROM attendance
        WHERE participant_type IS NOT NULL AND (
          participant_date_of_birth_snapshot IS NULL
          OR participant_age_on_occurrence IS NULL
          OR eligibility_evaluated_on IS NULL
        )) AS attendance_snapshot_missing,
      (SELECT count(*) FROM students
        WHERE account_type IN ('student', 'parent')
          AND (date_of_birth IS NULL OR date_of_birth > (now() AT TIME ZONE 'Africa/Cairo')::date)) AS accounts_missing_or_invalid_dob,
      (SELECT count(*) FROM children
        WHERE date_of_birth IS NULL OR date_of_birth > (now() AT TIME ZONE 'Africa/Cairo')::date) AS children_missing_or_invalid_dob,

      (SELECT count(*) FROM classes
        WHERE is_active = true
          AND allow_all_ages IS NULL AND min_age IS NULL AND max_age IS NULL) AS active_classes_unconfigured,
      (SELECT count(*) FROM price_packages
        WHERE is_active = true
          AND allow_all_ages IS NULL AND min_age IS NULL AND max_age IS NULL) AS active_packages_unconfigured,
      (SELECT count(*) FROM classes
        WHERE is_active = true AND (
          (allow_all_ages IS NULL AND (min_age IS NOT NULL OR max_age IS NOT NULL))
          OR (allow_all_ages = true AND (min_age IS NOT NULL OR max_age IS NOT NULL))
          OR (allow_all_ages = false AND (
            min_age IS NULL OR min_age < 0 OR min_age > 150
            OR (max_age IS NOT NULL AND (max_age < min_age OR max_age > 150))
          ))
        )) AS active_classes_invalid,
      (SELECT count(*) FROM price_packages
        WHERE is_active = true AND (
          (allow_all_ages IS NULL AND (min_age IS NOT NULL OR max_age IS NOT NULL))
          OR (allow_all_ages = true AND (min_age IS NOT NULL OR max_age IS NOT NULL))
          OR (allow_all_ages = false AND (
            min_age IS NULL OR min_age < 0 OR min_age > 150
            OR (max_age IS NOT NULL AND (max_age < min_age OR max_age > 150))
          ))
        )) AS active_packages_invalid,
      (SELECT count(*) FROM price_package_dance_types ppdt
        LEFT JOIN price_packages pp ON pp.id = ppdt.package_id
        LEFT JOIN dance_types dt ON dt.id = ppdt.dance_type_id
        WHERE pp.id IS NULL OR dt.id IS NULL) AS invalid_package_dance_relations,

      (SELECT count(*) FROM package_orders) AS reset_package_orders,
      (SELECT count(*) FROM credit_transactions) AS reset_credit_transactions,
      (SELECT count(*) FROM bookings) AS reset_bookings,
      (SELECT count(*) FROM attendance
        WHERE ballet_class_id IS NULL AND ballet_schedule_id IS NULL) AS reset_studio_attendance,
      (SELECT count(*) FROM payment_records) AS reset_payment_records,
      (SELECT count(*) FROM payment_events) AS reset_payment_events,
      (SELECT count(*) FROM payment_refunds) AS reset_payment_refunds,
      (SELECT count(*) FROM promotion_redemptions) AS reset_promotion_redemptions,
      (SELECT count(*) FROM notifications) AS reset_notifications,
      (SELECT count(*) FROM notification_devices) AS reset_notification_devices
  `);

  const row = result.rows[0] ?? {};
  const participantShapes = {
    invalidPackageOrders: toNumber(row.invalid_package_shapes),
    invalidCredits: toNumber(row.invalid_credit_shapes),
    invalidBookings: toNumber(row.invalid_booking_shapes),
    invalidAttendance: toNumber(row.invalid_attendance_shapes),
    invalidPayments: toNumber(row.invalid_payment_shapes),
  };
  const packageOwnership = {
    missingOrUnownedChild: toNumber(row.package_child_not_owned),
    missingSnapshots: toNumber(row.package_snapshot_missing),
  };
  const activationOwnership = {
    packageMismatch: toNumber(row.activation_owner_mismatch),
  };
  const bookingOwnership = {
    missingOrUnownedChild: toNumber(row.booking_child_not_owned),
    packageMismatch: toNumber(row.booking_package_mismatch),
    deductionMismatch: toNumber(row.booking_deduction_mismatch),
    missingSnapshots: toNumber(row.booking_snapshot_missing),
  };
  const attendanceOwnership = {
    missingOrUnownedChild: toNumber(row.attendance_child_not_owned),
    bookingMismatch: toNumber(row.attendance_booking_mismatch),
    deductionMismatch: toNumber(row.attendance_deduction_mismatch),
    missingSnapshots: toNumber(row.attendance_snapshot_missing),
  };
  const creditIntegrity = {
    missingBookingDeduction: toNumber(row.package_booking_missing_deduction),
    duplicateBookingDeductions: toNumber(row.duplicate_booking_deductions),
    missingWalkInDeduction: toNumber(row.package_walkin_missing_deduction),
    duplicateAttendanceDeductions: toNumber(row.duplicate_attendance_deductions),
    negativeBalances: toNumber(row.negative_package_balances),
    fullyUsedWithPositiveBalance: toNumber(row.fully_used_positive_balance),
    zeroBalanceNotFullyUsed: toNumber(row.zero_balance_not_fully_used),
  };
  const doubleDeductionRisk = {
    bookingBackedAttendanceDeductions: toNumber(row.booking_attendance_second_deduction),
  };
  const legacyRecords = {
    packageOrders: toNumber(row.legacy_package_orders),
    credits: toNumber(row.legacy_credits),
    bookings: toNumber(row.legacy_bookings),
    studioAttendance: toNumber(row.legacy_studio_attendance),
  };
  const ageConfiguration = {
    activeClassesUnconfigured: toNumber(row.active_classes_unconfigured),
    activePackagesUnconfigured: toNumber(row.active_packages_unconfigured),
    activeClassesInvalid: toNumber(row.active_classes_invalid),
    activePackagesInvalid: toNumber(row.active_packages_invalid),
    invalidPackageDanceRelations: toNumber(row.invalid_package_dance_relations),
    accountsMissingOrInvalidDob: toNumber(row.accounts_missing_or_invalid_dob),
    childrenMissingOrInvalidDob: toNumber(row.children_missing_or_invalid_dob),
  };
  const launchResetInventory = {
    packageOrders: toNumber(row.reset_package_orders),
    creditTransactions: toNumber(row.reset_credit_transactions),
    bookings: toNumber(row.reset_bookings),
    studioAttendance: toNumber(row.reset_studio_attendance),
    paymentRecords: toNumber(row.reset_payment_records),
    paymentEvents: toNumber(row.reset_payment_events),
    paymentRefunds: toNumber(row.reset_payment_refunds),
    promotionRedemptions: toNumber(row.reset_promotion_redemptions),
    notifications: toNumber(row.reset_notifications),
    notificationDevices: toNumber(row.reset_notification_devices),
  };
  const integrityBlockerCount = [
    participantShapes,
    packageOwnership,
    activationOwnership,
    bookingOwnership,
    attendanceOwnership,
    creditIntegrity,
    doubleDeductionRisk,
  ].flatMap(Object.values).reduce((sum, value) => sum + value, 0);
  const legacyRecordCount = Object.values(legacyRecords).reduce((sum, value) => sum + value, 0);

  return {
    participantShapes,
    packageOwnership,
    activationOwnership,
    bookingOwnership,
    attendanceOwnership,
    creditIntegrity,
    doubleDeductionRisk,
    legacyRecords,
    ageConfiguration,
    launchResetInventory,
    integrityBlockerCount,
    legacyRecordCount,
  };
}
