import assert from "node:assert/strict";
import test from "node:test";
import { createPool, withReadOnlyTransaction } from "./database";
import { exportFreshLaunchConfiguration } from "./configurationExport";
import { importFreshLaunchConfiguration } from "./configurationImport";
import { verifyConfigurationEquivalence, verifyTransactionalExclusion, captureSourceFingerprint } from "./configurationVerification";
import { validateCutoverEnvironment } from "./environmentGuard";
import { readFreshLaunchSourceInventory } from "./freshLaunchSourceInventory";

const sourceUrl = process.env.FRESH_LAUNCH_SOURCE_DATABASE_URL;
const targetUrl = process.env.FRESH_LAUNCH_TARGET_DATABASE_URL;
const enabled = Boolean(sourceUrl && targetUrl);

test("configuration-only transfer is deterministic, atomic, and source-immutable", { skip: !enabled }, async () => {
  const urls = validateCutoverEnvironment({
    rehearsalFlag: process.env.FRESH_LAUNCH_REHEARSAL,
    sourceUrl,
    targetUrl,
    env: { FRESH_LAUNCH_REHEARSAL: process.env.FRESH_LAUNCH_REHEARSAL },
  });
  const source = createPool(urls.source.toString());
  const target = createPool(urls.target.toString());
  try {
    await source.query(`
      INSERT INTO dance_types (id, name, slug, is_active) VALUES (101, 'Synthetic Studio Dance', 'synthetic-studio-dance', true);
      INSERT INTO instructors (id, name, is_active) VALUES (101, 'Synthetic Instructor', true);
      INSERT INTO classes (id, title, category, instructor_id, dance_type_id, allow_all_ages, min_age, max_age, is_active)
        VALUES (101, 'Synthetic General Class', 'Studio', 101, 101, false, 5, 17, true);
      INSERT INTO schedules (id, class_id, type, status, day_of_week, start_time, end_time)
        VALUES (101, 101, 'weekly', 'active', 1, '10:00', '11:00');
      INSERT INTO price_packages (id, name, type, sessions, price_egp, allow_all_ages, min_age, max_age, allowed_dance_types)
        VALUES (101, 'Synthetic Studio Package', 'per_class', 4, 1000, false, 5, 17, ARRAY['Synthetic Studio Dance']);
      INSERT INTO price_package_dance_types (package_id, dance_type_id) VALUES (101, 101);
      INSERT INTO promotions (id, name, type, discount_type, discount_value, is_active)
        VALUES (101, 'Synthetic Launch Promotion', 'code', 'percentage', 10, true);
      INSERT INTO promotion_codes (id, promotion_id, code) VALUES (101, 101, 'SYNTHETIC10');
      INSERT INTO ballet_levels (id, name, is_active) VALUES (101, 'Synthetic Ballet Level', true);
      INSERT INTO ballet_instructors (id, name, is_active) VALUES (101, 'Synthetic Ballet Instructor', true);
      INSERT INTO ballet_groups (id, name, level_id, is_active) VALUES (101, 'Synthetic Ballet Group', 101, true);
      INSERT INTO ballet_classes (id, title, is_legacy, level_id, group_id, instructor_id, is_active)
        VALUES (101, 'Synthetic Ballet Class', false, 101, 101, 101, true);
      INSERT INTO ballet_schedules (id, class_id, day_of_week, start_time, end_time, status)
        VALUES (101, 101, 2, '12:00', '13:00', 'active');
      INSERT INTO ballet_class_levels (id, class_id, level_id) VALUES (101, 101, 101);
      INSERT INTO ballet_class_groups (id, class_id, group_id) VALUES (101, 101, 101);
      INSERT INTO ballet_group_schedules (id, group_id, schedule_id) VALUES (101, 101, 101);
      INSERT INTO ballet_packages (id, name, monthly_classes, monthly_hours, price_egp, is_active)
        VALUES (101, 'Synthetic Ballet Package', 8, 8, 1200, true);
      INSERT INTO ballet_package_levels (id, package_id, level_id) VALUES (101, 101, 101);
      INSERT INTO students (id, name, email, account_type) VALUES (101, 'Synthetic Student', 'synthetic-student@example.invalid', 'student');
      INSERT INTO package_orders (id, student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
        VALUES (101, 'Synthetic Student', 'synthetic-student@example.invalid', 101, 101, 'Synthetic Studio Package', 4, 3, 'active');
      INSERT INTO bookings (id, student_name, student_email, account_owner_student_id, participant_type, schedule_id, class_id, package_order_id, status)
        VALUES (101, 'Synthetic Student', 'synthetic-student@example.invalid', 101, 'self', 101, 101, 101, 'confirmed');
      INSERT INTO attendance (id, student_name, student_email, student_id, participant_type, class_id, schedule_id, booking_id)
        VALUES (101, 'Synthetic Student', 'synthetic-student@example.invalid', 101, 'self', 101, 101, 101);
      INSERT INTO credit_transactions (id, package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, booking_id)
        VALUES (101, 101, 101, 'self', 'booking_deduction', -1, 4, 3, 101);
    `);
    const before = await captureSourceFingerprint(source);
    const inventory = await readFreshLaunchSourceInventory(source);
    assert.equal(inventory.counts.exclude.package_orders, 1);
    assert.ok(inventory.domains.balletTransfer > 0);

    const first = await exportFreshLaunchConfiguration(source, inventory.migration);
    const second = await exportFreshLaunchConfiguration(source, inventory.migration);
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(JSON.stringify(first), JSON.stringify(second));

    const result = await importFreshLaunchConfiguration(target, first);
    assert.ok(result.imported.danceTypes >= 1);
    assert.ok(result.advancedSequences.length > 0);
    const equivalence = await verifyConfigurationEquivalence(target, first);
    assert.equal(equivalence.equivalent, true, equivalence.differences.join(","));
    const excluded = await verifyTransactionalExclusion(target);
    assert.ok(Object.values(excluded).every((count) => count === 0));
    const readiness = await target.query<{
      active_classes_unconfigured: string;
      active_packages_unconfigured: string;
      invalid_relations: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM classes WHERE is_active AND allow_all_ages IS NULL) AS active_classes_unconfigured,
        (SELECT count(*)::text FROM price_packages WHERE is_active AND allow_all_ages IS NULL) AS active_packages_unconfigured,
        (SELECT count(*)::text FROM price_package_dance_types ppdt
          LEFT JOIN price_packages pp ON pp.id=ppdt.package_id
          LEFT JOIN dance_types dt ON dt.id=ppdt.dance_type_id
          WHERE pp.id IS NULL OR dt.id IS NULL) AS invalid_relations
    `);
    assert.deepEqual(readiness.rows[0], {
      active_classes_unconfigured: "0",
      active_packages_unconfigured: "0",
      invalid_relations: "0",
    });
    assert.equal(await captureSourceFingerprint(source), before);

    await withReadOnlyTransaction(target, async (client) => {
      const relations = await client.query(`SELECT 1 FROM price_package_dance_types WHERE package_id=101 AND dance_type_id=101`);
      assert.equal(relations.rowCount, 1);
      const ballet = await client.query(`SELECT 1 FROM ballet_group_schedules WHERE group_id=101 AND schedule_id=101`);
      assert.equal(ballet.rowCount, 1);
    });
  } finally {
    await source.end();
    await target.end();
  }
});

test("non-empty target and malformed exports fail without partial writes", { skip: !enabled }, async () => {
  const target = createPool(targetUrl!);
  try {
    const countBefore = await target.query<{ count: string }>("SELECT count(*)::text AS count FROM dance_types");
    await assert.rejects(
      async () => importFreshLaunchConfiguration(target, {
        format: "central-studio-fresh-launch-configuration",
        version: 1,
        manifestVersion: "unknown",
        manifestHash: "invalid",
        sourceMigration: "invalid",
        groups: [],
        contentHash: "invalid",
      }),
      /EXPORT_MANIFEST_MISMATCH/,
    );
    const countAfter = await target.query<{ count: string }>("SELECT count(*)::text AS count FROM dance_types");
    assert.equal(countAfter.rows[0]?.count, countBefore.rows[0]?.count);
  } finally {
    await target.end();
  }
});
