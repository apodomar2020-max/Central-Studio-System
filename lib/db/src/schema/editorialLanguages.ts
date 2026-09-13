import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";

/**
 * editorial_languages — Unified Editorial CMS Wave 1.1 (multilingual
 * foundation).
 *
 * WEBSITE-LEVEL, NOT CHANNEL-SCOPED. A language is a property of the
 * website as a whole: the same set of languages is offered on the 'news'
 * and 'experience' channels alike, so this table deliberately carries no
 * `channel` column (unlike editorial_topics, where a topic genuinely
 * belongs to exactly one channel). It is administered under Website
 * Settings, not under editorial content.
 *
 * CODE is a locale tag validated against a real BCP-47 subset (see
 * editorialLanguageCodeSchema below) rather than a hardcoded
 * English/Arabic enum — "en", "ar", "en-GB", "pt-BR", "zh-Hant" and
 * "zh-Hant-TW" are all legal, so adding a third or fourth language is a
 * data insert and never a migration. Stored in the canonical BCP-47
 * casing (lowercase language, Titlecase script, UPPERCASE region) and
 * UNIQUE, so "en-GB" cannot be registered twice under different casing.
 *
 * DIRECTION is 'ltr' | 'rtl', stored as text + a CHECK (the repo
 * convention — see ballet_performance_opportunities.status — rather than a
 * PG enum type, so a future value is an additive CHECK swap and not an
 * ALTER TYPE). It exists so the website can set `dir` correctly per
 * translation without the frontend hardcoding a language list.
 *
 * SINGLE DEFAULT — enforced at the DATABASE level, race-safely, by the
 * partial unique index `editorial_languages_single_default` below:
 *
 *   CREATE UNIQUE INDEX ... ON editorial_languages (is_default)
 *     WHERE is_default
 *
 * Among the rows the index covers, `is_default` is always `true`, so
 * uniqueness on that one column means AT MOST ONE row can have
 * is_default = true. Two concurrent transactions each promoting a
 * different language to default cannot both commit — the second blocks on
 * the index and then fails with 23505 — which an application-level
 * "UPDATE ... SET is_default = false; UPDATE ... SET is_default = true"
 * pair could not guarantee on its own. The partial-unique-index pattern
 * is already established in this repo (0050_ballet_applications_active_
 * uniqueness.sql, 0017_auth_providers.sql).
 *
 * DEFAULT CANNOT BE DEACTIVATED. `is_default AND NOT is_active` is
 * rejected by the `editorial_languages_default_is_active` CHECK below, so
 * the invariant "the default language is always active" holds even against
 * hand-written SQL. The *ordering* rule an editor actually experiences —
 * "promote another active language to default FIRST, then deactivate this
 * one" — is enforced in the service layer, which performs the demote +
 * promote + deactivate as one transaction under SELECT ... FOR UPDATE row
 * locks (see editorialLanguagesService.ts). The CHECK is the backstop that
 * makes an illegal final state unrepresentable; the service layer is what
 * produces a useful error message and orders the two writes correctly.
 *
 * NO DELETE ROUTE. Languages are retired with is_active = false, never
 * dropped: editorial_post_translations.language_id is ON DELETE RESTRICT
 * precisely so a language can never be deleted out from under published
 * content. Deactivating a language never mutates any translation's stored
 * status — an already-published translation stays published; the language
 * is simply excluded from new-translation pickers and from publishing.
 */
export const EDITORIAL_LANGUAGE_DIRECTIONS = ["ltr", "rtl"] as const;
export const editorialLanguageDirectionSchema = z.enum(EDITORIAL_LANGUAGE_DIRECTIONS);
export type EditorialLanguageDirection = z.infer<typeof editorialLanguageDirectionSchema>;

/**
 * BCP-47 subset: language[-script][-region].
 *
 *   language  2-3 lowercase letters        en, ar, fil
 *   script    4 letters, Titlecase         Hant, Cyrl        (optional)
 *   region    2 uppercase letters OR 3 digits   GB, BR, 419   (optional)
 *
 * Deliberately NOT the full RFC 5646 grammar (no variants, extensions, or
 * private-use subtags): those have no meaning for choosing a content
 * locale, and a narrow, readable pattern is easier to reason about at a
 * trust boundary than a permissive one. The pattern is case-SENSITIVE so
 * exactly one spelling of each tag can ever be stored — callers should
 * normalize with `canonicalizeEditorialLanguageCode` before validating.
 */
export const EDITORIAL_LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

export const editorialLanguageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(15)
  .regex(
    EDITORIAL_LANGUAGE_CODE_RE,
    'A language code must be a locale tag like "en", "ar", "en-GB", or "zh-Hant-TW".',
  );

/**
 * Fold a user-supplied tag into canonical BCP-47 casing so "EN-gb",
 * "en-gb" and "en-GB" all resolve to the one stored row. Subtag ROLE is
 * derived from length and position exactly as BCP-47 defines it (4 letters
 * = script, 2 letters or 3 digits = region), never from the casing the
 * caller happened to send.
 */
export function canonicalizeEditorialLanguageCode(raw: string): string {
  const parts = raw.trim().split("-");
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4 && /^[A-Za-z]{4}$/.test(part)) {
        return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
      return part;
    })
    .join("-");
}

export const editorialLanguagesTable = pgTable("editorial_languages", {
  id:               serial("id").primaryKey(),
  code:             text("code").notNull(),
  name:             text("name").notNull(),
  nativeName:       text("native_name").notNull(),
  direction:        text("direction").notNull().default("ltr").$type<EditorialLanguageDirection>(),
  isActive:         boolean("is_active").notNull().default(true),
  isDefault:        boolean("is_default").notNull().default(false),
  displayOrder:     integer("display_order").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  unique("editorial_languages_code_unique").on(table.code),
  // AT MOST ONE default language, guaranteed by the database rather than by
  // application ordering — see the header comment.
  uniqueIndex("editorial_languages_single_default")
    .on(table.isDefault)
    .where(sql`${table.isDefault}`),
  check("editorial_languages_code_not_blank", sql`length(trim(${table.code})) > 0`),
  check("editorial_languages_name_not_blank", sql`length(trim(${table.name})) > 0`),
  check("editorial_languages_native_name_not_blank", sql`length(trim(${table.nativeName})) > 0`),
  check("editorial_languages_direction_valid", sql`${table.direction} IN ('ltr', 'rtl')`),
  // Defense-in-depth mirror of EDITORIAL_LANGUAGE_CODE_RE. A CHECK cannot
  // import the TS regex, so the pattern is restated here — keep the two in
  // sync by hand if the accepted tag grammar ever widens.
  check(
    "editorial_languages_code_shape",
    sql`${table.code} ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'`,
  ),
  // The default language is ALWAYS active. Makes "deactivated default" an
  // unrepresentable state, not merely an unreachable one.
  check(
    "editorial_languages_default_is_active",
    sql`NOT (${table.isDefault} AND NOT ${table.isActive})`,
  ),
  check("editorial_languages_display_order_non_negative", sql`${table.displayOrder} >= 0`),
]);

export type EditorialLanguage = typeof editorialLanguagesTable.$inferSelect;
export type InsertEditorialLanguage = typeof editorialLanguagesTable.$inferInsert;
