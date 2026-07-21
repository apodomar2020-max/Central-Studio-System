/**
 * Real-database tests for the canonical Ballet Class model's final schema
 * shape and transactional invariants.
 *
 * Assumes DISPOSABLE_BALLET_CLASS_DATABASE_URL points at a local, disposable
 * Postgres database already migrated through 0075 (the full chain, run via
 * `pnpm --filter @workspace/db run migrate`). This file only exercises raw
 * SQL against that already-migrated schema — it does not seed or verify the
 * Expand-compatibility scenario (applying 0075 on top of pre-existing
 * legacy rows); see balletClassCanonicalMigrationCompat.test.ts for that.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const databaseUrlEnv = process.env["DISPOSABLE_BALLET_CLASS_DATABASE_URL"];
if (!databaseUrlEnv) throw new Error("DISPOSABLE_BALLET_CLASS_DATABASE_URL is required");
const DATABASE_URL: string = databaseUrlEnv;
const url = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/disposable|local|test/i.test(url.pathname)
  || url.searchParams.get('sslmode') !== 'disable') {
  throw new Error('Refusing to run Ballet Class DB tests outside a local disposable database with sslmode=disable');
}

function query(sql: string): string {
  return execFileSync('psql', [
    // -q suppresses the "INSERT 0 1" command-tag line psql prints after a
    // RETURNING statement — without it, -At output is "35\nINSERT 0 1",
    // which breaks Number(query(...)) parsing for insert-returning-id calls.
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At',
    '--dbname', DATABASE_URL,
    '--command', sql,
  ], { encoding: 'utf8' }).trim();
}

test('0075 final schema has nullable canonical relationships and is_legacy, and keeps legacy joins', () => {
  assert.equal(query(`
    select string_agg(column_name || ':' || is_nullable, ',' order by column_name)
    from information_schema.columns
    where table_schema='public' and table_name='ballet_classes'
      and column_name in ('level_id','group_id','instructor_id','is_legacy')`),
  'group_id:YES,instructor_id:YES,is_legacy:NO,level_id:YES');
  assert.equal(query(`select concat_ws(',',
    coalesce(to_regclass('public.ballet_class_levels')::text, 'null'),
    coalesce(to_regclass('public.ballet_class_groups')::text, 'null'),
    coalesce(to_regclass('public.ballet_group_schedules')::text, 'null'))`),
  'ballet_class_levels,ballet_class_groups,ballet_group_schedules');
});

test('is_legacy defaults to true, so an old-deployed-API-style insert stays legacy and inert', () => {
  const title = `Old API Style ${Date.now()}`;
  query(`
    begin;
    insert into ballet_classes (title, is_active) values ('${title}', true);
    do $block$
    begin
      if not exists (
        select 1 from ballet_classes
        where title = '${title}' and is_legacy = true and level_id is null and group_id is null
      ) then
        raise exception 'old-API-style insert did not default to legacy/null relationships';
      end if;
    end
    $block$;
    rollback;`);
  assert.equal(query(`select count(*) from ballet_classes where title='${title}'`), '0');
});

test('canonical class and its schedule commit atomically, is_legacy=false', () => {
  const title = `Canonical Class ${Date.now()}`;
  query(`
    begin;
    do $block$
    declare
      level_key integer;
      group_key integer;
      instructor_key integer;
      class_key integer;
    begin
      insert into ballet_levels (name, sort_order, is_active)
      values ('Canonical Level ${Date.now()}', 999, true) returning id into level_key;
      insert into ballet_groups (name, level_id, is_active)
      values ('Canonical Group ${Date.now()}', level_key, true) returning id into group_key;
      insert into ballet_instructors (name, is_active)
      values ('Canonical Instructor ${Date.now()}', true) returning id into instructor_key;
      insert into ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
      values ('${title}', false, level_key, group_key, instructor_key, true) returning id into class_key;
      insert into ballet_schedules
        (class_id, day_of_week, start_time, end_time, duration_mins, status)
      values (class_key, 1, '16:00', '17:15', 75, 'active');

      if not exists (
        select 1 from ballet_schedules
        where class_id = class_key and duration_mins = 75
      ) then
        raise exception 'class/schedule pair was not created';
      end if;
      if not exists (select 1 from ballet_classes where id = class_key and is_legacy = false) then
        raise exception 'canonical class was not marked non-legacy';
      end if;
    end
    $block$;
    rollback;`);
  assert.equal(query(`select count(*) from ballet_classes where title='${title}'`), '0');
});

test('database rejects a class whose group belongs to a different level', () => {
  assert.throws(() => query(`
    begin;
    do $block$
    declare
      level_one integer;
      level_two integer;
      group_key integer;
      instructor_key integer;
    begin
      insert into ballet_levels (name, sort_order, is_active) values ('Composite L1 ${Date.now()}', 990, true) returning id into level_one;
      insert into ballet_levels (name, sort_order, is_active) values ('Composite L2 ${Date.now()}', 991, true) returning id into level_two;
      insert into ballet_groups (name, level_id, is_active) values ('Composite Group ${Date.now()}', level_one, true) returning id into group_key;
      insert into ballet_instructors (name, is_active) values ('Composite Instructor ${Date.now()}', true) returning id into instructor_key;
      insert into ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
      values ('Invalid Composite ${Date.now()}', false, level_two, group_key, instructor_key, true);
    end
    $block$;
    rollback;`), /ballet_classes_group_level_fk|violates foreign key/i);
});

test('a legacy class may keep a null group_id without violating the composite FK (MATCH SIMPLE semantics)', () => {
  const title = `Legacy Null Group ${Date.now()}`;
  query(`
    begin;
    do $block$
    declare
      level_key integer;
      class_key integer;
    begin
      insert into ballet_levels (name, sort_order, is_active) values ('Legacy Backfill Level ${Date.now()}', 992, true) returning id into level_key;
      insert into ballet_classes (title, is_legacy, level_id, is_active) values ('${title}', true, level_key, false) returning id into class_key;
      if not exists (select 1 from ballet_classes where id = class_key and group_id is null) then
        raise exception 'legacy class with null group_id unexpectedly failed';
      end if;
    end
    $block$;
    rollback;`);
  assert.equal(query(`select count(*) from ballet_classes where title='${title}'`), '0');
});
