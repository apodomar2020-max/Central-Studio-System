/**
 * Verifies migration 0072 against a database shaped exactly like Production:
 * an already-populated legacy Ballet Class catalogue, not an empty one.
 *
 * This is the scenario the original (rejected) version of 0072 could not
 * survive — it aborted with a RAISE EXCEPTION unless every legacy table was
 * empty. This file proves the revised, additive migration coexists with
 * pre-existing legacy data instead.
 *
 * Preconditions (set up externally, not by this file — same convention as
 * balletCancellationRouteIntegration.test.ts's "must already be migrated"
 * note, to avoid coupling this suite's runtime to a migration run):
 *   1. DISPOSABLE_BALLET_CLASS_LEGACY_DATABASE_URL points at a local,
 *      disposable Postgres database migrated through 0071 (NOT 0072).
 *   2. The Production-shaped legacy fixture below has been seeded into it:
 *        - 2 ballet_levels ('Level A (Prod-shaped)', 'Level B (Prod-shaped)')
 *        - 1 ballet_instructor, 1 ballet_group (level_id = Level A)
 *        - 2 ballet_classes, both is_active = false:
 *            'Legacy Class 1 (Prod-shaped)' -> single ballet_class_levels
 *              link to Level A
 *            'Legacy Class 2 (Prod-shaped)' -> single ballet_class_levels
 *              link to Level B
 *        - 1 ballet_schedule owned by Class 1, status = 'cancelled',
 *          duration_mins = NULL (unknown historical shape)
 *        - 0 ballet_class_groups rows, 0 ballet_group_schedules rows
 *        - 2 attendance rows, one per class (Class 2's row has a NULL
 *          ballet_schedule_id, since it has no schedule)
 *   3. Migration 0072 has then been applied on top of that seed (e.g. via
 *      `pnpm --filter @workspace/db run migrate`).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const databaseUrlEnv = process.env["DISPOSABLE_BALLET_CLASS_LEGACY_DATABASE_URL"];
if (!databaseUrlEnv) throw new Error("DISPOSABLE_BALLET_CLASS_LEGACY_DATABASE_URL is required");
const DATABASE_URL: string = databaseUrlEnv;
const url = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/disposable|local|test/i.test(url.pathname)
  || url.searchParams.get('sslmode') !== 'disable') {
  throw new Error('Refusing to run Ballet Class migration-compat tests outside a local disposable database with sslmode=disable');
}

function query(sql: string): string {
  return execFileSync('psql', [
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At',
    '--dbname', DATABASE_URL,
    '--command', sql,
  ], { encoding: 'utf8' }).trim();
}

test('both pre-existing legacy classes are marked legacy and stay inactive', () => {
  assert.equal(
    query(`select string_agg(is_legacy::text || ':' || is_active::text, ',' order by title)
            from ballet_classes where title in ('Legacy Class 1 (Prod-shaped)', 'Legacy Class 2 (Prod-shaped)')`),
    'true:false,true:false',
  );
});

test('level_id is safely backfilled from the single legacy Level link, and group_id is never fabricated', () => {
  assert.equal(
    query(`select bc.title, bl.name, bc.group_id
           from ballet_classes bc
           left join ballet_levels bl on bl.id = bc.level_id
           where bc.title = 'Legacy Class 1 (Prod-shaped)'`),
    'Legacy Class 1 (Prod-shaped)|Level A (Prod-shaped)|',
  );
  assert.equal(
    query(`select bc.title, bl.name, bc.group_id
           from ballet_classes bc
           left join ballet_levels bl on bl.id = bc.level_id
           where bc.title = 'Legacy Class 2 (Prod-shaped)'`),
    'Legacy Class 2 (Prod-shaped)|Level B (Prod-shaped)|',
  );
});

test('the historical cancelled schedule survives unchanged, including its unknown duration', () => {
  assert.equal(
    query(`select s.status, coalesce(s.duration_mins::text, 'NULL')
           from ballet_schedules s join ballet_classes c on c.id = s.class_id
           where c.title = 'Legacy Class 1 (Prod-shaped)'`),
    'cancelled|NULL',
  );
});

test('historical attendance rows are preserved unchanged, including the schedule-less class', () => {
  assert.equal(
    query(`select count(*) from attendance where student_name in ('Prod Shaped Student One', 'Prod Shaped Student Two')`),
    '2',
  );
  assert.equal(
    query(`select a.student_name, a.ballet_schedule_id is null
           from attendance a
           join ballet_classes c on c.id = a.ballet_class_id
           where c.title = 'Legacy Class 2 (Prod-shaped)'`),
    'Prod Shaped Student Two|t',
  );
});

test('legacy join tables retain their original rows and are not dropped', () => {
  assert.equal(
    query(`select count(*) from ballet_class_levels bcl
           join ballet_classes bc on bc.id = bcl.class_id
           where bc.title in ('Legacy Class 1 (Prod-shaped)', 'Legacy Class 2 (Prod-shaped)')`),
    '2',
  );
  assert.equal(query(`select to_regclass('public.ballet_class_groups') is not null`), 't');
  assert.equal(query(`select to_regclass('public.ballet_group_schedules') is not null`), 't');
});
