import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Future collision guard (Phase A — ballet_schedules.capacity corrective
 * migration 0069). Prevents a repeat of the exact defect that caused
 * capacity to silently never reach production: migrations 0059 and 0060
 * were committed ~14 hours apart yet ended up with the identical journal
 * `when` value (1784462414000). The installed Drizzle Postgres migrator
 * tracks only a single high-water-mark `created_at` and applies a migration
 * only when `lastDbMigration.created_at < migration.folderMillis` (strict
 * `<`) — a duplicate `when` between two migrations means whichever one runs
 * second is silently skipped forever, with no error and no log line.
 *
 * That one historical pair is a known, already-shipped defect that this
 * test must NOT fail on (it's fixed forward by 0069, not by rewriting
 * history — see 0069's own header comment). Every OTHER duplicate `when`,
 * present or future, is a hard failure.
 */

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const KNOWN_HISTORICAL_WHEN_COLLISIONS = [
  {
    when: 1784462414000,
    tags: ["0059_drop_ballet_assessment_slots", "0060_ballet_schedule_capacity"],
  },
  {
    // 0123 is the forward-only reconciliation for the independently shipped
    // 0119/0120 collision. Historical journal entries must not be rewritten.
    when: 1788019200001,
    tags: ["0119_student_permanent_delete_fields", "0120_social_link_challenges"],
  },
];

function loadJournal(): JournalEntry[] {
  const journalPath = resolve(REPO_ROOT, "lib/db/migrations/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  return journal.entries;
}

test("no two journal entries share a tag", () => {
  const entries = loadJournal();
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const prevIdx = seen.get(entry.tag);
    assert.equal(prevIdx, undefined, `tag "${entry.tag}" is duplicated at idx ${prevIdx} and idx ${entry.idx}`);
    seen.set(entry.tag, entry.idx);
  }
});

test("no two journal entries share a `when` value, except documented historical collisions with forward repairs", () => {
  const entries = loadJournal();
  const byWhen = new Map<number, JournalEntry[]>();
  for (const entry of entries) {
    const group = byWhen.get(entry.when) ?? [];
    group.push(entry);
    byWhen.set(entry.when, group);
  }

  const duplicateGroups = [...byWhen.values()].filter((group) => group.length > 1);

  assert.equal(
    duplicateGroups.length,
    KNOWN_HISTORICAL_WHEN_COLLISIONS.length,
    `expected only the ${KNOWN_HISTORICAL_WHEN_COLLISIONS.length} documented collisions; found ${duplicateGroups.length}`,
  );

  for (const expected of KNOWN_HISTORICAL_WHEN_COLLISIONS) {
    const group = duplicateGroups.find((candidate) => candidate[0]!.when === expected.when);
    assert.ok(group, `missing documented collision at ${expected.when}`);
    assert.equal(group.length, 2, "a documented collision must involve exactly two entries, not more");
    assert.deepEqual(
      group.map((entry) => entry.tag).sort(),
      [...expected.tags].sort(),
      `unexpected migration pair at duplicated when=${expected.when}`,
    );
  }
});

test("the 0119/0120 collision has a forward-only social-link table reconciliation", () => {
  const repairPath = resolve(REPO_ROOT, "lib/db/migrations/0123_social_link_challenges_reconciliation.sql");
  const repair = readFileSync(repairPath, "utf8");
  assert.match(repair, /CREATE TABLE IF NOT EXISTS "social_link_challenges"/);
  assert.match(repair, /CREATE UNIQUE INDEX IF NOT EXISTS "social_link_challenges_token_hash_unique"/);
});

test("the newest journal entry has a strictly greater idx than the entry before it", () => {
  const entries = loadJournal();
  const newest = entries[entries.length - 1]!;
  const previous = entries[entries.length - 2]!;
  assert.ok(newest.idx > previous.idx, `newest entry idx (${newest.idx}) must be greater than the previous entry's idx (${previous.idx})`);
});

test("the newest journal entry's `when` is strictly greater than every other entry's `when`", () => {
  const entries = loadJournal();
  const newest = entries[entries.length - 1]!;
  const others = entries.slice(0, -1);
  const maxOtherWhen = Math.max(...others.map((e) => e.when));
  assert.ok(newest.when > maxOtherWhen, `newest entry \`when\` (${newest.when}) must be strictly greater than every previous entry's \`when\` (max: ${maxOtherWhen})`);
});

test("the newest journal entry's referenced SQL migration file exists on disk", () => {
  const entries = loadJournal();
  const newest = entries[entries.length - 1]!;
  const migrationPath = resolve(REPO_ROOT, `lib/db/migrations/${newest.tag}.sql`);
  assert.ok(existsSync(migrationPath), `expected migration file to exist: ${migrationPath}`);
});
